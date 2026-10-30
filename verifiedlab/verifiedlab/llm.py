"""OpenAI-compatible client over the vLLM servers, with role routing, JSON-schema decoding, retries and a trace."""
from __future__ import annotations
import fnmatch, itertools, json, re, threading, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from openai import OpenAI
from . import config

class Endpoint:
    def __init__(self, row: dict):
        self.name, self.model, self.url, self.node, self.gpus = row["name"], row["model"], row["url"], row["node"], row["gpus"]
        self.client = OpenAI(base_url=self.url, api_key="EMPTY", timeout=180, max_retries=1)
    def healthy(self, timeout=2.0) -> bool:
        try:
            urllib.request.urlopen(self.url.replace("/v1", "/health"), timeout=timeout); return True
        except Exception:
            return False
    @property
    def is_qwen(self):
        return "qwen" in self.model.lower()

class Router:
    """Maps agent roles to healthy endpoints; verifier_b is a pool that is used round-robin / in parallel."""
    def __init__(self, endpoints: list[dict] | None = None, trace=None):
        self.endpoints = [Endpoint(r) for r in (endpoints or config.load_endpoints())]
        self.health = {e.name: e.healthy() for e in self.endpoints}
        self.trace = trace if trace is not None else []
        self._lock = threading.Lock()
        self._rr = {}
        self.on_event = None          # optional callback(dict) fired at call start and end
    def pool(self, role: str) -> list[Endpoint]:
        for pattern in config.ROLES[role]:
            hits = [e for e in self.endpoints if fnmatch.fnmatch(e.name, pattern) and self.health.get(e.name)]
            if hits:
                return hits
        raise RuntimeError(f"no healthy server for role {role}; healthy: {[k for k,v in self.health.items() if v]}")
    def pick(self, role: str) -> Endpoint:
        pool = self.pool(role)
        it = self._rr.setdefault(role, itertools.cycle(range(len(pool))))
        return pool[next(it) % len(pool)]
    def describe(self) -> dict:
        out = {}
        for role in config.ROLES:
            try:
                p = self.pool(role); out[role] = {"models": sorted({e.model for e in p}), "replicas": len(p), "nodes": sorted({f"{e.node}:gpu{e.gpus}" for e in p})}
            except RuntimeError as err:
                out[role] = {"error": str(err)}
        return out

    def chat(self, role: str, system: str, user: str, *, schema: dict | None = None, max_tokens=1200,
             temperature=0.0, tag: str = "", endpoint: Endpoint | None = None, retries=2) -> dict:
        ep = endpoint or self.pick(role)
        messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        kwargs = dict(model=ep.name, messages=messages, max_tokens=max_tokens, temperature=temperature)
        extra = {}
        if ep.is_qwen:
            extra["chat_template_kwargs"] = {"enable_thinking": False}
        if schema is not None:
            kwargs["response_format"] = {"type": "json_schema", "json_schema": {"name": tag or role, "schema": schema}}
        if extra:
            kwargs["extra_body"] = extra
        last = None
        if self.on_event: self.on_event({"type": "call_start", "role": role, "tag": tag, "server": ep.name, "node": ep.node, "gpus": ep.gpus, "model": ep.model})
        for attempt in range(retries + 1):
            t0 = time.time()
            try:
                r = ep.client.chat.completions.create(**kwargs)
                text = r.choices[0].message.content or ""
                if r.choices[0].finish_reason == "length" and schema is not None and kwargs["max_tokens"] < 4096:
                    kwargs["max_tokens"] = min(4096, kwargs["max_tokens"] * 2)      # truncated JSON: give the model room and retry
                    raise ValueError(f"output truncated at {r.usage.completion_tokens} tokens; retrying with max_tokens={kwargs['max_tokens']}")
                data = parse_json(text) if schema is not None else None
                if schema is not None and data is None:
                    kwargs["temperature"] = 0.3                                     # a different sample next time
                    raise ValueError("model returned no parsable JSON")
                rec = {"role": role, "tag": tag, "model": ep.model, "server": ep.name, "node": ep.node, "gpus": ep.gpus,
                       "seconds": round(time.time() - t0, 2), "prompt_tokens": r.usage.prompt_tokens, "completion_tokens": r.usage.completion_tokens,
                       "system": system, "user": user, "output": text, "attempt": attempt}
                with self._lock:
                    self.trace.append(rec)
                meta = {k: rec[k] for k in ("role","tag","model","server","node","gpus","seconds","prompt_tokens","completion_tokens")}
                if self.on_event: self.on_event({"type": "call_end", **meta})
                return {"text": text, "json": data, "meta": meta}
            except Exception as err:  # noqa: BLE001
                last = err
                if self.on_event: self.on_event({"type": "call_retry", "role": role, "tag": tag, "server": ep.name, "attempt": attempt, "error": str(err)[:160]})
                time.sleep(0.5 + attempt)
        if self.on_event: self.on_event({"type": "call_end", "role": role, "tag": tag, "server": ep.name, "node": ep.node, "gpus": ep.gpus, "model": ep.model, "seconds": 0, "prompt_tokens": 0, "completion_tokens": 0, "failed": True})
        raise RuntimeError(f"{role} call failed on {ep.name}: {last}")

    def map_parallel(self, role: str, items: list, fn, workers: int | None = None) -> list:
        """Run fn(endpoint, item) over the role's replica pool in parallel; results keep item order."""
        pool = self.pool(role)
        workers = workers or max(4, 4 * len(pool))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            return list(ex.map(lambda ix: fn(pool[ix[0] % len(pool)], ix[1]), enumerate(items)))

def parse_json(text: str):
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{.*\}", text, flags=re.S)
    if m:
        try: return json.loads(m.group(0))
        except json.JSONDecodeError: pass
    # last resort: close an unterminated string / object (truncated output)
    for tail in ('"}', '"}]}', '"}}', '"]}', '}', ']}', '}}', '"}]}}'):
        try: return json.loads(text + tail)
        except json.JSONDecodeError: continue
    return None

def json_schema_for(fields: list[str], enum: list[str] | None = None) -> dict:
    prop = {"type": "string"} if not enum else {"type": "string", "enum": enum}
    return {"type": "object", "properties": {f: prop for f in fields}, "required": fields, "additionalProperties": False}
