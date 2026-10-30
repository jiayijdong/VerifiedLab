/** Verification Studio — three panes: source literature, structured record, verification audit. Plus queue, audit history and field reliability. */
import { $$, h, esc, val, isNull, num, pageHead, sectionHead, kv, badge, labelBadge, relBadge, routeBadge, table, pager, loading, errorBox, empty, doiLink, icon, md, drawer, toast } from '../ui.js';
import { groupFields, stackHtml, decisionBadge, runKindBadge } from '../record.js';
import { mountDevice } from '../device3d.js';

const HERO = '10.1002/adfm.202417293';

export async function render(ctx) {
  const s = ctx.route.section;
  if (s === 'queue') return queue(ctx);
  if (s === 'history') return ctx.route.path[1] ? auditRun(ctx, ctx.route.path[1]) : history(ctx);
  if (s === 'reliability') return reliability(ctx);
  return studio(ctx);
}

/* ------------------------------------------------------------------ Studio */
async function studio({ $, $$, replaceUrl, main, api, href, route, setCrumbs, navigate }) {
  const doi = route.params.doi || HERO; let runId = route.params.run || '';
  main.innerHTML = pageHead('Verification Studio', 'Where does this value come from, was it extracted correctly, and why can it be trusted? Pick a field to see its source evidence, rule and verifier decisions.') + `<div id="studio">${loading(8)}</div>`;
  let d; try { d = await api.record(doi); } catch (e) { $('#studio').innerHTML = errorBox(e) + `<p class="mt-3"><a href="${href('literature')}">Pick a paper in Literature</a></p>`; return; }
  setCrumbs([{ label: 'Verification', href: href('verification') }, { label: 'Record inspector', href: href('verification') }, { label: d.doi }]);
  if (!runId && d.verified_in_runs.length) runId = d.verified_in_runs[0];
  let run = null; if (runId) { try { run = await api.run(runId); } catch { run = null; } }
  const decisions = Object.fromEntries((run?.field_decisions || []).map((x) => [x.field, x]));
  const draft = run?.record_draft || {}; const corrected = run?.record_corrected || null;
  let noteText = null; if (d.sources.device_note) { try { noteText = await (await fetch(d.sources.device_note)).text(); } catch { noteText = null; } }
  const groups = groupFields(d.fields);
  let selected = route.params.field || 'Cell_stack_sequence'; let liveOnly = false; let filter = '';
  const gl = { rec: null, audit: [] }; const killAudit = () => { gl.audit.forEach((f) => f()); gl.audit = []; };

  const root = $('#studio');
  root.innerHTML = `
  <div class="toolbar"><div class="search" style="width:min(380px,100%)">${icon('search', 15)}<input class="input" id="doi-in" placeholder="Jump to a DOI (e.g. 10.1002/adfm.202417293)" aria-label="DOI"></div>
    <label class="small muted" for="run-sel">Audit run</label><select class="select" id="run-sel" aria-label="Audit run"><option value="">Released record only (no draft)</option>${d.verified_in_runs.map((id) => `<option value="${esc(id)}" ${id === runId ? 'selected' : ''}>${esc(id)}</option>`).join('')}</select>
    <span class="spacer"></span><a class="btn btn-sm" href="${href('literature', ['paper', d.doi])}">${icon('book-open', 14)}Paper</a><a class="btn btn-sm" href="${href('database', [], { doi: d.doi })}">${icon('database', 14)}Database row</a></div>
  <div class="studio">
    <section class="pane" aria-label="Source literature"><div class="pane-head">${icon('book-open', 15)}Source literature<span class="right" id="src-tabs"></span></div><div class="pane-body" id="src"></div></section>
    <section class="pane" aria-label="Structured record"><div class="pane-head">${icon('file-json', 15)}Structured record<span class="right"><label class="checkbox small"><input type="checkbox" id="live-only"> live fields</label></span></div>
      <div style="padding:8px 16px;border-bottom:1px solid var(--border)"><div class="search" style="width:100%">${icon('filter', 14)}<input class="input btn-sm" id="ff" placeholder="Filter fields" aria-label="Filter fields" style="height:28px"></div></div><div id="rec3d" class="gl-host flush" style="height:200px;border-bottom:1px solid var(--border);flex:none"></div><div class="pane-body" id="rec"></div></section>
    <section class="pane" aria-label="Verification audit"><div class="pane-head">${icon('shield-check', 15)}Verification audit</div><div class="pane-body" id="audit"></div></section>
  </div>`;
  $('#doi-in').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) navigate('verification', [], { doi: e.target.value.trim() }); });
  $('#run-sel').onchange = (e) => navigate('verification', [], { doi: d.doi, run: e.target.value, field: selected });
  $('#live-only').onchange = (e) => { liveOnly = e.target.checked; renderRecord(); };
  $('#ff').addEventListener('input', (e) => { filter = e.target.value.toLowerCase(); renderRecord(); });

  /* source pane */
  let srcTab = d.sources.pdf ? 'pdf' : noteText ? 'note' : 'prov';
  function renderSource() {
    const tabs = [d.sources.pdf && ['pdf', 'PDF'], noteText && ['note', 'Device note'], ['prov', 'Provenance']].filter(Boolean);
    $('#src-tabs').innerHTML = `<div class="segmented" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-pressed="${k === srcTab}" data-k="${k}">${l}</button>`).join('')}</div>`;
    $$('#src-tabs button').forEach((b) => { b.onclick = () => { srcTab = b.dataset.k; renderSource(); }; });
    const box = $('#src'); box.className = `pane-body ${srcTab === 'pdf' ? 'flush' : ''}`;
    if (srcTab === 'pdf') { box.innerHTML = `<iframe class="pdf-frame" src="${d.sources.pdf}#toolbar=1" title="Source PDF"></iframe>`; return; }
    if (srcTab === 'note') {
      const f = d.fields.find((x) => x.name === selected); const v = f && !isNull(f.value) ? String(f.value) : '';
      let html = esc(noteText);
      if (v) { const parts = [v, ...v.split(/[\/;]/).map((s) => s.trim()).filter((s) => s.length > 2)].slice(0, 8); parts.forEach((p) => { html = html.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), (m0) => `<mark>${m0}</mark>`); }); }
      const hits = (html.match(/<mark>/g) || []).length;
      box.innerHTML = `<div class="callout mb-3">${icon('info', 14)}<div>A prose rendering of the released record (not article text). ${hits ? `<b>${hits}</b> mention${hits > 1 ? 's' : ''} of <code>${esc(selected)}</code> highlighted.` : `No literal mention of the selected field's value.`}</div></div><div class="source-text">${html}</div>`;
      const m = box.querySelector('mark'); if (m) box.scrollTop = Math.max(0, m.offsetTop - box.clientHeight / 2);   // scroll the pane, not the page
      return;
    }
    box.innerHTML = `${kv([['Source DOI', doiLink(d.doi)], ['Title', esc(d.record.Ref_title)], ['Journal · year', `${esc(d.record.Ref_journal)} · ${esc(d.record.Ref_publication_year)}`], ['Extraction file', `<span class="mono small">${esc(d.provenance.source_file)}</span>`], ['Article PDF', d.sources.pdf ? 'on file' : '<span class="muted">not on file</span>'], ['Device note', noteText ? 'on file' : '<span class="muted">none</span>']])}
      <div class="callout mt-4">${icon('info', 14)}<div><b>Evidence boundary.</b> Only structured values with provenance to the source DOI are released; article text is not. Evidence location and highlighting work on the device note where one exists, and on a PDF placed in <code>sources/pdf/</code>. Page-level anchoring into the article is planned.</div></div>`;
  }

  /* record pane */
  function renderRecord() {
    const box = $('#rec'); let html = '';
    groups.forEach((g) => {
      const fs = g.fields.filter((f) => (!liveOnly || f.live) && (!filter || f.name.toLowerCase().includes(filter) || String(f.value ?? '').toLowerCase().includes(filter)));
      if (!fs.length) return;
      html += `<div class="group-head">${esc(g.category)} ${relBadge('', g.reliability).replace('<span class="badge', '<span class="badge plain').replace(' · ', '')}<span class="line"></span><span>${fs.length}</span></div>`;
      html += fs.map((f) => { const dec = decisions[f.name]; const k = dec ? (['TP', 'TN'].includes(dec.label) ? 'ok' : 'bad') : ''; return `<div class="field-row clickable ${f.name === selected ? 'sel' : ''}" data-f="${esc(f.name)}" role="button" tabindex="0"><span class="fname">${esc(f.name)}${f.live ? ` <span class="badge plain badge-planned" title="generated live in the harness run">live</span>` : ''}</span><span class="fval">${val(f.value)}</span><span class="right">${dec ? badge(dec.label, k) : f.rule.deterministic ? `<span class="badge plain" title="${esc(f.rule.text)}">${icon('scroll-text', 11)}rule</span>` : `<span class="badge plain" title="${esc(f.rule.text)}">${icon('bot', 11)}judge</span>`}</span></div>`; }).join('');
    });
    box.innerHTML = html || `<div class="empty" style="border:0">${icon('filter', 20)}<h3>No fields match</h3></div>`;
    $$('.field-row', box).forEach((row) => { const pick = () => { selected = row.dataset.f; replaceUrl(href('verification', [], { doi: d.doi, run: runId, field: selected })); renderRecord(); renderAudit(); if (srcTab === 'note') renderSource(); }; row.onclick = pick; row.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }; });
    const sel = box.querySelector('.field-row.sel'); if (sel && filter === '' && (sel.offsetTop < box.scrollTop || sel.offsetTop > box.scrollTop + box.clientHeight - 40)) box.scrollTop = Math.max(0, sel.offsetTop - 80);
  }

  /* audit pane */
  function renderAudit() {
    const f = d.fields.find((x) => x.name === selected); const dec = decisions[selected]; const box = $('#audit');
    const cat = f.category; const rel = f.reliability; const route_ = rel > 85 ? 'CONTINUE' : 'HUMAN_REVIEW';
    let html = `<h3 class="mono" style="font-size:13px;overflow-wrap:anywhere">${esc(selected)}</h3><div class="row wrap mt-2">${relBadge(cat, rel)}${routeBadge(route_)}</div>
      <div class="divider"></div><h4>Field rule <span class="muted small">(${f.rule.deterministic ? 'executed as code' : 'applied by the verifier model'})</span></h4><p class="small mt-2">${esc(f.rule.text)}</p>`;
    if (dec) {
      const bad = !['TP', 'TN'].includes(dec.label);
      html += `<div class="divider"></div><h4>Decision in run <span class="mono small">${esc(runId)}</span></h4>
        <div class="mt-2">${decisionBadge(dec.label)} <span class="small muted">decided by <code>${esc(dec.decided_by)}</code></span></div>
        <div class="check ${dec.judge_a === dec.label ? 'ok' : 'warn'} mt-3"><span class="who">judge A</span>${icon(dec.judge_a === dec.label ? 'circle-check' : 'circle-alert', 14)}<span>${labelBadge(dec.judge_a)} <span class="small muted">${esc((run.run?.models?.verifier_a || '').split('/').pop())}</span></span></div>
        <div class="check ${dec.judge_b === dec.label ? 'ok' : 'warn'}"><span class="who">judge B</span>${icon(dec.judge_b === dec.label ? 'circle-check' : 'circle-alert', 14)}<span>${labelBadge(dec.judge_b)} <span class="small muted">${esc((run.run?.models?.verifier_b || '').split('/').pop())}</span></span></div>
        <div class="check ${dec.rule_label ? 'ok' : 'warn'}"><span class="who">rule</span>${icon(dec.rule_label ? 'scroll-text' : 'minus', 14)}<span>${dec.rule_label ? labelBadge(dec.rule_label) : '<span class="muted small">no deterministic rule for this field</span>'}</span></div>
        <div class="mt-3"><div class="small muted">Candidate (generator draft)</div><div class="mono small" style="overflow-wrap:anywhere;color:${bad ? 'var(--bad)' : 'inherit'}">${esc(dec.candidate)}</div><div class="small muted mt-2">Reference (released record)</div><div class="mono small" style="overflow-wrap:anywhere">${esc(dec.reference)}</div></div>`;
      if (dec.rule_detail) html += `<div class="mt-3 note small"><b>${esc(dec.rule_detail.rule)}</b>: membership ${dec.rule_detail.same_material_membership ? 'same' : 'differs'}, order ${dec.rule_detail.same_order ? 'same' : 'differs'}${dec.rule_detail.reversed_copy ? ', reversed copy' : ''}. ${esc(dec.rule_detail.explanation)}</div>`;
      if (selected === 'Cell_stack_sequence' || selected.endsWith('_stack_sequence')) html += `<div class="grid grid-2 mt-3"><div><div class="small muted mb-2">Candidate ${bad ? badge('as drafted', 'bad') : ''}</div><div id="cand3d" style="height:190px"></div><div class="mt-2">${stackHtml(dec.candidate, { bad })}</div></div><div><div class="small muted mb-2">Reference</div><div id="ref3d" style="height:190px"></div><div class="mt-2">${stackHtml(dec.reference)}</div></div></div>`;
      if (corrected && corrected[selected] !== undefined && bad) html += `<div class="mt-3"><div class="small muted">After repair</div><div class="mono small" style="overflow-wrap:anywhere">${esc(corrected[selected])}</div> ${badge(String(corrected[selected]).trim() === String(dec.reference).trim() ? 'matches reference' : 'differs', String(corrected[selected]).trim() === String(dec.reference).trim() ? 'ok' : 'warn')}</div>`;
      if (run.rule_check) html += `<p class="small muted mt-3">${esc(run.rule_check.candidate_origin || '')}</p>`;
    } else {
      html += `<div class="divider"></div><h4>Record checks</h4><p class="small muted mt-2">No generated draft of this field was judged in a recorded run. The released value was judged at category level (data card). Deterministic checks on the released record:</p>
        ${['stack_substrate_first', 'architecture_consistent_with_stack', 'absorber_in_stack'].map((k) => { const v = d.consistency[k]; return `<div class="check ${v === true ? 'ok' : v === false ? 'bad' : 'warn'}">${icon(v === true ? 'circle-check' : v === false ? 'circle-x' : 'circle-help', 14)}<span>${esc(k.replace(/_/g, ' '))}${v === null ? ' <span class="muted">(not decidable)</span>' : ''}</span></div>`; }).join('')}
        ${d.verified_in_runs.length ? `<p class="small mt-3">Select an audit run above to see judge decisions on a generated draft.</p>` : ''}`;
    }
    if (run) { const s = run.field_decisions || []; const acc = s.filter((x) => ['TP', 'TN'].includes(x.label)).length; html += `<div class="divider"></div><h4>Run summary</h4>${kv([['Fields judged', `${s.length}`], ['Accepted first pass', `${acc}/${s.length}`], ['Rejected', s.filter((x) => !['TP', 'TN'].includes(x.label)).map((x) => `<code>${esc(x.field)}</code>`).join(', ') || '–'], ['Skills', `psc-annotate-v1@${esc(run.run?.skills?.annotate)} · psc-verify-v1@${esc(run.run?.skills?.verify)}`], ['Details', `<a href="${href('verification', ['history', runId])}">Audit history</a>`]])}`; }
    html += `<div class="divider"></div><p class="small muted" style="margin-bottom:0">Category judged accuracy is not the probability that this value is correct; consult the source DOI for any value that matters.</p>`;
    killAudit(); box.innerHTML = html;
    const c3 = box.querySelector('#cand3d'); const r3 = box.querySelector('#ref3d');
    if (c3 && dec) { const bad = !['TP', 'TN'].includes(dec.label); const nC = String(dec.candidate).split('/').length; gl.audit.push(mountDevice(c3, { ...d.record, Cell_stack_sequence: dec.candidate }, { height: 190, compact: true, autoRotate: false, badIndices: bad ? Array.from({ length: nC }, (_, i) => i) : [] })); }
    if (r3 && dec) gl.audit.push(mountDevice(r3, { ...d.record, Cell_stack_sequence: dec.reference }, { height: 190, compact: true, autoRotate: false }));
  }
  renderSource(); renderRecord(); renderAudit();
  gl.rec = mountDevice($('#rec3d'), d.record, { height: 200, compact: true, explode: 0.3 });
  return () => { killAudit(); if (gl.rec) gl.rec(); };
}

/* ------------------------------------------------------------------ Queue */
async function queue({ $, $$, replaceUrl, main, api, href, route }) {
  const state = { page: +route.params.page || 1, size: 50, rule: route.params.rule || '' };
  main.innerHTML = pageHead('Verification queue', 'Released records whose values fail a deterministic self-consistency rule. These are internal checks on the released values, not a re-audit of the source articles.') + `<div class="toolbar"><div class="segmented" id="rules" role="group" aria-label="Rule filter"></div><span class="spacer"></span><span class="small muted" id="qn"></span></div><div id="q">${loading(8)}</div>`;
  async function load() {
    let d; try { d = await api.queue(state); } catch (e) { $('#q').innerHTML = errorBox(e); return; }
    $('#qn').textContent = `${d.total.toLocaleString()} of ${d.checked.toLocaleString()} records flagged`;
    $('#rules').innerHTML = [['', `All (${d.total})`], ...Object.entries(d.by_rule).map(([k, n]) => [k, `${k.replace(/_/g, ' ')} (${n})`])].map(([k, l]) => `<button type="button" aria-pressed="${state.rule === k}" data-k="${k}" title="${esc(d.rules[k] || '')}">${esc(l)}</button>`).join('');
    $$('#rules button').forEach((b) => { b.onclick = () => { state.rule = b.dataset.k; state.page = 1; load(); }; });
    const t = table({ columns: [
      { key: 'doi', label: 'DOI', render: (r) => `<a href="${href('verification', [], { doi: r.doi })}" class="doi">${esc(r.doi)}</a>` },
      { key: 'year', label: 'Year', num: true, render: (r) => num(r.year, 0) }, { key: 'architecture', label: 'Arch.', render: (r) => val(r.architecture) },
      { key: 'stack', label: 'Stack (as released)', render: (r) => val(r.stack, { mono: true }), title: (r) => r.stack }, { key: 'composition', label: 'Composition', render: (r) => val(r.composition, { mono: true }) },
      { key: 'pce', label: 'PCE', num: true, render: (r) => num(r.pce, 2) }, { key: 'flags', label: 'Failed rules', render: (r) => r.flags.map((f) => badge(f.replace(/_/g, ' '), 'warn')).join(' ') },
    ], rows: d.rows, dense: true });
    t.appendChild(pager({ page: d.page, pages: d.pages, total: d.total, size: d.size, onPage: (p) => { state.page = p; load(); } }));
    $('#q').innerHTML = ''; $('#q').appendChild(t);
    $('#q').appendChild(h(`<p class="small muted mt-3">${esc(d.scope)} Open a record to inspect it in the Studio; a reviewer decision store (accept / correct / escalate) is planned.</p>`));
  }
  load();
}

/* ------------------------------------------------------------------ Audit history */
async function history({ $, $$, replaceUrl, main, api, href }) {
  main.innerHTML = pageHead('Audit history', 'Recorded harness runs: a generator draft of one record judged field by field by two verifier models and the harness rules, then repaired.') + `<div id="hist">${loading(6)}</div>`;
  let d; try { d = await api.runs(); } catch (e) { $('#hist').innerHTML = errorBox(e); return; }
  const films = d.runs.filter((r) => r.kind === 'film');
  if (!films.length) { $('#hist').innerHTML = empty('No audits recorded', 'Harness runs write field_decisions.json and rule_check.json into runs/.', 'history'); return; }
  const t = table({ columns: [
    { key: 'id', label: 'Run', render: (r) => `<a href="${href('verification', ['history', r.id])}" class="mono">${esc(r.id)}</a>` },
    { key: 'doi', label: 'Record', render: (r) => r.doi ? `<a href="${href('verification', [], { doi: r.doi, run: r.id })}" class="doi">${esc(r.doi)}</a>` : '–' },
    { key: 'accepted', label: 'Accepted', num: true, render: (r) => r.complete ? `${r.accepted}/${r.fields}` : '–' },
    { key: 'models', label: 'Generator · judges', render: (r) => r.models ? `<span class="small">${esc(r.models.generator?.split('/').pop())} · ${esc(r.models.verifier_a?.split('/').pop())} · ${esc(r.models.verifier_b?.split('/').pop())}</span>` : '–' },
    { key: 'candidate_origin', label: 'Candidate', render: (r) => r.candidate_origin ? (r.candidate_origin.includes('reversed') ? badge('labelled reversed-stack probe', 'warn') : badge('live draft', 'info')) : badge('incomplete', 'neutral') },
    { key: 'started', label: 'Started', render: (r) => `<span class="small">${esc(r.started || '')}</span>` },
  ], rows: films, dense: true });
  $('#hist').innerHTML = ''; $('#hist').appendChild(t);
}

async function auditRun({ $, $$, replaceUrl, main, api, href, setCrumbs }, id) {
  main.innerHTML = loading(10);
  let d; try { d = await api.run(id); } catch (e) { main.innerHTML = pageHead('Audit') + errorBox(e); return; }
  setCrumbs([{ label: 'Verification', href: href('verification') }, { label: 'Audit history', href: href('verification', ['history']) }, { label: id }]);
  const fd = d.field_decisions || []; const rc = d.rule_check || {}; const s = d.summary || {};
  main.innerHTML = pageHead(`Audit ${id}`, `${esc(s.request || '')}`, `<a class="btn btn-primary" href="${href('verification', [], { doi: s.doi, run: id })}">${icon('shield-check', 14)}Open in Studio</a><a class="btn" href="${href('workflows', ['run', id])}">${icon('workflow', 14)}Workflow trace</a>`) + `
  <div class="grid grid-3 mb-4"><div class="card">${kv([['Record', doiLink(s.doi)], ['Candidate', esc(rc.candidate_origin || '–')], ['Accepted first pass', `${s.accepted}/${s.fields}`], ['Skills', `psc-annotate-v1@${esc(s.skills?.annotate)} · psc-verify-v1@${esc(s.skills?.verify)}`]])}</div>
    <div class="card">${kv([['Generator', esc(s.models?.generator)], ['Judge A', esc(s.models?.verifier_a)], ['Judge B', esc(s.models?.verifier_b)], ['Model calls', `${s.llm_calls ?? '–'}`]])}</div>
    <div class="card"><h4>Rule check · ${esc(rc.field || '')}</h4><p class="small mt-2">${esc(rc.rule || '')}</p>${rc.correction ? `<div class="small">Correction ${badge(rc.correction_matches_reference ? 'matches reference' : 'differs', rc.correction_matches_reference ? 'ok' : 'warn')}</div>` : ''}</div></div>
  ${sectionHead('Field decisions', `${fd.length} fields`)}<div id="fd"></div>
  ${d.cohort_audit ? `<section class="section mt-4">${sectionHead('Cohort audit', `${d.cohort_audit.n} records · ${d.cohort_audit.replicas} verifier replicas`)}<div class="card">${kv([['Judge vs rules agreement', `${(d.cohort_audit.judge_rule_agreement * 100).toFixed(1)} %`], ['Rule-flagged', `${d.cohort_audit.rule_flagged.length} records`], ['Throughput', `${d.cohort_audit.records_per_second} records/s on ${esc(d.cohort_audit.nodes.join(', '))}`], ['Disagreements shown', `${d.cohort_audit.disagreements.length} of ${d.cohort_audit.results_n}`]])}</div></section>` : ''}
  ${d.review_request ? `<section class="section">${sectionHead('Human review request')}<div class="card">${md(d.review_request)}</div></section>` : ''}`;
  $('#fd').appendChild(table({ columns: [
    { key: 'field', label: 'Field', render: (r) => `<a class="mono" href="${href('verification', [], { doi: s.doi, run: id, field: r.field })}">${esc(r.field)}</a>` },
    { key: 'candidate', label: 'Candidate', render: (r) => `<span class="mono">${esc(r.candidate)}</span>`, title: (r) => r.candidate }, { key: 'reference', label: 'Reference', render: (r) => `<span class="mono">${esc(r.reference)}</span>`, title: (r) => r.reference },
    { key: 'judge_a', label: 'Judge A', render: (r) => labelBadge(r.judge_a) }, { key: 'judge_b', label: 'Judge B', render: (r) => labelBadge(r.judge_b) }, { key: 'rule_label', label: 'Rule', render: (r) => labelBadge(r.rule_label) },
    { key: 'label', label: 'Decision', render: (r) => decisionBadge(r.label) }, { key: 'decided_by', label: 'Decided by', render: (r) => `<code>${esc(r.decided_by)}</code>` },
  ], rows: fd, dense: true }));
}

/* ------------------------------------------------------------------ Field reliability */
async function reliability({ $, $$, replaceUrl, main, api, href }) {
  main.innerHTML = pageHead('Field reliability', 'The data card: judged accuracy per field category, the automation threshold that routes categories to agents or to a human, and which rules run as code.') + `<div id="rel">${loading(8)}</div>`;
  let s; try { s = await api.schema(); } catch (e) { $('#rel').innerHTML = errorBox(e); return; }
  let thr = s.threshold;
  const cats = Object.entries(s.categories);
  const box = $('#rel');
  function draw() {
    box.innerHTML = `<div class="grid" style="grid-template-columns: minmax(0,1.3fr) minmax(280px,1fr)"><div class="card"><div class="card-head"><h3>Categories</h3><span class="right small muted">${esc(s.source)}</span></div>
      <table class="table"><thead><tr><th>Category</th><th>Fields</th><th>Judged accuracy</th><th></th><th>Route at ${thr} %</th></tr></thead><tbody>${cats.map(([c, v]) => `<tr><td>${esc(c)}</td><td class="num">${v.fields}</td><td class="num tnum">${v.reliability.toFixed(2)} %</td><td style="min-width:160px"><span class="meter" style="display:block;margin-top:5px"><b class="${v.reliability > thr ? '' : 'warn'}" style="width:${v.reliability}%"></b><s style="left:${thr}%"></s></span></td><td>${routeBadge(v.reliability > thr ? 'CONTINUE' : 'HUMAN_REVIEW')}</td></tr>`).join('')}</tbody></table>
      <p class="small muted mt-3" style="margin-bottom:0">${esc(s.scope)}</p></div>
    <div class="card"><div class="card-head"><h3>Workflow threshold</h3></div><p class="small">The policy file sets <b>${s.threshold} %</b>. Move the slider to see which categories would change route; this is a what-if and does not change the policy.</p>
      <input class="range" type="range" min="60" max="100" step="1" value="${thr}" id="thr" aria-label="Threshold" style="width:100%"><div class="row spread small"><span>60 %</span><b class="tnum">${thr} %</b><span>100 %</span></div>
      <div class="mt-3 small">${cats.filter(([, v]) => (v.reliability > thr) !== (v.reliability > s.threshold)).map(([c, v]) => `<div>${esc(c)} → ${routeBadge(v.reliability > thr ? 'CONTINUE' : 'HUMAN_REVIEW')}</div>`).join('') || '<span class="muted">No category changes route at this threshold.</span>'}</div>
      <p class="small muted mt-3" style="margin-bottom:0">Edit <code>policies/workflow-policy.json</code> to change the real threshold. <a href="${href('skills')}">Skills</a></p></div></div>
    <section class="section mt-4">${sectionHead('Fields', `${s.fields.length} schema fields`)}<div id="flds"></div></section>`;
    $('#thr').oninput = (e) => { thr = +e.target.value; draw(); };
    $('#flds').appendChild(table({ columns: [
      { key: 'name', label: 'Field', render: (r) => `<span class="mono">${esc(r.name)}</span>${r.live ? ' <span class="badge plain badge-planned">live</span>' : ''}` }, { key: 'category', label: 'Category' },
      { key: 'reliability', label: 'Category accuracy', num: true, render: (r) => `${r.reliability?.toFixed(2)} %` }, { key: 'kind', label: 'Rule', render: (r) => r.deterministic ? badge(r.kind, 'info') : badge('verifier model', 'neutral') },
      { key: 'text', label: 'Rule text', wrap: true, render: (r) => `<span class="small">${esc(r.text)}</span>` },
    ], rows: s.fields, dense: true }));
  }
  draw();
}
