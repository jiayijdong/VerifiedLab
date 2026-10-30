/** Database — the structured record table: column visibility, sorting, filtering, pagination, record details, CSV export. */
import { $$, h, esc, val, isNull, num, pageHead, sectionHead, kv, badge, relBadge, table, pager, loading, errorBox, doiLink, icon, debounce, drawer, md } from '../ui.js';
import { groupFields, stackHtml, CATEGORY_ORDER } from '../record.js';
import { mountDevice } from '../device3d.js';

const DEFAULT_COLS = ['Ref_DOI', 'Ref_publication_year', 'Cell_architecture', 'Cell_stack_sequence', 'Perovskite_composition_long_form', 'Perovskite_additive_compound', 'Perovskite_bandgap', 'Cell_area_measured', 'JV_measured_reverse_scan_PCE', 'JV_measured_reverse_scan_Voc', 'JV_measured_reverse_scan_FF', 'Stability_PCE_after_time_value'];

export async function render(ctx) {
  if (ctx.route.section === 'datacard') return datacard(ctx);
  return records(ctx);
}

async function records({ $, $$, replaceUrl, main, api, href, route }) {
  const p = route.params;
  let cols = []; try { cols = JSON.parse(localStorage.getItem('vl.db.cols') || 'null') || DEFAULT_COLS; } catch { cols = DEFAULT_COLS; }
  const state = { q: p.q || '', page: +p.page || 1, size: +p.size || 50, sort: p.sort || 'JV_measured_reverse_scan_PCE', dir: p.dir || 'desc', architecture: p.architecture || '', family: p.family || '', year_min: p.year_min || '', year_max: p.year_max || '', pce_min: p.pce_min || '', pce_max: p.pce_max || '', flagged: p.flagged === 'true', has_stability: p.has_stability === 'true' };
  main.innerHTML = pageHead('Database', 'Every released record with all 97 schema fields. Values are strings with their units; <code>Null</code> means no support in the paper. Category reliability travels with every column.', `<button class="btn" id="colbtn">${icon('columns-3', 14)}Columns <span class="badge" id="colcount"></span></button><a class="btn" id="csv" href="#">${icon('download', 14)}Export CSV</a>`) + `
  <div class="toolbar"><div class="search" style="width:min(360px,100%)">${icon('search', 15)}<input class="input" id="q" type="search" placeholder="Search DOI, title, composition, stack…" value="${esc(state.q)}" aria-label="Search"></div>
    <select class="select" id="arch" aria-label="Architecture"><option value="">Any architecture</option><option value="NIP">n-i-p</option><option value="PIN">p-i-n</option></select>
    <select class="select" id="family" aria-label="Absorber family"><option value="">Any absorber family</option></select>
    <input class="input" id="pmin" type="number" step="0.5" placeholder="PCE ≥" style="width:96px" value="${esc(state.pce_min)}" aria-label="PCE minimum"><input class="input" id="pmax" type="number" step="0.5" placeholder="PCE ≤" style="width:96px" value="${esc(state.pce_max)}" aria-label="PCE maximum">
    <input class="input" id="ymin" type="number" placeholder="Year ≥" style="width:96px" value="${esc(state.year_min)}" aria-label="Year from"><input class="input" id="ymax" type="number" placeholder="Year ≤" style="width:96px" value="${esc(state.year_max)}" aria-label="Year to">
    <label class="checkbox"><input type="checkbox" id="flag" ${state.flagged ? 'checked' : ''}> rule-flagged</label><label class="checkbox"><input type="checkbox" id="stab" ${state.has_stability ? 'checked' : ''}> stability reported</label></div>
  <div id="tbl">${loading(10)}</div>`;
  $('#arch').value = state.architecture;
  const schema = await api.schema().catch(() => null); const catOf = Object.fromEntries((schema?.fields || []).map((f) => [f.name, f]));
  api.facets().then((f) => { const s = $('#family'); f.family.forEach((x) => s.appendChild(h(`<option value="${esc(x.value)}">${esc(x.value)} (${x.n})</option>`))); s.value = state.family; }).catch(() => {});
  const sync = () => { replaceUrl(href('database', [], { ...state, flagged: state.flagged ? 'true' : '', has_stability: state.has_stability ? 'true' : '' })); $('#colcount').textContent = cols.length; };
  const filterParams = () => Object.fromEntries(Object.entries({ q: state.q, architecture: state.architecture, family: state.family, year_min: state.year_min, year_max: state.year_max, pce_min: state.pce_min, pce_max: state.pce_max, flagged: state.flagged ? 'true' : '', has_stability: state.has_stability ? 'true' : '', sort: state.sort, dir: state.dir }).filter(([, v]) => v));
  async function load() {
    const box = $('#tbl'); box.setAttribute('aria-busy', 'true'); sync();
    $('#csv').href = `/api/records.csv?${new URLSearchParams({ ...filterParams(), cols: cols.join(',') })}`;
    try {
      const d = await api.records({ ...filterParams(), page: state.page, size: state.size, cols: cols.join(',') });
      const columns = d.columns.map((c) => ({ key: c, label: c.replace(/^(Ref|Cell|ETL|HTL|Perovskite|Backcontact|Encapsulation|JV|Stabilized|Stability)_/, (m0) => `${m0.slice(0, -1)} · `).replace(/_/g, ' '), num: /PCE|Voc|Jsc|FF|year|bandgap|thickness|area|concentration|temperature|time|speed|value/i.test(c), title: (r) => `${c}: ${r[c]}`,
        render: (r) => (c === 'Ref_DOI' ? `<a href="#" class="doi" data-doi="${esc(r.Ref_DOI)}">${esc(r.Ref_DOI)}</a>` : val(r[c], { mono: /sequence|composition/.test(c) })) }));
      columns.push({ key: '_flags', label: 'Checks', sortable: false, render: (r) => (r._flags?.length ? badge(`${r._flags.length} flag${r._flags.length > 1 ? 's' : ''}`, 'warn') : badge('ok', 'ok', false)) });
      box.innerHTML = '';
      const t = table({ columns, rows: d.rows, sort: state.sort, dir: state.dir, dense: true, onSort: (k, dir) => { state.sort = k; state.dir = dir; state.page = 1; load(); }, emptyText: 'No records match these filters.' });
      // header tooltips carry the category reliability
      $$('th', t).forEach((th, i) => { const f = catOf[columns[i]?.key]; if (f) th.title = `${f.category} · judged accuracy ${f.reliability} % · ${f.text}`; });
      t.appendChild(pager({ page: d.page, pages: d.pages, total: d.total, size: d.size, onPage: (pg) => { state.page = pg; load(); }, onSize: (s) => { state.size = s; state.page = 1; load(); } }));
      box.appendChild(t);
      $$('a[data-doi]', t).forEach((a) => { a.onclick = (e) => { e.preventDefault(); openRecord(a.dataset.doi); }; });
    } catch (e) { box.innerHTML = errorBox(e); }
    box.removeAttribute('aria-busy');
  }
  async function openRecord(doi) {
    const dl = drawer(doi, loading(10));
    try {
      const d = await api.record(doi); const r = d.record;
      dl.querySelector('.drawer-body').innerHTML = `<div class="row wrap mb-3">${doiLink(r.Ref_DOI)}${d.flags.length ? badge(`${d.flags.length} rule flag${d.flags.length > 1 ? 's' : ''}`, 'warn') : badge('passes stack rules', 'ok')}<span class="spacer"></span><a class="btn btn-sm btn-primary" href="${href('verification', [], { doi: r.Ref_DOI })}">${icon('shield-check', 14)}Verification Studio</a><a class="btn btn-sm" href="${href('literature', ['paper', r.Ref_DOI])}">${icon('book-open', 14)}Paper</a></div>
        <h3 style="font-size:15px;margin-bottom:12px">${esc(r.Ref_title)}</h3><div id="dev3d" style="height:240px;margin-bottom:8px"></div>${stackHtml(r.Cell_stack_sequence)}
        ${groupFields(d.fields).map((g) => `<div class="group-head">${esc(g.category)} <span class="badge plain">${g.reliability} %</span><span class="line"></span></div>${g.fields.map((f) => `<div class="field-row"><span class="fname">${esc(f.name)}</span><span class="fval">${val(f.value)}</span><span></span></div>`).join('')}`).join('')}`;
      $$('a', dl).forEach((a) => { if (a.getAttribute('href')?.startsWith('#')) a.onclick = () => dl.close(); });
      const dispose = mountDevice(dl.querySelector('#dev3d'), r, { height: 240, compact: true, explode: 0.2 }); dl.addEventListener('close', dispose);
    } catch (e) { dl.querySelector('.drawer-body').innerHTML = errorBox(e); }
  }
  $('#colbtn').onclick = () => {
    const fields = schema?.fields || cols.map((c) => ({ name: c, category: 'Other' }));
    const dl = drawer('Columns', `<div class="row mb-3"><button class="btn btn-sm" id="c-def">Default</button><button class="btn btn-sm" id="c-all">All</button><button class="btn btn-sm" id="c-none">None</button><span class="spacer"></span><span class="small muted" id="c-n"></span></div>` + groupFields(fields).map((g) => `<div class="group-head">${esc(g.category)}<span class="line"></span></div>${g.fields.map((f) => `<label class="checkbox" style="display:flex;padding:3px 0"><input type="checkbox" value="${esc(f.name)}" ${cols.includes(f.name) ? 'checked' : ''}><span class="mono small">${esc(f.name)}</span></label>`).join('')}`).join(''));
    const update = () => { cols = $$('input[type=checkbox]:checked', dl).map((i) => i.value); if (!cols.length) cols = ['Ref_DOI']; $('#c-n', dl).textContent = `${cols.length} columns`; try { localStorage.setItem('vl.db.cols', JSON.stringify(cols)); } catch { /* ignore */ } };
    $$('input[type=checkbox]', dl).forEach((i) => { i.onchange = update; });
    $('#c-def', dl).onclick = () => { $$('input[type=checkbox]', dl).forEach((i) => { i.checked = DEFAULT_COLS.includes(i.value); }); update(); };
    $('#c-all', dl).onclick = () => { $$('input[type=checkbox]', dl).forEach((i) => { i.checked = true; }); update(); };
    $('#c-none', dl).onclick = () => { $$('input[type=checkbox]', dl).forEach((i) => { i.checked = i.value === 'Ref_DOI'; }); update(); };
    update(); dl.addEventListener('close', () => load());
  };
  const reset = () => { state.page = 1; load(); };
  $('#q').addEventListener('input', debounce((e) => { state.q = e.target.value; reset(); }, 300));
  ['arch:architecture', 'family:family', 'pmin:pce_min', 'pmax:pce_max', 'ymin:year_min', 'ymax:year_max'].forEach((s) => { const [id, k] = s.split(':'); $(`#${id}`).onchange = (e) => { state[k] = e.target.value; reset(); }; });
  $('#flag').onchange = (e) => { state.flagged = e.target.checked; reset(); }; $('#stab').onchange = (e) => { state.has_stability = e.target.checked; reset(); };
  await load();
  if (p.doi) openRecord(p.doi);
}

async function datacard({ $, $$, replaceUrl, main, api, href }) {
  main.innerHTML = pageHead('Data card', 'What a record is, how the columns are organised, and how reliable each category was judged to be.') + `<div id="dc">${loading(8)}</div>`;
  let s, a; try { [s, a] = await Promise.all([api.schema(), api.about()]); } catch (e) { $('#dc').innerHTML = errorBox(e); return; }
  const groups = groupFields(s.fields);
  $('#dc').innerHTML = `<div class="grid" style="grid-template-columns: minmax(0,1.4fr) minmax(280px,1fr)"><div class="col" style="gap:var(--sp-4)">
    <div class="card"><div class="card-head"><h3>What a record is</h3></div><p class="small">One record per paper: the paper's best-performing device as identified by the annotator agent from the main text and supporting information. All values are strings and keep their units (<code>545 nm</code>, <code>23.87 mA/cm2</code>); layer stacks are ordered from substrate to top contact with <code>/</code>; multiple entries are separated by <code>;</code>; a field with no support in the paper is the literal string <code>Null</code>.</p><p class="small muted" style="margin-bottom:0">Records describe reported champion devices, not the experimental distribution, and reflect publication bias. Values are LLM extractions and can be wrong; consult the source DOI for any value that matters.</p></div>
    <div class="card pad-0"><table class="table"><thead><tr><th>Category</th><th>Prefixes</th><th>Fields</th><th>Judged accuracy</th><th>Route</th></tr></thead><tbody>${groups.map((g) => `<tr><td>${esc(g.category)}</td><td class="mono small">${Object.entries(s.field_category_prefixes).filter(([, c]) => c === g.category).map(([p]) => esc(p)).join(' ')}</td><td class="num">${g.fields.length}</td><td class="num tnum">${g.reliability?.toFixed(2)} %</td><td>${g.reliability > s.threshold ? badge('Continue', 'ok') : badge('Human review', 'warn')}</td></tr>`).join('')}</tbody></table></div>
    ${groups.map((g) => `<div class="card"><div class="card-head"><h3>${esc(g.category)}</h3><span class="right">${relBadge('', g.reliability).replace(' · ', '')}</span></div><div class="chips">${g.fields.map((f) => `<span class="chip mono" title="${esc(f.text)}">${esc(f.name)}</span>`).join('')}</div></div>`).join('')}
  </div><div class="col" style="gap:var(--sp-4)"><div class="card"><div class="card-head"><h3>Files</h3></div>${kv([['Parquet', `<span class="mono small" style="overflow-wrap:anywhere">${esc(a.dataset)}</span>`], ['SHA-256', `<span class="mono small" style="overflow-wrap:anywhere">${esc(a.dataset_sha256)}</span>`], ['Rows × columns', '10,258 × 102 (97 schema fields, 3 auxiliary, 2 provenance)'], ['License', 'MIT; structured values with DOI provenance only, no article text']])}</div>
    <div class="card"><div class="card-head"><h3>Reliability</h3></div><p class="small">${esc(s.source)}. Errors are mostly incorrect values rather than omissions. Treat stability fields as exploratory and check synthesis fields before relying on them.</p><p class="small muted" style="margin-bottom:0">${esc(s.scope)} <a href="${href('verification', ['reliability'])}">Field reliability</a></p></div></div></div>`;
}
