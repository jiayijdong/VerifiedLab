"""Read-only workspace API for the VerifiedLab front end (additive; the live /run, /investigate and /events routes live in server.py).

Everything here is computed from the released records, the policy files and the artifacts of past runs on disk. No model is called."""
from __future__ import annotations
import csv, io, json, math, re, statistics, time
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from pathlib import Path
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from . import config, data, rules
from .data import number
from .questions import KEY_QUESTIONS

router = APIRouter(prefix="/api")
POLICY = config.load_policy()
REL = POLICY["category_reliability_percent"]
THR = POLICY["automation_threshold_percent"]
PDF_DIR = config.SOURCES / "pdf"

# --------------------------------------------------------------------------------------------- derived table
NUMERIC = {"_pce": "JV_measured_reverse_scan_PCE", "_voc": "JV_measured_reverse_scan_Voc", "_jsc": "JV_measured_reverse_scan_Jsc", "_ff": "JV_measured_reverse_scan_FF",
           "_year": "Ref_publication_year", "_bandgap": "Perovskite_bandgap", "_thickness": "Perovskite_thickness", "_retained": "Stability_PCE_after_time_value", "_hours": "Stability_PCE_after_time"}

def _cm2(v) -> float | None:
    x = number(v)
    if x is None: return None
    return x / 100 if "mm" in str(v).lower() else x

@lru_cache(maxsize=1)
def derived() -> pd.DataFrame:
    """Released records plus parsed numeric helper columns and the deterministic consistency flags (computed once)."""
    df = data.records().copy()
    for col, src in NUMERIC.items():
        df[col] = df[src].map(number)
    df["_area_cm2"] = df["Cell_area_measured"].map(_cm2)
    df["_family"] = df["Perovskite_composition_long_form"].map(data.family)
    flags = []
    for row in df.to_dict("records"):
        c = rules.record_consistency(row)
        f = [k for k in ("stack_substrate_first", "absorber_in_stack") if not c[k]]
        if c["architecture_consistent_with_stack"] is False: f.append("architecture_consistent_with_stack")
        flags.append(f)
    df["_rflags"] = flags
    df["_n_flags"] = [len(f) for f in flags]
    return df

SCHEMA_COLS = [c for c in data.records().columns if not c.startswith("_")]
DEFAULT_COLS = ["Ref_DOI", "Ref_publication_year", "Ref_journal", "Ref_title", "Cell_architecture", "Cell_stack_sequence", "Perovskite_composition_long_form",
                "Perovskite_additive_compound", "Perovskite_bandgap", "Cell_area_measured", "JV_measured_reverse_scan_PCE", "Stability_PCE_after_time_value"]
SORT_NUMERIC = {"JV_measured_reverse_scan_PCE": "_pce", "Ref_publication_year": "_year", "Perovskite_bandgap": "_bandgap", "Cell_area_measured": "_area_cm2",
                "JV_measured_reverse_scan_Voc": "_voc", "JV_measured_reverse_scan_Jsc": "_jsc", "JV_measured_reverse_scan_FF": "_ff", "Stability_PCE_after_time_value": "_retained"}

def category_of(field: str) -> str:
    return data.category_of(field, POLICY)

def field_rule(field: str) -> dict:
    kind, tol, text = rules.FIELD_RULES.get(field, ("free", 0.0, "Semantic equivalence under the Skill's general rules (decided by the verifier model)."))
    return {"kind": kind, "tolerance": tol, "text": text, "deterministic": kind in ("ordered", "ordered_ratio", "numeric", "exact", "alias")}

def apply_filters(df: pd.DataFrame, q: str = "", architecture: str = "", year_min: float | None = None, year_max: float | None = None, composition: str = "",
                  additive: str = "", pce_min: float | None = None, pce_max: float | None = None, journal: str = "", family: str = "", flagged: bool = False,
                  has_stability: bool = False, etl: str = "", htl: str = "") -> pd.DataFrame:
    m = pd.Series(True, index=df.index)
    if q:
        qq = q.strip()
        m &= (df.Ref_title.str.contains(qq, case=False, regex=False) | df.Ref_DOI.str.contains(qq, case=False, regex=False) | df.Ref_journal.str.contains(qq, case=False, regex=False)
              | df.Perovskite_composition_long_form.str.contains(qq, case=False, regex=False) | df.Cell_stack_sequence.str.contains(qq, case=False, regex=False))
    if architecture:
        want = data.ARCH_ALIAS.get(architecture.strip().lower(), architecture.strip().upper())
        m &= df.Cell_architecture.str.upper().str.replace("-", "", regex=False) == want
    if year_min is not None: m &= df._year.fillna(-1) >= year_min
    if year_max is not None: m &= df._year.fillna(9999) <= year_max
    if composition: m &= df.Perovskite_composition_long_form.str.contains(composition, case=False, regex=False)
    if additive: m &= df.Perovskite_additive_compound.str.contains(additive, case=False, regex=False)
    if etl: m &= df.ETL_stack_sequence.str.contains(etl, case=False, regex=False)
    if htl: m &= df.HTL_stack_sequence.str.contains(htl, case=False, regex=False)
    if journal: m &= df.Ref_journal.str.contains(journal, case=False, regex=False)
    if family: m &= df._family == family
    if pce_min is not None: m &= df._pce.fillna(-1) >= pce_min
    if pce_max is not None: m &= df._pce.fillna(1e9) <= pce_max
    if flagged: m &= df._n_flags > 0
    if has_stability: m &= df._retained.notna()
    return df[m]

def _clean(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)): return None
    return v

# --------------------------------------------------------------------------------------------- servers
def fast_health(timeout: float = 0.6) -> dict:
    """Parallel health probe of the vLLM endpoints (the Router's own probe is sequential and slow when servers are down)."""
    import urllib.request
    servers = config.load_endpoints()
    def probe(s):
        try:
            urllib.request.urlopen(s["url"].replace("/v1", "/health"), timeout=timeout); return True
        except Exception:
            return False
    if not servers: return {"servers": [], "healthy": 0, "total": 0, "roles": {}, "endpoints_file": str(config.ENDPOINTS), "configured": False}
    with ThreadPoolExecutor(max_workers=max(1, len(servers))) as ex:
        ok = list(ex.map(probe, servers))
    health = {s["name"]: h for s, h in zip(servers, ok)}
    import fnmatch
    roles = {}
    for role, patterns in config.ROLES.items():
        chosen = None
        for pat in patterns:
            hits = [s for s in servers if fnmatch.fnmatch(s["name"], pat) and health[s["name"]]]
            if hits: chosen = {"models": sorted({s["model"] for s in hits}), "replicas": len(hits), "servers": [s["name"] for s in hits]}; break
        roles[role] = chosen or {"error": "no healthy server", "preference": patterns}
    return {"servers": [{**s, "healthy": health[s["name"]]} for s in servers], "healthy": sum(ok), "total": len(servers), "roles": roles,
            "endpoints_file": str(config.ENDPOINTS), "configured": True}

# --------------------------------------------------------------------------------------------- runs on disk
def _read_json(p: Path):
    try: return json.loads(p.read_text())
    except Exception: return None

def _tz_offset() -> str:
    import datetime
    z = datetime.datetime.now().astimezone().strftime("%z")      # e.g. -0700
    return f"{z[:3]}:{z[3:]}" if z else ""

def run_summary(d: Path) -> dict | None:
    if not d.is_dir(): return None
    files = sorted(p.name for p in d.iterdir() if p.is_file())
    if not files: return None
    kind = "investigation" if d.name.startswith("investigation-") else "film"
    stamp = d.name.split("-", 1)[1] if kind == "investigation" else d.name
    started = None
    m = re.match(r"(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})", stamp)
    if m: started = f"{m[1]}-{m[2]}-{m[3]}T{m[4]}:{m[5]}:{m[6]}{_tz_offset()}"      # run ids are local wall-clock; make the ISO string unambiguous
    out = {"id": d.name, "kind": kind, "started": started, "files": files, "complete": False}
    if kind == "film":
        rj = _read_json(d / "run.json")
        if rj:
            out.update(request=rj.get("request"), models=rj.get("models"), llm_calls=rj.get("llm_calls"), timings=rj.get("timings_seconds"), skills=rj.get("skills"),
                       policy=rj.get("policy"), complete=True, dataset_commit=rj.get("dataset_commit"), manuscript_commit=rj.get("manuscript_commit"))
            fd = _read_json(d / "field_decisions.json") or []
            out["fields"] = len(fd); out["accepted"] = sum(x.get("label") in ("TP", "TN") for x in fd)
            rc = _read_json(d / "rule_check.json") or {}
            out["doi"] = (rc.get("reference") or "").replace("Released structured record, DOI ", "") or config.HERO_DOI
            out["candidate_origin"] = rc.get("candidate_origin")
        else:
            out["request"] = None
    else:
        ev = _read_json(d / "evidence.json")
        if ev:
            cl = ev.get("claims") or []
            out.update(question=ev.get("question"), claims=len(cl), supported=sum(c.get("verdict") == "SUPPORTED" for c in cl), withheld=sum(c.get("verdict") == "WITHHELD" for c in cl),
                       evidence_items=len(ev.get("evidence") or []), scope=(ev.get("plan") or {}).get("scope"), complete=True)
        tr = d / "trace.jsonl"
        if tr.exists():
            try: out["llm_calls"] = sum(1 for _ in tr.open())
            except Exception: pass
    return out

_SUMMARY_CACHE: dict[str, tuple[float, dict | None]] = {}
_RUNS_CACHE: dict[str, object] = {}

def cached_summary(d: Path) -> dict | None:
    """run_summary memoized on the run directory's mtime (a run directory changes only when files are written into it)."""
    try: m = d.stat().st_mtime
    except OSError: return None
    hit = _SUMMARY_CACHE.get(d.name)
    if hit and hit[0] == m: return hit[1]
    v = run_summary(d); _SUMMARY_CACHE[d.name] = (m, v); return v

def list_runs() -> list[dict]:
    if not config.RUNS.exists(): return []
    key = (config.RUNS.stat().st_mtime, int(time.time() // 5))        # re-scan at most every 5 s, and whenever a run directory is added
    if _RUNS_CACHE.get("key") == key: return _RUNS_CACHE["value"]
    out = [cached_summary(d) for d in config.RUNS.iterdir()]
    out = sorted([o for o in out if o], key=lambda o: o["started"] or "", reverse=True)
    _RUNS_CACHE["key"] = key; _RUNS_CACHE["value"] = out
    return out

_AUDIT_DOIS: dict[str, tuple[float, set]] = {}
def audited_dois(run_id: str) -> set:
    p = config.RUNS / run_id / "cohort_audit.json"
    try: m = p.stat().st_mtime
    except OSError: return set()
    hit = _AUDIT_DOIS.get(run_id)
    if hit and hit[0] == m: return hit[1]
    ca = _read_json(p) or {}
    v = {str(x.get("doi", "")).lower() for x in ca.get("results", [])}
    _AUDIT_DOIS[run_id] = (m, v); return v

def read_trace(d: Path, full: bool = False) -> list[dict]:
    p = d / "trace.jsonl"
    if not p.exists(): return []
    keep = ("role", "tag", "model", "server", "node", "gpus", "seconds", "prompt_tokens", "completion_tokens", "attempt")
    out = []
    for i, line in enumerate(p.open()):
        try: r = json.loads(line)
        except Exception: continue
        rec = {k: r.get(k) for k in keep}; rec["i"] = i
        if full: rec.update(system=r.get("system"), user=r.get("user"), output=r.get("output"))
        else: rec["output_preview"] = (r.get("output") or "")[:160]
        out.append(rec)
    return out

# --------------------------------------------------------------------------------------------- routes
@router.get("/overview")
def overview():
    df = derived(); runs = list_runs()
    years = df._year.dropna()
    return {"corpus": {"records": int(len(df)), "schema_fields": 97, "columns": len(SCHEMA_COLS), "with_pce": int(df._pce.notna().sum()),
                       "year_min": int(years.min()) if len(years) else None, "year_max": int(years.max()) if len(years) else None,
                       "journals": int(df.Ref_journal.nunique()), "flagged": int((df._n_flags > 0).sum()), "with_stability": int(df._retained.notna().sum()),
                       "dataset": str(config.DATASET), "hero_doi": config.HERO_DOI},
            "reliability": REL, "threshold": THR, "reliability_source": POLICY["reliability_source"], "reliability_scope": POLICY["reliability_scope"],
            "skills": [{"name": n, "version": config.skill_text(n)[0]} for n in ("psc-annotate-v1", "psc-verify-v1")] + [{"name": POLICY["policy"], "version": POLICY["version"]}],
            "runs": {"film": sum(r["kind"] == "film" for r in runs), "investigations": sum(r["kind"] == "investigation" for r in runs), "latest": runs[:8]},
            "servers": fast_health(), "key_questions": len(KEY_QUESTIONS)}

@router.get("/schema")
def schema():
    fields = []
    for f in SCHEMA_COLS:
        cat = category_of(f); r = field_rule(f)
        fields.append({"name": f, "category": cat, "reliability": REL.get(cat), "live": f in config.LIVE_FIELDS, **r})
    cats = {c: {"reliability": r, "route": "CONTINUE" if r > THR else "HUMAN_REVIEW", "fields": sum(1 for x in fields if x["category"] == c)} for c, r in REL.items()}
    return {"fields": fields, "categories": cats, "threshold": THR, "field_category_prefixes": POLICY["field_category"], "scope": POLICY["reliability_scope"], "source": POLICY["reliability_source"]}

@router.get("/records")
def records(q: str = "", page: int = 1, size: int = Query(50, le=500), sort: str = "JV_measured_reverse_scan_PCE", dir: str = "desc", cols: str = "",
            architecture: str = "", year_min: float | None = None, year_max: float | None = None, composition: str = "", additive: str = "", pce_min: float | None = None,
            pce_max: float | None = None, journal: str = "", family: str = "", flagged: bool = False, has_stability: bool = False, etl: str = "", htl: str = ""):
    df = apply_filters(derived(), q, architecture, year_min, year_max, composition, additive, pce_min, pce_max, journal, family, flagged, has_stability, etl, htl)
    if sort:
        key = SORT_NUMERIC.get(sort)
        if key: df = df.sort_values(key, ascending=(dir == "asc"), na_position="last")
        elif sort in df.columns: df = df.sort_values(sort, ascending=(dir == "asc"), key=lambda s: s.str.lower())
    total = int(len(df)); page = max(1, page); start = (page - 1) * size
    want = [c for c in cols.split(",") if c in df.columns] if cols else DEFAULT_COLS
    rows = df.iloc[start:start + size]
    out = []
    for r in rows[want + ["_pce", "_year", "_n_flags", "_rflags"]].to_dict("records"):
        out.append({**{k: _clean(r[k]) for k in want}, "_pce": _clean(r["_pce"]), "_year": _clean(r["_year"]), "_flags": r["_rflags"]})
    return {"total": total, "page": page, "size": size, "pages": max(1, math.ceil(total / size)), "columns": want, "rows": out}

@router.get("/records.csv")
def records_csv(q: str = "", sort: str = "JV_measured_reverse_scan_PCE", dir: str = "desc", cols: str = "", architecture: str = "", year_min: float | None = None,
                year_max: float | None = None, composition: str = "", additive: str = "", pce_min: float | None = None, pce_max: float | None = None, journal: str = "",
                family: str = "", flagged: bool = False, has_stability: bool = False, etl: str = "", htl: str = "", limit: int = Query(20000, le=20000)):
    df = apply_filters(derived(), q, architecture, year_min, year_max, composition, additive, pce_min, pce_max, journal, family, flagged, has_stability, etl, htl)
    key = SORT_NUMERIC.get(sort)
    if key: df = df.sort_values(key, ascending=(dir == "asc"), na_position="last")
    want = [c for c in cols.split(",") if c in df.columns] if cols else SCHEMA_COLS
    buf = io.StringIO(); w = csv.writer(buf); w.writerow(want)
    for r in df[want].head(limit).itertuples(index=False): w.writerow(r)
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=verifiedlab_records.csv"})

@router.get("/facets")
def facets():
    df = derived()
    def top(col, k=12):
        vc = df[col][df[col] != "Null"].value_counts().head(k)
        return [{"value": v, "n": int(n)} for v, n in vc.items()]
    return {"architecture": top("Cell_architecture", 6), "family": [{"value": v, "n": int(n)} for v, n in df._family.value_counts().items()],
            "journal": top("Ref_journal", 15), "etl": top("ETL_stack_sequence", 12), "htl": top("HTL_stack_sequence", 12), "additive": top("Perovskite_additive_compound", 12),
            "years": [{"value": int(y), "n": int(n)} for y, n in df._year.dropna().astype(int).value_counts().sort_index().items()]}

def _record_detail(doi: str) -> dict:
    df = derived()
    hit = df[df.Ref_DOI.str.lower() == doi.lower().replace("https://doi.org/", "")]
    if not len(hit): raise HTTPException(404, f"no released record for DOI {doi}")
    row = hit.iloc[0]; rec = {k: _clean(row[k]) for k in SCHEMA_COLS}
    fields = [{"name": f, "value": rec[f], "category": category_of(f), "reliability": REL.get(category_of(f)), "rule": field_rule(f), "live": f in config.LIVE_FIELDS} for f in SCHEMA_COLS]
    cons = rules.record_consistency(rec)
    folder = str(row["_doi_folder"]) if row["_doi_folder"] not in (None, "Null") else doi.replace("/", "_")
    note = config.SOURCES / f"{doi.split('/', 1)[1] if '/' in doi else doi}.device_note.md"
    pdf = PDF_DIR / f"{folder}.pdf"
    runs = list_runs()
    verified_in = [r["id"] for r in runs if r["kind"] == "film" and r.get("doi", "").lower() == doi.lower()]
    audited_in = [r["id"] for r in runs if r["kind"] == "film" and "cohort_audit.json" in r["files"] and doi.lower() in audited_dois(r["id"])]
    return {"doi": rec["Ref_DOI"], "record": rec, "fields": fields, "consistency": cons, "flags": list(row["_rflags"]), "family": row["_family"],
            "numeric": {"pce": _clean(row["_pce"]), "year": _clean(row["_year"]), "bandgap": _clean(row["_bandgap"]), "area_cm2": _clean(row["_area_cm2"])},
            "provenance": {"doi_folder": rec.get("_doi_folder") if "_doi_folder" in rec else str(row["_doi_folder"]), "source_file": str(row["_source_file"]), "doi_url": f"https://doi.org/{rec['Ref_DOI']}"},
            "sources": {"device_note": f"/sources/{note.name}" if note.exists() else None, "pdf": f"/api/pdf/{folder}" if pdf.exists() else None},
            "verified_in_runs": verified_in, "audited_in_runs": audited_in[:10]}

@router.get("/records/{doi:path}")
def record(doi: str):
    return _record_detail(doi)

@router.get("/pdf/{folder}")
def pdf(folder: str):
    p = PDF_DIR / f"{folder}.pdf"
    if ".." in folder or not p.exists(): raise HTTPException(404, "no PDF on file for this record")
    return FileResponse(p, media_type="application/pdf")

@router.get("/queue")
def queue(page: int = 1, size: int = Query(50, le=500), rule: str = ""):
    """Records whose released values fail a deterministic self-consistency rule: the real verification queue."""
    df = derived(); f = df[df._n_flags > 0]
    if rule: f = f[f._rflags.map(lambda fl: rule in fl)]
    total = int(len(f)); start = (max(1, page) - 1) * size
    rows = [{"doi": r["Ref_DOI"], "year": _clean(r["_year"]), "architecture": r["Cell_architecture"], "stack": r["Cell_stack_sequence"], "composition": r["Perovskite_composition_long_form"],
             "pce": _clean(r["_pce"]), "flags": r["_rflags"]} for r in f.iloc[start:start + size].to_dict("records")]
    counts = {k: int(df._rflags.map(lambda fl: k in fl).sum()) for k in ("stack_substrate_first", "architecture_consistent_with_stack", "absorber_in_stack")}
    return {"total": total, "checked": int(len(df)), "page": page, "size": size, "pages": max(1, math.ceil(total / size)), "by_rule": counts, "rows": rows,
            "rules": {"stack_substrate_first": "Cell_stack_sequence starts at the substrate (FTO, ITO, glass, PEN, PET...) and ends at the top contact.",
                      "architecture_consistent_with_stack": "For NIP the electron-transport layer precedes the absorber and the hole-transport layer follows it; for PIN the reverse.",
                      "absorber_in_stack": "The perovskite absorber (or the word 'perovskite') appears as a layer in the stack."},
            "scope": "Deterministic internal-consistency checks on the released values (verifiedlab/rules.py::record_consistency). They are not a re-audit of the source articles."}

@router.get("/explore")
def explore(x: str = "bandgap", y: str = "pce", z: str = "", architecture: str = "", year_min: float | None = None, year_max: float | None = None, composition: str = "",
            additive: str = "", pce_min: float | None = None, pce_max: float | None = None, family: str = "", etl: str = "", htl: str = "", limit: int = Query(12000, le=12000)):
    axes = {"pce": ("_pce", "Reverse-scan PCE (%)", (0, 30)), "voc": ("_voc", "Voc (V)", (0.5, 1.4)), "jsc": ("_jsc", "Jsc (mA/cm²)", (5, 30)), "ff": ("_ff", "Fill factor (%)", (40, 90)),
            "year": ("_year", "Publication year", (2010, 2026)), "bandgap": ("_bandgap", "Bandgap (eV)", (0.8, 3.0)), "area": ("_area_cm2", "Measured cell area (cm²)", (0.0005, 500)),
            "thickness": ("_thickness", "Perovskite thickness (nm)", (20, 3000)), "retained": ("_retained", "Retained PCE after stability test (%)", (0, 100)), "hours": ("_hours", "Stability test duration (h)", (1, 20000))}
    if x not in axes or y not in axes or (z and z not in axes): raise HTTPException(400, f"axes: {list(axes)}")
    df = apply_filters(derived(), "", architecture, year_min, year_max, composition, additive, pce_min, pce_max, "", family, False, False, etl, htl)
    xc, xl, xr = axes[x]; yc, yl, yr = axes[y]
    zc, zl, zr = axes[z] if z else (None, None, None)
    need = [xc, yc] + ([zc] if zc else [])
    sub = df[list(dict.fromkeys(need + ["Ref_DOI", "Cell_architecture", "_family", "_year", "_pce"]))].dropna(subset=need)
    before = len(sub)
    sub = sub[(sub[xc] >= xr[0]) & (sub[xc] <= xr[1]) & (sub[yc] >= yr[0]) & (sub[yc] <= yr[1])]
    if zc: sub = sub[(sub[zc] >= zr[0]) & (sub[zc] <= zr[1])]
    pts = [{"doi": r["Ref_DOI"], "x": r[xc], "y": r[yc], **({"z": r[zc]} if zc else {}), "arch": str(r["Cell_architecture"]).upper(), "family": r["_family"], "year": _clean(r["_year"]), "pce": _clean(r["_pce"])} for r in sub.head(limit).to_dict("records")]
    def summ(col):
        v = sub[col]
        return {"n": int(len(v)), "median": round(float(v.median()), 3), "q1": round(float(v.quantile(.25)), 3), "q3": round(float(v.quantile(.75)), 3), "min": round(float(v.min()), 3), "max": round(float(v.max()), 3)} if len(v) else {"n": 0}
    return {"x": {"key": x, "label": xl, "field": NUMERIC.get(xc, "Cell_area_measured"), "category": category_of(NUMERIC.get(xc, "Cell_area_measured")), "summary": summ(xc)},
            "y": {"key": y, "label": yl, "field": NUMERIC.get(yc, "Cell_area_measured"), "category": category_of(NUMERIC.get(yc, "Cell_area_measured")), "summary": summ(yc)},
            **({"z": {"key": z, "label": zl, "field": NUMERIC.get(zc, "Cell_area_measured"), "category": category_of(NUMERIC.get(zc, "Cell_area_measured")), "summary": summ(zc)}} if zc else {}),
            "n": int(len(sub)), "filtered_records": int(len(df)), "dropped_out_of_range": int(before - len(sub)), "dropped_missing": int(len(df) - before), "points": pts, "axes": {k: v[1] for k, v in axes.items()},
            "note": "Each point is one paper's reported champion device (publication-biased). Values are LLM extractions; verify any value that matters at the source DOI. Out-of-range values are dropped as garbled."}

@router.get("/trend")
def trend(architecture: str = "", composition: str = "", additive: str = "", family: str = "", etl: str = "", htl: str = ""):
    df = derived(); sub = apply_filters(df, "", architecture, None, None, composition, additive, None, None, "", family, False, False, etl, htl)
    def by_year(d):
        g = d.dropna(subset=["_year", "_pce"]); g = g[(g._pce > 0) & (g._pce <= 30)]
        out = []
        for y, grp in g.groupby(g._year.astype(int)):
            if y < 2015: continue
            out.append({"year": int(y), "n": int(len(grp)), "median": round(float(grp._pce.median()), 2), "q1": round(float(grp._pce.quantile(.25)), 2), "q3": round(float(grp._pce.quantile(.75)), 2), "share_above_22": round(float((grp._pce >= 22).mean()), 3)})
        return out
    return {"cohort": by_year(sub), "corpus": by_year(df), "cohort_n": int(len(sub)), "corpus_n": int(len(df))}

@router.get("/runs")
def runs():
    return {"runs": list_runs(), "runs_dir": str(config.RUNS)}

@router.get("/runs/{run_id}")
def run_detail(run_id: str):
    d = config.RUNS / run_id
    if ".." in run_id or not d.is_dir(): raise HTTPException(404)
    s = run_summary(d) or {}
    bundle = {"summary": s}
    for name in ("run.json", "evidence.json", "field_decisions.json", "rule_check.json", "record_draft.json", "record_corrected.json"):
        if (d / name).exists(): bundle[name.replace(".json", "")] = _read_json(d / name)
    for name in ("research_brief.md", "review_request.md"):
        if (d / name).exists(): bundle[name.replace(".md", "")] = (d / name).read_text()
    if (d / "cohort_audit.json").exists():
        ca = _read_json(d / "cohort_audit.json") or {}
        res = ca.pop("results", [])
        ca["disagreements"] = [r for r in res if not r.get("agree")][:50]; ca["results_n"] = len(res)
        bundle["cohort_audit"] = ca
    bundle["trace"] = read_trace(d)
    return bundle

@router.get("/runs/{run_id}/trace")
def run_trace(run_id: str, full: bool = False, i: int | None = None):
    d = config.RUNS / run_id
    if ".." in run_id or not d.is_dir(): raise HTTPException(404)
    tr = read_trace(d, full=full or i is not None)
    if i is not None:
        hit = [t for t in tr if t["i"] == i]
        if not hit: raise HTTPException(404)
        return hit[0]
    return {"trace": tr}

@router.get("/skills")
def skills():
    out = []
    for p in sorted(config.POLICIES.iterdir()):
        if p.suffix == ".md":
            raw = p.read_text(); parts = raw.split("---", 2)
            meta = {}
            for l in parts[1].splitlines():
                if ":" in l:
                    k, v = l.split(":", 1); meta[k.strip()] = v.strip()
            out.append({"file": p.name, "kind": "skill", "name": meta.get("skill", p.stem), "version": meta.get("version"), "role": meta.get("role"), "labels": meta.get("labels"),
                        "source": meta.get("source"), "body": parts[2].strip(), "modified": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(p.stat().st_mtime)), "chars": len(raw)})
        elif p.suffix == ".json":
            j = _read_json(p) or {}
            out.append({"file": p.name, "kind": "policy", "name": j.get("policy", p.stem), "version": j.get("version"), "role": "workflow policy (gate)", "json": j, "body": json.dumps(j, indent=2),
                        "modified": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(p.stat().st_mtime)), "chars": p.stat().st_size})
    fields = [{"name": f, "category": category_of(f), "reliability": REL.get(category_of(f)), **field_rule(f)} for f in SCHEMA_COLS]
    return {"skills": out, "field_rules": fields, "live_fields": config.LIVE_FIELDS, "policies_dir": str(config.POLICIES),
            "note": "Skill files are materialized from the manuscript's Methods and Supplementary Note; they are the demo's versioned policies, not the full released Skill registry. Field rules are the part of the verification Skill that runs as code (verifiedlab/rules.py)."}

@router.get("/servers")
def servers():
    return fast_health()

@router.get("/questions")
def questions():
    return {"questions": KEY_QUESTIONS}

@router.get("/about")
def about():
    import hashlib, sys
    return {"dataset": str(config.DATASET), "dataset_sha256": hashlib.sha256(config.DATASET.read_bytes()).hexdigest() if config.DATASET.exists() else None,
            "runs_dir": str(config.RUNS), "policies_dir": str(config.POLICIES), "sources_dir": str(config.SOURCES), "endpoints_file": str(config.ENDPOINTS),
            "python": sys.version.split()[0], "pandas": pd.__version__, "roles": config.ROLES, "live_fields": config.LIVE_FIELDS, "hero_doi": config.HERO_DOI}

@router.get("/claims")
def claims():
    """Every claim the critic/harness decided in recorded investigations, with its verdict and reason (the claims ledger)."""
    out = []
    for r in list_runs():
        if r["kind"] != "investigation": continue
        out.extend(run_claims(r["id"], r["started"]))
    return {"claims": out, "runs": sum(1 for r in list_runs() if r["kind"] == "investigation")}

_CLAIMS: dict[str, tuple[float, list]] = {}
def run_claims(run_id: str, started: str | None) -> list[dict]:
    p = config.RUNS / run_id / "evidence.json"
    try: m = p.stat().st_mtime
    except OSError: return []
    hit = _CLAIMS.get(run_id)
    if hit and hit[0] == m: return hit[1]
    ev = _read_json(p) or {}
    v = [{"run": run_id, "started": started, "question": ev.get("question"), "i": i + 1, "statement": c.get("statement"), "category": c.get("category"), "verdict": c.get("verdict"),
          "route": c.get("route"), "reason": c.get("reason"), "checks": c.get("checks"), "evidence": c.get("evidence")} for i, c in enumerate(ev.get("claims") or [])]
    _CLAIMS[run_id] = (m, v); return v
