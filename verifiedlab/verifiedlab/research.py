"""One investigation, in the Verified Lab's architecture: PI plans (and, for exploratory questions, chooses the librarian's tools)
-> librarian computes the evidence -> specialist answers -> reliability gate -> critic scopes -> artifacts are written."""
from __future__ import annotations
import datetime, json, time
from . import agents, config, gate as gating, librarian
from .llm import Router, json_schema_for

TOOL_PLAN_SCHEMA = {"type": "object", "properties": {
    "plan": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 4},
    "calls": {"type": "array", "minItems": 1, "maxItems": 4, "items": {"type": "object", "properties": {
        "tool": {"type": "string", "enum": list(librarian.TOOLS)},
        "args": {"type": "object", "properties": {
            "contract": {"type": "object", "properties": {k: {"type": ["string", "number", "boolean", "array"]} for k in ("composition_prefix", "composition_excludes", "additive_contains", "pce_min", "pce_max", "require_surface_treatment", "composition_contains", "etl_contains", "htl_contains", "stack_contains", "surface_contains", "architecture", "year_min", "year_max")}, "additionalProperties": False},
            "field": {"type": "string"}, "pce_min": {"type": "number"}}, "additionalProperties": False}},
        "required": ["tool", "args"], "additionalProperties": False}},
    "claims_to_make": {"type": "array", "minItems": 1, "maxItems": 3, "items": {"type": "object", "properties": {
        "question": {"type": "string"}, "category": {"type": "string", "enum": ["Reference data", "Cell definition", "Device stack", "Material synthesis", "Device fabrication", "J-V metrics", "Stability metrics"]}},
        "required": ["question", "category"], "additionalProperties": False}}},
    "required": ["plan", "calls", "claims_to_make"], "additionalProperties": False}

PI_TOOLS_SYSTEM = agents.PI_SYSTEM + """

For this investigation you also choose which librarian tools to call (at most four). Each tool computes statistics over the
released records; pick the ones whose numbers would answer the researcher's question, and set a query contract only when the
question names a family, architecture (use architecture: "NIP" or "PIN") or layer; when the question restricts to one group,
every call must carry that restriction in its contract. Your claims_to_make must be exactly the questions the researcher asked. Field names for top_values are schema fields such as Perovskite_additive_compound,
Perovskite_surface_treatment_material, Perovskite_deposition_spin_coating_antisolvent, ETL_stack_sequence, HTL_stack_sequence,
Encapsulation_method."""

def investigate(router: Router, question: str, calls: list[dict] | None = None, policy: dict | None = None, emit=None, run_id: str | None = None) -> dict:
    """Run one question through the architecture. `calls` fixed = key question; None = the PI chooses tools (exploratory)."""
    emit = emit or (lambda kind, **kw: None); policy = policy or config.load_policy(); t0 = time.time()
    run_id = run_id or datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    # 1 PI
    if calls is None:
        user = f"Researcher's request:\n{question}\n\nLibrarian tools:\n{json.dumps(librarian.TOOL_MENU, indent=1)}\n\nReturn the JSON object."
        res = router.chat("pi", PI_TOOLS_SYSTEM, user, schema=TOOL_PLAN_SCHEMA, tag="pi_tools", max_tokens=900)
        plan = res["json"]; calls = plan["calls"]; mode = "exploratory"
    else:
        res = agents.pi_plan(router, question); plan = res["json"]; mode = "key question"
    from .orchestrator import plan_coverage_check
    if mode == "exploratory":
        import re
        if re.search(r"stabil|degrad|lifetime|long-term|retain", question, re.I) and not any(c["category"] == "Stability metrics" for c in plan["claims_to_make"]):
            plan["claims_to_make"].append({"question": "Is the stability claim established?", "category": "Stability metrics"})
        archs = {a for a, pat in (("PIN", r"\bp-?i-?n\b|inverted"), ("NIP", r"\bn-?i-?p\b|regular")) if re.search(pat, question, re.I)}
        if len(archs) == 1:   # the question is about one architecture: every call must be scoped to it
            for c in calls:
                if c["tool"] in ("cohort", "trend", "bandgap", "area", "top_values", "stability"):
                    c.setdefault("args", {}); c["args"]["contract"] = {**(c["args"].get("contract") or {}), "architecture": next(iter(archs))}
    else:
        plan_coverage_check(question, plan)
    emit("pi", plan=plan, calls=calls, meta=res["meta"], mode=mode)
    # 2 librarian
    evidence = librarian.run_calls(calls)
    if evidence and all(e.get("reliability") is None for e in evidence):   # nothing usable: fall back to the broad, always-valid view
        evidence = evidence + librarian.run_calls([{"tool": "breakdowns"}, {"tool": "top_values", "args": {"field": "Perovskite_composition_long_form"}}])
    emit("evidence", evidence=evidence)
    ev_for_models = {f"{e['tool']}_{i}": {"title": e.get("title", e["tool"]), "category": e.get("category", "Reference data"), "judged_accuracy": e.get("reliability"), **(e.get("summary") or {}), "note": e.get("note", "")} for i, e in enumerate(evidence)}
    # 3 specialist team in parallel, then the PI consolidates
    team = agents.team_answers(router, plan, ev_for_models)
    emit("team", team=team)
    res = agents.synthesize(router, plan, team)
    claims = res["json"]["claims"]
    import re as _re
    for c in claims:   # the harness, not the model, decides which category a claim rests on: the category of the evidence it cites
        cited = {ev_for_models[k]["category"] for k in _re.findall(r"\b([a-z_]+_\d+)\b", c.get("evidence", "")) if k in ev_for_models}
        if len(cited) == 1: c["category"] = cited.pop()
        elif "Stability metrics" in cited: c["category"] = "Stability metrics"
    emit("specialist", claims=claims, meta=res["meta"])
    # 4 gate
    g = gating.apply_gate(plan["claims_to_make"] + claims, policy); emit("gate", gate=g)
    # 5 critic: each claim is judged against the evidence items it cites (all items if it cites none)
    per_claim = {}
    for i, c in enumerate(claims):
        keys = [k for k in _re.findall(r"\b([a-z_]+_\d+)\b", c.get("evidence", "")) if k in ev_for_models]
        per_claim[f"claim_{i+1}"] = {"statement": c["statement"], "evidence_items": {k: ev_for_models[k] for k in keys} if keys else ev_for_models}
    # harness scope rule: a claim that names one architecture must rest on evidence scoped to it
    scope_flags = {}
    for i, c in enumerate(claims):
        named = {a for a, pat in (("PIN", r"\bp-?i-?n\b|inverted"), ("NIP", r"\bn-?i-?p\b|regular")) if _re.search(pat, c["statement"], _re.I)}
        if len(named) == 1:
            items = per_claim[f"claim_{i+1}"]["evidence_items"].values()
            scoped = any(str(it.get("scope", "")).upper().find(next(iter(named))) >= 0 or str(it.get("contract", "")).upper().find(next(iter(named))) >= 0 or isinstance(it.get("groups"), list) for it in items)
            if not scoped: scope_flags[i] = f"harness scope rule: the claim restricts to {next(iter(named))} but its evidence is not scoped to that architecture"
    caveats = {}
    # harness bound rule: a value at the query's upper bound (30 %) is a likely garbled extraction and cannot carry a claim
    for i, c in enumerate(claims):
        if any(float(x) >= 29.95 for x in _re.findall(r"(\d+\.\d+|\d+)\s*%?", c["statement"]) if float(x) <= 100) and _re.search(r"\b(29\.9\d|30(\.0+)?)\s*%?", c["statement"]):
            msg = "harness bound rule: the quoted 30 % value sits at the query's upper bound and is a likely garbled extraction; verify it at the source DOI before citing"
            if _re.search(r"median", c["statement"], _re.I): caveats[i] = msg          # the claim rests on a median: keep it, attach the caveat
            else: scope_flags[i] = (scope_flags[i] + "; " if i in scope_flags else "") + msg
    checked = agents.critic_parallel(router, claims, g, policy, per_claim)
    metas = [c.pop("meta") for c in checked]
    final, over = gating.enforce(checked, g, scope_flags)
    for i, c in enumerate(final):
        if i in caveats: c["reason"] += "; caveat: " + caveats[i]
    scoped = agents.scoped_answer(router, final, question)["text"].strip()
    emit("critic", claims=final, scoped=scoped, overrides=over, meta=metas[0] if metas else None, metas=metas)
    # 6 artifacts
    run_dir = config.RUNS / f"investigation-{run_id}"; run_dir.mkdir(parents=True, exist_ok=True)
    brief = [f"# VerifiedLab investigation ({mode})", "", f"Question: {question}", "", "## Scoped answer", "", scoped, "", "## Claims", ""]
    brief += [f"- [{c['verdict']}] {c['statement']} ({c['category']}; {c['reason']})" for c in final]
    brief += ["", "## Evidence (librarian)", ""]
    for e in evidence:
        brief += [f"### {e['title']}  —  {e['category']}, {e['reliability']} % judged accuracy", "", "```json", json.dumps(e["summary"], indent=1, default=str)[:4000], "```", e["note"], ""]
    brief += ["## Scope", "", f"PI: {router.pool('pi')[0].model}; specialist: {router.pool('specialist')[0].model}; critic: {router.pool('critic')[0].model}. Statistics are computed from the released records; medians describe reported champion devices and are not causal; category accuracy is not per-value confidence."]
    (run_dir / "research_brief.md").write_text("\n".join(brief) + "\n")
    (run_dir / "evidence.json").write_text(json.dumps({"question": question, "plan": plan, "calls": calls, "evidence": evidence, "team": [{k: t[k] for k in ("agent", "claims", "meta")} for t in team], "claims": final, "scoped_answer": scoped, "gate": g}, indent=1, default=str) + "\n")
    with (run_dir / "trace.jsonl").open("w") as f:
        for rec in router.trace: f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    emit("done", run_dir=str(run_dir), files=["research_brief.md", "evidence.json", "trace.jsonl"], seconds=round(time.time() - t0, 1), scoped=scoped, claims=final)
    return {"plan": plan, "evidence": evidence, "claims": final, "scoped_answer": scoped, "run_dir": str(run_dir)}
