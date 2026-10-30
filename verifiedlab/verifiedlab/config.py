"""Paths, model roles and endpoint resolution."""
from __future__ import annotations
import json, os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAPER = ROOT.parent                                   # repository root
DATASET = Path(os.environ.get("VL_DATASET", ROOT.parent / "dataset" / "device_records.parquet"))   # records from huggingface.co/datasets/jiayijdong/VerifiedLab
POLICIES = ROOT / "policies"
SOURCES = ROOT / "sources"
RUNS = Path(os.environ.get("VL_RUNS", ROOT / "runs"))
ENDPOINTS = ROOT / "slurm" / "endpoints.json"

HERO_DOI = "10.1002/adfm.202417293"

# Which served model plays which agent. Order = preference; the first healthy server wins.
ROLES = {
    "pi":          ["llama-3.3-70b", "llama-3.3-70b-b", "qwen3-14b"],   # principal investigator: plan + query contract + tool choice
    "generator":   ["llama-3.3-70b-b", "llama-3.3-70b", "qwen3-14b"],   # annotation agent under psc-annotate-v1
    "critic":      ["llama-3.3-70b*", "qwen3-14b"],                     # scientific critic; both 70B replicas, claims checked in parallel
    "verifier_a":  ["qwen3-14b", "qwen3-14b-b", "qwen3-8b"],            # judge A under psc-verify-v1
    "verifier_b":  ["qwen3-4b-r*", "qwen3-8b"],                         # judge B pool (smaller checkpoint with rules), used in parallel
    "specialist":  ["qwen3-14b*", "qwen3-8b"],                          # specialist team (device physicist, materials chemist, data scientist) in parallel
}

# Live-generated sub-schema (a slice of the 97 fields) so one generator call stays short enough for a live audience.
LIVE_FIELDS = [
    "Ref_DOI", "Cell_architecture", "Cell_stack_sequence", "ETL_stack_sequence",
    "Perovskite_composition_long_form", "Perovskite_additive_compound", "Perovskite_additive_concentration",
    "Perovskite_bandgap", "Perovskite_deposition_solvents_mixing_ratio", "Perovskite_surface_treatment_material",
    "HTL_stack_sequence", "Backcontact_thickness",
    "JV_measured_reverse_scan_Voc", "JV_measured_reverse_scan_Jsc", "JV_measured_reverse_scan_FF",
    "JV_measured_reverse_scan_PCE", "JV_measured_scan_speed",
    "Stability_PCE_after_time", "Stability_PCE_after_time_value",
]

def load_endpoints() -> list[dict]:
    if not ENDPOINTS.exists():
        return []
    return json.loads(ENDPOINTS.read_text())["servers"]

def load_policy() -> dict:
    return json.loads((POLICIES / "workflow-policy.json").read_text())

def skill_text(name: str) -> tuple[str, str]:
    """Return (version, body) of a Skill markdown file with a YAML front matter."""
    raw = (POLICIES / f"{name}.md").read_text()
    head, body = raw.split("---", 2)[1:]
    version = next(l.split(":", 1)[1].strip() for l in head.splitlines() if l.startswith("version:"))
    return version, body.strip()
