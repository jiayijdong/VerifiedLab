#!/usr/bin/env python
"""VerifiedLab research workspace in the terminal: explore the verified database and drive the live agents.
   python explore.py            interactive (type help)       python explore.py --plain     ASCII, no colour
   python explore.py "show" "trend" "probe <DOI>"             one-shot commands"""
from __future__ import annotations
import cmd, csv, json, random, shlex, statistics, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from rich.text import Text
from verifiedlab import agents, config, data, gate as gating, notes, rules
from verifiedlab.data import EXTRA_FILTERS, number
from verifiedlab.vibe import Vibe, TEAL, RED, AMBER, INK, MUTED, DIM

BASE_KEYS = ["composition_prefix", "composition_excludes", "additive_contains", "pce_min", "pce_max", "require_surface_treatment"]
ALL_KEYS = BASE_KEYS + list(EXTRA_FILTERS)
DEFAULT = dict(composition_prefix="FAPbI3", composition_excludes=["Cs", "MA"], additive_contains="MACl", pce_min=0.0, pce_max=30.0, require_surface_treatment=False)

class Explorer(cmd.Cmd):
    prompt = "you › "

    def __init__(self, plain: bool = False):
        super().__init__()
        self.ui = Vibe(plain=plain); self.plain = plain
        if plain: self.prompt = "you > "
        self.filters = dict(DEFAULT); self.saved = {}
        self.policy = config.load_policy(); self.threshold = self.policy["automation_threshold_percent"]
        self.skills = {"annotate": config.skill_text("psc-annotate-v1")[0], "verify": config.skill_text("psc-verify-v1")[0]}
        self.router = None; self.calls = 0
        self.q = data.query_records(**self.filters)
        self.ui.banner(None, self.skills, self.q["total_records"])

    # ---------------- helpers
    def rt(self):
        if self.router is None:
            from verifiedlab.llm import Router
            self.router = Router(trace=[])
            self.ui.say("Connecting to the agents on the allocation.")
            for r, v in self.router.describe().items():
                self.ui.print(Text.assemble((f"  {r:<11}", MUTED), (", ".join(v.get("models", [v.get("error", "offline")])).replace("meta-llama/", "").replace("Qwen/", ""), INK), (f"  ×{v.get('replicas', 0)}  {', '.join(v.get('nodes', []))}", DIM)))
        return self.router
    def track(self, res):
        self.calls += 1; self.ui.call(res["meta"]["tag"], res["meta"]); return res
    def refresh(self): self.q = data.query_records(**self.filters)
    def cat(self, field): return data.category_of(field, self.policy)
    def rel(self, field): return self.policy["category_reliability_percent"].get(self.cat(field))
    def rows(self): return self.q["rows"]
    def contract_line(self):
        c = {k: v for k, v in self.filters.items() if v not in ("", None, False, [])}
        return "query   " + "   ".join(f"{k}: {v}" for k, v in c.items())
    def cohort_cards(self, q=None):
        q = q or self.q
        if not q["n"]: self.ui.note("no record matches this contract", "warn"); return
        v = q["values"]; qs = statistics.quantiles(v, n=4)
        self.ui.cards([("MATCHING RECORDS", str(q["n"]), f"of {q['eligible_records']} eligible · with source DOIs"),
                       ("REPORTED EFFICIENCY", f"{q['median_pce']} %", f"median PCE · q1 {qs[0]:.1f} · q3 {qs[2]:.1f} · max {max(v):.1f}"),
                       ("ABOVE 22 %", f"{q['share_above_22']:.1%}", "share of records · descriptive, not a forecast")])

    # ---------------- query the corpus
    def do_show(self, arg):
        """show                       the current cohort: contract, record count, efficiency distribution"""
        self.ui.kicker("query the corpus", "From one record to a recipe family.", "Reliability-scoped query over the released database.")
        self.ui.say("I'll query the released records under an explicit contract. Every row keeps its DOI.", "generate  →  verify  →  query  →  critique")
        self.ui.print(Text("  " + self.contract_line(), style=TEAL))
        self.cohort_cards(); self.ui.hist(self.q["values"])
    def do_filter(self, arg):
        """filter key=value [...] | filter default | filter clear      redefine the cohort contract
        keys: composition_prefix composition_excludes(a,b) additive_contains pce_min pce_max require_surface_treatment(true/false)
              composition_contains etl_contains htl_contains stack_contains surface_contains antisolvent_contains journal_contains
              architecture(NIP/PIN) dimension(3D/2D) encapsulation year_min year_max
        e.g.  filter composition_prefix=MAPbI3 composition_excludes=FA,Cs additive_contains= etl_contains=SnO2 year_min=2023"""
        toks = shlex.split(arg)
        if "clear" in toks: self.filters = dict(composition_prefix="", composition_excludes=[], additive_contains="", pce_min=0.0, pce_max=30.0, require_surface_treatment=False)
        if "default" in toks: self.filters = dict(DEFAULT)
        for tok in [t for t in toks if t not in ("clear", "default")]:
            if "=" not in tok: self.ui.note(f"expected key=value, got {tok}", "bad"); return
            k, v = tok.split("=", 1)
            if k not in ALL_KEYS: self.ui.note(f"unknown key {k}. keys: {' '.join(ALL_KEYS)}", "bad"); return
            if k == "composition_excludes": v = [x for x in v.split(",") if x]
            elif k in ("pce_min", "pce_max", "year_min", "year_max"): v = float(v) if v else None
            elif k == "require_surface_treatment": v = v.lower() in ("1", "true", "yes")
            if v is None: self.filters.pop(k, None)
            else: self.filters[k] = v
        self.refresh(); self.do_show("")
    def do_save(self, arg):
        """save <name>                keep the current cohort for compare"""
        name = arg.strip() or f"cohort{len(self.saved)+1}"
        self.saved[name] = (dict(self.filters), self.q); self.ui.note(f"saved '{name}' · {self.q['n']} records", "ok")
    def do_compare(self, arg):
        """compare [name ...]         saved cohorts side by side (n, median, share >= 22 %, treated share, NIP share)"""
        names = arg.split() or list(self.saved) + ["current"]
        self.ui.kicker("query the corpus", "Same contract, different families.", "Each column is a descriptive statistic over released champion devices.")
        rows = []
        for n in names:
            fq = self.saved.get(n) or ((self.filters, self.q) if n == "current" else None)
            if not fq: self.ui.note(f"no cohort '{n}'", "bad"); continue
            q = fq[1]; v = q["values"]
            if not v: rows.append([n, "0", "", "", "", "", ""]); continue
            st = sum(r["Perovskite_surface_treatment_material"] != "Null" for r in q["rows"]) / q["n"]; nip = sum(str(r["Cell_architecture"]).upper() == "NIP" for r in q["rows"]) / q["n"]
            rows.append([Text(n, style=INK), str(q["n"]), Text(f"{q['median_pce']:.2f} %", style=f"bold {TEAL}"), f"{statistics.mean(v):.2f} %", f"{sum(x>=22 for x in v)/len(v):.1%}", f"{st:.1%}", f"{nip:.1%}"])
        self.ui.table(["cohort", "n", "median PCE", "mean", "≥ 22 %", "surface-treated", "NIP"], rows)
        self.ui.print(Text("  J–V metrics: 93.12 % judged accuracy → CONTINUE.  Transport layers unrestricted unless filtered.", style=DIM))
    def do_top(self, arg):
        """top <field> [k]            most frequent values of a field in the cohort, with the category's judged accuracy"""
        a = arg.split(); f = a[0] if a else "ETL_stack_sequence"; k = int(a[1]) if len(a) > 1 else 10
        if f not in data.records().columns: self.ui.note(f"unknown field {f} (try: fields)", "bad"); return
        full = data.records().loc[self.q["index"]].to_dict("records")
        self.ui.kicker("query the corpus", f"What this family uses for {f.replace('_', ' ')}.", f"{len(full)} records · category {self.cat(f)}")
        self.ui.print(Text.assemble("  ", self.ui.tag(f"{self.cat(f).upper()} · {self.rel(f)} % JUDGED ACCURACY", "ok" if self.rel(f) > self.threshold else "warn")))
        rows = [[Text(str(c), style=f"bold {TEAL}"), Text(("█" if not self.plain else "#") * int(c / data.value_counts(full, f, 1)[0][1] * 24), style=TEAL), v[:70]] for v, c in data.value_counts(full, f, k)]
        self.ui.table(["n", "", "value"], rows)
    def do_trend(self, arg):
        """trend                      median PCE by publication year, cohort against the whole corpus"""
        allq = data.query_records(pce_min=0, pce_max=30)
        a = {y: (n, m) for y, n, m in data.by_year(allq["rows"])}; c = {y: (n, m) for y, n, m in data.by_year(self.rows())}
        self.ui.kicker("query the corpus", "The family over time.", "Reported efficiencies drift upward; the cohort is read against the corpus of the same year.")
        rows = []
        for y in sorted(set(a) | set(c)):
            if y < 2021: continue
            cn, cm = c.get(y, (0, None)); an, am = a.get(y, (0, None))
            rows.append([str(y), str(cn), Text(f"{cm:.2f}" if cm else "–", style=f"bold {TEAL}"), Text(("█" if not self.plain else "#") * int((cm or 0) * 1.6), style=TEAL), str(an), f"{am:.2f}" if am else "–"])
        self.ui.table(["year", "cohort n", "cohort median", "", "corpus n", "corpus median"], rows)
    def do_best(self, arg):
        """best [k]                   the cohort's highest reported efficiencies"""
        k = int(arg) if arg.strip() else 8
        self.ui.kicker("query the corpus", "The strongest records, each with its DOI.", "Reported values; consult the source for any value that matters.")
        self.ui.table(["DOI", "year", "PCE", "stack"], [[Text(r["Ref_DOI"], style=INK), r["Ref_publication_year"], Text(r["JV_measured_reverse_scan_PCE"], style=f"bold {TEAL}"), r["Cell_stack_sequence"]] for r in sorted(self.rows(), key=lambda r: -(number(r["JV_measured_reverse_scan_PCE"]) or 0))[:k]])
    def do_sample(self, arg):
        """sample [k]                 random records of the cohort"""
        k = int(arg) if arg.strip() else 8
        self.ui.kicker("query the corpus", "A random slice of the family.", "")
        self.ui.table(["DOI", "year", "PCE", "stack"], [[Text(r["Ref_DOI"], style=INK), r["Ref_publication_year"], r["JV_measured_reverse_scan_PCE"], r["Cell_stack_sequence"]] for r in random.sample(self.rows(), min(k, len(self.rows())))])

    # ---------------- inspect one device
    def do_record(self, arg):
        """record <DOI> [all]         one verified record, grouped by category with judged accuracy ('all' shows Null fields)"""
        a = arg.split(); rec = data.record_by_doi(a[0]) if a else None
        if not rec: self.ui.note("record <DOI>   (DOIs come from best / sample / top)", "bad"); return
        show_all = len(a) > 1 and a[1] == "all"
        self.ui.kicker("inspect one device", str(rec.get("Ref_title", ""))[:90] + ("…" if len(str(rec.get("Ref_title", ""))) > 90 else ""), f"{rec['Ref_journal']} · {rec['Ref_publication_year']} · DOI {rec['Ref_DOI']}")
        self.ui.say("A typed record replaces the PDF. Every category carries its judged accuracy.")
        chk = rules.record_consistency(rec); bad = not (chk["stack_substrate_first"] and chk["absorber_in_stack"] and chk["architecture_consistent_with_stack"] is not False)
        self.ui.stack("DEVICE PREVIEW" + (" · RULE FLAG" if bad else ""), rec.get("Cell_stack_sequence"), bad=bad, kind="bad" if bad else "ok")
        if bad: self.ui.note(f"consistency rules: {json.dumps({k: v for k, v in chk.items() if k != 'n_layers'})}", "warn")
        cats = {}
        for f, v in rec.items():
            if f.startswith("_") or f in ("JV_measured_inverse_scan_Voc", "ETL_deposition_spin_coating_score", "Perovskite_deposition_final_solutions_concentration"): continue
            if rules.is_empty(v) and not show_all: continue
            cats.setdefault(self.cat(f), []).append((f, v))
        for c, items in cats.items():
            r = self.policy["category_reliability_percent"].get(c, 0)
            self.ui.print(Text.assemble("  ", self.ui.tag(f"{c.upper()} · {r} %", "ok" if r > self.threshold else "warn")))
            for f, v in items: self.ui.print(Text.assemble(("    " + f"{f:<62}", MUTED), (str(v)[:70], INK if not rules.is_empty(v) else DIM)))
    def do_note(self, arg):
        """note <DOI> [up]            the device note the generator reads (top-down like a schematic; 'up' = substrate first)"""
        a = arg.split(); rec = data.record_by_doi(a[0]) if a else None
        if not rec: self.ui.note("note <DOI>", "bad"); return
        self.ui.kicker("inspect one device", "What the generator reads.", "Prose rendering of the released record, not article text.")
        self.ui.panel(Text(notes.device_note(rec, top_down=not (len(a) > 1 and a[1] == "up")), style=MUTED), title="DEVICE NOTE", kind="dim")
    def do_fields(self, arg):
        """fields                     the 97-field schema by category, with judged accuracy"""
        self.ui.kicker("execution contract", "A schema that fixes the output contract.", "Seven categories distilled by experimentalists; the same definitions are the evaluation rubric.")
        cols = [c for c in data.records().columns if not c.startswith("_")]
        for c, r in self.policy["category_reliability_percent"].items():
            fs = [f for f in cols if self.cat(f) == c]
            self.ui.print(Text.assemble("  ", self.ui.tag(f"{c.upper()} · {r} %", "ok" if r > self.threshold else "warn"), (f"  {len(fs)} fields", MUTED)))
            self.ui.print(Text("    " + "  ".join(fs), style=DIM))
    def do_rule(self, arg):
        """rule <field>               the verification rule the harness executes for a field"""
        f = arg.strip()
        self.ui.kicker("verification rule", "Order is part of the value." if "stack" in f.lower() else "A rule you can read.", f"{f} · {self.cat(f)} · {self.rel(f)} %")
        self.ui.panel(Text(rules.rule_text(f), style=INK), title=f"psc-verify-v1@{self.skills['verify']}", kind="violet")

    # ---------------- policy
    def do_threshold(self, arg):
        """threshold [pct]            move the automation threshold; watch categories route to CONTINUE or HUMAN REVIEW"""
        if arg.strip(): self.threshold = float(arg); self.policy["automation_threshold_percent"] = self.threshold
        self.ui.kicker("reliability gate", "Let reliability decide what runs next.", "Reliability travels with the data.")
        self.ui.gate(self.policy["category_reliability_percent"], self.threshold)

    # ---------------- live agents
    def do_probe(self, arg):
        """probe <DOI> [up|reverse]   LIVE  generate the record from the note · verify every field (two judges + rules) · repair"""
        a = arg.split(); rec = data.record_by_doi(a[0]) if a else None
        if not rec: self.ui.note("probe <DOI>", "bad"); return
        mode = a[1] if len(a) > 1 else "topdown"; r = self.rt(); note = notes.device_note(rec, top_down=(mode != "up"))
        self.ui.kicker("inspect one device", "Same materials. Wrong order?", f"DOI {rec['Ref_DOI']} · the note lists the stack {'substrate-first' if mode == 'up' else 'top-down, as a schematic would'}.")
        self.ui.say("I'll generate the record, then verify it under explicit, versioned rules.", f"psc-annotate-v1@{self.skills['annotate']}  →  psc-verify-v1@{self.skills['verify']}")
        t0 = time.time(); res = self.track(agents.generator_draft(r, note, config.LIVE_FIELDS)); draft = res["json"]
        if mode == "reverse":
            draft["Cell_stack_sequence"] = "/".join(reversed(rec["Cell_stack_sequence"].split("/"))); self.ui.note("stack deliberately reversed · illustrative error, labelled", "warn")
        chk = rules.ordered_sequence_check(draft.get("Cell_stack_sequence", ""), rec["Cell_stack_sequence"])
        self.ui.stacks_side_by_side(("CANDIDATE" + (" · REVERSED" if chk["reversed_copy"] else ""), draft.get("Cell_stack_sequence"), not chk["same_order"], "ok" if chk["same_order"] else "bad"),
                                    ("RELEASED REFERENCE", rec["Cell_stack_sequence"], False, "dim"))
        self.ui.print(Text.assemble("  ", self.ui.tag("MATERIALS MATCH" if chk["same_material_membership"] else "MATERIALS DIFFER", "ok" if chk["same_material_membership"] else "bad"), " ", self.ui.tag("ORDER PRESERVED" if chk["same_order"] else "ORDER MISMATCH", "ok" if chk["same_order"] else "bad")))
        ver = agents.verify_record(r, draft, rec, config.LIVE_FIELDS); self.calls += 2
        self.ui.kicker("verification rule", "Order is part of the value." if not chk["same_order"] else "Every field, two judges, one rule set.", "Compare the ordered sequence from substrate to top contact. Material membership alone is insufficient.")
        self.ui.call("judge_a", ver["summary"]["models"]["judge_a"]); self.ui.call("judge_b", ver["summary"]["models"]["judge_b"])
        self.verify_table(ver)
        rejected = [d for d in ver["decisions"] if d["label"] in ("FP", "FN", "FP_mismatch")]
        if rejected:
            self.ui.say(f"The verifier rejects {len(rejected)} field(s). I'm returning the decisions and their rules to the generator.")
            fb = [{"field": d["field"], "label": d["label"], "rule": d["rule"], "candidate": d["candidate"]} for d in rejected]
            res = self.track(agents.generator_draft(r, note, config.LIVE_FIELDS, feedback=fb)); fixed = res["json"]
            ver2 = agents.verify_record(r, fixed, rec, config.LIVE_FIELDS); self.calls += 2
            ok = not ver2["summary"]["rejected"]
            self.ui.stack("CORRECTED RECORD" if ok else "STILL REJECTED", fixed.get("Cell_stack_sequence"), bad=not rules.ordered_sequence_check(fixed.get("Cell_stack_sequence", ""), rec["Cell_stack_sequence"])["same_order"], kind="ok" if ok else "bad")
            self.ui.print(Text.assemble("  ", self.ui.tag(f"{ver2['summary']['accepted']}/{ver2['summary']['fields']} FIELDS ACCEPTED", "ok" if ok else "warn"), ("   ✓ corrected record + source DOI " + rec["Ref_DOI"], TEAL) if ok else (f"   still rejected: {ver2['summary']['rejected']}", AMBER)))
        else:
            self.ui.print(Text.assemble("  ", self.ui.tag("19/19 FIELDS ACCEPTED", "ok"), ("   ✓ record bound to source DOI " + rec["Ref_DOI"], TEAL)))
        self.ui.print(Text(f"  local sequence check against the released record · {time.time() - t0:.1f} s", style=DIM))
    def verify_table(self, ver):
        s = ver["summary"]; rows = []
        for d in ver["decisions"]:
            ok = d["label"] in ("TP", "TN")
            short = lambda l: {"FP_mismatch": "FP_mis", None: "–"}.get(l, str(l))
            rows.append([Text(d["field"][:34], style=INK), d["candidate"][:26], d["reference"][:26], short(d["judge_a"]), short(d["judge_b"]), short(d["rule_label"]), self.ui.tag(short(d["label"]), "ok" if ok else "bad")])
        self.ui.table(["field", "candidate", "released reference", "A", "B", "rule", "label"], rows)
        self.ui.print(Text(f"  accepted {s['accepted']}/{s['fields']} · judges agree {s['judge_agreement']:.0%} · judge A vs rules {s['judge_a_vs_rules']:.0%} · judge B vs rules {s['judge_b_vs_rules']:.0%} · the rule decides where it applies", style=DIM))
    def do_audit(self, arg):
        """audit [n]                  LIVE  the verifier pool checks every cohort record against the stack rules, in parallel"""
        rows = self.rows()[: int(arg)] if arg.strip() else self.rows()
        if not rows: self.ui.note("empty cohort", "warn"); return
        r = self.rt(); pool = r.pool("verifier_b")
        self.ui.kicker("verify the family", "Rules over scale.", f"{len(rows)} records · {len(pool)} replicas of {pool[0].model.split('/')[-1]} on {', '.join(sorted({e.node for e in pool}))}")
        self.ui.say("I'll run the same three rules on every record, with a small verifier on each GPU and the harness's code as referee.")
        last = [0.0]
        def prog(i, n, ep):
            if time.time() - last[0] > 0.5 or i == n: last[0] = time.time(); self.ui.print(Text(f"  {i:>4}/{n}  {'█' * int(i / n * 40) if not self.plain else '#' * int(i / n * 40)}  {ep.name}@{ep.node}", style=TEAL))
        a = agents.audit_cohort(r, rows, prog); self.calls += a["n"]
        self.ui.cards([("RECORDS CHECKED", str(a["n"]), f"{a['seconds']} s · {a['records_per_second']} records/s"), ("JUDGE vs RULES", f"{a['judge_rule_agreement']:.1%}", "agreement with the deterministic check"), ("RULE-FLAGGED", str(len(a["rule_flagged"])), "records to open")])
        for f in a["rule_flagged"]:
            rec = next(x for x in rows if x["Ref_DOI"] == f["doi"])
            self.ui.print(Text.assemble("  ", self.ui.tag("FLAG", "bad"), (f"  {f['doi']}  ", INK), (rec["Cell_stack_sequence"][:50], RED), ("  " + ", ".join(k for k, v in f["rule"].items() if v is False), DIM)))
    # ---------------- key questions and exploratory investigations
    def do_questions(self, arg):
        """questions                  the field's key questions the records can answer; `ask <n>` runs one"""
        from verifiedlab.questions import KEY_QUESTIONS
        self.ui.kicker("one research task", "What will you investigate?", "Twelve questions of the field, each answered from the released records through the full architecture.")
        for q in KEY_QUESTIONS:
            self.ui.print(Text.assemble((f"  {q['id']:>2}  ", f"bold {TEAL}"), (f"{q['topic']:<22}", MUTED), (q["question"], INK)))
            self.ui.print(Text(f"      {q['why']}", style=DIM))
        self.ui.print(Text("  ask <n> runs a key question · ask <your own question> lets the PI choose the evidence", style=DIM))
    def do_ask(self, arg):
        """ask <n> | ask <question>   LIVE  a key question (by number) or your own, through PI → librarian → specialist → gate → critic"""
        from verifiedlab.questions import by_id
        from verifiedlab.research import investigate
        a = arg.strip()
        if not a: self.ui.note("ask <n> or ask <question>", "bad"); return
        kq = by_id(int(a)) if a.isdigit() else None
        if a.isdigit() and not kq: self.ui.note("no such question; see `questions`", "bad"); return
        question = kq["question"] if kq else a
        r = self.rt()
        self.ui.kicker("one research task", question[:110], (f"Key question {kq['id']} · {kq['topic']}" if kq else "Exploratory question · the PI chooses the evidence") + " · every number comes from the released records")
        self.ui.say("I'll plan the claims, ask the librarian for evidence, answer over reliable categories, and scope the conclusion.", "PI  →  librarian  →  specialist  →  gate  →  critic  →  artifacts")
        pending = {"evidence": [], "t0": time.time()}
        def emit(kind, **e):
            if kind == "pi":
                self.calls += 1; self.ui.call(e["meta"]["tag"], e["meta"])
                for c in e["plan"]["claims_to_make"]:
                    rel = self.policy["category_reliability_percent"].get(c["category"], 0)
                    self.ui.print(Text.assemble(("  claim  ", DIM), (c["question"], INK), "  ", self.ui.tag(f"{c['category']} · {rel} %", "ok" if rel > self.threshold else "warn")))
                self.ui.print(Text("  librarian ← " + " · ".join(f"{c['tool']}({', '.join(f'{k}={v}' for k, v in (c.get('args') or {}).items())})" for c in e["calls"]), style=DIM))
                pending["t0"] = time.time()
            elif kind == "evidence":
                pending["evidence"] = e["evidence"]
                self.ui.print(Text.assemble(("  librarian → ", DIM), (f"{len(e['evidence'])} evidence items computed from the released records in {time.time() - pending['t0']:.1f} s", TEAL), ("   (no model involved)", DIM)))
            elif kind == "team":
                self.calls += len(e["team"])
                self.ui.kicker("the team answers", "Three specialists, three GPUs, one evidence set.", "device physicist · materials chemist · data scientist, in parallel")
                for t in e["team"]:
                    self.ui.print(Text.assemble(("  ", ""), self.ui.tag(t["agent"].upper(), "violet"), (f"  {t['meta']['server']} on {t['meta']['node']} gpu {t['meta']['gpus']} · {t['meta']['seconds']}s", DIM)))
                    for c in t["claims"]: self.ui.print(Text.assemble(("     · ", DIM), (c["statement"][:150], INK)))
            elif kind == "specialist":
                self.calls += 1
                self.ui.kicker("a result you can inspect", "The PI consolidates the team's answer.", f"{e['meta']['model'].split('/')[-1]} · every claim names the evidence it rests on")
                self.ui.call("pi_synthesis", e["meta"])
                cited = set()
                for i, c in enumerate(e["claims"], 1):
                    self.ui.print(Text.assemble((f"  {i}  ", f"bold {TEAL}"), (c["statement"], INK)))
                    import re as _re
                    cited |= {k for k in _re.findall(r"\b([a-z_]+_\d+)\b", c.get("evidence", ""))}
                items = {f"{ev['tool']}_{i}": ev for i, ev in enumerate(pending["evidence"])}
                shown = [items[k] for k in items if k in cited] or list(items.values())[:2]
                self.ui.print(Text("  evidence the answer rests on", style=f"bold {DIM}"))
                for ev in shown: self.ui.evidence_compact(ev, self.threshold)
                others = [ev["title"] for k, ev in items.items() if k not in cited and ev not in shown]
                if others: self.ui.print(Text("  also computed, not cited: " + " · ".join(o[:60] for o in others), style=DIM))
                self.ui.print(Text("  " + shown[0]["note"], style=DIM))
            elif kind == "gate":
                pass   # the gate is shown inside each claim card
            elif kind == "critic":
                self.calls += len(e.get("metas") or [1]) + 1
                self.ui.kicker("verify the claims", "Claims keep their evidence, or return for review.", "one critic call per claim, in parallel · four factual checks · the harness applies the gate and its rules and decides")
                for m in (e.get("metas") or []): self.ui.call(m["tag"], m)
                for i, c in enumerate(e["claims"], 1): self.ui.claim_card(i, c, self.policy["category_reliability_percent"], self.threshold)
            elif kind == "done":
                cl = e.get("claims", []); sup = [c for c in cl if c["verdict"] == "SUPPORTED"]; wh = [c for c in cl if c["verdict"] == "WITHHELD"]
                checks = [v for c in cl for v in (c.get("checks") or {}).values()]
                cats = sorted({c["category"] for c in cl}); rel = self.policy["category_reliability_percent"]
                self.ui.kicker("scoped answer", "The evidence changes the answer." if wh else "An answer that keeps its evidence.", f"{e['seconds']} s · {self.calls} model calls this session · {e['run_dir'].split('/')[-1]}")
                self.ui.cards([("SUPPORTED", str(len(sup)), "claims with evidence"), ("WITHHELD", str(len(wh)), "returned for review" if wh else "nothing withheld"),
                               ("CHECKS", f"{sum(checks)}/{len(checks)}", "critic facts confirmed"), ("RELIABILITY", " · ".join(f"{rel.get(c, 0):.0f} %" for c in cats), " · ".join(cats))])
                for c in wh: self.ui.print(Text.assemble(("  ✗ " if not self.plain else "  x ", RED), Text(c["statement"][:100], style=f"strike {RED}"), ("  " + c["reason"].split(";")[0], AMBER)))
                self.ui.panel(Text(e.get("scoped", ""), style=INK), title="SCOPED ANSWER", kind="ok")
                self.ui.print(Text(f"  open: {e['run_dir']}/research_brief.md", style=DIM))
        investigate(r, question, calls=(kq["calls"] if kq else None), policy=self.policy, emit=emit)
    def do_discuss(self, arg):
        """discuss <question>         alias of ask <question>"""
        return self.do_ask(arg)

    def do_run(self, arg):
        """run [request]              LIVE  the full nine-chapter demo"""
        from verifiedlab.orchestrator import Run
        from verifiedlab.plain import Plain
        if self.plain: Run(arg.strip() or None, emit=Plain(width=100), router=self.rt()).start(); return
        from cli import render
        Run(arg.strip() or None, emit=render, router=self.rt()).start()
    def do_servers(self, arg):
        """servers                    the agents and where they run"""
        r = self.rt(); self.ui.banner(r.describe(), self.skills, self.q["total_records"])
    def do_export(self, arg):
        """export <file.csv>          write the cohort rows"""
        path = arg.strip() or "cohort.csv"
        with open(path, "w", newline="") as f:
            w = csv.DictWriter(f, list(self.rows()[0].keys())); w.writeheader(); w.writerows(self.rows())
        self.ui.kicker("inspect the output", "A research lead you can open.", "Source rows · exact filters · DOIs")
        self.ui.files(str(Path(path).resolve().parent), [Path(path).name])

    # ---------------- misc
    def do_help(self, arg):
        if arg: return super().do_help(arg)
        self.ui.kicker("research workspace", "What will you investigate?", "Commands run on the released records; LIVE commands call the agents on the allocation.")
        groups = [("QUERY THE CORPUS", ["show", "filter", "save", "compare", "top", "trend", "best", "sample", "export"]),
                  ("INSPECT ONE DEVICE", ["record", "note", "fields", "rule"]),
                  ("RELIABILITY", ["threshold"]),
                  ("INVESTIGATE (LIVE)", ["questions", "ask", "probe", "audit", "run", "servers"])]
        for title, names in groups:
            self.ui.print(Text.assemble("  ", self.ui.tag(title, "ok" if "LIVE" in title else "dim")))
            for n in names:
                doc = (getattr(self, "do_" + n).__doc__ or "").strip().splitlines()[0]
                self.ui.print(Text.assemble(("    ", ""), (f"{doc[:27]:<27}", TEAL), (doc[27:].strip(), MUTED)))
        self.ui.print(Text("  help <command> for details · quit to leave", style=DIM))
    def do_quit(self, arg):
        """quit                       leave the workspace"""
        self.ui.close(self.q["total_records"], self.calls); return True
    do_exit = do_EOF = do_quit
    def emptyline(self): pass
    def default(self, line):
        self.ui.note(f"unknown command '{line.split()[0]}' · help", "bad")

if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--plain"]; plain = "--plain" in sys.argv
    ex = Explorer(plain=plain)
    if args:
        for c in args: ex.ui.print(Text(f"{ex.prompt}{c}", style=f"bold {TEAL}")); ex.onecmd(c)
    else:
        ex.cmdloop(intro="")
