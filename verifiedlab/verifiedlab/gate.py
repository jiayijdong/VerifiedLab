"""Reliability gate: a deterministic workflow policy applied to every category a claim rests on."""
from __future__ import annotations

def apply_gate(claims: list[dict], policy: dict) -> dict:
    thr = policy["automation_threshold_percent"]
    rel = policy["category_reliability_percent"]
    by_cat = {}
    for c in claims:
        cat = c["category"]
        r = rel.get(cat)
        by_cat[cat] = {"reliability": r, "threshold": thr, "route": "CONTINUE" if (r is not None and r > thr) else "HUMAN_REVIEW"}
    return {"threshold": thr, "by_category": by_cat, "scope": policy["reliability_scope"]}

CHECK_TEXT = {"numbers_match_evidence": "a number in the claim is not in its evidence", "direction_matches_evidence": "the stated direction disagrees with the evidence",
              "comparison_present_if_needed": "no comparison or group breakdown in the evidence for a comparative claim", "scope_matches_wording": "the evidence was computed over a different population than the claim names"}

def enforce(critic_claims: list[dict], gate: dict, scope_flags: dict | None = None) -> tuple[list[dict], list[str]]:
    """The harness, not the critic, has the last word. Verdict = all factual checks pass AND the category gate says CONTINUE
    AND the harness's own scope rule is satisfied. `overridden` lists claims the harness withheld although every check passed."""
    out, overridden = [], []
    for i, c in enumerate(critic_claims):
        route = gate["by_category"].get(c["category"], {}).get("route", "HUMAN_REVIEW")
        checks = c.get("checks") or {}
        failed = [k for k, v in checks.items() if v is False]
        reasons = []
        if route == "HUMAN_REVIEW":
            g = gate["by_category"].get(c["category"], {})
            reasons.append(f"category {c['category']} is judged at {g.get('reliability')} %, below the {g.get('threshold')} % policy: returned for human review")
        reasons += [CHECK_TEXT[k] for k in failed]
        flag = (scope_flags or {}).get(i)
        if flag: reasons.append(flag)
        if c.get("issue"): reasons.append(c["issue"].strip())
        verdict = "SUPPORTED" if not reasons else "WITHHELD"
        if verdict == "WITHHELD" and not failed and not c.get("issue"):
            overridden.append(c["statement"])
        out.append({**c, "verdict": verdict, "route": route, "reason": "; ".join(reasons) if reasons else "all checks pass and the category clears the gate"})
    return out, overridden
