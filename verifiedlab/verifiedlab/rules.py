"""Deterministic scientific rules executed by the harness (the part of the verification Skill that is code, not prose)."""
from __future__ import annotations
import re
from .data import number

EMPTY = {"", "null", "nan", "unknown", "none", "n/a"}
SUBSTRATES = ("FTO", "ITO", "Glass", "glass", "soda", "Soda", "quartz", "Quartz", "PEN", "PET", "PI", "PDMS", "Si", "Ti", "AZO", "antireflection", "Antireflection", "AR")

def is_empty(v) -> bool:
    return str(v).strip().lower() in EMPTY

ALIAS_TOKENS = re.compile(r"\b(glass|substrate|electrode|contact|layer|film|top|bottom|back)\b", re.I)

def norm_layer(s: str) -> str:
    """Case/spacing-insensitive layer name; substrate and electrode qualifiers are dropped (Skill: aliases ignored when layers stay aligned)."""
    s = ALIAS_TOKENS.sub("", str(s))
    return re.sub(r"[\s\-_()]", "", s).lower()

def split_stack(stack: str) -> list[str]:
    """Layers of a slash-joined stack; pure substrate carriers ('glass') are dropped because the Skill ignores substrate aliases."""
    return [p.strip() for p in str(stack).split("/") if p.strip() and norm_layer(p)]

def ordered_sequence_check(candidate: str, reference: str) -> dict:
    """The rule from the film: membership is not order. Compare substrate -> top contact."""
    c, r = split_stack(candidate), split_stack(reference)
    cn, rn = [norm_layer(x) for x in c], [norm_layer(x) for x in r]
    same_membership = sorted(cn) == sorted(rn)
    same_order = cn == rn
    return {"rule": "ordered_sequence", "field": "Cell_stack_sequence",
            "same_material_membership": same_membership, "same_order": same_order,
            "reversed_copy": same_membership and cn == rn[::-1] and len(rn) > 1,
            "decision": "TP" if same_order else ("FP_mismatch" if not is_empty(candidate) else "FN"),
            "explanation": "Layer order must run from substrate to top contact; material membership alone is insufficient." if not same_order else "Ordered sequence matches the reference."}

def numeric_equivalent(candidate: str, reference: str, rel_tol: float) -> bool | None:
    a, b = number(candidate), number(reference)
    if a is None or b is None:
        return None
    return abs(a - b) <= rel_tol * max(abs(b), 1e-9)

FIELD_RULES = {
    "Cell_stack_sequence": ("ordered", 0.0, "Ordered layer stack from substrate to top contact; same membership with different order is FP_mismatch."),
    "Perovskite_deposition_solvents_mixing_ratio": ("ordered_ratio", 0.0, "Solvent ratios keep their order; 8:1 is not 1:8."),
    "JV_measured_reverse_scan_PCE": ("numeric", 0.01, "Numeric, 1 % relative tolerance after unit conversion; keep the percent unit."),
    "JV_measured_reverse_scan_Voc": ("numeric", 0.01, "Numeric, 1 % tolerance; V and mV are convertible."),
    "JV_measured_reverse_scan_Jsc": ("numeric", 0.01, "Numeric, 1 % tolerance; mA/cm2."),
    "JV_measured_reverse_scan_FF": ("numeric", 0.01, "Numeric, 1 % tolerance; FF in % or fraction are convertible."),
    "Perovskite_bandgap": ("numeric", 0.02, "Numeric, 2 % tolerance, eV."),
    "Backcontact_thickness": ("numeric", 0.02, "Numeric, 2 % tolerance after unit conversion."),
    "Perovskite_additive_concentration": ("numeric", 0.02, "Numeric with unit, 2 % tolerance."),
    "Stability_PCE_after_time": ("numeric", 0.02, "Duration; preserve inequalities such as >1000 h."),
    "Stability_PCE_after_time_value": ("numeric", 0.02, "Retained PCE share in %."),
    "JV_measured_scan_speed": ("numeric", 0.02, "Scan speed; 0.2 V/s = 200 mV/s. A value the text does not state is an over-prediction (FP)."),
    "Cell_architecture": ("alias", 0.0, "NIP = nip = n-i-p = regular; PIN = inverted."),
    "Perovskite_composition_long_form": ("chem", 0.0, "Chemical notation aliases are identical; an additive written inside the composition is FP_mismatch."),
    "Perovskite_additive_compound": ("chem", 0.0, "Chemical aliases are identical; multiple entries separated by ';' in any order."),
    "Perovskite_surface_treatment_material": ("chem", 0.0, "The compound applied onto the formed absorber as a passivation or interlayer treatment; not the antisolvent, a precursor or a transport layer. Chemical aliases are identical."),
    "ETL_stack_sequence": ("ordered", 0.0, "Ordered; compact and mesoporous layers are distinct."),
    "HTL_stack_sequence": ("ordered", 0.0, "Ordered; distinct oxides and polymers are never merged."),
    "Ref_DOI": ("exact", 0.0, "Exact after case folding and stripping a URL prefix."),
}

def rule_text(field: str) -> str:
    return FIELD_RULES.get(field, ("free", 0.0, "Semantic equivalence under the Skill's general rules."))[2]

def deterministic_label(field: str, candidate: str, reference: str) -> dict | None:
    """Labels the harness can decide without a model. Returns None when the decision needs the verifier."""
    ce, re_ = is_empty(candidate), is_empty(reference)
    if ce and re_: return {"label": "TN", "by": "rule:empty"}
    if ce: return {"label": "FN", "by": "rule:empty"}
    if re_: return {"label": "FP", "by": "rule:empty"}
    kind, tol, _ = FIELD_RULES.get(field, ("free", 0.0, ""))
    if kind == "ordered":
        chk = ordered_sequence_check(candidate, reference)
        return {"label": chk["decision"], "by": "rule:ordered_sequence", "detail": chk}
    if kind == "ordered_ratio":
        a = re.findall(r"\d+(?:\.\d+)?", candidate); b = re.findall(r"\d+(?:\.\d+)?", reference)
        if a and b: return {"label": "TP" if a == b else "FP_mismatch", "by": "rule:ordered_ratio"}
    if kind == "numeric":
        eq = numeric_equivalent(candidate, reference, tol)
        if eq is not None and same_unit_family(candidate, reference):
            return {"label": "TP" if eq else "FP_mismatch", "by": f"rule:numeric(tol={tol})"}
    if kind == "exact":
        a = candidate.lower().replace("https://doi.org/", "").strip(); b = reference.lower().replace("https://doi.org/", "").strip()
        return {"label": "TP" if a == b else "FP_mismatch", "by": "rule:exact"}
    if kind == "alias" and field == "Cell_architecture":
        m = {"nip": "nip", "n-i-p": "nip", "regular": "nip", "pin": "pin", "p-i-n": "pin", "inverted": "pin"}
        a, b = m.get(candidate.strip().lower()), m.get(reference.strip().lower())
        if a and b: return {"label": "TP" if a == b else "FP_mismatch", "by": "rule:alias"}
    return None   # chem / free: ask the verifier model under the Skill

def same_unit_family(a: str, b: str) -> bool:
    """Crude guard so that 1.164 V vs 1164 mV goes to the model (unit conversion) rather than being auto-rejected."""
    ua = re.sub(r"[\d\.\s,%]", "", a).lower(); ub = re.sub(r"[\d\.\s,%]", "", b).lower()
    return ua == ub or (ua == "" and ub == "") or ("%" in a and "%" in b)

# ---- record self-consistency rules for the cohort audit (no article text needed) ----------------------------
def record_consistency(row: dict) -> dict:
    layers = split_stack(row.get("Cell_stack_sequence", ""))
    arch = str(row.get("Cell_architecture", "")).strip().upper().replace("-", "")
    substrate_first = bool(layers) and any(layers[0].upper().startswith(s.upper()) for s in SUBSTRATES)
    comp = norm_layer(str(row.get("Perovskite_composition_long_form", "")))
    etl = norm_layer(str(row.get("ETL_stack_sequence", "")).split("/")[0]) if not is_empty(row.get("ETL_stack_sequence")) else ""
    htl = norm_layer(str(row.get("HTL_stack_sequence", "")).split("/")[0]) if not is_empty(row.get("HTL_stack_sequence")) else ""
    ln = [norm_layer(x) for x in layers]
    def idx(name):
        if not name: return None
        for i, l in enumerate(ln):
            if l and (name in l or l in name): return i
        return None
    i_etl, i_htl = idx(etl), idx(htl)
    i_abs = next((i for i, l in enumerate(ln) if "perovskite" in l or (comp and (comp[:5] in l))), None)
    arch_ok = None
    if i_etl is not None and i_htl is not None:
        arch_ok = (i_etl < i_htl) if arch == "NIP" else ((i_htl < i_etl) if arch == "PIN" else None)
    return {"stack_substrate_first": substrate_first, "architecture_consistent_with_stack": arch_ok,
            "absorber_in_stack": i_abs is not None, "n_layers": len(layers)}
