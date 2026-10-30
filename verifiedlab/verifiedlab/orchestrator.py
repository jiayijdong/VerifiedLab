"""Runs the full harness in nine chapters: each chapter is one harness stage with live agent calls and emitted events."""
from __future__ import annotations
import os, time, datetime
from pathlib import Path
from . import agents, config, data, gate as gating, rules, artifacts
from .llm import Router

CHAPTERS = [
    ("ask",      "01 / ONE RESEARCH TASK",      "What will you investigate?"),
    ("contract", "02 / EXECUTION CONTRACT",     "Generate. Verify. Then reason."),
    ("catch",    "03 / INSPECT ONE DEVICE",     "Same materials. Wrong order?"),
    ("repair",   "04 / VERIFICATION RULE",      "Order is part of the value."),
    ("query",    "05 / QUERY THE CORPUS",       "From one record to a recipe family."),
    ("gate",     "06 / RELIABILITY GATE",       "Let reliability decide what runs next."),
    ("critic",   "07 / SCIENTIFIC CRITIC",      "The evidence changes the answer."),
    ("handoff",  "08 / INSPECT THE OUTPUT",     "A research lead you can open."),
    ("close",    "09 / VERIFIEDLAB",            "Harnessing Knowns for Unknowns."),
]
COVERAGE = [  # (regex on the request, category, question the claim must answer)
    (r"stabil|degrad|lifetime|long-term|retain", "Stability metrics", "Does the evidence support a long-term stability claim for this recipe family?"),
    (r"efficien|pce|performance|high-eff", "J-V metrics", "What reported efficiency does this recipe family reach?"),
]

def plan_coverage_check(request: str, plan: dict) -> list[dict]:
    """Deterministic harness check: every topic the researcher asked about must have a claim in the plan; comparative wording widens the scope."""
    import re
    plan.setdefault("scope", "cohort")
    if re.search(r"which (kind|type|family|architecture|layer|stack)|highest|best|lead|outperform|compare", request, re.I): plan["scope"] = "corpus_comparison"
    have = {c["category"] for c in plan["claims_to_make"]}
    added = []
    for pat, cat, question in COVERAGE:
        if re.search(pat, request, re.I) and cat not in have:
            added.append({"question": question, "category": cat}); have.add(cat)
    plan["claims_to_make"] = added + plan["claims_to_make"]
    return added

DEFAULT_REQUEST = "Find a high-efficiency perovskite solar-cell recipe and show the evidence. Can we also trust its long-term stability?"

class Run:
    def __init__(self, request: str = DEFAULT_REQUEST, *, emit=None, pause=None, catch_mode: str = "auto", audit: bool = True,
                 run_id: str | None = None, router: Router | None = None):
        self.request = request or DEFAULT_REQUEST
        self.emit = emit or (lambda e: None)
        self.pause = pause or (lambda chapter: None)
        self.catch_mode = catch_mode          # auto | model | inject
        self.audit = audit
        self.run_id = run_id or datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        self.run_dir = config.RUNS / self.run_id
        self.router = router or Router(trace=[])
        self.trace = self.router.trace          # one trace list shared by router and run
        self.state = {"request": self.request, "trace": self.trace, "timings": {}, "models": {}, "slurm_job": os.environ.get("SLURM_JOB_ID")}

    # ----- helpers
    def ev(self, type_, **kw):
        self.emit({"type": type_, "t": round(time.time() - self.t0, 2), **kw})
    def log(self, text, **kw):
        self.ev("log", text=text, **kw)
    def llm_ev(self, res):
        self.ev("llm", **res["meta"])
    def chapter(self, cid):
        _, k, title = next(c for c in CHAPTERS if c[0] == cid)
        self.pause(cid)
        self.ev("chapter", id=cid, kicker=k, title=title)
        return time.time()
    def done(self, cid, t):
        self.state["timings"][cid] = round(time.time() - t, 2)
        self.ev("chapter_done", id=cid, seconds=self.state["timings"][cid])

    # ----- the run
    def start(self) -> dict:
        self.t0 = time.time()
        roles = self.router.describe()
        self.state["models"] = {r: (v.get("models") or [None])[0] for r, v in roles.items()}
        self.state["roles"] = roles
        self.state["policy"] = policy = config.load_policy()
        self.state["skills"] = {"annotate": config.skill_text("psc-annotate-v1")[0], "verify": config.skill_text("psc-verify-v1")[0]}
        self.ev("run", run_id=self.run_id, request=self.request, roles=roles, skills=self.state["skills"], policy=policy["version"], chapters=[c[0] for c in CHAPTERS])

        # 01 ask: the PI agent turns the request into a plan and a query contract
        t = self.chapter("ask")
        self.log(f"YOU: {self.request}")
        res = agents.pi_plan(self.router, self.request); self.llm_ev(res)
        plan = res["json"]; added = plan_coverage_check(self.request, plan)
        if added:
            self.log(f"Harness plan check: the request asks about {', '.join(a['category'] for a in added)}; added the missing claim(s) to the plan.", level="note")
        self.state["plan"] = plan
        self.ev("result", id="ask", plan=plan["plan"], contract=plan["query_contract"], claims=plan["claims_to_make"], harness_added=added)
        self.done("ask", t)

        # 02 contract: load versioned Skills; separate generator from verifier
        t = self.chapter("contract")
        self.ev("result", id="contract", generator={"skill": f"psc-annotate-v1@{self.state['skills']['annotate']}", "model": self.state["models"]["generator"]},
                verifier={"skill": f"psc-verify-v1@{self.state['skills']['verify']}", "judge_a": self.state["models"]["verifier_a"], "judge_b": self.state["models"]["verifier_b"],
                          "replicas_b": roles["verifier_b"].get("replicas")},
                policy={"name": policy["policy"], "version": policy["version"], "threshold": policy["automation_threshold_percent"]},
                fields=len(config.LIVE_FIELDS), schema_fields=97)
        self.done("contract", t)

        # 03 catch: the generator drafts a record from the device note; verifier judges every field against the released record
        t = self.chapter("catch")
        hero = data.hero(); self.state["hero"] = hero
        note = (config.SOURCES / "adfm.202417293.device_note.md").read_text()
        self.log(f"Generator ({self.state['models']['generator']}) reads the device note for DOI {hero['Ref_DOI']} under psc-annotate-v1.")
        res = agents.generator_draft(self.router, note, config.LIVE_FIELDS); self.llm_ev(res)
        draft = res["json"]; origin = "Live generator output from the device note."
        chk = rules.ordered_sequence_check(draft.get("Cell_stack_sequence", ""), hero["Cell_stack_sequence"])
        if self.catch_mode == "inject" or (self.catch_mode == "auto" and chk["same_order"]):
            self.log("Generator kept the substrate-first order. Injecting the top-down (reversed) stack as a labelled counterfactual probe so the rule is exercised.", level="note")
            draft = {**draft, "Cell_stack_sequence": "/".join(reversed(hero["Cell_stack_sequence"].split("/")))}
            origin = "Live generator output with Cell_stack_sequence deliberately reversed (illustrative error, labelled)."
            chk = rules.ordered_sequence_check(draft["Cell_stack_sequence"], hero["Cell_stack_sequence"])
        self.ev("result", id="catch", candidate_stack=draft.get("Cell_stack_sequence"), reference_stack=hero["Cell_stack_sequence"], check=chk, record=draft, origin=origin)
        self.log("Verifier: judge A, judge B and the harness rules label every field.")
        ver = agents.verify_record(self.router, draft, hero, config.LIVE_FIELDS)
        self.llm_ev({"meta": ver["summary"]["models"]["judge_a"]}); self.llm_ev({"meta": ver["summary"]["models"]["judge_b"]})
        self.state["catch"] = {"record": draft, "candidate_origin": origin, "check": chk}
        self.state["verification"] = ver
        self.ev("result", id="verify", summary={k: v for k, v in ver["summary"].items() if k != "models"}, decisions=ver["decisions"])
        self.done("catch", t)

        # 04 repair: feedback to the generator; the corrected record must pass the rule
        t = self.chapter("repair")
        rejected = [d for d in ver["decisions"] if d["label"] in ("FP", "FN", "FP_mismatch")]
        if rejected:
            fb = [{"field": d["field"], "label": d["label"], "rule": d["rule"], "candidate": d["candidate"]} for d in rejected]
            self.log(f"Verifier rejects {len(rejected)} field(s): {[d['field'] for d in rejected]}. Returning decisions and rules to the generator.")
            res = agents.generator_draft(self.router, note, config.LIVE_FIELDS, feedback=fb); self.llm_ev(res)
            fixed = res["json"]
            ver2 = agents.verify_record(self.router, fixed, hero, config.LIVE_FIELDS)
            self.llm_ev({"meta": ver2["summary"]["models"]["judge_a"]}); self.llm_ev({"meta": ver2["summary"]["models"]["judge_b"]})
            self.state["repair"] = {"record": fixed, "verification": ver2, "feedback": fb}
            chk2 = rules.ordered_sequence_check(fixed.get("Cell_stack_sequence", ""), hero["Cell_stack_sequence"])
            self.ev("result", id="repair", corrected_stack=fixed.get("Cell_stack_sequence"), check=chk2, summary={k: v for k, v in ver2["summary"].items() if k != "models"},
                    still_rejected=ver2["summary"]["rejected"], doi=hero["Ref_DOI"])
        else:
            self.state["repair"] = None
            self.ev("result", id="repair", corrected_stack=draft.get("Cell_stack_sequence"), check=chk, summary={k: v for k, v in ver["summary"].items() if k != "models"}, still_rejected=[], doi=hero["Ref_DOI"])
        self.done("repair", t)

        # 05 query: the librarian executes the PI's contract on the released records; the verifier pool audits the cohort in parallel
        t = self.chapter("query")
        qc = plan["query_contract"]
        q = data.query_records(**qc); self.state["query"] = q
        self.log(f"query_records({qc}) -> {q['n']} records, median PCE {q['median_pce']} %.")
        self.ev("result", id="query", contract=q["contract"], n=q["n"], median=q["median_pce"], share_above_22=q["share_above_22"], total=q["total_records"], eligible=q["eligible_records"], values=q["values"])
        if self.audit and q["n"]:
            pool = self.router.pool("verifier_b")
            self.log(f"Cohort audit: {q['n']} records across {len(pool)} verifier replicas ({pool[0].model}) on {sorted({e.node for e in pool})}.")
            last = [0.0]
            def progress(i, n, ep):
                if time.time() - last[0] > 0.4 or i == n:
                    last[0] = time.time(); self.ev("progress", id="audit", done=i, total=n, server=ep.name, node=ep.node)
            audit = agents.audit_cohort(self.router, q["rows"], progress); self.state["audit"] = audit
            self.ev("result", id="audit", **{k: v for k, v in audit.items() if k != "results"})
        else:
            self.state["audit"] = None
        self.done("query", t)

        # 06 gate: the reliability policy decides the route of every claim category
        t = self.chapter("gate")
        g = gating.apply_gate(plan["claims_to_make"], policy); self.state["gate"] = g
        self.ev("result", id="gate", **g, reliabilities=policy["category_reliability_percent"])
        self.done("gate", t)

        # 07 critic: a specialist drafts claims; the critic scopes them; the harness enforces the gate
        t = self.chapter("critic")
        res = agents.specialist_answer(self.router, plan, q, hero); self.llm_ev(res)
        claims = res["json"]["claims"]; self.state["specialist"] = claims
        self.ev("result", id="specialist", claims=claims)
        res = agents.critic_review(self.router, claims, g, policy, evidence={"cohort": {k: q[k] for k in ("contract", "n", "median_pce", "share_above_22")}, "cohort_splits": data.splits(q["rows"])}); self.llm_ev(res)
        final, overridden = gating.enforce(res["json"]["claims"], g)
        res = agents.scoped_answer(self.router, final, self.request); self.llm_ev(res); scoped = res["text"].strip()
        self.state["critic_final"] = {"claims": final, "scoped_answer": scoped}; self.state["overridden"] = overridden
        self.ev("result", id="critic", claims=final, scoped_answer=scoped, harness_overrides=overridden)
        self.done("critic", t)

        # 08 handoff: write the inspectable artifacts
        t = self.chapter("handoff")
        files = artifacts.write_all(self.run_dir, self.state)
        self.ev("result", id="handoff", run_dir=str(self.run_dir), files=files)
        self.done("handoff", t)

        # 09 close
        t = self.chapter("close")
        self.ev("result", id="close", papers=q["total_records"], fields=97, llm_calls=len(self.trace), seconds=round(time.time() - self.t0, 1),
                gpus=sorted({f"{r['node']}:{r['gpus']}" for r in self.trace}))
        self.done("close", t)
        self.ev("run_done", run_id=self.run_id, run_dir=str(self.run_dir))
        return self.state
