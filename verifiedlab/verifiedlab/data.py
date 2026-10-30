"""Released records: loading, the librarian's reliability-scoped query tool, and the data card."""
from __future__ import annotations
import re, statistics
from functools import lru_cache
import pandas as pd
from . import config

NUM = re.compile(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?")

def number(value) -> float | None:
    m = NUM.search(str(value).replace(",", ""))
    return float(m[0]) if m else None

@lru_cache(maxsize=1)
def records() -> pd.DataFrame:
    df = pd.read_parquet(config.DATASET)
    return df.fillna("Null")

def hero() -> dict:
    df = records()
    return df[df.Ref_DOI == config.HERO_DOI].iloc[0].to_dict()

def category_of(field: str, policy: dict) -> str:
    for prefix, cat in policy["field_category"].items():
        if field.startswith(prefix):
            return cat
    return "Other"

# ---- the librarian's query tool: one explicit, inspectable contract -----------------------------------------
QUERY_TOOL = {
    "name": "query_records",
    "description": "Filter the released champion-device records. All filters are case-sensitive substring/prefix tests on schema fields.",
    "parameters": {
        "type": "object",
        "properties": {
            "composition_prefix": {"type": "string", "description": "Perovskite_composition_long_form must start with this (e.g. 'FAPbI3')."},
            "composition_excludes": {"type": "array", "items": {"type": "string"}, "description": "Substrings that must NOT appear in the composition (e.g. ['Cs','MA'])."},
            "additive_contains": {"type": "string", "description": "Substring required in Perovskite_additive_compound (e.g. 'MACl'); empty for none."},
            "pce_min": {"type": "number"}, "pce_max": {"type": "number"},
            "require_surface_treatment": {"type": "boolean"}
        },
        "required": ["composition_prefix", "composition_excludes", "additive_contains", "pce_min", "pce_max", "require_surface_treatment"],
        "additionalProperties": False
    }
}

ARCH_ALIAS = {"nip": "NIP", "n-i-p": "NIP", "regular": "NIP", "normal": "NIP", "conventional": "NIP", "pin": "PIN", "p-i-n": "PIN", "inverted": "PIN"}
EXTRA_FILTERS = {   # name -> (column, kind); kind: contains | equals | year_min | year_max
    "composition_contains": ("Perovskite_composition_long_form", "contains"),
    "etl_contains": ("ETL_stack_sequence", "contains"),
    "htl_contains": ("HTL_stack_sequence", "contains"),
    "stack_contains": ("Cell_stack_sequence", "contains"),
    "surface_contains": ("Perovskite_surface_treatment_material", "contains"),
    "antisolvent_contains": ("Perovskite_deposition_spin_coating_antisolvent", "contains"),
    "journal_contains": ("Ref_journal", "contains"),
    "architecture": ("Cell_architecture", "equals"),
    "dimension": ("Perovskite_dimension", "equals"),
    "encapsulation": ("Encapsulation_method", "contains"),
    "year_min": ("Ref_publication_year", "year_min"),
    "year_max": ("Ref_publication_year", "year_max"),
}

def query_records(composition_prefix="", composition_excludes=(), additive_contains="", pce_min=0.0, pce_max=30.0, require_surface_treatment=False, **extra) -> dict:
    df = records()
    pce = df["JV_measured_reverse_scan_PCE"].map(number)
    mask = pce.notna() & (pce > pce_min) & (pce <= pce_max)
    comp = df["Perovskite_composition_long_form"]
    if composition_prefix:
        mask &= comp.str.startswith(composition_prefix)
    for s in composition_excludes or ():
        mask &= ~comp.str.contains(s, regex=False)
    if additive_contains:
        mask &= df["Perovskite_additive_compound"].str.contains(additive_contains, regex=False)
    if require_surface_treatment:
        mask &= df["Perovskite_surface_treatment_material"] != "Null"
    for k, v in extra.items():
        if v in (None, "", False): continue
        col, kind = EXTRA_FILTERS[k]
        if kind == "contains": mask &= df[col].str.contains(str(v), case=False, regex=False)
        elif kind == "equals":
            want = ARCH_ALIAS.get(str(v).strip().lower(), str(v).strip().upper()) if col == "Cell_architecture" else str(v).upper()
            mask &= df[col].str.upper().str.replace("-", "", regex=False) == want
        elif kind == "year_min": mask &= df[col].map(number).fillna(-1) >= float(v)
        elif kind == "year_max": mask &= df[col].map(number).fillna(9999) <= float(v)
    rows = df[mask]
    values = [number(v) for v in rows["JV_measured_reverse_scan_PCE"]]
    cols = ["Ref_DOI", "Ref_publication_year", "Cell_architecture", "Cell_stack_sequence", "ETL_stack_sequence", "HTL_stack_sequence",
            "Perovskite_composition_long_form", "Perovskite_additive_compound", "Perovskite_surface_treatment_material", "JV_measured_reverse_scan_PCE",
            "Perovskite_bandgap", "Cell_area_measured", "Perovskite_deposition_spin_coating_antisolvent", "Stability_PCE_after_time", "Stability_PCE_after_time_value"]
    return {
        "contract": dict(composition_prefix=composition_prefix, composition_excludes=list(composition_excludes), additive_contains=additive_contains,
                         pce_min=pce_min, pce_max=pce_max, require_surface_treatment=require_surface_treatment, transport_layers="unrestricted",
                         **{k: v for k, v in extra.items() if v not in (None, "", False)}),
        "total_records": int(len(df)), "eligible_records": int((pce.notna() & (pce > 0) & (pce <= 30)).sum()),
        "n": int(len(rows)), "median_pce": round(statistics.median(values), 2) if values else None,
        "share_above_22": round(sum(v >= 22 for v in values) / len(values), 4) if values else None,
        "values": values, "rows": rows[cols].to_dict("records"), "index": rows.index.tolist(),
    }


def record_by_doi(doi: str) -> dict | None:
    df = records()
    hit = df[df.Ref_DOI.str.lower() == doi.lower().replace("https://doi.org/", "")]
    return hit.iloc[0].to_dict() if len(hit) else None

def value_counts(rows: list[dict] | None, field: str, k: int = 12) -> list[tuple[str, int]]:
    import collections
    src = rows if rows is not None else records().to_dict("records")
    c = collections.Counter(str(r.get(field, "Null")) for r in src)
    return c.most_common(k)

def by_year(rows: list[dict]) -> list[tuple[int, int, float]]:
    """(year, n, median PCE) for rows with a parsable year."""
    import collections, statistics
    g = collections.defaultdict(list)
    for r in rows:
        y, v = number(r.get("Ref_publication_year")), number(r.get("JV_measured_reverse_scan_PCE"))
        if y and v: g[int(y)].append(v)
    return [(y, len(v), round(statistics.median(v), 2)) for y, v in sorted(g.items())]


def _stats(vals):
    import statistics
    return {"n": len(vals), "median_pce": round(statistics.median(vals), 2), "share_above_22": round(sum(v >= 22 for v in vals) / len(vals), 3)} if vals else {"n": 0}

def splits(rows: list[dict]) -> dict:
    """Comparative statistics the librarian attaches to every answer, so comparative claims rest on compared numbers."""
    pce = lambda r: number(r.get("JV_measured_reverse_scan_PCE"))
    treated = [pce(r) for r in rows if r.get("Perovskite_surface_treatment_material", "Null") != "Null" and pce(r)]
    untreated = [pce(r) for r in rows if r.get("Perovskite_surface_treatment_material", "Null") == "Null" and pce(r)]
    nip = [pce(r) for r in rows if str(r.get("Cell_architecture", "")).upper() == "NIP" and pce(r)]
    pin = [pce(r) for r in rows if str(r.get("Cell_architecture", "")).upper() == "PIN" and pce(r)]
    stab = [r for r in rows if r.get("Stability_PCE_after_time_value", "Null") != "Null"]
    return {"by_surface_treatment": {"treated": _stats(treated), "untreated": _stats(untreated)},
            "by_architecture": {"NIP": _stats(nip), "PIN": _stats(pin)},
            "by_year": [{"year": y, "n": n, "median_pce": m} for y, n, m in by_year(rows)],
            "stability_reported": {"records_with_retained_pce": len(stab), "of": len(rows),
                                   "note": "Stability fields are the least reliable category (70.31 %); conditions differ between papers and are not comparable without source review."}}


def family(comp: str) -> str:
    """Coarse absorber family from the composition string (A-site cations and Sn)."""
    c = str(comp)
    if c == "Null" or not c.strip(): return "unreported"
    fa, ma, cs, sn = "FA" in c, ("MA" in c and "MACl" not in c.replace("MA", "", 0)) or "CH3NH3" in c, "Cs" in c, "Sn" in c
    ma = ("MA" in c) or ("CH3NH3" in c)
    if sn: return "Sn-containing"
    if cs and fa and ma: return "Cs/FA/MA triple cation"
    if cs and fa: return "Cs/FA double cation"
    if fa and ma: return "FA/MA double cation"
    if fa: return "FA-only"
    if ma: return "MA-only"
    if cs: return "all-inorganic Cs"
    return "other"

def group_stats(rows: list[dict], key, top: int = 8, min_n: int = 20) -> list[dict]:
    """Per-group n / median / max PCE (with the DOI of the max) / share >= 22 %, sorted by median; key is a column or a function."""
    import collections, statistics
    g = collections.defaultdict(list)
    for r in rows:
        v = number(r.get("JV_measured_reverse_scan_PCE"))
        if v is None: continue
        k = key(r) if callable(key) else str(r.get(key, "Null"))
        g[k].append((v, r["Ref_DOI"]))
    out = []
    for k, vals in g.items():
        if len(vals) < min_n or k.upper() in ("NULL", "UNREPORTED", "OTHER"): continue
        vs = [v for v, _ in vals]; mx = max(vals)
        out.append({"group": k, "n": len(vs), "median_pce": round(statistics.median(vs), 2), "max_pce": mx[0], "max_doi": mx[1], "share_above_22": round(sum(v >= 22 for v in vs) / len(vs), 3)})
    return sorted(out, key=lambda d: -d["median_pce"])[:top]

def corpus_breakdowns(rows: list[dict] | None = None) -> dict:
    """What 'kind' of device leads, across the whole corpus (or a cohort): by absorber family, architecture, ETL, HTL, surface treatment."""
    rows = rows if rows is not None else query_records(pce_min=0, pce_max=30)["rows"]
    return {"scope": f"{len(rows)} released champion devices with 0 < PCE <= 30; groups with fewer than 20 records are omitted",
            "by_absorber_family": group_stats(rows, lambda r: family(r.get("Perovskite_composition_long_form"))),
            "by_architecture": group_stats(rows, lambda r: str(r.get("Cell_architecture", "Null")).upper()),
            "by_ETL": group_stats(rows, "ETL_stack_sequence"), "by_HTL": group_stats(rows, "HTL_stack_sequence"),
            "by_surface_treatment": group_stats(rows, lambda r: "treated" if r.get("Perovskite_surface_treatment_material", "Null") != "Null" else "untreated", min_n=1),
            "overall_max": max(({"pce": number(r["JV_measured_reverse_scan_PCE"]), "doi": r["Ref_DOI"], "family": family(r.get("Perovskite_composition_long_form")), "stack": r["Cell_stack_sequence"]} for r in rows if number(r["JV_measured_reverse_scan_PCE"])), key=lambda d: d["pce"]),
            "reading": "Medians describe reported champion devices per group (publication-biased); a single maximum is one paper's reported value, not a family property. A maximum equal to 30.0 sits exactly at the query's upper bound and is likely a garbled extraction (module, tandem or unit error): check it at the source DOI before citing it."}
