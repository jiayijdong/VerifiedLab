"""Write the inspectable outputs of a run: brief, records, rule check, review request, trace."""
from __future__ import annotations
import csv, json, subprocess, hashlib
from pathlib import Path
from . import config

def git_rev(path: Path) -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=path, text=True, stderr=subprocess.DEVNULL).strip()
    except Exception:
        return "unknown"

def write_all(run_dir: Path, state: dict) -> list[str]:
    run_dir.mkdir(parents=True, exist_ok=True)
    q, hero, ver, gate, critic = state["query"], state["hero"], state["verification"], state["gate"], state["critic_final"]
    written = []
    def put(name, text):
        (run_dir / name).write_text(text); written.append(name)
    # 1 source records
    with (run_dir / "source_records.csv").open("w", newline="") as f:
        cols = list(q["rows"][0].keys()); w = csv.DictWriter(f, cols); w.writeheader(); w.writerows(q["rows"])
    written.append("source_records.csv")
    # 2 rule check (the real executed verification of this run)
    stack = next(d for d in ver["decisions"] if d["field"] == "Cell_stack_sequence")
    put("rule_check.json", json.dumps({
        "scope": "Executed in this run: deterministic ordered-sequence rule plus two LLM judges under psc-verify-v1; reference is the released record, not a new full-article audit.",
        "reference": f"Released structured record, DOI {hero['Ref_DOI']}", "field": "Cell_stack_sequence",
        "candidate_origin": state["catch"]["candidate_origin"], "candidate": stack["candidate"], "released_reference": stack["reference"],
        "rule": stack["rule"], "rule_detail": stack["rule_detail"], "judge_a": stack["judge_a"], "judge_b": stack["judge_b"], "label": stack["label"], "decided_by": stack["decided_by"],
        "correction": state["repair"]["record"].get("Cell_stack_sequence") if state.get("repair") else None,
        "correction_matches_reference": state["repair"]["verification"]["summary"]["rejected"] == [] if state.get("repair") else None,
        "policy_context": {"annotation": f"psc-annotate-v1@{state['skills']['annotate']}", "verification": f"psc-verify-v1@{state['skills']['verify']}"},
        "models": {"generator": state["models"].get("generator"), "judge_a": state["models"].get("verifier_a"), "judge_b": state["models"].get("verifier_b")}}, indent=2) + "\n")
    # 3 review request
    withheld = [c for c in critic["claims"] if c["verdict"] == "WITHHELD"]
    lines = ["# Human review request", ""]
    for c in withheld:
        g = gate["by_category"].get(c["category"], {})
        lines += [f"Claim: {c['statement']}", f"Category: {c['category']} (judged accuracy {g.get('reliability')} %; workflow requires >{g.get('threshold')} %)", f"Decision: WITHHELD. {c['reason']}", ""]
    lines += ["These scores describe categories, not the probability that an individual value is correct; failing this gate does not prove a claim false.",
              "Next step: audit source articles and supplements for matched devices, temperature, atmosphere, illumination, encapsulation, exposure duration and retained PCE. Do not infer stability from efficiency."]
    put("review_request.md", "\n".join(lines) + "\n")
    # 4 research brief
    c = q["contract"]; sup = [x for x in critic["claims"] if x["verdict"] == "SUPPORTED"]
    brief = ["# VerifiedLab research brief (live run)", "", f"Request: {state['request']}", "", "## Scoped answer", "", critic["scoped_answer"], "", "## Claims", ""]
    brief += [f"- [{x['verdict']}] {x['statement']} ({x['category']}; {x['reason']})" for x in critic["claims"]]
    brief += ["", "## Query contract", "", f"- Composition starts with {c['composition_prefix']!r}, excludes {c['composition_excludes']}; additive contains {c['additive_contains']!r}.",
              f"- Reverse-scan PCE in ({c['pce_min']}, {c['pce_max']}]; transport layers {c['transport_layers']}; surface treatment required: {c['require_surface_treatment']}.",
              f"- {q['n']} matching records of {q['eligible_records']} eligible ({q['total_records']} total); median PCE {q['median_pce']} %; share >= 22 %: {q['share_above_22']}.",
              "", "## Reliability scope", "", f"Automation threshold {gate['threshold']} % judged accuracy. " + gate["scope"],
              "", "## Verified example record", "", f"DOI {hero['Ref_DOI']}: released stack {hero['Cell_stack_sequence']}, reverse-scan PCE {hero['JV_measured_reverse_scan_PCE']}.",
              f"Generator draft: {ver['summary']['accepted']}/{ver['summary']['fields']} fields accepted on first pass; rejected: {ver['summary']['rejected']}. See rule_check.json and field_decisions.json.",
              "", "## Scope", "", "Agents ran live on local open-weight models (see run.json). The query, statistics, rule checks and these files are computed from the released records. The source note for the example record is a prose rendering of the released record, not article text. No new discovery is claimed."]
    put("research_brief.md", "\n".join(brief) + "\n")
    # 5 machine-readable bundle
    put("field_decisions.json", json.dumps(ver["decisions"], indent=1) + "\n")
    put("record_draft.json", json.dumps(state["catch"]["record"], indent=1) + "\n")
    if state.get("repair"):
        put("record_corrected.json", json.dumps(state["repair"]["record"], indent=1) + "\n")
    if state.get("audit"):
        a = {k: v for k, v in state["audit"].items() if k != "results"}; a["results"] = state["audit"]["results"]
        put("cohort_audit.json", json.dumps(a, indent=1) + "\n")
    with (run_dir / "trace.jsonl").open("w") as f:
        for rec in state["trace"]:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    written.append("trace.jsonl")
    put("run.json", json.dumps({
        "run_id": run_dir.name, "request": state["request"], "models": state["models"], "skills": state["skills"], "policy": state["policy"]["version"],
        "timings_seconds": state["timings"], "llm_calls": len(state["trace"]),
        "manuscript_commit": git_rev(config.PAPER), "dataset_commit": git_rev(config.DATASET.parents[1]),
        "dataset_sha256": hashlib.sha256(config.DATASET.read_bytes()).hexdigest(),
        "plan": state["plan"], "gate": gate, "critic_overrides_by_harness": state["overridden"], "slurm_job": state.get("slurm_job")}, indent=2) + "\n")
    return written
