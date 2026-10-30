/** Workflows — recorded agent runs with step timelines and traces, the pipeline as implemented, and launching the harness run. */
import { $$, h, esc, num, pageHead, sectionHead, kv, badge, labelBadge, relBadge, routeBadge, table, loading, errorBox, empty, icon, md, drawer, toast } from '../ui.js';
import { stream } from '../api.js';
import { runTitle, runKindBadge, stackHtml, decisionBadge, verdictBadge } from '../record.js';
import { histogram } from '../charts.js';
import { createLivePanel, openText } from '../live.js';

const CHAPTERS = [['ask', 'Plan & contract', 'PI agent'], ['contract', 'Load Skills', 'harness'], ['catch', 'Draft & verify record', 'generator · judges · rules'], ['repair', 'Repair', 'generator · verifier'], ['query', 'Query corpus', 'librarian · verifier pool'], ['gate', 'Reliability gate', 'policy (code)'], ['critic', 'Answer & critique', 'specialist · critic · harness'], ['handoff', 'Write artifacts', 'harness'], ['close', 'Summary', 'harness']];
const INV_STAGES = [['pi', 'PI plans', 'pi'], ['librarian', 'Librarian evidence', 'code'], ['team', 'Specialist team', 'specialist'], ['synthesis', 'PI synthesis', 'pi'], ['gate', 'Reliability gate', 'code'], ['critic', 'Critic + harness', 'critic'], ['artifacts', 'Artifacts', 'code']];
const ROLE_CLS = { pi: '', critic: '', generator: 'a', specialist: 'a', verifier_a: 'b', verifier_b: 'b' };

export async function render(ctx) {
  const s = ctx.route.section;
  if (s === 'run' && ctx.route.path[1]) return runDetail(ctx, ctx.route.path[1]);
  if (s === 'pipeline') return pipeline(ctx);
  if (s === 'film') return film(ctx);
  return list(ctx);
}

async function list({ $, $$, replaceUrl, main, api, href }) {
  main.innerHTML = pageHead('Workflow runs', 'Every recorded run of the two workflows: the full harness run (plan → extract → verify → repair → query → gate → critique) and research investigations. Each run keeps its full model trace.') + `<div class="toolbar"><div class="segmented" id="kf"><button type="button" data-k="" aria-pressed="true">All</button><button type="button" data-k="film" aria-pressed="false">Harness runs</button><button type="button" data-k="investigation" aria-pressed="false">Investigations</button></div><span class="spacer"></span><a class="btn btn-primary" href="${href('workflows', ['film'])}">${icon('play', 14)}New harness run</a><a class="btn" href="${href('scientist')}">${icon('brain-circuit', 14)}New investigation</a></div><div id="rl">${loading(8)}</div>`;
  let d; try { d = await api.runs(); } catch (e) { $('#rl').innerHTML = errorBox(e); return; }
  let k = '';
  const draw = () => {
    const rows = d.runs.filter((r) => !k || r.kind === k);
    $('#rl').innerHTML = ''; if (!rows.length) { $('#rl').innerHTML = empty('No runs recorded', `Runs are written to ${d.runs_dir}.`, 'workflow'); return; }
    $('#rl').appendChild(table({ columns: [
      { key: 'kind', label: 'Workflow', render: (r) => runKindBadge(r) }, { key: 'title', label: 'Request', wrap: true, render: (r) => `<a href="${href('workflows', ['run', r.id])}">${esc(runTitle(r))}</a>` },
      { key: 'status', label: 'Status', render: (r) => (r.complete ? badge('complete', 'ok') : badge('incomplete', 'warn')) }, { key: 'llm_calls', label: 'Model calls', num: true, render: (r) => num(r.llm_calls, 0) },
      { key: 'result', label: 'Result', render: (r) => (r.kind === 'film' ? (r.complete ? `${r.accepted}/${r.fields} fields accepted` : '–') : `${r.supported ?? 0} supported · ${r.withheld ?? 0} withheld`) },
      { key: 'dur', label: 'Agent time', num: true, render: (r) => (r.timings ? `${Object.values(r.timings).reduce((a, b) => a + b, 0).toFixed(1)} s` : '–') }, { key: 'started', label: 'Started', render: (r) => `<span class="small">${esc(r.started || '')}</span>` },
    ], rows, dense: true }));
  };
  $$('#kf button').forEach((b) => { b.onclick = () => { k = b.dataset.k; $$('#kf button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); }; });
  draw();
}

function pipelineHtml(stages, state = {}) {
  return `<div class="pipeline">${stages.map(([id, label, who], i) => `${i ? `<span class="pipe-arrow">${icon('arrow-right', 14)}</span>` : ''}<div class="pipe-node ${who === 'code' || who === 'harness' || who.includes('code') ? 'code' : ''} ${state[id] === 'done' ? 'done' : state[id] === 'live' ? 'live' : ''}"><b>${esc(label)}</b><span class="who">${esc(who)}${state.timings?.[id] !== undefined ? ` · ${state.timings[id]} s` : ''}</span></div>`).join('')}</div>`;
}

async function runDetail({ $, $$, replaceUrl, main, api, href, setCrumbs }, id) {
  main.innerHTML = loading(10);
  let d; try { d = await api.run(id); } catch (e) { main.innerHTML = pageHead('Run') + errorBox(e); return; }
  const s = d.summary; setCrumbs([{ label: 'Workflows', href: href('workflows') }, { label: 'Workflow runs', href: href('workflows') }, { label: id }]);
  const film = s.kind === 'film';
  const stageState = film ? Object.fromEntries(CHAPTERS.map(([c]) => [c, s.timings && (c in s.timings || c === 'handoff' || c === 'close') ? 'done' : ''])) : Object.fromEntries(INV_STAGES.map(([c]) => [c, s.complete ? 'done' : '']));
  if (film) stageState.timings = s.timings;
  const tr = d.trace || []; const tot = tr.reduce((a, t) => a + (t.seconds || 0), 0); const toks = tr.reduce((a, t) => a + (t.prompt_tokens || 0) + (t.completion_tokens || 0), 0);
  main.innerHTML = pageHead(runTitle(s), `${runKindBadge(s)} ${s.complete ? badge('complete', 'ok') : badge('incomplete', 'warn')} <span class="small muted">${esc(s.started || '')}</span>`, `${film ? `<a class="btn" href="${href('verification', ['history', id])}">${icon('shield-check', 14)}Field decisions</a>` : `<a class="btn" href="${href('scientist', ['session', id])}">${icon('brain-circuit', 14)}Session view</a>`}${s.files?.includes('research_brief.md') ? `<a class="btn" href="${href('scientist', ['reports'], { run: id })}">${icon('file-text', 14)}Report</a>` : ''}`) + `
  <section class="section">${sectionHead('Stages')}${pipelineHtml(film ? CHAPTERS : INV_STAGES, stageState)}</section>
  <div class="grid grid-3 mb-4"><div class="card">${kv([['Model calls', `${tr.length}`], ['Model time (sum)', `${tot.toFixed(1)} s`], ['Tokens (prompt + completion)', num(toks, 0)], ['GPU placements', [...new Set(tr.map((t) => `${t.node}:${t.gpus}`))].length]])}</div>
    <div class="card">${kv(Object.entries(d.run?.models || s.models || {}).map(([r, m]) => [r, `<span class="small">${esc(m || '–')}</span>`]))}${!film && d.evidence ? kv([['Scope', esc(d.evidence.plan?.scope || '')], ['Evidence items', `${d.evidence.evidence?.length ?? 0}`], ['Claims', `${d.evidence.claims?.length ?? 0}`]]) : ''}</div>
    <div class="card"><h4>Artifacts</h4><div class="chips mt-2">${(s.files || []).map((f) => `<a class="chip" href="/runs/${esc(id)}/${esc(f)}" target="_blank" rel="noopener">${icon('file-text', 12)}${esc(f)}</a>`).join('')}</div>${d.run ? `<p class="small muted mt-3" style="margin-bottom:0">manuscript ${esc(d.run.manuscript_commit)} · dataset ${esc(d.run.dataset_commit)} · policy ${esc(d.run.policy)}${d.run.slurm_job ? ` · Slurm job ${esc(d.run.slurm_job)}` : ''}</p>` : ''}</div></div>
  ${d.run?.critic_overrides_by_harness?.length ? `<div class="callout warn mb-4">${icon('triangle-alert', 14)}<div><b>Harness override.</b> The gate withheld ${d.run.critic_overrides_by_harness.length} claim(s) the critic had kept: ${d.run.critic_overrides_by_harness.map(esc).join('; ')}</div></div>` : ''}
  <section class="section">${sectionHead('Trace', `${tr.length} model calls`, '<span class="small muted">click a call to read its prompt and output</span>')}<div id="trace"></div></section>`;
  const t0 = 0; let acc = 0;
  const rows = tr.map((t) => { acc += t.seconds || 0; return { ...t, at: acc }; });
  const tbl = table({ columns: [
    { key: 'i', label: '#', num: true, render: (r) => `${r.i + 1}` }, { key: 'role', label: 'Role', render: (r) => `<span class="row"><i class="dot ${r.role === 'pi' || r.role === 'critic' ? 'info' : r.role === 'generator' || r.role === 'specialist' ? 'warn' : 'ok'}"></i>${esc(r.role)}</span>` },
    { key: 'tag', label: 'Step', render: (r) => `<a href="#" class="mono" data-i="${r.i}">${esc(r.tag)}</a>${r.attempt ? ` ${badge(`retry ${r.attempt}`, 'warn')}` : ''}` }, { key: 'model', label: 'Model', render: (r) => `<span class="small">${esc((r.model || '').split('/').pop())}</span>` },
    { key: 'server', label: 'Server · node · GPUs', render: (r) => `<span class="small mono">${esc(r.server)} · ${esc(r.node)} · ${esc(r.gpus)}</span>` }, { key: 'seconds', label: 'Seconds', num: true, render: (r) => num(r.seconds, 2) },
    { key: 'prompt_tokens', label: 'Tokens in / out', num: true, render: (r) => `${num(r.prompt_tokens, 0)} / ${num(r.completion_tokens, 0)}` }, { key: 'output_preview', label: 'Output', render: (r) => `<span class="small muted">${esc(r.output_preview || '')}</span>`, title: (r) => r.output_preview },
  ], rows, dense: true, emptyText: 'No trace recorded for this run.' });
  $('#trace').appendChild(tbl);
  $$('a[data-i]', tbl).forEach((a) => { a.onclick = async (e) => { e.preventDefault(); const dl = drawer(`Call ${+a.dataset.i + 1} · ${a.textContent}`, loading(8), { modal: true }); try { const c = await api.trace(id, +a.dataset.i); dl.querySelector('.drawer-body').innerHTML = `${kv([['Role', esc(c.role)], ['Model', esc(c.model)], ['Server', `${esc(c.server)} · ${esc(c.node)} · GPUs ${esc(c.gpus)}`], ['Latency', `${c.seconds} s`], ['Tokens', `${c.prompt_tokens} in · ${c.completion_tokens} out`]])}<h4 class="mt-4 mb-2">System prompt</h4><pre class="code">${esc(c.system)}</pre><h4 class="mt-4 mb-2">User message</h4><pre class="code">${esc(c.user)}</pre><h4 class="mt-4 mb-2">Model output</h4><pre class="code">${esc(c.output)}</pre>`; } catch (err) { dl.querySelector('.drawer-body').innerHTML = errorBox(err); } }; });
}

async function pipeline({ $, $$, replaceUrl, main, api, href }) {
  main.innerHTML = pageHead('Pipeline', 'The two loops as implemented in this repository, and which served model plays which role right now.') + `<div id="pp">${loading(6)}</div>`;
  const sv = await api.servers().catch(() => ({ roles: {}, servers: [] }));
  const roleRow = (r) => { const v = sv.roles?.[r]; return v && !v.error ? `${v.models.map((m) => `<span class="small">${esc(m.split('/').pop())}</span>`).join(', ')} ${badge(`×${v.replicas}`, 'ok', false)}` : `<span class="small muted">no healthy server</span>`; };
  $('#pp').innerHTML = `<section class="section">${sectionHead('Harness loop', 'literature → structured record → field-level verification')}${pipelineHtml([['note', 'Source (device note)', 'harness'], ['gen', 'Generator draft', 'generator · psc-annotate-v1'], ['judge', 'Judge A · Judge B', 'verifier_a · verifier_b'], ['rules', 'Deterministic rules', 'code'], ['repair', 'Repair loop', 'generator'], ['rec', 'Verified record', 'harness']])}
    <p class="small muted mt-3">Every field gets one label (TP, TN, FP, FN, FP_mismatch); rules decide where they can (ordered stacks, numeric tolerance, exact DOI, aliases), judges decide the rest; rejected fields and their rules go back to the generator.</p></section>
  <section class="section">${sectionHead('Discovery loop', 'question → evidence → scoped claims')}${pipelineHtml(INV_STAGES)}
    <p class="small muted mt-3">The librarian is code over the released records; the gate applies the data-card reliability per category; the critic answers four factual checks per claim and the harness computes the verdict, including its own scope and bound rules.</p></section>
  <section class="section">${sectionHead('Role placement', sv.configured ? `${sv.healthy}/${sv.total} servers healthy` : 'no endpoints configured')}<div class="card">${kv([['PI', roleRow('pi')], ['Generator', roleRow('generator')], ['Critic', roleRow('critic')], ['Verifier A (judge A)', roleRow('verifier_a')], ['Verifier B pool (judge B, cohort audit)', roleRow('verifier_b')], ['Specialist team', roleRow('specialist')]])}<p class="small muted mt-3" style="margin-bottom:0">Preferences live in <code>verifiedlab/config.py::ROLES</code>; the first healthy server wins. <a href="${href('settings')}">Settings</a></p></div></section>`;
}

/* ------------------------------------------------------------------ harness run (live): the full workflow, narrated as steps */
const STEPS = {   // step id → [title, who] in the voice of the AI Scientist session view
  ask: ['PI turns the request into a plan and an executable query contract', 'PI agent'],
  contract: ['Versioned Skills and the workflow policy are loaded; generator and verifier are separated', 'harness'],
  catch: ['Generator drafts the device record from the source note', 'generator · psc-annotate-v1'],
  verify: ['Two verifier models and the harness rules judge every field against the released record', 'judge A · judge B · rules · psc-verify-v1'],
  repair: ['Rejected fields and their rules go back to the generator; the corrected record is re-verified', 'generator · verifier'],
  query: ['Librarian executes the contract on the released records', 'librarian (code)'],
  audit: ['Verifier pool audits every matching record against the stack-consistency rules', 'verifier B pool'],
  gate: ['Reliability gate routes each claim category', 'workflow policy (code)'],
  specialist: ['Specialist drafts the claims from the evidence', 'device physicist'],
  critic: ['Critic checks each claim; the harness decides', 'critic · harness'],
  handoff: ['Artifacts are written for inspection', 'harness'],
  close: ['Run summary', 'harness'],
};
const STEP_ORDER = Object.keys(STEPS);
const INPUT_FILES = [['device_note.md', '/sources/adfm.202417293.device_note.md', 'notebook-text'], ['psc-annotate-v1.md', '/policies/psc-annotate-v1.md', 'sliders-horizontal'], ['psc-verify-v1.md', '/policies/psc-verify-v1.md', 'shield-check'], ['workflow-policy.json', '/policies/workflow-policy.json', 'scale']];

async function film({ $, $$, replaceUrl, main, api, href }) {
  main.innerHTML = pageHead('Harness run', 'One request through the whole harness: plan, contract, a generated record verified field by field and repaired, a corpus query with a parallel audit, the reliability gate, a specialist answer checked by the critic, and the written artifacts. Every step runs live on the allocation.') + `<div id="f">${loading(4)}</div>`;
  const [def, sv] = await Promise.all([api.defaults().catch(() => ({ request: '' })), api.servers().catch(() => ({ healthy: 0 }))]);
  const live = sv.healthy > 0;
  $('#f').innerHTML = `<div class="grid" style="grid-template-columns: minmax(0,1fr) 320px; align-items:start"><div>
    <div class="card mb-4">${live ? '' : `<div class="callout warn mb-3">${icon('server', 14)}<div><b>Model servers are offline.</b> Launch the vLLM servers inside the allocation to run live; recorded runs are under <a href="${href('workflows')}">Workflow runs</a>.</div></div>`}
      <textarea class="textarea" id="req" rows="2" ${live ? '' : 'disabled'}>${esc(def.request || '')}</textarea>
      <div class="row mt-3 wrap"><select class="select" id="catch" aria-label="Probe mode" ${live ? '' : 'disabled'}><option value="auto">probe: auto (inject a reversed stack only if the draft is already correct)</option><option value="model">probe: model only (never inject)</option><option value="inject">probe: always inject the reversed stack</option></select><label class="checkbox"><input type="checkbox" id="audit" checked ${live ? '' : 'disabled'}> cohort audit on the verifier pool</label><span class="spacer"></span><span class="small muted" id="status"></span><button class="btn btn-primary" id="run" ${live ? '' : 'disabled'}>${icon('play', 14)}Run</button></div></div>
    <div id="stages" class="mb-4"></div><div class="card" id="out" style="display:none"></div></div>
    <div><div id="lp"></div><div class="card mt-4 files-rail"><div class="card-head"><h3>Workspace</h3></div><div class="lab">Inputs</div>${INPUT_FILES.map(([n, u, ic]) => `<button type="button" data-url="${u}" data-name="${n}">${icon(ic, 14)}${esc(n)}</button>`).join('')}<div class="lab">Outputs of this run</div><div id="outputs"><span class="small muted" style="padding:0 8px">None yet.</span></div></div></div></div>`;
  const panel = createLivePanel($('#lp'));
  $$('.files-rail button[data-url]').forEach((b) => { b.onclick = () => openText(b.dataset.name, b.dataset.url, drawer, loading, errorBox); });
  let closer = null;
  const st = {}; const stageEl = $('#stages'); const out = $('#out'); const status = $('#status');
  const steps = {};   // id → { meta, body, state }
  const renderSteps = () => {
    out.style.display = '';
    out.innerHTML = STEP_ORDER.filter((id) => steps[id]).map((id, i) => { const s = steps[id]; const [title, who] = STEPS[id]; return `<div class="step ${s.state === 'done' ? 'done' : ''} ${s.state === 'live' ? 'live' : ''}" id="st-${id}"><div class="bullet">${s.state === 'done' ? icon('check', 13) : s.state === 'live' ? icon('loader-circle', 13, 'spin') : i + 1}</div><div style="min-width:0"><h4>${esc(title)}</h4><div class="meta">${esc(who)}${s.meta ? ` · ${s.meta}` : ''}</div>${s.body ? `<div class="body">${s.body}</div>` : ''}</div></div>`; }).join('');
  };
  const step = (id, meta, body, state = 'done') => { steps[id] = { meta: meta ?? steps[id]?.meta ?? '', body: body ?? steps[id]?.body ?? '', state }; renderSteps(); };
  const drawStages = () => { stageEl.innerHTML = pipelineHtml(CHAPTERS, st); };
  const addOutput = (name, onClick, href_) => { const box = $('#outputs'); if (box.querySelector('span.muted')) box.innerHTML = ''; const el = href_ ? h(`<a href="${href_}" target="_blank" rel="noopener">${icon('file-text', 14)}${esc(name)}</a>`) : h(`<button type="button">${icon('file-json', 14)}${esc(name)}</button>`); if (onClick) el.onclick = onClick; box.appendChild(el); };
  drawStages();
  function result(e) {
    const id = e.id;
    if (id === 'ask') step('ask', `${st.models?.pi ? esc(st.models.pi.split('/').pop()) : ''}`, `<div class="grid grid-2"><div><div class="small muted mb-2">Plan</div><ul style="margin:0;padding-left:18px">${e.plan.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>${e.harness_added?.length ? `<div class="callout mt-3">${icon('info', 14)}<div>Harness plan check added ${e.harness_added.length} missing claim(s): ${e.harness_added.map((a) => esc(a.category)).join(', ')}.</div></div>` : ''}</div><div><div class="small muted mb-2">Query contract for the librarian</div><pre class="code" style="max-height:200px">${esc(JSON.stringify(e.contract, null, 1))}</pre><div class="small muted mt-2 mb-2">Claims the lab must make</div>${e.claims.map((c) => `<div class="small">· ${esc(c.question)} <span class="badge">${esc(c.category)}</span></div>`).join('')}</div></div>`);
    else if (id === 'contract') step('contract', `policy ${esc(e.policy.name)}@${esc(e.policy.version)} · threshold > ${e.policy.threshold} %`, `<div class="grid grid-2"><div class="note"><b>Generator</b> · ${esc(e.generator.skill)}<div class="small muted">${esc(e.generator.model)}</div></div><div class="note"><b>Verifier</b> · ${esc(e.verifier.skill)}<div class="small muted">judge A ${esc(e.verifier.judge_a)} · judge B ${esc(e.verifier.judge_b)} ×${e.verifier.replicas_b} · harness rules (ordered sequences, numeric tolerance, Null)</div></div></div><p class="small muted mt-2" style="margin-bottom:0">${e.fields} of ${e.schema_fields} schema fields are generated live in this run.</p>`);
    else if (id === 'catch') { const c = e.check; step('catch', `${esc(e.origin)}`, `<div class="grid grid-2"><div><div class="row mb-2">${badge(`draft${c.reversed_copy ? ' · reversed stack' : ''}`, c.same_order ? 'ok' : 'bad')}</div>${stackHtml(e.candidate_stack, { bad: !c.same_order })}</div><div><div class="row mb-2">${badge('released reference', 'neutral')}</div>${stackHtml(e.reference_stack)}<div class="small muted mono">substrate → top contact</div></div></div><div class="row mt-2">${badge(`materials ${c.same_material_membership ? 'match' : 'differ'}`, c.same_material_membership ? 'ok' : 'bad')}${badge(`order ${c.same_order ? 'matches' : 'differs'}`, c.same_order ? 'ok' : 'bad')}</div>`); addOutput('record_draft.json', () => drawer('record_draft.json', `<pre class="code" style="max-height:70vh">${esc(JSON.stringify(e.record, null, 1))}</pre>`, { modal: true })); }
    else if (id === 'verify') { const s = e.summary; step('verify', `${s.accepted}/${s.fields} fields accepted · judges agree ${(s.judge_agreement * 100).toFixed(0)} % · A vs rules ${(s.judge_a_vs_rules * 100).toFixed(0)} % · B vs rules ${(s.judge_b_vs_rules * 100).toFixed(0)} %`, `<div class="table-wrap"><table class="table dense"><thead><tr><th>field</th><th>candidate</th><th>reference</th><th>A</th><th>B</th><th>rule</th><th>label</th></tr></thead><tbody>${e.decisions.map((d) => `<tr><td class="mono">${esc(d.field)}</td><td title="${esc(d.candidate)}">${esc(d.candidate)}</td><td title="${esc(d.reference)}">${esc(d.reference)}</td><td>${labelBadge(d.judge_a)}</td><td>${labelBadge(d.judge_b)}</td><td>${labelBadge(d.rule_label)}</td><td>${decisionBadge(d.label)}</td></tr>`).join('')}</tbody></table></div>`); }
    else if (id === 'repair') { const c = e.check; step('repair', e.still_rejected.length ? `still rejected on ${e.still_rejected.map(esc).join(', ')}` : `corrected record passes every field decision · accepted ${e.summary.accepted}/${e.summary.fields}`, `<div class="grid grid-2"><div>${badge(c.same_order ? 'order preserved' : 'still rejected', c.same_order ? 'ok' : 'bad')}${stackHtml(e.corrected_stack, { bad: !c.same_order })}</div><div class="small"><div class="mt-2">${badge(`bound to source DOI ${e.doi}`, 'ok')}</div><p class="muted mt-2" style="margin-bottom:0">Layer order runs from substrate to top contact; membership alone is not equivalence.</p></div></div>`); }
    else if (id === 'query') { step('query', `<span class="mono">query_records(${esc(JSON.stringify(e.contract))})</span>`, `<div class="grid grid-2"><div class="stat-row"><div class="stat"><span class="v">${e.n}</span><span class="l">matching records · of ${e.eligible} eligible · ${e.total} papers</span></div><div class="stat"><span class="v">${e.median} %</span><span class="l">median reverse-scan PCE · ${(e.share_above_22 * 100).toFixed(1)} % ≥ 22 %</span></div></div><div id="qh"></div></div><div class="small muted mt-2" id="audit-progress">Descriptive evidence from published champion devices; transport layers unrestricted.</div>`); histogram($('#qh'), e.values, { xLabel: 'Reverse-scan PCE (%)', bins: 20, H: 180, W: 420, highlight: (a) => a >= 22 }); }
    else if (id === 'audit') step('audit', `${e.n} records in ${e.seconds} s · ${e.replicas} replicas of ${esc(e.model)} on ${esc(e.nodes.join(', '))} · ${e.records_per_second} records/s`, `<div class="row">${badge(`judge vs rules ${(e.judge_rule_agreement * 100).toFixed(1)} %`, 'info')}${badge(`rule-flagged ${e.rule_flagged.length}`, e.rule_flagged.length ? 'warn' : 'ok')}</div>${e.rule_flagged.length ? `<div class="small muted mt-2">${e.rule_flagged.slice(0, 5).map((f) => esc(f.doi)).join(' · ')}</div>` : '<div class="small muted mt-2">no record violates the stack rules</div>'}<div class="small muted mt-2">An internal-consistency check of the released values, not a re-audit of the articles.</div>`);
    else if (id === 'gate') step('gate', `category judged accuracy > ${e.threshold} % continues; otherwise human review`, `${Object.entries(e.reliabilities).map(([cat, r]) => { const g = e.by_category[cat]; return `<div class="row" style="padding:3px 0;opacity:${g ? 1 : 0.5}"><span class="small" style="width:140px">${esc(cat)}</span><span class="meter grow"><b class="${r > e.threshold ? '' : 'warn'}" style="width:${r}%"></b><s style="left:${e.threshold}%"></s></span><span style="width:120px;text-align:right">${g ? routeBadge(g.route) : `<span class="small muted">${r} %</span>`}</span></div>`; }).join('')}<p class="small muted mt-2" style="margin-bottom:0">${esc(e.scope)}</p>`);
    else if (id === 'specialist') step('specialist', `${e.claims.length} claim${e.claims.length > 1 ? 's' : ''} before the critic`, e.claims.map((c) => `<div class="claim"><div class="st">${esc(c.statement)}</div><div class="why">${esc(c.category)} · ${esc(c.evidence)}</div></div>`).join(''));
    else if (id === 'critic') step('critic', `${e.claims.filter((c) => c.verdict === 'SUPPORTED').length} supported · ${e.claims.filter((c) => c.verdict === 'WITHHELD').length} withheld${e.harness_overrides.length ? ' · harness override' : ''}`, `${e.claims.map((c) => `<div class="claim ${c.verdict === 'SUPPORTED' ? 'supported' : 'withheld'}"><div class="row mb-1">${verdictBadge(c.verdict)}</div><div class="st" ${c.verdict === 'WITHHELD' ? 'style="text-decoration:line-through;color:var(--muted)"' : ''}>${esc(c.statement)}</div><div class="why">${esc(c.reason)}</div></div>`).join('')}<p style="font-size:15px;line-height:1.55;margin-top:12px">${esc(e.scoped_answer)}</p>${e.harness_overrides.length ? `<div class="callout warn">${icon('triangle-alert', 14)}<div><b>Harness override.</b> The gate withheld a claim the critic had kept; the policy wins over the model.</div></div>` : ''}`);
    else if (id === 'handoff') { step('handoff', esc(e.run_dir), `<div class="chips">${e.files.map((f) => `<a class="chip" href="/runs/${esc(st.runId)}/${esc(f)}" target="_blank" rel="noopener">${icon('file-text', 12)}${esc(f)}</a>`).join('')}</div>`); $('#outputs').innerHTML = ''; e.files.forEach((f) => addOutput(f, null, `/runs/${st.runId}/${f}`)); }
    else if (id === 'close') step('close', `${e.seconds} s`, `<div class="stat-row"><div class="stat"><span class="v">${e.papers.toLocaleString()}</span><span class="l">papers</span></div><div class="stat"><span class="v">${e.fields}</span><span class="l">record fields</span></div><div class="stat"><span class="v">${e.llm_calls}</span><span class="l">live model calls</span></div><div class="stat"><span class="v">${e.gpus.length}</span><span class="l">GPU placements used</span></div></div><p class="small mt-3" style="margin-bottom:0"><a href="${href('workflows', ['run', st.runId])}">Open the full trace</a> · <a href="${href('verification', [], { doi: '10.1002/adfm.202417293', run: st.runId })}">Open in Verification Studio</a> · <a href="${href('scientist', ['reports'], { run: st.runId })}">Research brief</a></p>`);
  }
  const FIRST = { catch: 'catch', query: 'query', critic: 'specialist' };
  $('#run').onclick = async () => {
    $('#run').disabled = true; Object.keys(steps).forEach((k) => delete steps[k]); out.innerHTML = ''; out.style.display = 'none'; Object.keys(st).forEach((k) => delete st[k]); st.timings = {}; drawStages(); panel.reset(); $('#outputs').innerHTML = '<span class="small muted" style="padding:0 8px">None yet.</span>'; status.textContent = 'starting…';
    let r; try { r = await api.runFilm({ request: $('#req').value, catch: $('#catch').value, audit: $('#audit').checked }); } catch (e) { toast(`Could not start: ${e.message}`); $('#run').disabled = false; status.textContent = ''; return; }
    st.runId = r.run_id; toast(`Run ${r.run_id} started`);
    closer = stream(r.run_id, (e) => {
      panel.handle(e);
      if (e.type === 'run') { st.models = Object.fromEntries(Object.entries(e.roles).map(([k, v]) => [k, (v.models || [''])[0]])); status.textContent = `running · ${e.run_id}`; panel.badge(`${Object.values(e.roles).reduce((n, x) => n + (x.replicas || 0), 0)} model replicas · psc-annotate-v1@${e.skills.annotate} · psc-verify-v1@${e.skills.verify} · policy ${e.policy}`); }
      else if (e.type === 'chapter') { st[e.id] = 'live'; drawStages(); const first = FIRST[e.id] || e.id; if (!steps[first]) step(first, '', '', 'live'); }
      else if (e.type === 'chapter_done') { st[e.id] = 'done'; st.timings[e.id] = e.seconds; drawStages(); status.textContent = `running · ${e.id} done in ${e.seconds} s`; Object.keys(steps).forEach((k) => { if (steps[k].state === 'live') steps[k].state = 'done'; }); renderSteps(); }
      else if (e.type === 'progress') { const ap = $('#audit-progress'); if (ap) ap.innerHTML = `${icon('loader-circle', 12, 'spin')} cohort audit ${e.done}/${e.total} records · ${esc(e.server)}@${esc(e.node)}`; }
      else if (e.type === 'result') result(e);
      else if (e.type === 'error') { out.style.display = ''; out.insertAdjacentHTML('afterbegin', errorBox(e.text)); status.textContent = 'error'; }
      else if (e.type === 'run_done') { $('#run').disabled = false; status.textContent = `complete · ${e.run_id}`; toast('Run complete'); }
    }, () => { $('#run').disabled = false; }, () => { toast('Event stream closed'); $('#run').disabled = false; });
  };
  return () => { if (closer) closer(); };
}
