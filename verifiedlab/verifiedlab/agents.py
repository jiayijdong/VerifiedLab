"""The agents of the Verified Lab, each a thin prompt around a Skill plus a JSON schema the harness validates."""
from __future__ import annotations
import json
from . import config, rules
from .data import QUERY_TOOL, category_of
from .llm import Router, json_schema_for

LABELS = ["TN", "FP", "FN", "TP", "FP_mismatch"]

# ---------------------------------------------------------------- principal investigator
PI_SYSTEM = """You are the principal-investigator agent of a Verified Lab for perovskite solar cells. You never read papers directly:
every fact reaches you through a librarian harness that returns verified records tagged with category-level reliability.
Turn the researcher's request into (1) a short research plan, (2) one explicit, executable query contract for the librarian's
`query_records` tool, (2b) the scope of evidence needed: "cohort" when the request is about one recipe family, or
"corpus_comparison" when it asks which kind / family / architecture / layer is best, highest, or how groups compare, and (3) the list of claims the team will have to make to answer the request: exactly one per question the researcher actually
asked, phrased as that question, each tagged with the schema category whose fields would supply the evidence
(efficiency/PCE/Voc/FF -> "J-V metrics"; stability/degradation/retained PCE -> "Stability metrics"; layer stack -> "Device stack";
composition/additives/solvents -> "Material synthesis"; deposition/annealing -> "Device fabrication"). Categories: Reference data, Cell definition, Device stack, Material synthesis,
Device fabrication, J-V metrics, Stability metrics. Default recipe family unless the researcher names another:
compositions beginning with FAPbI3, excluding Cs and MA from the composition, with MACl as additive, reverse-scan PCE in (0, 30]."""

PI_SCHEMA = {"type": "object", "properties": {
    "plan": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 5},
    "scope": {"type": "string", "enum": ["cohort", "corpus_comparison"]},
    "query_contract": QUERY_TOOL["parameters"],
    "claims_to_make": {"type": "array", "minItems": 1, "maxItems": 3, "items": {"type": "object", "properties": {
        "question": {"type": "string"}, "category": {"type": "string", "enum": ["Reference data", "Cell definition", "Device stack", "Material synthesis", "Device fabrication", "J-V metrics", "Stability metrics"]}},
        "required": ["question", "category"], "additionalProperties": False}}},
    "required": ["plan", "scope", "query_contract", "claims_to_make"], "additionalProperties": False}

def pi_plan(router: Router, request: str) -> dict:
    user = f"Researcher's request:\n{request}\n\nTool available to the librarian:\n{json.dumps(QUERY_TOOL, indent=1)}\n\nReturn the JSON object."
    return router.chat("pi", PI_SYSTEM, user, schema=PI_SCHEMA, tag="pi_plan", max_tokens=900)

# ---------------------------------------------------------------- generator (annotation agent)
def generator_draft(router: Router, note: str, fields: list[str], feedback: dict | None = None) -> dict:
    version, skill = config.skill_text("psc-annotate-v1")
    system = f"{skill}\n\n[Skill psc-annotate-v1@{version}]"
    user = (f"Source text:\n{note}\n\nFill exactly these keys (string values; use the literal string Null when absent):\n{json.dumps(fields)}\n")
    if feedback:
        user += ("\nA verifier under psc-verify-v1 rejected your previous record. Field decisions and rules:\n" + json.dumps(feedback, indent=1)
                 + "\nRe-read the source text for each rejected field and re-emit the complete record, correcting every rejected field according to its rule. Keep accepted fields unchanged.")
    return router.chat("generator", system, user, schema=json_schema_for(fields), tag="generate" if not feedback else "repair", max_tokens=900)

# ---------------------------------------------------------------- verifier (judge A, judge B pool, harness rules)
def _verify_prompt(pairs: list[dict]) -> tuple[str, str]:
    version, skill = config.skill_text("psc-verify-v1")
    system = f"{skill}\n\n[Skill psc-verify-v1@{version}]"
    lines = [f"- field: {p['field']}\n  candidate: {p['candidate']}\n  reference: {p['reference']}\n  rule: {p['rule']}" for p in pairs]
    return system, "Field units to classify:\n" + "\n".join(lines) + "\n\nReturn a JSON object mapping each field name to its label."

def verify_record(router: Router, candidate: dict, reference: dict, fields: list[str]) -> dict:
    pairs = [{"field": f, "candidate": str(candidate.get(f, "Null")), "reference": str(reference.get(f, "Null")), "rule": rules.rule_text(f)} for f in fields]
    system, user = _verify_prompt(pairs)
    schema = json_schema_for(fields, enum=LABELS)
    a = router.chat("verifier_a", system, user, schema=schema, tag="judge_a", max_tokens=600)
    b = router.chat("verifier_b", system, user, schema=schema, tag="judge_b", max_tokens=600)
    decisions = []
    for p in pairs:
        f = p["field"]
        det = rules.deterministic_label(f, p["candidate"], p["reference"])
        la, lb = (a["json"] or {}).get(f), (b["json"] or {}).get(f)
        final = det["label"] if det else (la if la == lb else la)     # rule > judge A > judge B
        decided_by = det["by"] if det else ("judges_agree" if la == lb else "judge_a(disagreement)")
        decisions.append({**p, "judge_a": la, "judge_b": lb, "rule_label": det["label"] if det else None, "label": final, "decided_by": decided_by,
                          "rule_detail": det.get("detail") if det else None})
    n = len(decisions)
    summary = {"fields": n, "accepted": sum(d["label"] in ("TP", "TN") for d in decisions),
               "rejected": [d["field"] for d in decisions if d["label"] in ("FP", "FN", "FP_mismatch")],
               "judge_agreement": round(sum(d["judge_a"] == d["judge_b"] for d in decisions) / n, 3),
               "judge_a_vs_rules": round(sum(d["judge_a"] == d["rule_label"] for d in decisions if d["rule_label"]) / max(1, sum(1 for d in decisions if d["rule_label"])), 3),
               "judge_b_vs_rules": round(sum(d["judge_b"] == d["rule_label"] for d in decisions if d["rule_label"]) / max(1, sum(1 for d in decisions if d["rule_label"])), 3),
               "models": {"judge_a": a["meta"], "judge_b": b["meta"]}}
    return {"decisions": decisions, "summary": summary}

# ---------------------------------------------------------------- cohort audit on the verifier pool
AUDIT_SYSTEM = """You are a verifier agent under the verification Skill psc-verify-v1. You check one released device record for
internal consistency with three explicit rules and answer each with true or false:
1. stack_substrate_first: Cell_stack_sequence starts at the substrate (FTO, ITO, glass, PEN, PET...) and ends at the top contact.
2. architecture_consistent_with_stack: for NIP the electron-transport layer comes before the absorber and the hole-transport layer after it; for PIN the reverse.
3. absorber_in_stack: the perovskite absorber (or the word 'perovskite') appears as a layer in the stack.
Return only JSON."""
AUDIT_SCHEMA = {"type": "object", "properties": {k: {"type": "boolean"} for k in ("stack_substrate_first", "architecture_consistent_with_stack", "absorber_in_stack")},
                "required": ["stack_substrate_first", "architecture_consistent_with_stack", "absorber_in_stack"], "additionalProperties": False}

def audit_cohort(router: Router, rows: list[dict], progress=None) -> dict:
    import time
    t0 = time.time(); done = [0]
    def one(ep, row):
        user = "Record:\n" + json.dumps({k: row[k] for k in ("Ref_DOI", "Cell_architecture", "Cell_stack_sequence", "ETL_stack_sequence", "HTL_stack_sequence", "Perovskite_composition_long_form")}, indent=1)
        r = router.chat("verifier_b", AUDIT_SYSTEM, user, schema=AUDIT_SCHEMA, tag="cohort_audit", max_tokens=80, endpoint=ep, retries=1)
        det = rules.record_consistency(row)
        done[0] += 1
        if progress: progress(done[0], len(rows), ep)
        return {"doi": row["Ref_DOI"], "server": ep.name, "node": ep.node, "gpu": ep.gpus, "judge": r["json"], "rule": det,
                "agree": all((r["json"] or {}).get(k) == det.get(k) for k in det if k != "n_layers" and det.get(k) is not None)}
    out = router.map_parallel("verifier_b", rows, one)
    secs = time.time() - t0
    pool = router.pool("verifier_b")
    flagged = [o for o in out if not (o["rule"]["stack_substrate_first"] and o["rule"]["absorber_in_stack"] and o["rule"]["architecture_consistent_with_stack"] is not False)]
    return {"n": len(out), "seconds": round(secs, 1), "records_per_second": round(len(out) / secs, 1), "replicas": len(pool),
            "nodes": sorted({e.node for e in pool}), "model": pool[0].model,
            "judge_rule_agreement": round(sum(o["agree"] for o in out) / len(out), 3),
            "rule_flagged": [{"doi": o["doi"], "rule": o["rule"]} for o in flagged], "results": out}

# ---------------------------------------------------------------- specialist (device physicist)
SPECIALIST_SYSTEM = """You are the device-physicist agent of a Verified Lab. You reason only over records the librarian returned.
Answer each of the principal investigator's questions with one claim. For every claim name the schema category its evidence
comes from and cite the evidence (cohort statistic or a DOI-bound record value). Be concrete and quantitative. A comparative claim
(X raises/lowers Y) is allowed only when the evidence contains the compared statistics; quote both numbers. A superlative claim
(highest, best, leading kind) is allowed only when the evidence contains a breakdown across several groups: answer with the group
median and n (the field-wide view), name the runner-up with its median, and mention a single maximum only as an aside with its
DOI; never let one record's maximum carry a claim, and never quote a value that sits at the query's upper bound (30 %). If the returned records do not contain the comparison, say so in the claim instead of inferring. Do not hedge otherwise: the scientific critic will decide
what is supported."""
SPEC_SCHEMA = {"type": "object", "properties": {"claims": {"type": "array", "minItems": 1, "maxItems": 4, "items": {"type": "object", "properties": {
    "statement": {"type": "string"}, "category": {"type": "string", "enum": ["Reference data", "Cell definition", "Device stack", "Material synthesis", "Device fabrication", "J-V metrics", "Stability metrics"]},
    "evidence": {"type": "string"}}, "required": ["statement", "category", "evidence"], "additionalProperties": False}}},
    "required": ["claims"], "additionalProperties": False}

def specialist_answer(router: Router, plan: dict, query: dict, hero: dict, breakdowns: dict | None = None) -> dict:
    from .data import splits
    from .data import query_records
    corpus = query_records(pce_min=0, pce_max=30)
    ev = {"cohort": {k: query[k] for k in ("contract", "n", "median_pce", "share_above_22")}, "cohort_splits": splits(query["rows"]),
          **({"corpus_breakdowns": breakdowns} if breakdowns else {}),
          "whole_corpus": {"n": corpus["n"], "median_pce": corpus["median_pce"], "share_above_22": corpus["share_above_22"], "scope": "all released champion devices with 0 < PCE <= 30"},
          "example_record": {k: hero.get(k, "Null") for k in ("Ref_DOI", "Cell_stack_sequence", "Perovskite_composition_long_form", "Perovskite_additive_compound", "JV_measured_reverse_scan_PCE",
                                                             "Stability_test_temperature", "Stability_test_atmosphere", "Stability_test_relative_humidity", "Stability_PCE_after_time", "Stability_PCE_after_time_value")}}
    user = f"Questions:\n{json.dumps(plan['claims_to_make'], indent=1)}\n\nEvidence returned by the librarian:\n{json.dumps(ev, indent=1)}\n\nReturn the JSON object."
    return router.chat("specialist", SPECIALIST_SYSTEM, user, schema=SPEC_SCHEMA, tag="specialist", max_tokens=700)

TEAM = [
    ("device physicist", "You are the device-physicist agent: you think in terms of architecture, transport layers, band alignment, area and J-V behaviour."),
    ("materials chemist", "You are the materials-chemist agent: you think in terms of absorber composition, additives, solvents, antisolvents, passivation and processing."),
    ("data scientist", "You are the data-scientist agent: you think in terms of sample sizes, medians versus maxima, publication bias, confounding and what the numbers can and cannot support."),
]

def team_answers(router: Router, plan: dict, ev_for_models: dict) -> list[dict]:
    """Three specialists answer the same questions in parallel, each from its own angle, on separate GPUs."""
    import json as _json
    from concurrent.futures import ThreadPoolExecutor
    def one(spec):
        name, persona = spec
        system = persona + "\n\n" + SPECIALIST_SYSTEM.split("\n", 1)[1]
        user = (f"Questions:\n{_json.dumps(plan['claims_to_make'], indent=1)}\n\nEvidence returned by the librarian (each item has a key):\n{_json.dumps(ev_for_models, indent=1, default=str)}"
                "\n\nIn each claim's evidence field, name the key(s) of the evidence items you used and quote the numbers.\nReturn the JSON object.")
        res = router.chat("specialist", system, user, schema=SPEC_SCHEMA, tag=f"specialist:{name.split()[0]}", max_tokens=700)
        return {"agent": name, "claims": res["json"]["claims"], "meta": res["meta"]}
    with ThreadPoolExecutor(max_workers=3) as ex:
        return list(ex.map(one, TEAM))

SYNTH_SYSTEM = """You are the principal-investigator agent consolidating your team's drafts into the claims the lab will submit to the
critic. Three specialists answered the same questions from different angles. Produce at most one claim per question: keep the
most precise, quantitative statement, merge complementary numbers, drop anything a specialist contradicts without evidence, and
keep each claim's evidence keys. Preserve the specialists' caution where they say the evidence is missing."""

def synthesize(router: Router, plan: dict, team: list[dict]) -> dict:
    import json as _json
    user = f"Questions:\n{_json.dumps(plan['claims_to_make'], indent=1)}\n\nTeam drafts:\n" + _json.dumps([{"agent": t["agent"], "claims": t["claims"]} for t in team], indent=1) + "\n\nReturn the JSON object."
    return router.chat("pi", SYNTH_SYSTEM, user, schema=SPEC_SCHEMA, tag="pi_synthesis", max_tokens=700)

def critic_parallel(router: Router, claims: list[dict], gate: dict, policy: dict, per_claim: dict) -> list[dict]:
    """One critic call per claim, spread over the 70B replicas; returns the checked claims in order."""
    from concurrent.futures import ThreadPoolExecutor
    def one(ic):
        i, c = ic
        try:
            res = critic_review(router, [c], gate, policy, evidence={f"claim_{i+1}": per_claim[f"claim_{i+1}"]})
            out = res["json"]["claims"][0] if res["json"].get("claims") else {**c, "checks": {}, "issue": "critic returned no decision"}
            out.setdefault("statement", c["statement"]); out.setdefault("category", c["category"]); out["meta"] = res["meta"]
        except Exception as err:  # noqa: BLE001
            out = {**c, "checks": {k: False for k in ("numbers_match_evidence", "direction_matches_evidence", "comparison_present_if_needed", "scope_matches_wording")},
                   "issue": f"critic call failed ({str(err)[:80]}); checks not completed", "meta": {"tag": "critic", "model": "-", "server": "-", "node": "-", "gpus": "-", "seconds": 0, "prompt_tokens": 0, "completion_tokens": 0}}
        return out
    with ThreadPoolExecutor(max_workers=max(1, len(claims))) as ex:
        return list(ex.map(one, enumerate(claims)))

# ---------------------------------------------------------------- critic
CRITIC_SYSTEM = """You are the scientific critic of a Verified Lab. You do not decide verdicts; the harness does. For every claim
you answer four factual checks against the evidence attached to that claim, true or false:
- numbers_match_evidence: every number quoted in the claim appears in its evidence (rounding to the shown precision is fine).
- direction_matches_evidence: the comparison or trend stated (higher, lower, rises, no difference, most common) agrees with the
  evidence. A 'no difference' claim is true when the compared statistics are equal or nearly equal; no statistical test exists
  or is expected.
- comparison_present_if_needed: a comparative or superlative claim has both sides (or a group breakdown within the dimension it
  names) in its evidence; a descriptive claim passes automatically.
- scope_matches_wording: the evidence was computed over the population the claim talks about (for example a claim about inverted
  cells rests on evidence scoped to PIN, not on the whole corpus).
Judge each claim exactly as worded, over the population and threshold it names; do not extend it to other populations or
thresholds that happen to be in the evidence. Write one short issue sentence when any check is false, otherwise an empty
string. Never infer stability from efficiency. The scoped_answer field may be left as a one-line summary; the final answer is
written after the harness has applied the gate."""

SCOPED_SYSTEM = """You are the scientific critic of a Verified Lab writing the final scoped answer. You receive the claims with the
harness's final verdict and reason. Write at most three sentences: state what the SUPPORTED claims establish with their key
numbers, then what is WITHHELD and why (category below the reliability threshold -> human review; failed check -> what is
missing). Do not soften or overturn a verdict."""

def scoped_answer(router: Router, final_claims: list[dict], question: str) -> dict:
    user = f"Question: {question}\n\nFinal claims:\n" + json.dumps([{k: c[k] for k in ("statement", "category", "verdict", "reason")} for c in final_claims], indent=1) + "\n\nWrite the scoped answer as plain text."
    return router.chat("critic", SCOPED_SYSTEM, user, tag="scoped_answer", max_tokens=300)
CRITIC_SCHEMA = {"type": "object", "properties": {"claims": {"type": "array", "items": {"type": "object", "properties": {
    "statement": {"type": "string"}, "category": {"type": "string"},
    "checks": {"type": "object", "properties": {k: {"type": "boolean"} for k in ("numbers_match_evidence", "direction_matches_evidence", "comparison_present_if_needed", "scope_matches_wording")},
               "required": ["numbers_match_evidence", "direction_matches_evidence", "comparison_present_if_needed", "scope_matches_wording"], "additionalProperties": False},
    "issue": {"type": "string"}}, "required": ["statement", "category", "checks", "issue"], "additionalProperties": False}},
    "scoped_answer": {"type": "string"}}, "required": ["claims", "scoped_answer"], "additionalProperties": False}

def critic_review(router: Router, claims: list[dict], gate: dict, policy: dict, evidence: dict | None = None) -> dict:
    user = (f"Workflow policy: automation threshold {policy['automation_threshold_percent']} % judged accuracy. "
            f"Category reliabilities: {json.dumps(policy['category_reliability_percent'])}\n\nClaims with their gate decision:\n"
            + json.dumps([{**c, "gate": gate["by_category"].get(c["category"])} for c in claims], indent=1))
    if evidence:
        user += "\n\nEvidence the librarian returned, attached to the claim that cites it (run the four checks for each claim only against its own evidence items):\n" + json.dumps(evidence, indent=1, default=str)
    user += "\n\nReturn the JSON object."
    return router.chat("critic", CRITIC_SYSTEM, user, schema=CRITIC_SCHEMA, tag="critic", max_tokens=900)
