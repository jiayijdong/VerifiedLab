"""Plain-text renderer: print() only, ASCII only, no colours. Works in any terminal, over tail -f, or captured to a file."""
from __future__ import annotations
import json, sys

class Plain:
    def __init__(self, width: int = 100, out=None, logfile: str | None = None):
        self.w = width
        self.out = out or sys.stdout
        self.log = open(logfile, "a", buffering=1) if logfile else None

    def p(self, s: str = ""):
        for line in str(s).splitlines() or [""]:
            print(line, file=self.out, flush=True)
            if self.log: self.log.write(line + "\n")

    def rule(self, ch="-"):
        self.p(ch * self.w)

    def kv(self, k, v):
        self.p(f"  {k:<14} {v}")

    def __call__(self, e: dict):
        t = e["type"]
        if t == "run":
            self.rule("="); self.p(f"VERIFIEDLAB LIVE RUN  {e['run_id']}"); self.rule("=")
            self.p(f"request: {e['request']}")
            self.p(f"skills : psc-annotate-v1@{e['skills']['annotate']}  psc-verify-v1@{e['skills']['verify']}  policy {e['policy']}")
            for r, v in e["roles"].items():
                self.p(f"  {r:<11} {', '.join(v.get('models', [v.get('error', '?')])):<36} x{v.get('replicas', 0)}  {', '.join(v.get('nodes', []))}")
        elif t == "chapter":
            self.p(); self.rule(); self.p(f"{e['kicker']}   {e['title']}"); self.rule()
        elif t == "log":
            self.p(("  NOTE " if e.get("level") == "note" else "  ") + e["text"])
        elif t == "llm":
            self.p(f"  [call] {e['tag']:<13} {e['model'].split('/')[-1]:<26} {e['node']} gpu {e['gpus']:<8} {e['seconds']:>6.2f}s  {e['prompt_tokens']}+{e['completion_tokens']} tok")
        elif t == "progress":
            if e["done"] == e["total"] or e["done"] % 50 == 0:
                self.p(f"  audit {e['done']}/{e['total']}  ({e['server']}@{e['node']})")
        elif t == "result":
            self.result(e)
        elif t == "chapter_done":
            self.p(f"  ({e['seconds']} s)")
        elif t == "error":
            self.p(f"ERROR: {e['text']}")
        elif t == "run_done":
            self.rule("="); self.p(f"RUN COMPLETE  ->  {e['run_dir']}"); self.rule("=")

    def stack(self, label, s):
        layers = str(s or "").split("/")
        self.p(f"  {label}")
        for i, l in enumerate(layers):
            self.p(f"    {i+1}. {l}")

    def result(self, e: dict):
        i = e["id"]
        if i == "ask":
            self.p("  PI plan:")
            for s in e["plan"]: self.p(f"    - {s}")
            self.p("  query contract: " + json.dumps(e["contract"]))
            self.p("  claims to make:")
            for c in e["claims"]: self.p(f"    - [{c['category']}] {c['question']}")
        elif i == "contract":
            self.kv("generator", f"{e['generator']['skill']}  <-  {e['generator']['model']}")
            self.kv("verifier", f"{e['verifier']['skill']}  <-  judge A {e['verifier']['judge_a']} ; judge B {e['verifier']['judge_b']} x{e['verifier']['replicas_b']} ; harness rules")
            self.kv("policy", f"{e['policy']['name']}@{e['policy']['version']}  threshold >{e['policy']['threshold']} %  ({e['fields']} of {e['schema_fields']} fields live)")
        elif i == "catch":
            c = e["check"]
            self.p("  " + e["origin"])
            self.stack("CANDIDATE" + (" (reversed)" if c["reversed_copy"] else ""), e["candidate_stack"])
            self.stack("RELEASED REFERENCE (substrate -> top contact)", e["reference_stack"])
            self.p(f"  same materials: {c['same_material_membership']}   same order: {c['same_order']}   -> {c['decision']}")
        elif i == "verify":
            s = e["summary"]
            self.p(f"  {'field':<36} {'candidate':<24} {'reference':<24} {'A':<12} {'B':<12} {'rule':<12} label")
            for d in e["decisions"]:
                mark = "   " if d["label"] in ("TP", "TN") else " X "
                self.p(f"  {d['field'][:36]:<36} {d['candidate'][:24]:<24} {d['reference'][:24]:<24} {str(d['judge_a']):<12} {str(d['judge_b']):<12} {str(d['rule_label'] or '-'):<12}{mark}{d['label']}")
            self.p(f"  accepted {s['accepted']}/{s['fields']}  rejected {s['rejected']}  judge A=B {s['judge_agreement']:.0%}  A vs rules {s['judge_a_vs_rules']:.0%}  B vs rules {s['judge_b_vs_rules']:.0%}")
        elif i == "repair":
            c = e["check"]
            self.stack("CORRECTED", e["corrected_stack"])
            self.p(f"  order preserved: {c['same_order']}   still rejected: {e['still_rejected'] or 'none'}   accepted {e['summary']['accepted']}/{e['summary']['fields']}   DOI {e['doi']}")
        elif i == "query":
            self.p(f"  MATCHING RECORDS : {e['n']}   (of {e['eligible']} eligible, {e['total']} papers)")
            self.p(f"  MEDIAN PCE       : {e['median']} %   share >= 22 %: {e['share_above_22']:.1%}")
            self.p("  " + ascii_hist(e["values"]))
        elif i == "audit":
            self.p(f"  cohort audit: {e['n']} records in {e['seconds']} s  ({e['records_per_second']} rec/s)  {e['replicas']} x {e['model'].split('/')[-1]} on {', '.join(e['nodes'])}")
            self.p(f"  judge vs rules agreement: {e['judge_rule_agreement']:.1%}   rule-flagged: {len(e['rule_flagged'])}")
            for f in e["rule_flagged"][:6]:
                self.p(f"    ! {f['doi']}  {json.dumps({k: v for k, v in f['rule'].items() if k != 'n_layers'})}")
        elif i == "gate":
            for cat, g in e["by_category"].items():
                bar = "#" * int(g["reliability"] / 2.5)
                self.p(f"  {cat:<20} {g['reliability']:6.2f} %  |{bar:<40}|  >{g['threshold']} %  ->  {g['route']}")
            self.p("  " + e["scope"])
        elif i == "specialist":
            for c in e["claims"]: self.p(f"  draft  [{c['category']}] {c['statement']}\n         evidence: {c['evidence']}")
        elif i == "critic":
            for c in e["claims"]:
                self.p(f"  {c['verdict']:<9} {c['statement']}")
                if c["verdict"] == "WITHHELD": self.p(f"            -> {c['reason']}")
            self.p("  SCOPED ANSWER: " + e["scoped_answer"])
            if e["harness_overrides"]: self.p(f"  HARNESS OVERRIDE on: {e['harness_overrides']}")
        elif i == "handoff":
            self.p(f"  {e['run_dir']}")
            for f in e["files"]: self.p(f"    {f}")
        elif i == "close":
            self.p(f"  {e['papers']:,} papers  |  {e['fields']} fields  |  {e['llm_calls']} live model calls  |  {e['seconds']} s  |  {len(e['gpus'])} GPU placements")

def ascii_hist(values, bins=12, width=40):
    if not values: return ""
    lo, hi = min(values), max(values)
    counts = [0] * bins
    for v in values:
        counts[min(bins - 1, int((v - lo) / (hi - lo or 1) * bins))] += 1
    m = max(counts)
    lines = []
    for b, c in enumerate(counts):
        a = lo + (hi - lo) * b / bins
        lines.append(f"  {a:5.1f}-{a + (hi - lo) / bins:5.1f} % |{'#' * int(c / m * width):<{width}}| {c}")
    return "PCE distribution\n" + "\n".join(lines)
