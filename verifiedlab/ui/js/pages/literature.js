/** Literature — the paper-level view of the released records, with search, filters, sorting, pagination and a paper detail page. */
import { h, esc, val, isNull, num, pageHead, sectionHead, kv, badge, table, pager, loading, errorBox, empty, doiLink, icon, debounce, planned } from '../ui.js';
import { champion, stackHtml, runKindBadge } from '../record.js';
import { mountDevice, roleLegend } from '../device3d.js';

export async function render(ctx) {
  const { route } = ctx;
  if (route.section === 'paper' && route.path[1]) return paper(ctx, route.path.slice(1).join('/'));
  if (route.section === 'extraction') return extraction(ctx);
  return papers(ctx);
}

async function papers({ $, $$, replaceUrl, main, api, href, navigate, route }) {
  const p = route.params;
  const state = { q: p.q || '', page: +p.page || 1, size: +p.size || 50, sort: p.sort || 'JV_measured_reverse_scan_PCE', dir: p.dir || 'desc', architecture: p.architecture || '', year_min: p.year_min || '', year_max: p.year_max || '', journal: p.journal || '', has_stability: p.has_stability === 'true' };
  main.innerHTML = pageHead('Literature', 'One record per paper: the champion device as extracted by the annotator agent and verified field by field. Values keep their units; <code>Null</code> means the paper gives no support.') + `
  <div class="toolbar"><div class="search" style="width:min(420px,100%)">${icon('search', 15)}<input class="input" id="q" type="search" placeholder="Search title, DOI, journal, composition or stack" value="${esc(state.q)}" aria-label="Search papers"></div>
    <select class="select" id="arch" aria-label="Architecture"><option value="">Any architecture</option><option value="NIP">n-i-p</option><option value="PIN">p-i-n</option></select>
    <input class="input" id="ymin" type="number" placeholder="Year from" style="width:110px" value="${esc(state.year_min)}" aria-label="Year from"><input class="input" id="ymax" type="number" placeholder="to" style="width:90px" value="${esc(state.year_max)}" aria-label="Year to">
    <select class="select" id="journal" aria-label="Journal"><option value="">Any journal</option></select>
    <label class="checkbox"><input type="checkbox" id="stab" ${state.has_stability ? 'checked' : ''}> stability reported</label>
    <span class="spacer"></span><a class="btn" id="csv" href="#" title="Download the current selection as CSV (schema columns)">${icon('download', 14)}Export CSV</a></div>
  <div id="tbl">${loading(8)}</div>`;
  $('#arch').value = state.architecture;
  api.facets().then((f) => { const s = $('#journal'); f.journal.forEach((j) => s.appendChild(h(`<option value="${esc(j.value)}">${esc(j.value)} (${j.n})</option>`))); s.value = state.journal; }).catch(() => {});
  const sync = () => { replaceUrl(href('literature', [], { ...state, has_stability: state.has_stability ? 'true' : '' })); };
  const cols = [
    { key: 'Ref_title', label: 'Title', wrap: true, width: '34%', render: (r) => `<a href="${href('literature', ['paper', r.Ref_DOI])}" style="font-weight:500">${esc(r.Ref_title)}</a><div class="small muted trunc">${esc(r.Ref_journal)} · ${esc(r.Ref_publication_year)}${r._flags?.length ? ` · ${badge(`${r._flags.length} rule flag${r._flags.length > 1 ? 's' : ''}`, 'warn')}` : ''}</div>` },
    { key: 'Ref_DOI', label: 'DOI', render: (r) => doiLink(r.Ref_DOI) },
    { key: 'Ref_publication_year', label: 'Year', num: true, render: (r) => val(r.Ref_publication_year) },
    { key: 'Cell_architecture', label: 'Arch.', render: (r) => val(r.Cell_architecture) },
    { key: 'Perovskite_composition_long_form', label: 'Composition', render: (r) => val(r.Perovskite_composition_long_form, { mono: true }), title: (r) => r.Perovskite_composition_long_form },
    { key: 'JV_measured_reverse_scan_PCE', label: 'PCE (rev.)', num: true, render: (r) => val(r.JV_measured_reverse_scan_PCE) },
    { key: 'Stability_PCE_after_time_value', label: 'Retained', num: true, render: (r) => val(r.Stability_PCE_after_time_value) },
    { key: 'status', label: 'Status', sortable: false, render: () => badge('released · judged', 'ok') },
  ];
  async function load() {
    const box = $('#tbl'); box.setAttribute('aria-busy', 'true'); sync();
    const params = { ...state, has_stability: state.has_stability ? true : '' };
    $('#csv').href = `/api/records.csv?${new URLSearchParams(Object.entries({ q: state.q, sort: state.sort, dir: state.dir, architecture: state.architecture, year_min: state.year_min, year_max: state.year_max, journal: state.journal, has_stability: state.has_stability ? 'true' : '' }).filter(([, v]) => v))}`;
    try {
      const d = await api.records(params);
      box.innerHTML = '';
      const t = table({ columns: cols, rows: d.rows, sort: state.sort, dir: state.dir, onSort: (k, dir) => { state.sort = k; state.dir = dir; state.page = 1; load(); }, emptyText: 'No papers match these filters.' });
      t.appendChild(pager({ page: d.page, pages: d.pages, total: d.total, size: d.size, onPage: (pg) => { state.page = pg; load(); }, onSize: (s) => { state.size = s; state.page = 1; load(); } }));
      box.appendChild(t);
    } catch (e) { box.innerHTML = errorBox(e); }
    box.removeAttribute('aria-busy');
  }
  const reset = () => { state.page = 1; load(); };
  $('#q').addEventListener('input', debounce((e) => { state.q = e.target.value; reset(); }, 300));
  $('#arch').onchange = (e) => { state.architecture = e.target.value; reset(); };
  $('#ymin').onchange = (e) => { state.year_min = e.target.value; reset(); }; $('#ymax').onchange = (e) => { state.year_max = e.target.value; reset(); };
  $('#journal').onchange = (e) => { state.journal = e.target.value; reset(); }; $('#stab').onchange = (e) => { state.has_stability = e.target.checked; reset(); };
  load();
}

async function paper({ $, $$, replaceUrl, main, api, href, setCrumbs, setTitle }, doi) {
  main.innerHTML = loading(10);
  let d; try { d = await api.record(doi); } catch (e) { main.innerHTML = pageHead('Paper') + errorBox(e); return; }
  const r = d.record; setTitle(r.Ref_title || doi);
  setCrumbs([{ label: 'Literature', href: href('literature') }, { label: 'All papers', href: href('literature') }, { label: r.Ref_title || doi }]);
  const sources = [];
  if (d.sources.pdf) sources.push(`<a class="btn btn-sm" href="${d.sources.pdf}" target="_blank" rel="noopener">${icon('file-text', 14)}PDF on file</a>`);
  if (d.sources.device_note) sources.push(`<a class="btn btn-sm" href="${d.sources.device_note}" target="_blank" rel="noopener">${icon('notebook-text', 14)}Device note</a>`);
  main.innerHTML = `<div class="page-head"><div class="titles"><div class="row small muted mb-2">${badge('released record', 'ok')}${d.flags.length ? badge(`${d.flags.length} consistency flag${d.flags.length > 1 ? 's' : ''}`, 'warn') : badge('passes stack rules', 'ok')}<span>${esc(r.Ref_journal)} · ${esc(r.Ref_publication_year)}</span></div><h1 style="font-size:20px">${esc(r.Ref_title)}</h1><p class="sub">${doiLink(r.Ref_DOI)} ${icon('external-link', 12)}</p></div>
    <div class="actions"><a class="btn btn-primary" href="${href('verification', [], { doi: r.Ref_DOI })}">${icon('shield-check', 14)}Open in Verification Studio</a><a class="btn" href="${href('database', [], { doi: r.Ref_DOI })}">${icon('database', 14)}All 97 fields</a></div></div>
  <div class="grid" style="grid-template-columns: minmax(0,1.5fr) minmax(280px,1fr)">
    <div class="col" style="gap:var(--sp-4)">
      <div class="card"><div class="card-head"><h3>Champion device</h3><span class="right small muted">as extracted · ${d.family}</span></div>${kv(champion(r))}</div>
      <div class="card"><div class="card-head"><h3>Device stack</h3><span class="right small muted">substrate → top contact · hover a layer for its provenance</span></div><div id="dev3d" style="height:340px"></div>${roleLegend()}<div class="mt-3">${stackHtml(r.Cell_stack_sequence)}</div>
        <div class="mt-3">${['stack_substrate_first', 'architecture_consistent_with_stack', 'absorber_in_stack'].map((k) => { const v = d.consistency[k]; return `<div class="check ${v === true ? 'ok' : v === false ? 'bad' : 'warn'}">${icon(v === true ? 'circle-check' : v === false ? 'circle-x' : 'circle-help', 14)}<span>${esc(k.replace(/_/g, ' '))}${v === null ? ' <span class="muted">(not decidable: transport layer not found in stack)</span>' : ''}</span></div>`; }).join('')}</div></div>
    </div>
    <div class="col" style="gap:var(--sp-4)">
      <div class="card"><div class="card-head"><h3>Source & provenance</h3></div>
        ${kv([['Source DOI', doiLink(r.Ref_DOI)], ['Extraction', `<span class="mono small">${esc(d.provenance.source_file)}</span>`], ['Article text', sources.length ? sources.join(' ') : '<span class="muted">not on file</span>']])}
        <p class="small muted mt-3" style="margin-bottom:0">The released dataset contains structured values with DOI provenance, not article text. ${d.sources.pdf ? 'A PDF is on file for this record.' : 'Place a PDF at <code>sources/pdf/&lt;doi_folder&gt;.pdf</code> to view it in the Studio.'}</p></div>
      <div class="card"><div class="card-head"><h3>Verification history</h3></div>
        ${d.verified_in_runs.length ? `<p class="small">Field-level audit in ${d.verified_in_runs.length} recorded run${d.verified_in_runs.length > 1 ? 's' : ''}:</p><div class="chips">${d.verified_in_runs.slice(0, 6).map((id) => `<a class="chip" href="${href('verification', [], { doi: r.Ref_DOI, run: id })}">${icon('history', 12)}${esc(id)}</a>`).join('')}</div>` : `<p class="small muted">No field-level audit of a generated draft for this DOI has been recorded. The released value was judged at category level (data card: ${badge('category reliability', 'neutral', false)}).</p>`}
        ${d.audited_in_runs.length ? `<p class="small mt-3" style="margin-bottom:0">Included in ${d.audited_in_runs.length} cohort audit${d.audited_in_runs.length > 1 ? 's' : ''} (stack rules, verifier pool).</p>` : ''}</div>
    </div></div>`;
  const dispose = mountDevice($('#dev3d'), r, { height: 340, explode: 0.25 });
  return () => dispose();
}

async function extraction({ $, $$, replaceUrl, main, api, href }) {
  main.innerHTML = pageHead('Extraction runs', 'Generator drafts produced live under the annotation Skill and judged against the released record. The corpus itself was extracted on commercial API models outside this repository; these runs re-draft one record live under the annotation Skill.') + `<div id="x">${loading(5)}</div>`;
  let d; try { d = await api.runs(); } catch (e) { $('#x').innerHTML = errorBox(e); return; }
  const films = d.runs.filter((r) => r.kind === 'film' && r.complete);
  $('#x').innerHTML = films.length ? `<div class="card pad-0">${films.map((r) => `<a class="row-link" href="${href('verification', [], { doi: r.doi, run: r.id })}">${icon('scan-search', 16)}<span class="grow"><span class="t">${esc(r.doi)} · ${r.accepted}/${r.fields} fields accepted on first pass</span><span class="s">${esc(r.candidate_origin || '')} · generator ${esc((r.models?.generator || '').split('/').pop())} · ${esc(r.started || '')}</span></span>${runKindBadge(r)}</a>`).join('')}</div>` : empty('No extraction runs recorded', 'Run the harness workflow with the model servers up to produce one.', 'scan-search');
}
