#!/usr/bin/env python
"""Web front end: POST /run starts a live run; GET /events/{id} streams its events (SSE); artifacts served from runs/."""
from __future__ import annotations
import json, queue, sys, threading
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from verifiedlab import config
from verifiedlab.llm import Router
from verifiedlab.orchestrator import Run, DEFAULT_REQUEST, CHAPTERS
from verifiedlab.questions import KEY_QUESTIONS, by_id
from verifiedlab.research import investigate
from verifiedlab import api as workspace_api

app = FastAPI(title="VerifiedLab")
app.include_router(workspace_api.router)                      # read-only workspace API (/api/*)
app.mount("/ui", StaticFiles(directory=str(config.ROOT / "ui")), name="ui")   # front-end assets
RUNS: dict[str, dict] = {}          # run_id -> {"events": [...], "queues": [Queue,...], "done": bool}
ROUTER: Router | None = None
LOCK = threading.Lock()

class RunRequest(BaseModel):
    request: str = DEFAULT_REQUEST
    catch: str = "auto"
    audit: bool = True

class AskRequest(BaseModel):
    question: str = ""
    key: int | None = None

def new_record():
    rec = {"events": [], "queues": [], "done": False}
    def emit(e):
        with LOCK:
            rec["events"].append(e)
            for q in rec["queues"]: q.put(e)
    return rec, emit

def finish(rec):
    with LOCK:
        rec["done"] = True
        for q in rec["queues"]: q.put(None)

def router() -> Router:
    global ROUTER
    with LOCK:
        if ROUTER is None:
            ROUTER = Router()
        return ROUTER

@app.get("/", response_class=HTMLResponse)
def index():
    return (config.ROOT / "ui" / "index.html").read_text()


@app.get("/health")
def health():
    r = Router(); return {"servers": r.health, "roles": r.describe()}

@app.get("/policies/{name}", response_class=PlainTextResponse)
def policy(name: str):
    p = config.POLICIES / name
    if not p.exists() or p.suffix not in (".md", ".json"): raise HTTPException(404)
    return p.read_text()

@app.get("/sources/{name}", response_class=PlainTextResponse)
def source(name: str):
    p = config.SOURCES / name
    if not p.exists(): raise HTTPException(404)
    return p.read_text()

@app.get("/default")
def default():
    return {"request": DEFAULT_REQUEST, "chapters": CHAPTERS, "dataset": str(config.DATASET)}

@app.get("/questions")
def questions():
    return {"questions": [{k: q[k] for k in ("id", "topic", "question", "why")} for q in KEY_QUESTIONS]}

@app.get("/servers")
def servers():
    return {"servers": config.load_endpoints(), "roles": Router().describe()}

@app.post("/run")
def start(req: RunRequest):
    rec, emit = new_record()
    rt = Router(trace=[]); rt.on_event = emit
    run = Run(req.request, emit=emit, catch_mode=req.catch, audit=req.audit, router=rt)
    RUNS[run.run_id] = rec
    def work():
        try:
            run.start()
        except Exception as err:   # noqa: BLE001
            emit({"type": "error", "text": f"{type(err).__name__}: {err}"})
        finally:
            finish(rec)
    threading.Thread(target=work, daemon=True).start()
    return {"run_id": run.run_id}

@app.post("/investigate")
def start_investigation(req: AskRequest):
    import datetime
    kq = by_id(req.key) if req.key else None
    question = kq["question"] if kq else req.question.strip()
    if not question: raise HTTPException(400, "question or key required")
    rec, emit = new_record()
    run_id = "investigation-" + datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    RUNS[run_id] = rec
    rt = Router(trace=[]); rt.on_event = emit
    emit({"type": "ask", "question": question, "key": kq, "roles": rt.describe(), "run_id": run_id})
    def work():
        try:
            investigate(rt, question, calls=(kq["calls"] if kq else None), emit=lambda kind, **e: emit({"type": "inv", "kind": kind, **e}), run_id=run_id.split("-", 1)[1])
        except Exception as err:   # noqa: BLE001
            emit({"type": "error", "text": f"{type(err).__name__}: {err}"})
        finally:
            finish(rec)
    threading.Thread(target=work, daemon=True).start()
    return {"run_id": run_id}

@app.get("/events/{run_id}")
def events(run_id: str):
    rec = RUNS.get(run_id)
    if rec is None: raise HTTPException(404)
    q: queue.Queue = queue.Queue()
    with LOCK:
        backlog = list(rec["events"]); done = rec["done"]; rec["queues"].append(q)
    def gen():
        for e in backlog: yield f"data: {json.dumps(e)}\n\n"
        if done: yield "event: end\ndata: {}\n\n"; return
        while True:
            e = q.get()
            if e is None: yield "event: end\ndata: {}\n\n"; return
            yield f"data: {json.dumps(e)}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.get("/runs/{run_id}/{name}")
def artifact(run_id: str, name: str):
    p = config.RUNS / run_id / name
    if not p.exists() or ".." in name: raise HTTPException(404)
    return FileResponse(p, media_type="text/plain; charset=utf-8")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(sys.argv[1]) if len(sys.argv) > 1 else 8765, log_level="warning")
