"""Terminal renderer in the film's voice: a persistent research workspace, chapter kickers, one-line headlines,
tags (SUPPORTED / WITHHELD / HUMAN REVIEW), layered device stacks, and the agent's short first-person lines."""
from __future__ import annotations
import json
from rich import box
from rich.console import Console, Group
from rich.columns import Columns
from rich.panel import Panel
from rich.table import Table
from rich.text import Text
from rich.rule import Rule

TEAL, VIOLET, AMBER, RED, INK, MUTED, DIM, MINT, ROSE, GOLD = "#7be7d4", "#b0a3ff", "#f7cb7c", "#ff8196", "#edf3ff", "#9dabc3", "#53627a", "#173b3d", "#3b2234", "#3a3021"
LAYER_COLORS = [TEAL, VIOLET, AMBER, "#ff9f7a", "#8fd3ff", "#c7f06b", "#f28fd0", MUTED]
BADGE = "ILLUSTRATIVE WORKFLOW · RELEASED DATA · LIVE OPEN-WEIGHT MODELS"

class Vibe:
    def __init__(self, plain: bool = False, width: int | None = None):
        self.plain = plain
        self.con = Console(highlight=False, color_system=None if plain else "auto", width=width, emoji=False)
        self.box = box.ASCII if plain else box.ROUNDED
        self.chapter = 0

    # ---- primitives ------------------------------------------------------------------------------------
    def print(self, *a, **k): self.con.print(*a, **k)
    def tag(self, s: str, kind: str = "ok") -> Text:
        if self.plain: return Text(f"[{s}]")
        style = {"ok": f"bold {TEAL} on {MINT}", "bad": f"bold {RED} on {ROSE}", "warn": f"bold {AMBER} on {GOLD}", "dim": f"bold {MUTED} on #17253a", "violet": f"bold {VIOLET} on #2b2848"}[kind]
        return Text(f" {s} ", style=style)
    def mono(self, s: str, color=MUTED) -> Text: return Text(s, style=color)
    def kicker(self, kicker: str, headline: str, sub: str = ""):
        self.chapter += 1
        self.print(); self.print(Rule(style="#2b3a51"))
        self.print(Text(f"{self.chapter:02d} / {kicker.upper()}", style=f"bold {TEAL}"))
        self.print(Text(headline, style=f"bold {INK}"))
        if sub: self.print(Text(sub, style=MUTED))
    def say(self, line: str, chain: str = ""):
        """The agent's one-line intention, as in the film's dialogue bubble."""
        t = Text.assemble(self.tag("VERIFIEDLAB", "ok"), "  ", (line, INK))
        self.print(t)
        if chain: self.print(Text("  " + chain, style=f"{TEAL}"))
    def note(self, s: str, kind="warn"): self.print(Text.assemble("  ", self.tag("NOTE", kind), "  ", (s, MUTED)))
    def call(self, tag: str, meta: dict):
        self.print(Text(f"  ↳ {tag} · {meta['model'].split('/')[-1]} · {meta['node']} gpu {meta['gpus']} · {meta['seconds']}s · {meta['prompt_tokens']}+{meta['completion_tokens']} tok", style=DIM))
    def panel(self, body, title: str = "", kind: str = "dim", pad=(0, 1)):
        self.print(Panel(body, title=self.tag(title, kind) if title else None, title_align="left", border_style="#2b3a51", box=self.box, padding=pad))
    def cards(self, items: list[tuple[str, str, str]]):
        """Film-style stat cards: (label, big value, sub)."""
        ps = [Panel(Group(Text(label, style=f"bold {DIM}"), Text(big, style=f"bold {TEAL}"), Text(sub, style=MUTED)), border_style="#2b3a51", box=self.box, padding=(0, 2), expand=False) for label, big, sub in items]
        self.print(Columns(ps, padding=(0, 2)))
    def stack(self, title: str, stack: str, bad: bool = False, kind: str = "dim", note: str = "substrate → top contact"):
        layers = [l.strip() for l in str(stack or "").split("/") if l.strip()] or ["(stack not reported)"]
        n = len(layers); g = Table.grid(padding=(0, 1))
        for i, l in enumerate(layers):
            ci = (n - 1 - i) if bad else i   # colours follow the material, so a reversed stack shows the same colours upside down
            bar = Text("████████" if not self.plain else "########", style=LAYER_COLORS[ci % len(LAYER_COLORS)])
            g.add_row(Text(f"{i+1}", style=DIM), bar, Text(l, style=RED if bad else INK))
        self.panel(Group(g, Text(note, style=DIM)), title=title, kind=kind)
    def stacks_side_by_side(self, left: tuple, right: tuple):
        def one(title, stack, bad, kind):
            layers = [l.strip() for l in str(stack or "").split("/") if l.strip()] or ["(stack not reported)"]
            n = len(layers); g = Table.grid(padding=(0, 1))
            for i, l in enumerate(layers):
                ci = (n - 1 - i) if bad else i
                g.add_row(Text(f"{i+1}", style=DIM), Text("████████" if not self.plain else "########", style=LAYER_COLORS[ci % len(LAYER_COLORS)]), Text(l, style=RED if bad else INK))
            return Panel(Group(g, Text("substrate → top contact", style=DIM)), title=self.tag(title, kind), title_align="left", border_style="#2b3a51", box=self.box, padding=(0, 1), expand=False)
        self.print(Columns([one(*left), one(*right)], padding=(0, 3)))
    def table(self, columns: list[str], rows: list[list], styles: dict | None = None, title: str = ""):
        t = Table(box=self.box, border_style="#2b3a51", header_style=f"bold {DIM}", show_lines=False, title=title or None, title_style=f"bold {TEAL}", title_justify="left", pad_edge=False)
        for c in columns: t.add_column(c, overflow="ellipsis", no_wrap=True, max_width=40, min_width=max(len(c) + 2, 8))
        for r in rows: t.add_row(*[x if isinstance(x, Text) else str(x) for x in r])
        self.print(t)
    def hist(self, values: list[float], bins: int = 12, width: int = 36, label: str = "PCE (%)"):
        if not values: return
        lo, hi = min(values), max(values); counts = [0] * bins
        for v in values: counts[min(bins - 1, int((v - lo) / (hi - lo or 1) * bins))] += 1
        m = max(counts); g = Table.grid(padding=(0, 1))
        for b, c in enumerate(counts):
            a = lo + (hi - lo) * b / bins
            g.add_row(Text(f"{a:5.1f}", style=DIM), Text(("█" if not self.plain else "#") * int(c / m * width), style=TEAL), Text(str(c), style=MUTED))
        self.panel(Group(g, Text(f"{label}: reported reverse-scan efficiency of published champion devices", style=DIM)), title="REPORTED EFFICIENCY", kind="dim")
    def gate(self, rel: dict, threshold: float, active: set | None = None):
        g = Table.grid(padding=(0, 2))
        for cat, r in rel.items():
            on = active is None or cat in active
            route = "CONTINUE" if r > threshold else "HUMAN REVIEW"
            bar = Text(("█" if not self.plain else "#") * int(r / 2.5) + ("░" if not self.plain else ".") * (40 - int(r / 2.5)), style=(TEAL if r > threshold else AMBER) if on else DIM)
            g.add_row(Text(cat, style=INK if on else DIM), bar, Text(f"{r:6.2f} %", style=MUTED), self.tag(route, "ok" if r > threshold else "warn") if on else Text(""))
        self.panel(Group(g, Text(f"illustrative workflow policy: category judged accuracy > {threshold:g} %   ·   category-level calibration is not confidence in an individual value", style=DIM)), title="RELIABILITY GATE", kind="dim")
    def claims(self, claims: list[dict], scoped: str = "", overrides: list | None = None):
        rows = []
        for c in claims:
            if c["verdict"] == "SUPPORTED":
                rows += [Text.assemble(("✓ " if not self.plain else "+ ", TEAL), (c["statement"], INK), "  ", self.tag("SUPPORTED", "ok"))]
            else:
                rows += [Text.assemble(("✗ " if not self.plain else "x ", RED), Text(c["statement"], style=f"strike {RED}"), "  ", self.tag("WITHHELD", "bad")),
                         Text("   " + c.get("reason", ""), style=AMBER)]
        body = Group(*rows) if not scoped else Group(*rows, Text(""), Text(scoped, style=INK))
        self.panel(body, title="SCOPED ANSWER", kind="ok")
        if overrides: self.note(f"the harness withheld a claim the critic had kept: {overrides}", "warn")
    def files(self, run_dir: str, files: list[str]):
        g = Table.grid(padding=(0, 2))
        for f in files: g.add_row(Text(f.split(".")[-1].upper(), style=DIM), Text(f, style=INK), Text("✓" if not self.plain else "ok", style=TEAL))
        self.panel(Group(g, Text(run_dir, style=DIM)), title="OUTPUT FILES", kind="ok")

    # ---- the persistent workspace ----------------------------------------------------------------------
    def banner(self, roles: dict | None, skills: dict, corpus: int, fields: int = 97):
        self.print(Rule(style="#2b3a51"))
        head = Text.assemble(("■ " if not self.plain else "", TEAL), ("VerifiedLab", f"bold {INK}"), ("   RESEARCH WORKSPACE", MUTED), ("   ·   ", DIM), (BADGE, DIM))
        self.print(head)
        ws = Table.grid(padding=(0, 3)); ws.add_column(); ws.add_column()
        left = Group(Text("WORKSPACE", style=f"bold {DIM}"),
                     *[Text(f"  {f}", style=MUTED) for f in ("research.md", "annotation.skill", "verification.skill", "device_record.json", "source_records.csv", "research_brief.md")],
                     Text(""), Text("CORPUS", style=f"bold {DIM}"), Text(f"  {corpus:,}", style=f"bold {INK}"), Text(f"  published papers · {fields} record fields", style=MUTED),
                     Text(""), Text.assemble(("  ● ", TEAL), ("Generate   ", MUTED), ("● ", TEAL), ("Verify   ", MUTED), ("● ", TEAL), ("Reason", MUTED)))
        rl = [Text("CONTRACT", style=f"bold {DIM}"),
              Text.assemble(("  Generator  ", MUTED), (f"psc-annotate-v1@{skills['annotate']}", TEAL)),
              Text.assemble(("  Verifier   ", MUTED), (f"psc-verify-v1@{skills['verify']}", TEAL)), Text("")]
        if roles:
            rl.append(Text("AGENTS", style=f"bold {DIM}"))
            for r, v in roles.items():
                rl.append(Text.assemble((f"  {r:<11}", MUTED), (", ".join(v.get("models", [v.get("error", "offline")])).replace("meta-llama/", "").replace("Qwen/", ""), INK), (f"  ×{v.get('replicas', 0)}  {', '.join(sorted({n.split(':')[0] for n in v.get('nodes', [])}))}", DIM)))
        else:
            rl.append(Text("AGENTS      offline until a live command (probe / audit / discuss / run)", style=DIM))
        ws.add_row(left, Group(*rl))
        self.panel(ws, title="verifiedlab / research_session", kind="dim")
        self.print(Text("What will you investigate?", style=f"bold {INK}"))
        self.print(Text("One question. An inspectable chain of evidence.   Type help, or start with: show · trend · record <DOI> · probe <DOI> · discuss <question>", style=MUTED))
    def close(self, corpus: int, calls: int):
        self.print(); self.print(Rule(style="#2b3a51"))
        self.print(Text("VerifiedLab", style=f"bold {INK}")); self.print(Text.assemble(("Harnessing Knowns ", f"bold {INK}"), ("for Unknowns.", f"bold {TEAL}")))
        self.print(Text("Scientific rules. Measured reliability. Evidence an AI scientist can inspect.", style=MUTED))
        self.cards([("PAPERS", f"{corpus:,}", "verified records"), ("FIELDS", "97", "per record"), ("THIS SESSION", str(calls), "live model calls")])

# ---- investigation views (ask): one proof per screen ---------------------------------------------------------
CHECK_LABEL = {"numbers_match_evidence": "numbers in evidence", "direction_matches_evidence": "direction agrees", "comparison_present_if_needed": "comparison present", "scope_matches_wording": "scope matches wording"}

def _ok(self, flag):
    return Text("✓" if not self.plain else "+", style=f"bold {TEAL}") if flag else Text("✗" if not self.plain else "x", style=f"bold {RED}")

def claim_card(self, i: int, c: dict, rel: dict, threshold: float):
    """One verified claim: category reliability, route, the critic's four checks, the harness rules, the verdict."""
    r = rel.get(c["category"], 0); route_ok = r > threshold
    head = Text.assemble((f"CLAIM {i}  ", f"bold {DIM}"), (c["statement"], INK))
    cat = Text.assemble(("  category  ", DIM), self.tag(f"{c['category'].upper()} · {r} %", "ok" if route_ok else "warn"), ("   gate  ", DIM), self.tag("CONTINUE" if route_ok else "HUMAN REVIEW", "ok" if route_ok else "warn"))
    g = Table.grid(padding=(0, 2))
    checks = c.get("checks") or {}
    for k, label in CHECK_LABEL.items():
        if k in checks: g.add_row(Text("  critic", style=DIM), _ok(self, checks[k]), Text(label, style=INK if checks[k] else RED))
    for seg in [x.strip() for x in c.get("reason", "").split(";")]:
        if seg.startswith("caveat"): g.add_row(Text("  harness", style=DIM), Text("!", style=f"bold {AMBER}"), Text(seg.split(":", 1)[1].strip(), style=AMBER))
        elif seg.startswith("harness"): g.add_row(Text("  harness", style=DIM), _ok(self, False), Text(seg, style=RED))
    if not route_ok:
        g.add_row(Text("  harness", style=DIM), _ok(self, False), Text(f"category below the {threshold:g} % policy → returned to the human", style=AMBER))
    issue = c.get("issue", "").strip()
    verdict = Text.assemble(("  verdict   ", DIM), self.tag(c["verdict"], "ok" if c["verdict"] == "SUPPORTED" else "bad"), ("   " + issue if issue and c["verdict"] == "WITHHELD" else "", AMBER))
    body = Group(head, cat, g, verdict)
    self.panel(body, kind="ok" if c["verdict"] == "SUPPORTED" else "bad")

def evidence_compact(self, ev: dict, threshold: float, max_rows: int = 6):
    """A cited evidence item: tag, title, the few rows that matter."""
    r = ev.get("reliability") or 0
    self.print(Text.assemble(("  ", ""), self.tag(f"{ev['category'].upper()} · {r} %", "ok" if r > threshold else "warn"), (f"  {ev['title']}", INK)))
    t = ev.get("table")
    if not t: return
    cols = t["columns"]; keep = [j for j, c in enumerate(cols) if c not in ("max DOI",)]
    tbl = Table(box=self.box, border_style="#2b3a51", header_style=f"bold {DIM}", pad_edge=False, show_edge=False)
    for j in keep: tbl.add_column(cols[j], min_width=max(len(cols[j]) + 2, 8))
    for row in t["rows"][:max_rows]:
        tbl.add_row(*[Text(f"{x:.2f}" if isinstance(x, float) else str(x), style=(f"bold {TEAL}" if "median" in cols[j] else INK)) for j, x in enumerate(row) if j in keep])
    self.print(tbl)
    if len(t["rows"]) > max_rows: self.print(Text(f"    … {len(t['rows']) - max_rows} more rows in evidence.json", style=DIM))

Vibe.claim_card = claim_card
Vibe.evidence_compact = evidence_compact
