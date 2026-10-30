/** Research-session renderer: the librarian's evidence as charts, the claims as compact verdict rows, and two data-carrying 3D views
 *  (the champion device the evidence points at; the cohort inside the corpus cloud). Agent prose is kept but folded away. */
import { esc, num, badge, relBadge, routeBadge, icon, h, isNull, kv, stat } from './ui.js';
import { lines, hbars, vbars } from './charts.js';
import { verdictBadge } from './record.js';
import { mountDevice, mountCloud } from './device3d.js';
import { api } from './api.js';

export const REL = { 'Reference data': 99.5, 'Cell definition': 93.33, 'Device fabrication': 93.05, 'J-V metrics': 93.12, 'Device stack': 89.95, 'Material synthesis': 85.31, 'Stability metrics': 70.31 };
const CHK = { numbers_match_evidence: 'numbers appear in the evidence', direction_matches_evidence: 'direction agrees with the evidence', comparison_present_if_needed: 'comparison present where needed', scope_matches_wording: 'scope matches the wording' };
const CHK_ICON = { numbers_match_evidence: 'hash', direction_matches_evidence: 'arrow-up-down', comparison_present_if_needed: 'scale', scope_matches_wording: 'quote' };
const STEPS = [['plan', 'Plan', 'pi'], ['evidence', 'Evidence', 'code'], ['team', 'Drafts', 'specialists'], ['gate', 'Gate', 'policy'], ['final', 'Critic', 'critic · harness'], ['scoped', 'Answer', 'harness']];
const DOI_RE = /10\.\d{4,9}\/[^\s)\]",;]+/g;

/* ------------------------------------------------------------------ roles: who each agent is, what backs it, what it did */
export const ROLE_DEFS = [
  { key: 'pi', label: 'Principal investigator', icon: 'brain-circuit', color: 'var(--s1)', does: 'plans the investigation, picks librarian tools, consolidates the drafts', bound: 'never reads papers', serverRole: 'pi', step: 'plan' },
  { key: 'librarian', label: 'Librarian', icon: 'library', color: 'var(--muted)', does: 'computes every evidence item from the released records', bound: 'code · no model', step: 'evidence' },
  { key: 'specialist', label: 'Specialist team', icon: 'users', color: 'var(--s2)', does: 'device physicist, materials chemist and data scientist draft claims in parallel', bound: 'see only the evidence', serverRole: 'specialist', step: 'team' },
  { key: 'gate', label: 'Reliability gate', icon: 'gauge', color: 'var(--s3)', does: 'routes each claim by the judged accuracy of its category', bound: 'workflow policy · code', step: 'gate' },
  { key: 'critic', label: 'Critic', icon: 'shield-check', color: 'var(--s1)', does: 'answers four factual checks for every claim', bound: 'cannot overrule the gate', serverRole: 'critic', step: 'final' },
  { key: 'harness', label: 'Harness', icon: 'scale', color: 'var(--fg-2)', does: 'computes the verdicts, scopes the answer, writes the artifacts', bound: 'code · the last word', step: 'scoped' },
];
export const EVENT_ROLE = { pi: 'pi', specialist: 'specialist', generator: 'specialist', critic: 'critic', verifier_a: 'critic', verifier_b: 'critic' };
/** Aggregate a recorded trace (or live call events) into per-role model statistics. */
export function roleStatsFromTrace(trace) {
  const st = {};
  (trace || []).forEach((t) => { const k = EVENT_ROLE[t.role] || t.role; const r = (st[k] ||= { calls: 0, seconds: 0, tokens: 0 }); r.calls += 1; r.seconds += t.seconds || 0; r.tokens += (t.prompt_tokens || 0) + (t.completion_tokens || 0); });
  return st;
}
function backing(def, servers) {
  if (!def.serverRole) return `<span class="r-back code">${icon('terminal', 11)} ${esc(def.bound)}</span>`;
  const v = servers?.roles?.[def.serverRole];
  if (!v || v.error || !v.models?.length) {   // offline: show the configured preference so the role keeps its identity
    const pref = (servers?.prefs?.[def.serverRole] || [])[0]; const sv = pref && (servers?.servers || []).find((x) => x.name === pref.replace('*', '') || x.name.startsWith(pref.replace('*', '')));
    return sv ? `<span class="r-back warn" title="configured server ${esc(sv.name)} is not reachable">${icon('cpu', 11)} ${esc(sv.model.split('/').pop())} <span class="muted">· offline</span></span>` : `<span class="r-back warn">${icon('server', 11)} no model server configured</span>`;
  }
  const nodes = [...new Set((v.servers || []).map((n) => servers.servers?.find((x) => x.name === n)?.node).filter(Boolean))];
  return `<span class="r-back" title="${esc(def.bound)}">${icon('cpu', 11)} ${esc(v.models[0].split('/').pop())}${v.replicas > 1 ? ` <b>×${v.replicas}</b>` : ''}${nodes.length ? ` <span class="muted">· ${esc(nodes.join(', '))}</span>` : ''}</span>`;
}
const fmtS = (x) => (x >= 10 ? `${Math.round(x)} s` : `${(+x).toFixed(1)} s`);
/** The role board: six cards in pipeline order, each with its duty, its backing and what it contributed to `inv` (may be partial / live). */
export function roleBoard(inv = {}, servers = null, { compact = false } = {}) {
  const done = { plan: !!inv.plan, evidence: !!inv.evidence, team: !!inv.team, gate: !!inv.gate, final: !!inv.final, scoped: !!inv.scoped };
  const liveIdx = ROLE_DEFS.findIndex((d) => !done[d.step]);
  const rs = inv.roleStats || {};
  const fin = inv.final || []; const nS = fin.filter((c) => c.verdict === 'SUPPORTED').length; const nW = fin.filter((c) => c.verdict === 'WITHHELD').length;
  const chips = {
    pi: [inv.plan && `${(inv.plan.plan || []).length} plan steps`, inv.calls && `${inv.calls.length} librarian call${inv.calls.length === 1 ? '' : 's'}`, inv.synth && `${inv.synth.length} claims consolidated`],
    librarian: [inv.evidence && `${inv.evidence.length} evidence item${inv.evidence.length === 1 ? '' : 's'}`, inv.evidence && `${[...new Set(inv.evidence.map((e) => e.tool))].length} tools`],
    specialist: inv.team ? inv.team.map((t) => `${esc(t.agent.split(' ')[0])} ${(t.claims || []).length}${t.meta?.seconds ? ` · ${fmtS(t.meta.seconds)}` : ''}`) : [],
    gate: inv.gate ? [`threshold ${inv.gate.threshold} %`, ...Object.entries(inv.gate.by_category).map(([c, g]) => `${esc(c.split(' ')[0])} ${g.route === 'CONTINUE' ? '✓' : '→ human'}`)] : [],
    critic: fin.length ? (() => { const all = fin.flatMap((c) => Object.values(c.checks || {})); return [`${all.filter(Boolean).length}/${all.length} checks passed`]; })() : [],
    harness: fin.length ? [`${nS} supported`, `${nW} withheld`, inv.overrides?.length && `${inv.overrides.length} override`, inv.files && `${inv.files.length} files`] : [],
  };
  const cards = ROLE_DEFS.map((d, i) => {
    const r = rs[d.key]; const active = inv.live && (r?.active || (i === liveIdx && !r)); const state = done[d.step] ? 'done' : active ? 'live' : '';
    const model = r && r.calls ? `<span class="r-chip m">${r.calls} call${r.calls === 1 ? '' : 's'} · ${fmtS(r.seconds)} · ${num(r.tokens, 0)} tok</span>` : '';
    return `<div class="role ${state}" style="--rc:${d.color}" title="${esc(d.does)}"><div class="r-head"><span class="r-ic">${icon(d.icon, 15)}</span><b>${esc(d.label)}</b><span class="r-n">${i + 1}</span></div>
      ${compact ? '' : `<div class="r-does">${esc(d.does)}</div>`}${backing(d, servers)}
      <div class="r-stats">${model}${(chips[d.key] || []).filter(Boolean).map((c) => `<span class="r-chip">${c}</span>`).join('')}${state === 'live' ? `<span class="r-chip live">${icon('loader-circle', 11, 'spin')} ${r?.tag ? esc(r.tag) : 'working'}</span>` : ''}</div></div>`;
  }).join('');
  const tot = ['pi', 'specialist', 'critic'].reduce((a, k) => a + (rs[k]?.seconds || 0), 0);
  const bar = tot ? `<div class="role-time"><span class="small muted">model time</span><span class="rt-bar">${['pi', 'specialist', 'critic'].map((k) => (rs[k]?.seconds ? `<i style="width:${(100 * rs[k].seconds) / tot}%;background:${ROLE_DEFS.find((d) => d.key === k).color}" title="${k}: ${fmtS(rs[k].seconds)}"></i>` : '')).join('')}</span><span class="small tnum">${fmtS(tot)}</span><span class="small muted">· librarian, gate and harness run as code</span></div>` : '';
  return `<div class="roles ${compact ? 'compact' : ''}">${cards}</div>${bar}`;
}

/* ------------------------------------------------------------------ evidence → chart */
function col(t, name) { return t.columns.findIndex((c) => String(c).toLowerCase() === name); }
function tableFallback(ev) {
  if (!ev.table) return `<div class="small muted">${esc(ev.summary?.error || 'no table')}</div>`;
  const cols = ev.table.columns; const rows = ev.table.rows.slice(0, 8);
  return `<div class="table-wrap"><table class="table dense"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td class="${typeof v === 'number' ? 'num' : ''}" title="${esc(v)}">${typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
/** Draw one evidence item into `el`. onDoi(doi, label) is called when the user picks a bar that carries a champion DOI. */
export function evidenceChart(el, ev, { onDoi } = {}) {
  const t = ev.table; const tool = ev.tool || '';
  try {
    if ((tool.startsWith('breakdown') || tool === 'cohort' || tool === 'area') && t) {
      const iG = col(t, 'group') >= 0 ? col(t, 'group') : col(t, 'slice') >= 0 ? col(t, 'slice') : col(t, 'area band'); const iN = col(t, 'n'); const iM = col(t, 'median pce'); const iS = col(t, '≥ 22 %'); const iD = col(t, 'max doi'); const iBy = col(t, 'by');
      const groups = iBy >= 0 ? [...new Set(t.rows.map((r) => r[iBy]))] : [null];
      el.innerHTML = '';
      groups.forEach((g) => {
        const rows = t.rows.filter((r) => iBy < 0 || r[iBy] === g).slice(0, 8);
        const items = rows.map((r, i) => ({ label: String(r[iG]), value: +r[iM], n: r[iN], sub: iS >= 0 && r[iS] != null ? `${(r[iS] * 100).toFixed(0)} % ≥ 22` : '', doi: iD >= 0 ? r[iD] : null, hl: i === 0 }));
        const wrap = h(`<div class="ev-sub">${g ? `<div class="small muted mb-1">by ${esc(g)}</div>` : ''}<div class="ch"></div></div>`); el.appendChild(wrap);
        hbars(wrap.querySelector('.ch'), items, { xLabel: 'median reverse-scan PCE (%)', fmt: (v) => `${num(v, 2)} %`, onPick: onDoi ? (it) => it.doi && onDoi(it.doi, it.label) : null });
      });
      return true;
    }
    if (tool === 'trend' && ev.summary?.by_year) {
      const by = ev.summary.by_year;
      lines(el, [{ name: 'cohort', points: by.filter((r) => r.cohort_n >= 5).map((r) => ({ x: r.year, y: r.cohort_median, n: r.cohort_n })) }, { name: 'corpus', points: by.map((r) => ({ x: r.year, y: r.corpus_median, n: r.corpus_n })) }], { xLabel: 'Publication year', yLabel: 'Median PCE (%)', H: 220 });
      return true;
    }
    if (tool === 'bandgap' && t) {
      const items = t.rows.map((r) => ({ label: String(r[0]), value: +r[1], hl: +r[0] >= 1.5 && +r[0] < 1.7 }));
      vbars(el, items, { yLabel: 'devices above threshold', xLabel: 'bandgap (eV)', fmt: (v) => num(v, 0) });
      const a = ev.summary?.above_threshold; if (a) el.appendChild(h(`<div class="small muted mt-2">${num(a.n, 0)} devices · median ${num(a.median_bandgap_eV, 2)} eV · <b>${(a.share_in_1_5_1_7_eV * 100 || a['share_in_1.5_1.7_eV'] * 100).toFixed(0)} %</b> inside 1.5–1.7 eV (highlighted)</div>`));
      return true;
    }
    if (tool === 'top_values' && t) {
      const items = t.rows.slice(0, 8).map((r, i) => ({ label: String(r[0]), value: +r[1], sub: r[2] != null ? `${(r[2] * 100).toFixed(1)} %` : '', hl: i === 0 }));
      hbars(el, items, { xLabel: 'devices', fmt: (v) => num(v, 0) });
      const s = ev.summary; if (s?.devices) el.appendChild(h(`<div class="small muted mt-2">${num(s.with_value, 0)} of ${num(s.devices, 0)} devices report the field (${(s.share_with_value * 100).toFixed(0)} %)</div>`));
      return true;
    }
    if (tool === 'stability' && ev.summary) {
      const s = ev.summary;
      el.innerHTML = `<div class="stat-row" style="grid-template-columns:repeat(4,1fr)">${stat(num(s.records, 0), 'records')}${stat(num(s.with_retained_pce, 0), 'report retained PCE')}${stat(s.retained_pce_median_percent != null ? `${num(s.retained_pce_median_percent, 1)} %` : '–', 'median retained')}${stat(s.test_duration_median_h != null ? `${num(s.test_duration_median_h, 0)} h` : '–', 'median duration')}</div><div class="grid grid-2 mt-3"><div><div class="small muted mb-1">test atmosphere</div><div class="ch a"></div></div><div><div class="small muted mb-1">encapsulation</div><div class="ch b"></div></div></div>`;
      hbars(el.querySelector('.ch.a'), (s.atmospheres || []).slice(0, 5).map(([k, n], i) => ({ label: k, value: n, hl: i === 0 })), { fmt: (v) => num(v, 0), W: 300, compact: true });
      hbars(el.querySelector('.ch.b'), (s.encapsulation || []).slice(0, 5).map(([k, n], i) => ({ label: k, value: n, hl: i === 0 })), { fmt: (v) => num(v, 0), W: 300, compact: true });
      return true;
    }
    if (tool === 'reliability' && ev.summary?.category_reliability_percent) {
      const thr = ev.summary.threshold ?? 85;
      el.innerHTML = Object.entries(ev.summary.category_reliability_percent).map(([c, r]) => `<div class="row" style="padding:3px 0;gap:var(--sp-3)"><span class="small" style="width:132px">${esc(c)}</span><span class="meter grow"><b class="${r > thr ? '' : 'warn'}" style="width:${r}%"></b><s style="left:${thr}%"></s></span><span class="small tnum" style="width:52px;text-align:right">${r.toFixed(1)} %</span>${routeBadge(r > thr ? 'CONTINUE' : 'HUMAN_REVIEW')}</div>`).join('');
      return true;
    }
  } catch (e) { console.error(e); }
  el.innerHTML = tableFallback(ev); return false;
}

/* ------------------------------------------------------------------ what the evidence points at */
function leadingDoi(inv) {
  for (const ev of inv.evidence || []) { const t = ev.table; if (!t) continue; const iD = col(t, 'max doi'); if (iD >= 0 && t.rows.length && t.rows[0][iD]) return { doi: t.rows[0][iD], label: String(t.rows[0][0 === iD ? 1 : (col(t, 'group') >= 0 ? col(t, 'group') : 0)]), why: ev.title }; }
  for (const c of inv.final || inv.synth || []) { const m = String(c.statement || '').match(DOI_RE); if (m) return { doi: m[0].replace(/[.,]$/, ''), label: 'cited in a claim', why: c.statement }; }
  return null;
}
function cohortFilters(inv) {
  // contracts the librarian actually executed come first; the PI's default contract counts only for tools that consume it
  const calls = inv.calls || []; const usesDefault = calls.some((c) => ['cohort', 'stability'].includes(c.tool) || c.args?.contract === 'default');
  const cands = [...calls.map((c) => (typeof c.args?.contract === 'object' ? c.args.contract : null)), usesDefault ? inv.plan?.query_contract : null].filter(Boolean);
  for (const c of cands) {
    const f = {}; if (c.composition_prefix) f.composition = c.composition_prefix; else if (c.composition_contains) f.composition = c.composition_contains;
    if (c.additive_contains) f.additive = c.additive_contains; if (c.architecture) f.architecture = c.architecture; if (c.pce_min) f.pce_min = c.pce_min;
    if (Object.keys(f).length) return { filters: f, label: Object.entries(f).map(([k, v]) => `${k.replace('_', ' ')} ${v}`).join(' · '), excludes: c.composition_excludes || [] };
  }
  return null;
}

/* ------------------------------------------------------------------ side: two 3D views, mounted once per key */
const SIDES = new Set();
function ensureSide(side) {
  if (side.dataset.ready) return;
  side.dataset.ready = '1'; SIDES.add(side); side._gl = { dev: null, devKey: '', cloud: null, cloudKey: '', corpus: null };
  side.innerHTML = `<div class="card"><div class="card-head"><h3>Champion device</h3><span class="right small muted trunc" id="s-dev-cap" style="max-width:55%"></span></div><div id="s-dev" style="height:230px"></div><div class="small muted mt-2" id="s-dev-note">The evidence has not named a device yet.</div></div>
    <div class="card mt-4"><div class="card-head"><h3>Cohort in the corpus</h3><span class="right small muted" id="s-cloud-cap"></span></div><div id="s-cloud" style="height:250px"></div><div class="small muted mt-2" id="s-cloud-note">bandgap × PCE × year · one point per paper</div></div>
    <div class="card mt-4" id="s-claims"><div class="card-head"><h3>Claims</h3></div><p class="small muted" style="margin-bottom:0">Claims appear once the critic has checked them.</p></div>`;
}
async function showDevice(side, pick, href) {
  const g = side._gl; if (!pick || pick.doi === g.devKey) return; g.devKey = pick.doi;
  const cap = side.querySelector('#s-dev-cap'); const note = side.querySelector('#s-dev-note'); cap.textContent = pick.label; note.innerHTML = `${icon('loader-circle', 12, 'spin')} loading ${esc(pick.doi)}`;
  try {
    const d = await api.record(pick.doi); if (g.devKey !== pick.doi) return;
    if (g.dev) g.dev(); g.dev = mountDevice(side.querySelector('#s-dev'), d.record, { height: 230, compact: true, explode: 0.3, tools: false });
    const r = d.record; note.innerHTML = `<a href="${href ? href('literature', ['paper', r.Ref_DOI]) : '#'}" class="doi">${esc(r.Ref_DOI)}</a> · ${esc(r.Ref_publication_year)} · ${isNull(r.JV_measured_reverse_scan_PCE) ? '' : esc(r.JV_measured_reverse_scan_PCE)} · ${esc(r.Cell_architecture)}<br><span class="trunc" style="display:block" title="${esc(r.Ref_title)}">${esc(r.Ref_title)}</span>`;
  } catch (e) { note.innerHTML = `could not load ${esc(pick.doi)}: ${esc(e.message)}`; }
}
async function showCloud(side, coh, { fallbackDevice = false, href } = {}) {
  const g = side._gl; const key = coh ? JSON.stringify(coh.filters) : 'corpus'; if (key === g.cloudKey) return; g.cloudKey = key;
  const cap = side.querySelector('#s-cloud-cap'); const note = side.querySelector('#s-cloud-note');
  try {
    if (!g.corpus) g.corpus = await api.explore({ x: 'bandgap', y: 'pce', z: 'year' });
    let hl = null; let n = g.corpus.points.length;
    if (coh) { const c = await api.explore({ x: 'bandgap', y: 'pce', z: 'year', ...coh.filters }); let pts = c.points; if (coh.excludes?.length) pts = pts.filter((p) => !coh.excludes.some((x) => String(p.family || '').toLowerCase().includes(String(x).toLowerCase()))); hl = new Set(pts.map((p) => p.doi)); n = hl.size; }
    if (g.cloudKey !== key) return;
    if (fallbackDevice && !g.devKey) { const pool = hl ? g.corpus.points.filter((p) => hl.has(p.doi)) : g.corpus.points; const top = pool.reduce((a, p) => (p.pce > (a?.pce ?? -1) ? p : a), null); if (top) showDevice(side, { doi: top.doi, label: `highest reported PCE ${coh ? 'in the cohort' : 'in the corpus'}` }, href); }
    if (g.cloud) g.cloud(); g.cloud = mountCloud(side.querySelector('#s-cloud'), g.corpus.points, { x: { label: 'Bandgap (eV)' }, y: { label: 'PCE (%)' }, z: { label: 'Year' } }, { height: 250, colorBy: 'pce', highlight: hl, onPick: (p) => { location.hash = `#/literature/paper/${encodeURIComponent(p.doi)}`; }, tipFn: (p) => `<b>${esc(p.doi)}</b><span>${num(p.x, 2)} eV · ${num(p.y, 2)} % · ${p.year ? num(p.year, 0) : ''}</span>` });
    cap.textContent = coh ? `${num(n, 0)} of ${num(g.corpus.points.length, 0)} highlighted` : `${num(n, 0)} papers`;
    note.innerHTML = coh ? `cohort ≈ <span class="mono">${esc(coh.label)}</span> (explorer filters approximate the librarian's contract) · others dimmed` : 'whole corpus coloured by PCE · the session did not restrict a cohort';
  } catch (e) { note.textContent = `cloud unavailable: ${e.message}`; }
}
export function disposeSessionViews() { SIDES.forEach((s) => { const g = s._gl || {}; if (g.dev) g.dev(); if (g.cloud) g.cloud(); delete s._gl; delete s.dataset.ready; }); SIDES.clear(); }

/* ------------------------------------------------------------------ main renderer */
export function investigationView(box, side, inv, { href, servers } = {}) {
  const done = { plan: !!inv.plan, evidence: !!inv.evidence, team: !!inv.team, gate: !!inv.gate, final: !!inv.final, scoped: !!inv.scoped };
  const liveIdx = STEPS.findIndex(([k]) => !done[k]);
  const fin = inv.final || []; const nS = fin.filter((c) => c.verdict === 'SUPPORTED').length; const nW = fin.filter((c) => c.verdict === 'WITHHELD').length;
  const stepper = `<div class="mb-4">${roleBoard(inv, servers)}</div>`;
  const answer = inv.scoped ? `<div class="answer"><div class="row wrap mb-2">${badge(`${nS} supported`, 'ok')}${badge(`${nW} withheld`, nW ? 'warn' : 'neutral')}${inv.gate ? Object.entries(inv.gate.by_category).map(([c, g]) => relBadge(c, g.reliability)).join('') : ''}${inv.overrides?.length ? badge('harness override', 'warn') : ''}</div><p>${esc(inv.scoped)}</p>${inv.files ? `<div class="chips">${inv.files.map((f) => `<a class="chip" href="/runs/${esc(inv.runId)}/${esc(f)}" target="_blank" rel="noopener">${icon('file-text', 12)}${esc(f)}</a>`).join('')}</div>` : ''}</div>` : inv.live ? `<div class="note mb-4">${icon('loader-circle', 13, 'spin')} ${liveIdx >= 0 ? STEPS[liveIdx][1] : 'working'}…</div>` : '';
  const evid = inv.evidence ? `<div class="section-head"><h2>Evidence</h2><span class="count">${inv.evidence.length} items · computed by the librarian from the released records, no model</span></div><div class="ev-grid">${inv.evidence.map((ev, i) => `<div class="card ev" data-i="${i}"><div class="row wrap mb-2"><span class="mono muted small">${esc(ev.tool)}_${i}</span>${ev.reliability != null ? relBadge(ev.category, ev.reliability) : badge('no evidence', 'warn')}</div><div class="ev-title">${esc(ev.title)}</div><div class="ev-chart"></div>${ev.note ? `<details class="small muted mt-2"><summary>note</summary>${esc(ev.note)}</details>` : ''}</div>`).join('')}</div>` : '';
  const claims = fin.length ? `<div class="section-head mt-4"><h2>Claims</h2><span class="count">critic answers four checks per claim; the harness computes the verdict</span></div>${fin.map((c, i) => { const ch = Object.entries(c.checks || {}); return `<div class="claim2 ${c.verdict === 'SUPPORTED' ? 'supported' : 'withheld'}"><div class="c-head">${verdictBadge(c.verdict)}<span class="checks">${ch.map(([k, v]) => `<span class="chk ${v ? 'ok' : 'bad'}" title="${esc(CHK[k] || k)}: ${v ? 'pass' : 'fail'}">${icon(CHK_ICON[k] || 'circle-dot', 12)}</span>`).join('')}</span>${c.category ? relBadge(c.category, REL[c.category] ?? 0) : ''}${c.route ? routeBadge(c.route) : ''}<span class="spacer"></span><span class="muted small">${i + 1}</span></div><div class="st ${c.verdict === 'WITHHELD' ? 'withheld' : ''}">${esc(c.statement)}</div>${c.reason ? `<div class="why">${icon('corner-down-right', 11)} ${esc(c.reason)}</div>` : ''}${c.evidence ? `<div class="small muted">evidence <span class="mono">${esc(c.evidence)}</span></div>` : ''}</div>`; }).join('')}` : '';
  const transcript = (inv.plan || inv.team || inv.synth) ? `<details class="transcript mt-4"><summary>${icon('message-square', 13)} Agent transcript <span class="muted small">plan, librarian calls, specialist drafts, consolidation</span></summary>
      ${inv.plan ? `<div class="t-block"><div class="t-who">PI${inv.piMeta ? ` · ${esc(inv.piMeta.model.split('/').pop())} on ${esc(inv.piMeta.node)} · ${inv.piMeta.seconds}s` : ''}</div><ul>${(inv.plan.plan || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul>${(inv.plan.claims_to_make || []).map((c) => `<div class="small">· ${esc(c.question)} ${relBadge(c.category, REL[c.category] ?? 0)}</div>`).join('')}${inv.calls ? `<div class="small muted mt-2">librarian ← <span class="mono">${inv.calls.map((c) => `${esc(c.tool)}(${esc(Object.entries(c.args || {}).map(([a, v]) => `${a}=${JSON.stringify(v)}`).join(', '))})`).join(' · ')}</span></div>` : ''}</div>` : ''}
      ${inv.team ? inv.team.map((t) => `<div class="t-block"><div class="t-who">${esc(t.agent)}${t.meta ? ` · ${esc(t.meta.server)}@${esc(t.meta.node)} · ${t.meta.seconds}s` : ''}</div>${(t.claims || []).map((c) => `<div class="small">· ${esc(c.statement)}</div>`).join('')}</div>`).join('') : ''}
      ${inv.synth ? `<div class="t-block"><div class="t-who">PI consolidates · ${inv.synth.length} claims to the critic</div>${inv.synth.map((c, i) => `<div class="small"><b class="muted">${i + 1}</b> ${esc(c.statement)} <span class="mono muted">${esc(c.evidence || '')}</span></div>`).join('')}</div>` : ''}
      ${inv.gate ? `<div class="t-block"><div class="t-who">Gate · threshold ${inv.gate.threshold} %</div><div class="small muted">${esc(inv.gate.scope)}</div></div>` : ''}</details>` : '';
  box.innerHTML = `<div class="card"><div class="row wrap mb-2">${badge(inv.mode === 'key question' || inv.key ? 'key question' : 'exploratory', 'info')}${inv.live ? badge('live', 'ok') : badge('recorded', 'neutral')}${inv.key ? `<span class="small muted">${esc(inv.key.topic)} · ${esc(inv.key.why)}</span>` : ''}${inv.runId ? `<span class="spacer"></span><span class="mono small muted">${esc(inv.runId)}${inv.seconds ? ` · ${inv.seconds} s` : ''}</span>` : ''}</div><h2 style="font-size:17px;margin-bottom:12px">${esc(inv.question || '')}</h2>${stepper}${answer}${evid}${claims}${transcript}</div>`;
  // charts
  const pickDoi = (doi, label) => side && showDevice(side, { doi, label }, href);
  (inv.evidence || []).forEach((ev, i) => { const el = box.querySelector(`.ev[data-i="${i}"] .ev-chart`); if (el) evidenceChart(el, ev, { onDoi: pickDoi }); });
  // side: 3D views + claim summary
  if (side) {
    ensureSide(side);
    const lead = leadingDoi(inv); showDevice(side, lead, href); showCloud(side, cohortFilters(inv), { fallbackDevice: !lead, href });
    const sc = side.querySelector('#s-claims');
    sc.innerHTML = `<div class="card-head"><h3>Claims</h3>${fin.length ? `<span class="right small muted">${nS} supported · ${nW} withheld</span>` : ''}</div>${fin.length ? fin.map((c) => `<div class="small mb-2">${verdictBadge(c.verdict)} ${esc(c.statement).slice(0, 160)}${c.statement.length > 160 ? '…' : ''}</div>`).join('') : '<p class="small muted" style="margin-bottom:0">Claims appear once the critic has checked them.</p>'}`;
  }
}
