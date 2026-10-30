"""The librarian: deterministic evidence tools over the released records. Every tool returns numbers the agents reason over,
a table the workspace renders, and the category reliability the gate applies. No model is involved here."""
from __future__ import annotations
import collections, statistics
from . import config, data
from .data import number, query_records, splits, corpus_breakdowns, by_year, family, group_stats

POLICY = config.load_policy()
REL = POLICY["category_reliability_percent"]
DEFAULT_CONTRACT = dict(composition_prefix="FAPbI3", composition_excludes=["Cs", "MA"], additive_contains="MACl", pce_min=0.0, pce_max=30.0, require_surface_treatment=False)
ALL = dict(pce_min=0.0, pce_max=30.0)

def _full_rows(q):            # rows with every column (query_records keeps a slice)
    return data.records().loc[q["index"]].to_dict("records")

def _stats(vals):
    return {"n": len(vals), "median_pce": round(statistics.median(vals), 2), "share_above_22": round(sum(v >= 22 for v in vals) / len(vals), 3)} if vals else {"n": 0}

# ------------------------------------------------------------------------------------------------- tools
def cohort(contract: dict | None = None) -> dict:
    """Records matching a query contract: n, median, share >= 22 %, and splits by surface treatment / architecture / year."""
    c = contract or DEFAULT_CONTRACT; q = query_records(**c)
    s = splits(q["rows"])
    return {"tool": "cohort", "title": "Cohort under the contract", "category": "J-V metrics", "reliability": REL["J-V metrics"],
            "summary": {"scope": describe_scope(q["contract"]), "contract": q["contract"], "n": q["n"], "eligible": q["eligible_records"], "median_pce": q["median_pce"], "share_above_22": q["share_above_22"], "splits": s},
            "table": {"columns": ["slice", "n", "median PCE", "≥ 22 %"], "rows":
                      [["all matching", q["n"], q["median_pce"], q["share_above_22"]]] +
                      [[f"surface {k}", v["n"], v.get("median_pce"), v.get("share_above_22")] for k, v in s["by_surface_treatment"].items()] +
                      [[k, v["n"], v.get("median_pce"), v.get("share_above_22")] for k, v in s["by_architecture"].items()]},
            "note": "Descriptive statistics of reported champion devices; transport layers unrestricted unless filtered."}

def breakdowns(contract: dict | None = None) -> list[dict]:
    """Which kind of device leads: one evidence item per dimension (absorber family, architecture, ETL, HTL; n >= 20)."""
    rows = query_records(**(contract or ALL))["rows"]; b = corpus_breakdowns(rows)
    items = []
    for key, label in (("by_absorber_family", "absorber family"), ("by_architecture", "architecture"), ("by_ETL", "electron-transport layer"), ("by_HTL", "hole-transport layer")):
        groups = b[key]
        items.append({"tool": f"breakdown_{label.split()[0].replace('-', '_')}", "title": f"Which {label} leads · {len(rows)} devices", "category": "J-V metrics", "reliability": REL["J-V metrics"],
                      "summary": {"dimension": label, "groups": groups, "overall_max": b["overall_max"] if key == "by_absorber_family" else None},
                      "table": {"columns": ["group", "n", "median PCE", "≥ 22 %", "max", "max DOI"], "rows": [[g["group"], g["n"], g["median_pce"], g["share_above_22"], g["max_pce"], g["max_doi"]] for g in groups]},
                      "note": b["reading"]})
    return items

def trend(contract: dict | None = None) -> dict:
    """Median PCE by publication year for the contract and for the whole corpus."""
    q = query_records(**(contract or DEFAULT_CONTRACT)); allq = query_records(**ALL)
    c = {y: (n, m) for y, n, m in by_year(q["rows"])}; a = {y: (n, m) for y, n, m in by_year(allq["rows"])}
    rows = [[y, c.get(y, (0, None))[0], c.get(y, (0, None))[1], a[y][0], a[y][1]] for y in sorted(a) if y >= 2021]
    return {"tool": "trend", "title": "Reported efficiency over time · " + describe_scope(q["contract"]), "category": "J-V metrics", "reliability": REL["J-V metrics"],
            "summary": {"scope": describe_scope(q["contract"]), "by_year": [{"year": r[0], "cohort_n": r[1], "cohort_median": r[2], "corpus_n": r[3], "corpus_median": r[4]} for r in rows]},
            "table": {"columns": ["year", "cohort n", "cohort median", "corpus n", "corpus median"], "rows": rows},
            "note": "Reported efficiencies drift upward with time; compare a family against the corpus of the same year."}

def bandgap(contract: dict | None = None, pce_min: float = 22.0) -> dict:
    """Bandgap distribution of devices above a PCE threshold: share inside 1.5-1.7 eV, median bandgap."""
    q = query_records(**(contract or ALL)); rows = _full_rows(q)
    pairs = [(number(r["Perovskite_bandgap"]), number(r["JV_measured_reverse_scan_PCE"])) for r in rows]
    pairs = [(b, p) for b, p in pairs if b and p and 0.8 <= b <= 3.0]
    hi = [b for b, p in pairs if p >= pce_min]; lo = [b for b, p in pairs if p < pce_min]
    win = lambda v: round(sum(1.5 <= x <= 1.7 for x in v) / len(v), 3) if v else None
    bins = collections.Counter(round(b, 1) for b in hi)
    return {"tool": "bandgap", "title": f"Bandgap of devices above {pce_min:g} % PCE · {describe_scope(q['contract'])}", "category": "Material synthesis", "reliability": REL["Material synthesis"],
            "summary": {"scope": describe_scope(q["contract"]), "records_with_bandgap": len(pairs), "above_threshold": {"n": len(hi), "median_bandgap_eV": round(statistics.median(hi), 3) if hi else None, "share_in_1.5_1.7_eV": win(hi)},
                        "below_threshold": {"n": len(lo), "median_bandgap_eV": round(statistics.median(lo), 3) if lo else None, "share_in_1.5_1.7_eV": win(lo)}},
            "table": {"columns": ["bandgap (eV)", f"devices ≥ {pce_min:g} %"], "rows": [[b, n] for b, n in sorted(bins.items())]},
            "note": "Bandgap is a Material-synthesis field (85.31 % judged accuracy); values outside 0.8-3.0 eV are dropped as garbled."}

def area(contract: dict | None = None, large_cm2: float = 1.0) -> dict:
    """Efficiency against measured cell area: median PCE for large-area devices (>= 1 cm2) versus all."""
    rows = _full_rows(query_records(**(contract or ALL)))
    def cm2(v):
        x = number(v); s = str(v).lower()
        if x is None: return None
        return x / 100 if "mm" in s else x
    pairs = [(cm2(r["Cell_area_measured"]), number(r["JV_measured_reverse_scan_PCE"])) for r in rows]
    pairs = [(a, p) for a, p in pairs if a and p and 0 < a < 500]
    big = [p for a, p in pairs if a >= large_cm2]; small = [p for a, p in pairs if a < 0.2]; mid = [p for a, p in pairs if 0.2 <= a < large_cm2]
    stacks = collections.Counter(r["ETL_stack_sequence"] for r in rows if (cm2(r["Cell_area_measured"]) or 0) >= large_cm2 and (number(r["JV_measured_reverse_scan_PCE"]) or 0) > 20)
    return {"tool": "area", "title": "Efficiency against cell area", "category": "Cell definition", "reliability": REL["Cell definition"],
            "summary": {"scope": describe_scope(contract), "records_with_area": len(pairs), "all": _stats([p for _, p in pairs]), f"area_ge_{large_cm2:g}_cm2": _stats(big), "area_0.2_to_1_cm2": _stats(mid), "area_lt_0.2_cm2": _stats(small),
                        "dominant_ETL_large_area_above_20": stacks.most_common(5)},
            "table": {"columns": ["area band", "n", "median PCE", "≥ 22 %"], "rows": [["< 0.2 cm2", *_stats(small).values()], ["0.2 – 1 cm2", *_stats(mid).values()], [f"≥ {large_cm2:g} cm2", *_stats(big).values()]]},
            "note": "Area is a Cell-definition field (93.33 %); mm2 values are converted to cm2."}

import re as _re
SUBS = str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789")
CHEM_ALIASES = [("CH3NH3", "MA"), ("HC(NH2)2", "FA"), ("NH2CHNH2", "FA"), ("(NH2)2CH", "FA"), ("CH(NH2)2", "FA"), ("methylammonium", "MA"), ("formamidinium", "FA")]

def canon(v: str) -> str:
    """Alias merging for counting, after psc-verify-v1: case, spacing, parenthetical abbreviations, subscripts and the
    chemical synonyms the Skill declares equivalent (CH3NH3PbI3 = MAPbI3, HC(NH2)2PbI3 = FAPbI3)."""
    x = str(v).translate(SUBS)
    for a, b in CHEM_ALIASES: x = x.replace(a, b).replace(a.lower(), b)
    def _trail(m):   # trailing "(note)", "(CB)" or a synonym "(CH3NH3PbI3)" is dropped; a formula fragment is kept
        inner = m.group(1); base = x[:m.start()]
        same = _re.sub(r"[\s\-]", "", inner).lower() == _re.sub(r"[\s\-]", "", base).lower()
        return "" if (" " in inner or not _re.search(r"\d", inner) or same) else m.group(0)
    x = _re.sub(r"\s*\(([^()]*)\)\s*$", _trail, x)
    x = _re.sub(r"\s*\(([^()]* [^()]*)\)", "", x)                    # mid-string notes with spaces; formula parentheses (MA0.15FA0.85) stay
    return _re.sub(r"\s+", " ", x).strip().lower()

def describe_scope(contract: dict | None) -> str:
    c = {k: v for k, v in (contract or {}).items() if v not in ("", None, False, [], "unrestricted") and not (k == "pce_max" and float(v) >= 30) and not (k == "pce_min" and float(v) <= 0)}
    return ("restricted to " + ", ".join(f"{k.replace('_contains', '').replace('composition_', '')}={v}" for k, v in c.items())) if c else "whole corpus: all released champion devices with 0 < PCE <= 30 %"

FIELD_ALIASES = {  # what a PI tends to write -> schema field
    "composition": "Perovskite_composition_long_form", "perovskite": "Perovskite_composition_long_form", "absorber": "Perovskite_composition_long_form",
    "additive": "Perovskite_additive_compound", "antisolvent": "Perovskite_deposition_spin_coating_antisolvent", "solvent": "Perovskite_deposition_solvents_compound",
    "surface": "Perovskite_surface_treatment_material", "passivation": "Perovskite_surface_treatment_material", "etl": "ETL_stack_sequence", "htl": "HTL_stack_sequence",
    "hole": "HTL_stack_sequence", "electron": "ETL_stack_sequence", "stack": "Cell_stack_sequence", "architecture": "Cell_architecture", "encapsulation": "Encapsulation_method", "bandgap": "Perovskite_bandgap",
    "annealing": "Perovskite_deposition_thermal_annealing_temperature", "method": "Perovskite_deposition_method", "deposition": "Perovskite_deposition_method",
    "backcontact": "Backcontact_deposition_method", "electrode": "Backcontact_deposition_method", "journal": "Ref_journal", "year": "Ref_publication_year",
    "dimension": "Perovskite_dimension", "atmosphere": "Perovskite_deposition_synthesis_atmosphere", "area": "Cell_area_measured", "thickness": "Perovskite_thickness",
}

def resolve_field(name: str) -> str:
    """Exact, case-insensitive, prefix, alias or closest-match resolution of a field name to a schema column."""
    import difflib
    cols = [c for c in data.records().columns if not c.startswith("_")]
    if name in cols: return name
    low = {c.lower(): c for c in cols}
    n = str(name).strip().lower().replace(" ", "_")
    if n in low: return low[n]
    pref = [c for c in cols if c.lower().startswith(n)]
    if len(pref) == 1 or (pref and n.endswith("composition")): return pref[0]
    for key, col in FIELD_ALIASES.items():
        if key in n: return col
    close = difflib.get_close_matches(n, list(low), n=1, cutoff=0.6)
    if close: return low[close[0]]
    raise ValueError(f"{name} is not a schema field (try: {', '.join(sorted(set(FIELD_ALIASES.values()))[:6])}...)")

def top_values(field: str, contract: dict | None = None, pce_min: float = 0.0, k: int = 10) -> dict:
    """Most frequent values of a field among devices above a PCE threshold, with the field's category reliability."""
    field = resolve_field(field)
    q = query_records(**(contract or ALL)); rows = _full_rows(q)
    sel = [r for r in rows if (number(r["JV_measured_reverse_scan_PCE"]) or 0) >= pce_min]
    cat = data.category_of(field, POLICY)
    cnt = collections.Counter(); label = {}
    for r in sel:
        v = str(r.get(field, "Null")); c = canon(v)
        cnt[c] += 1
        if c not in label or len(v) < len(label[c]): label[c] = v          # show the shortest spelling of a merged group
    total = len(sel); nonnull = total - cnt.get("null", 0)
    top = [(label[c], n) for c, n in cnt.most_common(k + 1) if c != "null"][:k]
    scope = describe_scope(q["contract"])
    return {"tool": "top_values", "title": f"Most frequent {field} among devices ≥ {pce_min:g} % · {scope}", "category": cat, "reliability": REL.get(cat),
            "summary": {"field": field, "scope": scope, "devices": total, "with_value": nonnull, "share_with_value": round(nonnull / total, 3) if total else None, "top": [{"value": v, "n": n, "share_of_reported": round(n / max(nonnull, 1), 3)} for v, n in top]},
            "table": {"columns": ["value", "n", "share of reported"], "rows": [[v, n, round(n / max(nonnull, 1), 3)] for v, n in top]},
            "note": f"{cat}: {REL.get(cat)} % judged accuracy. Case, abbreviations and the Skill's chemical synonyms (CH3NH3 = MA, HC(NH2)2 = FA) are merged for counting."}

def stability(contract: dict | None = None) -> dict:
    """What the stability fields report for the contract: how many records, retained PCE, test conditions. Least reliable category."""
    rows = _full_rows(query_records(**(contract or DEFAULT_CONTRACT)))
    rep = [r for r in rows if r.get("Stability_PCE_after_time_value", "Null") != "Null"]
    ret = [number(r["Stability_PCE_after_time_value"]) for r in rep]; ret = [v for v in ret if v is not None and 0 < v <= 100]
    hours = [number(r["Stability_PCE_after_time"]) for r in rep]; hours = [h for h in hours if h]
    atm = collections.Counter(str(r["Stability_test_atmosphere"]) for r in rep).most_common(5)
    enc = collections.Counter(str(r["Encapsulation_method"]) for r in rows).most_common(4)
    return {"tool": "stability", "title": "What the stability fields report", "category": "Stability metrics", "reliability": REL["Stability metrics"],
            "summary": {"scope": describe_scope(contract or DEFAULT_CONTRACT), "records": len(rows), "with_retained_pce": len(rep), "retained_pce_median_percent": round(statistics.median(ret), 1) if ret else None,
                        "test_duration_median_h": round(statistics.median(hours)) if hours else None, "atmospheres": atm, "encapsulation": enc,
                        "caveat": "Conditions (temperature, light, humidity, encapsulation, duration) differ between papers; retained-PCE values are not comparable without source review. Category judged accuracy 70.31 %."},
            "table": {"columns": ["measure", "value"], "rows": [["records", len(rows)], ["with retained PCE", len(rep)], ["median retained PCE", f"{statistics.median(ret):.1f} %" if ret else "–"], ["median test duration", f"{statistics.median(hours):.0f} h" if hours else "–"]] + [[f"atmosphere: {a}", n] for a, n in atm]},
            "note": "Stability metrics: 70.31 % judged accuracy, below the 85 % workflow policy. Any stability claim goes to human review."}

def reliability() -> dict:
    """The data card: judged accuracy per field category and what each category contains."""
    return {"tool": "reliability", "title": "Category reliability (data card)", "category": "Reference data", "reliability": REL["Reference data"],
            "summary": {"category_reliability_percent": REL, "threshold": POLICY["automation_threshold_percent"], "scope": POLICY["reliability_scope"]},
            "table": {"columns": ["category", "judged accuracy", "route"], "rows": [[c, r, "CONTINUE" if r > POLICY["automation_threshold_percent"] else "HUMAN REVIEW"] for c, r in REL.items()]},
            "note": "Judged by two LLM judges (gpt-5-mini and o3) over 10,258 records; errors are mostly wrong values rather than omissions."}

TOOLS = {"cohort": cohort, "breakdowns": breakdowns, "trend": trend, "bandgap": bandgap, "area": area, "top_values": top_values, "stability": stability, "reliability": reliability}

TOOL_MENU = [  # what the PI sees when it plans an exploratory investigation
    {"name": "cohort", "args": {"contract": "query contract (optional; default FAPbI3+MACl family)"}, "use": "statistics of one recipe family, with treated/untreated, NIP/PIN and by-year splits"},
    {"name": "breakdowns", "args": {"contract": "optional; default whole corpus"}, "use": "which absorber family / architecture / ETL / HTL leads (medians, n, maxima)"},
    {"name": "trend", "args": {"contract": "optional"}, "use": "median PCE by publication year, family vs corpus"},
    {"name": "bandgap", "args": {"contract": "optional", "pce_min": "PCE threshold, default 22"}, "use": "bandgap window of high-efficiency devices"},
    {"name": "area", "args": {"contract": "optional"}, "use": "efficiency versus measured cell area; dominant ETL in large-area devices"},
    {"name": "top_values", "args": {"field": "schema field name", "contract": "optional", "pce_min": "default 0"}, "use": "most frequent additives, antisolvents, surface treatments, ETL/HTL... among high-efficiency devices"},
    {"name": "stability", "args": {"contract": "optional"}, "use": "what stability fields report (least reliable category; routes to human review)"},
    {"name": "reliability", "args": {}, "use": "the data card: which categories can be automated on"},
]

def clean_contract(c) -> dict | None:
    """Normalise what the PI wrote into what query_records accepts; a list naming both architectures means no restriction."""
    if not isinstance(c, dict): return None
    out = {}
    for k, v in c.items():
        if k not in data.EXTRA_FILTERS and k not in DEFAULT_CONTRACT: continue
        if isinstance(v, list) and k != "composition_excludes":
            vals = [str(x) for x in v if str(x).strip()]
            if k == "architecture":
                archs = {data.ARCH_ALIAS.get(x.lower(), x.upper()) for x in vals}
                if len(archs) != 1: continue           # both (or none) -> unrestricted
                v = archs.pop()
            elif len(vals) == 1: v = vals[0]
            else: continue
        if k in ("pce_min", "pce_max", "year_min", "year_max"):
            try: v = float(v)
            except (TypeError, ValueError): continue
            if (k == "year_min" and v < 1990) or (k == "year_max" and v > 2100) or (k == "pce_min" and v <= 0) or (k == "pce_max" and v >= 30): continue
        if k == "require_surface_treatment": v = str(v).lower() in ("1", "true", "yes")
        if v in ("", None, [], "default"): continue
        out[k] = v
    return out or None

def _failed(name, msg):
    return {"tool": name, "title": f"{name}: no evidence", "category": "Reference data", "reliability": None, "summary": {"error": msg}, "table": None,
            "note": f"librarian could not run {name}: {msg}"}

def run_calls(calls: list[dict]) -> list[dict]:
    """Execute a list of {"tool": name, "args": {...}} safely; unknown tools or bad args become a note instead of a crash."""
    out = []
    for c in calls:
        name = c.get("tool"); args = dict(c.get("args") or {})
        if name not in TOOLS: out.append(_failed(str(name), "unknown tool")); continue
        if "contract" in args:
            cc = clean_contract(args["contract"])
            if cc: args["contract"] = cc
            else: args.pop("contract")
        for k in ("pce_min", "k"):
            if k in args:
                try: args[k] = float(args[k]) if k == "pce_min" else int(args[k])
                except (TypeError, ValueError): args.pop(k)
        if name != "top_values": args.pop("field", None)
        try:
            r = TOOLS[name](**args); out.extend(r if isinstance(r, list) else [r])
        except Exception as err:  # noqa: BLE001
            out.append(_failed(name, f"{type(err).__name__}: {err}"))
    return out
