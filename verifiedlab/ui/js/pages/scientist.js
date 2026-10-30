/** AI Scientist — research sessions (PI → librarian → specialists → gate → critic), key questions, claims ledger, reports. */
import { $$, h, esc, num, pageHead, sectionHead, kv, badge, relBadge, routeBadge, table, loading, errorBox, empty, icon, md, drawer, toast, fmtDate, ago } from '../ui.js';
import { stream } from '../api.js';
import { verdictBadge } from '../record.js';
import { createLivePanel } from '../live.js';
import { investigationView, disposeSessionViews, roleBoard, roleStatsFromTrace, EVENT_ROLE, REL as REL2 } from '../session.js';

const REL = REL2;

export async function render(ctx) {
  const s = ctx.route.section;
  if (s === 'questions') return questions(ctx);
  if (s === 'claims') return ledger(ctx);
  if (s === 'reports') return reports(ctx);
  return sessions(ctx);
}

export function fromEvidence(run, id) {
  const ev = run.evidence || {};
  return { question: ev.question, mode: (ev.plan?.scope === 'corpus_comparison' ? 'corpus comparison · ' : '') + 'recorded', plan: ev.plan, calls: ev.calls, evidence: ev.evidence, team: ev.team, gate: ev.gate, final: ev.claims, scoped: ev.scoped_answer, files: run.summary?.files, runId: id, done: true, roleStats: roleStatsFromTrace(run.trace), seconds: run.trace?.length ? +run.trace.reduce((a, t) => a + (t.seconds || 0), 0).toFixed(1) : undefined };
}

/* ------------------------------------------------------------------ Sessions */
async function sessions({ $, $$, replaceUrl, main, api, href, route, navigate, setCrumbs }) {
  const sel = route.section === 'session' ? route.path[1] : null;
  main.innerHTML = pageHead('Research sessions', 'One question becomes a plan, an evidence set computed from the released records, specialist drafts, a reliability gate and a critic\'s checks. The harness, not a model, has the last word.') + `<div class="tri"><div id="left">${loading(5)}</div><div id="center"></div><div id="side"></div></div>`;
  const [runsRes, servers, qs, about] = await Promise.all([api.runs().catch(() => ({ runs: [] })), api.servers().catch(() => ({ healthy: 0 })), api.questions().catch(() => ({ questions: [] })), api.about().catch(() => null)]);
  if (about?.roles) servers.prefs = about.roles;
  const inv = runsRes.runs.filter((r) => r.kind === 'investigation');
  const live = servers.healthy > 0;
  const left = $('#left'); const center = $('#center'); const side = $('#side');
  function renderLeft(activeId) {
    left.innerHTML = `<a class="btn btn-primary mb-3" style="width:100%;justify-content:center" href="${href('scientist')}">${icon('plus', 14)}New session</a><div class="small muted mb-2">${inv.length} recorded</div><div class="side-list">${inv.map((r) => `<a class="side-item ${r.id === activeId ? 'active' : ''}" href="${href('scientist', ['session', r.id])}"><span class="t" title="${esc(r.question || '')}">${esc(r.question || r.id)}</span><span class="s">${r.supported ?? 0} supported · ${r.withheld ?? 0} withheld · ${r.started ? ago(r.started) : ''}</span></a>`).join('') || `<p class="small muted">No sessions yet.</p>`}</div>`;
  }
  let closer = null;
  if (sel) {
    renderLeft(sel); setCrumbs([{ label: 'AI Scientist', href: href('scientist') }, { label: 'Research sessions', href: href('scientist') }, { label: sel }]);
    center.innerHTML = loading(10);
    try { const run = await api.run(sel); const inv = fromEvidence(run, sel); inv.key = qs.questions.find((q) => q.question === inv.question) || null; if (inv.key) inv.mode = 'key question'; investigationView(center, side, inv, { href, servers }); }
    catch (e) { center.innerHTML = errorBox(e); }
    return () => disposeSessionViews();
  }
  renderLeft(null);
  const chips = qs.questions.map((q) => `<button class="chip" type="button" data-key="${q.id}" title="${esc(q.question)}"><b>${q.id}</b>${esc(q.topic)}</button>`).join('');
  center.innerHTML = `<div class="card"><h3 class="mb-2">Ask a question</h3><p class="small muted">The PI agent plans, chooses librarian tools and tags the claims; every number in the answer is computed from the released records and every claim keeps or loses its evidence in the open.</p>
    ${live ? '' : `<div class="callout warn mb-3">${icon('server', 14)}<div><b>Model servers are offline.</b> Live sessions need the vLLM servers inside the Slurm allocation (<code>bash slurm/launch_servers.sh</code>). Recorded sessions on the left remain fully inspectable.</div></div>`}
    <textarea class="textarea" id="q" rows="3" placeholder="e.g. Do inverted (p-i-n) devices with SAM hole contacts reach higher efficiency than n-i-p devices since 2023?" ${live ? '' : 'disabled'}></textarea>
    <div class="row mt-3"><button class="btn btn-primary" id="ask" ${live ? '' : 'disabled'}>${icon('send', 14)}Ask the lab</button><span class="small muted">PI → librarian → specialist team → gate → critic → artifacts</span></div>
    <div class="divider"></div><div class="small muted mb-2">Key questions of the field (fixed evidence recipes)</div><div class="chips">${chips}</div></div>
    <div class="card mt-4"><div class="card-head"><h3>The lab</h3><span class="right small muted">six roles in pipeline order · what each may do and which model backs it</span></div>${roleBoard({}, servers)}</div>`;
  side.innerHTML = `<div class="card"><div class="card-head"><h3>Rules of the lab</h3></div><ul class="small" style="padding-left:18px;margin:0"><li>Only the librarian touches the records, and it is code.</li><li>Every number in an answer is computed, never recalled.</li><li>Claims keep or lose their evidence in the open.</li><li>Categories under ${85} % judged accuracy go back to a human.</li></ul></div>`;
  async function start(body) {
    if (!live) { toast('Model servers are offline'); return; }
    $('#ask').disabled = true;
    let r; try { r = await api.investigate(body); } catch (e) { toast(`Could not start: ${e.message}`); $('#ask').disabled = false; return; }
    const st = { live: true, runId: r.run_id };
    side.innerHTML = '<div id="lp"></div><div id="sb" class="mt-4"></div>';
    const panel = createLivePanel($('#lp')); const sb = $('#sb');
    st.roleStats = {}; center.innerHTML = ''; investigationView(center, sb, st, { href, servers });
    closer = stream(r.run_id, (e) => {
      panel.handle(e);
      if (e.type === 'call_start' || e.type === 'call_end') {
        const k = EVENT_ROLE[e.role] || e.role; const rs = (st.roleStats[k] ||= { calls: 0, seconds: 0, tokens: 0 });
        if (e.type === 'call_start') { rs.active = (rs.active || 0) + 1; rs.tag = e.tag; } else { rs.active = Math.max(0, (rs.active || 1) - 1); rs.calls += 1; rs.seconds += e.seconds || 0; rs.tokens += (e.prompt_tokens || 0) + (e.completion_tokens || 0); }
        investigationView(center, sb, st, { href, servers }); return;
      }
      if (e.type === 'ask') { st.question = e.question; st.key = e.key; st.mode = e.key ? 'key question' : 'exploratory'; panel.badge(`${Object.values(e.roles || {}).reduce((n, x) => n + (x.replicas || 0), 0)} model replicas · ${e.run_id}`); }
      else if (e.type === 'error') { toast(e.text); center.insertAdjacentHTML('afterbegin', errorBox(e.text)); return; }
      else if (e.type === 'inv') {
        if (e.kind === 'pi') { st.plan = e.plan; st.calls = e.calls; st.piMeta = e.meta; st.mode = e.mode; }
        else if (e.kind === 'evidence') st.evidence = e.evidence;
        else if (e.kind === 'team') st.team = e.team;
        else if (e.kind === 'specialist') st.synth = e.claims;
        else if (e.kind === 'gate') st.gate = e.gate;
        else if (e.kind === 'critic') { st.final = e.claims; st.scoped = e.scoped; st.overrides = e.overrides; }
        else if (e.kind === 'done') { st.done = true; st.files = e.files; st.seconds = e.seconds; st.live = false; }
      } else return;
      investigationView(center, sb, st, { href, servers });
    }, () => { st.live = false; investigationView(center, sb, st, { href, servers }); toast('Session complete'); }, () => toast('Event stream closed'));
  }
  $('#ask').onclick = () => { const t = $('#q').value.trim(); if (t) start({ question: t }); };
  $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#ask').click(); } });
  $$('.chip[data-key]', center).forEach((b) => { b.onclick = () => (live ? start({ key: +b.dataset.key }) : navigate('scientist', ['questions'])); });
  if (route.params.ask && live) start({ key: +route.params.ask });
  return () => { if (closer) closer(); disposeSessionViews(); };
}

/* ------------------------------------------------------------------ Key questions */
async function questions({ $, $$, replaceUrl, main, api, href }) {
  main.innerHTML = pageHead('Key questions', 'Twelve questions of the perovskite-solar-cell field that the released records can answer, each with a fixed librarian evidence recipe.') + `<div id="kq">${loading(6)}</div>`;
  const [qs, servers, runs] = await Promise.all([api.questions(), api.servers().catch(() => ({ healthy: 0 })), api.runs().catch(() => ({ runs: [] }))]);
  const live = servers.healthy > 0;
  $('#kq').innerHTML = `<div class="grid grid-2">${qs.questions.map((q) => { const past = runs.runs.filter((r) => r.kind === 'investigation' && r.question === q.question); return `<div class="card"><div class="row mb-2"><span class="badge">${q.id}</span><b>${esc(q.topic)}</b><span class="spacer"></span>${past.length ? `<a class="small" href="${href('scientist', ['session', past[0].id])}">${past.length} recorded</a>` : ''}</div><p>${esc(q.question)}</p><p class="small muted">${esc(q.why)}</p><div class="small muted mb-3">librarian: <span class="mono">${q.calls.map((c) => esc(c.tool)).join(' · ')}</span></div><a class="btn btn-sm ${live ? 'btn-primary' : ''}" href="${href('scientist', [], { ask: q.id })}" ${live ? '' : 'aria-disabled="true" title="Model servers offline"'}>${icon('send', 13)}${live ? 'Ask' : 'Ask (offline)'}</a></div>`; }).join('')}</div>`;
}

/* ------------------------------------------------------------------ Claims ledger */
async function ledger({ $, $$, replaceUrl, main, api, href }) {
  main.innerHTML = pageHead('Claims ledger', 'Every claim decided in a recorded session, with the verdict the harness computed from the critic\'s checks, the gate and its own rules. Nothing here is a confirmed scientific finding; supported means supported by the released records under the stated scope.') + `<div class="toolbar"><div class="segmented" id="vf"><button type="button" data-v="" aria-pressed="true">All</button><button type="button" data-v="SUPPORTED" aria-pressed="false">Supported</button><button type="button" data-v="WITHHELD" aria-pressed="false">Withheld</button></div><span class="spacer"></span><span class="small muted" id="n"></span></div><div id="lg">${loading(8)}</div>`;
  let d; try { d = await api.claims(); } catch (e) { $('#lg').innerHTML = errorBox(e); return; }
  let v = '';
  const draw = () => {
    const rows = d.claims.filter((c) => !v || c.verdict === v);
    $('#n').textContent = `${rows.length} of ${d.claims.length} claims from ${d.runs} sessions`;
    $('#lg').innerHTML = ''; $('#lg').appendChild(table({ columns: [
      { key: 'verdict', label: 'Verdict', render: (r) => verdictBadge(r.verdict) }, { key: 'statement', label: 'Claim', wrap: true, render: (r) => `<div>${esc(r.statement)}</div><div class="small muted">${esc(r.reason || '')}</div>` },
      { key: 'category', label: 'Category', render: (r) => relBadge(r.category, REL[r.category] ?? 0) }, { key: 'question', label: 'Session', wrap: true, render: (r) => `<a class="small" href="${href('scientist', ['session', r.run])}">${esc(r.question)}</a><div class="small muted">${esc(r.started || '')}</div>` },
    ], rows, dense: true, emptyText: 'No claims recorded.' }));
  };
  $$('#vf button').forEach((b) => { b.onclick = () => { v = b.dataset.v; $$('#vf button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); }; });
  draw();
}

/* ------------------------------------------------------------------ Reports */
async function reports({ $, $$, replaceUrl, main, api, href, route }) {
  main.innerHTML = pageHead('Research reports', 'The research brief written at the end of every session: scoped answer, claims with verdicts, the evidence tables and the scope statement.') + `<div class="tri" style="grid-template-columns:300px minmax(0,1fr)"><div id="rl">${loading(5)}</div><div id="rv"></div></div>`;
  const runs = (await api.runs().catch(() => ({ runs: [] }))).runs.filter((r) => r.files?.includes('research_brief.md'));
  const sel = route.params.run || runs[0]?.id;
  $('#rl').innerHTML = `<div class="side-list">${runs.map((r) => `<a class="side-item ${r.id === sel ? 'active' : ''}" href="${href('scientist', ['reports'], { run: r.id })}"><span class="t">${esc(r.question || r.request || r.id)}</span><span class="s">${r.kind} · ${esc(r.started || '')}</span></a>`).join('') || '<p class="small muted">No reports yet.</p>'}</div>`;
  if (!sel) { $('#rv').innerHTML = empty('No reports', 'A research_brief.md is written by every completed session.', 'file-text'); return; }
  try { const run = await api.run(sel); $('#rv').innerHTML = `<div class="card"><div class="row mb-3"><a class="btn btn-sm" href="/runs/${esc(sel)}/research_brief.md" target="_blank" rel="noopener">${icon('download', 13)}research_brief.md</a>${run.summary.kind === 'investigation' ? `<a class="btn btn-sm" href="${href('scientist', ['session', sel])}">${icon('message-square', 13)}Session</a>` : `<a class="btn btn-sm" href="${href('workflows', ['run', sel])}">${icon('workflow', 13)}Workflow run</a>`}</div>${md(run.research_brief || '')}</div>`; }
  catch (e) { $('#rv').innerHTML = errorBox(e); }
}
