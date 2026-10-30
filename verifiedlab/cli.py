#!/usr/bin/env python
"""Terminal front end for a full harness run.  python cli.py [--plain] [--pause] [--log FILE] [--request "..."] [--catch auto|model|inject] [--no-audit]"""
from __future__ import annotations
import argparse, json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.rule import Rule
from verifiedlab.orchestrator import Run, DEFAULT_REQUEST
from verifiedlab.llm import Router

con = Console(highlight=False)
TEAL, RED, AMBER, DIM = "bold #7be7d4", "bold #ff8196", "bold #f7cb7c", "#9dabc3"

def render(e):
    t = e["type"]
    if t == "run":
        tbl = Table(title="Agents and models", show_lines=False, title_style=TEAL)
        tbl.add_column("role"); tbl.add_column("model"); tbl.add_column("replicas"); tbl.add_column("placement", style=DIM)
        for r, v in e["roles"].items():
            tbl.add_row(r, ", ".join(v.get("models", [v.get("error", "?")])), str(v.get("replicas", "")), ", ".join(v.get("nodes", [])))
        con.print(tbl); con.print(f"[{DIM}]Skills psc-annotate-v1@{e['skills']['annotate']} · psc-verify-v1@{e['skills']['verify']} · policy {e['policy']} · run {e['run_id']}[/]")
    elif t == "chapter":
        con.print(Rule(style="#2b3a51")); con.print(f"[{TEAL}]{e['kicker']}[/]  [bold white]{e['title']}[/]")
    elif t == "log":
        con.print(f"[{AMBER if e.get('level')=='note' else DIM}]{e['text']}[/]")
    elif t == "llm":
        con.print(f"[{DIM}]  ↳ {e['tag']} · {e['model']} on {e['node']} gpu {e['gpus']} · {e['seconds']}s · {e['prompt_tokens']}+{e['completion_tokens']} tok[/]")
    elif t == "progress":
        con.print(f"[{DIM}]  audit {e['done']}/{e['total']} ({e['server']}@{e['node']})[/]", end="\r")
    elif t == "result":
        i = e["id"]
        if i == "ask":
            con.print(Panel("\n".join(f"• {p}" for p in e["plan"]) + "\n\n[bold]query contract[/]  " + json.dumps(e["contract"]) + "\n[bold]claims to make[/]  " + "; ".join(f"{c['question']} [{c['category']}]" for c in e["claims"]), title="PI agent", border_style="#2b3a51"))
        elif i == "contract":
            con.print(f"  Generator  {e['generator']['skill']}  ←  {e['generator']['model']}\n  Verifier   {e['verifier']['skill']}  ←  judge A {e['verifier']['judge_a']} · judge B {e['verifier']['judge_b']} ×{e['verifier']['replicas_b']}\n  Policy     {e['policy']['name']}@{e['policy']['version']} · threshold >{e['policy']['threshold']} % · {e['fields']} of {e['schema_fields']} fields generated live")
        elif i == "catch":
            c = e["check"]; col = RED if not c["same_order"] else TEAL
            con.print(f"  candidate  [{col}]{e['candidate_stack']}[/]\n  released   {e['reference_stack']}\n  membership {c['same_material_membership']} · order {c['same_order']} · reversed copy {c['reversed_copy']}\n  [{DIM}]{e['origin']}[/]")
        elif i == "verify":
            tbl = Table(show_lines=False); [tbl.add_column(x) for x in ("field", "candidate", "reference", "A", "B", "rule", "label")]
            for d in e["decisions"]:
                st = TEAL if d["label"] in ("TP", "TN") else RED
                tbl.add_row(d["field"], d["candidate"][:34], d["reference"][:34], d["judge_a"] or "-", d["judge_b"] or "-", d["rule_label"] or "-", f"[{st}]{d['label']}[/]")
            con.print(tbl); s = e["summary"]
            con.print(f"  accepted {s['accepted']}/{s['fields']} · rejected {s['rejected']} · judge A=B {s['judge_agreement']:.0%} · A vs rules {s['judge_a_vs_rules']:.0%} · B vs rules {s['judge_b_vs_rules']:.0%}")
        elif i == "repair":
            c = e["check"]; col = TEAL if c["same_order"] else RED
            con.print(f"  corrected  [{col}]{e['corrected_stack']}[/]  · order {c['same_order']} · still rejected {e['still_rejected']} · bound to DOI {e['doi']}")
        elif i == "query":
            con.print(f"  [bold white]{e['n']}[/] matching records of {e['eligible']} eligible ({e['total']} papers) · median PCE [bold white]{e['median']} %[/] · share ≥22 %: {e['share_above_22']:.1%}")
        elif i == "audit":
            con.print(f"  cohort audit: {e['n']} records · {e['replicas']} replicas of {e['model']} on {e['nodes']} · {e['seconds']} s ({e['records_per_second']} rec/s) · judge/rule agreement {e['judge_rule_agreement']:.1%} · rule-flagged {len(e['rule_flagged'])}")
        elif i == "gate":
            for cat, g in e["by_category"].items():
                col = TEAL if g["route"] == "CONTINUE" else AMBER
                con.print(f"  {cat:20s} {g['reliability']:6.2f} %  vs >{g['threshold']} %  →  [{col}]{g['route']}[/]")
            con.print(f"  [{DIM}]{e['scope']}[/]")
        elif i == "specialist":
            for c in e["claims"]: con.print(f"  draft  {c['statement']}  [{DIM}]({c['category']}; {c['evidence']})[/]")
        elif i == "critic":
            for c in e["claims"]:
                if c["verdict"] == "SUPPORTED": con.print(f"  [{TEAL}]✓ SUPPORTED[/]  {c['statement']}")
                else: con.print(f"  [{RED}]✗ WITHHELD[/]   [strike]{c['statement']}[/]  [{AMBER}]{c['reason']}[/]")
            con.print(Panel(e["scoped_answer"], title="Scoped answer", border_style="#2b3a51"))
            if e["harness_overrides"]: con.print(f"  [{AMBER}]harness overrode the critic on: {e['harness_overrides']}[/]")
        elif i == "handoff":
            con.print(f"  {e['run_dir']}\n  " + "  ".join(e["files"]))
        elif i == "close":
            con.print(f"  {e['papers']:,} papers · {e['fields']} fields · {e['llm_calls']} live model calls · {e['seconds']} s · GPUs {e['gpus']}")
    elif t == "chapter_done":
        con.print(f"[{DIM}]  ({e['seconds']} s)[/]")
    elif t == "run_done":
        con.print(Rule(style="#2b3a51")); con.print(f"[{TEAL}]Run complete → {e['run_dir']}[/]")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--request", default=DEFAULT_REQUEST); ap.add_argument("--pause", action="store_true", help="wait for Enter before each chapter")
    ap.add_argument("--catch", default="auto", choices=["auto", "model", "inject"]); ap.add_argument("--no-audit", action="store_true")
    ap.add_argument("--check", action="store_true", help="only print server health and exit")
    ap.add_argument("--plain", action="store_true", help="plain print() output: ASCII, no colours, works in any terminal or via tail -f")
    ap.add_argument("--log", default=None, help="also append the plain output to this file (use with tail -f from another terminal)")
    ap.add_argument("--width", type=int, default=110)
    a = ap.parse_args()
    if a.check:
        r = Router(); [con.print(f"  {'UP  ' if h else 'DOWN'} {n}") for n, h in r.health.items()]; con.print(r.describe()); return
    if a.plain or a.log:
        from verifiedlab.plain import Plain
        out = Plain(width=a.width, logfile=a.log)
        pause = (lambda cid: input(f"  [press Enter for {cid}] ")) if a.pause else None
        Run(a.request, emit=out, pause=pause, catch_mode=a.catch, audit=not a.no_audit).start(); return
    pause = (lambda cid: con.input(f"[{DIM}]  press Enter for {cid} …[/]")) if a.pause else None
    Run(a.request, emit=render, pause=pause, catch_mode=a.catch, audit=not a.no_audit).start()

if __name__ == "__main__":
    main()
