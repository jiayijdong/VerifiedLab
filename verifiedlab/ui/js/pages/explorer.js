/** Explorer — scatter, distributions and trend over the released records, with filters and point-level provenance. */
import { $$, h, esc, num, pageHead, sectionHead, kv, badge, relBadge, loading, errorBox, doiLink, icon, drawer, stat } from '../ui.js';
import { scatter, histogram, lines } from '../charts.js';
import { champion } from '../record.js';
import { mountDevice, mountCloud } from '../device3d.js';

const FILTERS = ['architecture', 'family', 'composition', 'additive', 'year_min', 'year_max', 'pce_min', 'etl', 'htl'];

function filterBar(state, facets) {
  return `<div class="toolbar">
    <select class="select" id="f-arch" aria-label="Architecture"><option value="">Any architecture</option><option value="NIP">n-i-p</option><option value="PIN">p-i-n</option></select>
    <select class="select" id="f-family" aria-label="Absorber family"><option value="">Any absorber family</option>${(facets?.family || []).map((x) => `<option value="${esc(x.value)}">${esc(x.value)} (${x.n})</option>`).join('')}</select>
    <input class="input" id="f-comp" placeholder="Composition contains" style="width:170px" value="${esc(state.composition)}" aria-label="Composition contains">
    <input class="input" id="f-add" placeholder="Additive contains" style="width:150px" value="${esc(state.additive)}" aria-label="Additive contains">
    <input class="input" id="f-ymin" type="number" placeholder="Year ≥" style="width:92px" value="${esc(state.year_min)}" aria-label="Year from"><input class="input" id="f-ymax" type="number" placeholder="Year ≤" style="width:92px" value="${esc(state.year_max)}" aria-label="Year to">
    <input class="input" id="f-pmin" type="number" step="0.5" placeholder="PCE ≥" style="width:92px" value="${esc(state.pce_min)}" aria-label="PCE minimum"></div>`;
}
function bindFilters($, state, onChange) {
  $('#f-arch').value = state.architecture; $('#f-family').value = state.family;
  const map = { 'f-arch': 'architecture', 'f-family': 'family', 'f-comp': 'composition', 'f-add': 'additive', 'f-ymin': 'year_min', 'f-ymax': 'year_max', 'f-pmin': 'pce_min' };
  Object.entries(map).forEach(([id, k]) => { $(`#${id}`).onchange = (e) => { state[k] = e.target.value; onChange(); }; });
}
function pick(state, p) { return Object.fromEntries(FILTERS.map((k) => [k, state[k] || p[k] || ''])); }

export async function render(ctx) {
  const s = ctx.route.section;
  if (s === 'distribution') return distribution(ctx);
  if (s === 'trend') return trend(ctx);
  if (s === 'space') return space(ctx);
  return scatterPage(ctx);
}

async function openPoint(api, href, doi) {
  const dl = drawer(doi, loading(6));
  try { const d = await api.record(doi); dl.querySelector('.drawer-body').innerHTML = `<div class="row wrap mb-3">${doiLink(d.doi)}<span class="spacer"></span><a class="btn btn-sm btn-primary" href="${href('verification', [], { doi: d.doi })}">${icon('shield-check', 14)}Verification Studio</a><a class="btn btn-sm" href="${href('literature', ['paper', d.doi])}">${icon('book-open', 14)}Paper</a></div><h3 style="font-size:15px;margin-bottom:12px">${esc(d.record.Ref_title)}</h3><div id="dev3d" style="height:220px;margin-bottom:10px"></div>${kv(champion(d.record))}<p class="small muted mt-3">${esc(d.record.Ref_journal)} · ${esc(d.record.Ref_publication_year)} · extraction <span class="mono">${esc(d.provenance.source_file.split('/').pop())}</span></p>`; $$('a[href^="#"]', dl).forEach((a) => { a.onclick = () => dl.close(); }); const dispose = mountDevice(dl.querySelector('#dev3d'), d.record, { height: 220, compact: true, explode: 0.2 }); dl.addEventListener('close', dispose); }
  catch (e) { dl.querySelector('.drawer-body').innerHTML = errorBox(e); }
}

async function scatterPage({ $, $$, replaceUrl, main, api, href, route }) {
  const p = route.params; const state = { x: p.x || 'bandgap', y: p.y || 'pce', color: p.color || 'arch', ...pick({}, p) };
  const facets = await api.facets().catch(() => null);
  main.innerHTML = pageHead('Explorer', 'Each point is one paper\'s reported champion device. Pick the axes, filter the cohort, hover for the DOI and click a point to open its record.') + `
  <div class="toolbar"><label class="small muted">x</label><select class="select" id="ax" aria-label="x axis"></select><label class="small muted">y</label><select class="select" id="ay" aria-label="y axis"></select>
    <label class="small muted">colour</label><select class="select" id="col" aria-label="Colour by"><option value="">none</option><option value="arch">architecture</option><option value="family">absorber family (top 3)</option></select>
    <label class="checkbox"><input type="checkbox" id="logx"> log x</label></div>${filterBar(state, facets)}
  <div class="grid" style="grid-template-columns: minmax(0,1fr) 260px"><div class="card"><div id="chart">${loading(6)}</div></div><div class="col" style="gap:var(--sp-4)"><div class="card" id="summary">${loading(5)}</div></div></div>`;
  bindFilters($, state, load);
  $('#col').value = state.color; $('#col').onchange = (e) => { state.color = e.target.value; load(); }; $('#logx').onchange = load;
  let axesList = null;
  async function load() {
    replaceUrl(href('explorer', [], state));
    let d; try { d = await api.explore({ x: state.x, y: state.y, ...pick(state, {}) }); } catch (e) { $('#chart').innerHTML = errorBox(e); return; }
    if (!axesList) { axesList = d.axes; ['ax', 'ay'].forEach((id) => { const sel = $(`#${id}`); sel.innerHTML = Object.entries(axesList).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join(''); sel.value = id === 'ax' ? state.x : state.y; sel.onchange = (e) => { state[id === 'ax' ? 'x' : 'y'] = e.target.value; load(); }; }); }
    const logX = $('#logx').checked && d.points.every((q) => q.x > 0);
    const colorKey = state.color === 'arch' ? 'arch' : state.color === 'family' ? 'family' : null;
    let groups = [];
    if (colorKey) { const cnt = {}; d.points.forEach((q) => { cnt[q[colorKey]] = (cnt[q[colorKey]] || 0) + 1; }); groups = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k]) => k).filter((k) => k && k !== 'NULL' && k !== 'unreported').slice(0, 3); }
    scatter($('#chart'), d.points, { xLabel: d.x.label, yLabel: d.y.label, colorKey, groups, logX, onPick: (q) => openPoint(api, href, q.doi), tipFn: (q) => `<b>${esc(q.doi)}</b><br>${esc(d.x.label)}: ${num(q.x, 3)} · ${esc(d.y.label)}: ${num(q.y, 3)}<br>${esc(q.arch)} · ${esc(q.family)} · ${q.year ? num(q.year, 0) : ''}` });
    $('#summary').innerHTML = `<div class="card-head"><h3>Selection</h3></div><div class="stat-row" style="grid-template-columns:1fr 1fr">${stat(num(d.n, 0), 'points plotted')}${stat(num(d.filtered_records, 0), 'records in cohort')}</div><div class="divider"></div>
      ${kv([[d.x.label, `median ${num(d.x.summary.median, 3)} · IQR ${num(d.x.summary.q1, 3)}–${num(d.x.summary.q3, 3)}`], [d.y.label, `median ${num(d.y.summary.median, 3)} · IQR ${num(d.y.summary.q1, 3)}–${num(d.y.summary.q3, 3)}`], ['x field', `<span class="mono small">${esc(d.x.field)}</span><br>${relBadge(d.x.category, { 'Reference data': 99.5, 'Cell definition': 93.33, 'Device fabrication': 93.05, 'J-V metrics': 93.12, 'Device stack': 89.95, 'Material synthesis': 85.31, 'Stability metrics': 70.31 }[d.x.category] ?? 0)}`], ['y field', `<span class="mono small">${esc(d.y.field)}</span><br>${relBadge(d.y.category, { 'Reference data': 99.5, 'Cell definition': 93.33, 'Device fabrication': 93.05, 'J-V metrics': 93.12, 'Device stack': 89.95, 'Material synthesis': 85.31, 'Stability metrics': 70.31 }[d.y.category] ?? 0)}`], ['Dropped', `${num(d.dropped_missing, 0)} without both values · ${num(d.dropped_out_of_range, 0)} out of range`]])}
      <p class="small muted mt-3" style="margin-bottom:0">${esc(d.note)}</p>`;
  }
  load();
}

async function distribution({ $, $$, replaceUrl, main, api, href, route }) {
  const p = route.params; const state = { v: p.v || 'pce', ...pick({}, p) };
  const facets = await api.facets().catch(() => null);
  main.innerHTML = pageHead('Distributions', 'Histogram of one reported quantity across the filtered cohort. Bars in the 22 % and above range are highlighted for PCE; bandgap highlights the 1.5–1.7 eV window.') + `<div class="toolbar"><label class="small muted">variable</label><select class="select" id="var" aria-label="Variable"></select><label class="small muted">bins</label><select class="select" id="bins" aria-label="Bins"><option>20</option><option selected>30</option><option>50</option></select></div>${filterBar(state, facets)}
  <div class="grid" style="grid-template-columns: minmax(0,1fr) 260px"><div class="card"><div id="chart">${loading(6)}</div></div><div class="card" id="summary">${loading(4)}</div></div>`;
  bindFilters($, state, load); $('#bins').onchange = load;
  let axesList = null;
  async function load() {
    replaceUrl(href('explorer', ['distribution'], state));
    let d; try { d = await api.explore({ x: state.v, y: state.v, ...pick(state, {}) }); } catch (e) { $('#chart').innerHTML = errorBox(e); return; }
    if (!axesList) { axesList = d.axes; const sel = $('#var'); sel.innerHTML = Object.entries(axesList).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join(''); sel.value = state.v; sel.onchange = (e) => { state.v = e.target.value; load(); }; }
    const vals = d.points.map((q) => q.x);
    const hl = state.v === 'pce' ? (a) => a >= 22 : state.v === 'bandgap' ? (a, b) => a >= 1.5 && b <= 1.7 : null;
    histogram($('#chart'), vals, { xLabel: d.x.label, bins: +$('#bins').value, highlight: hl });
    const s = d.x.summary;
    $('#summary').innerHTML = `<div class="card-head"><h3>${esc(d.x.label)}</h3></div>${kv([['n', num(s.n, 0)], ['median', num(s.median, 3)], ['IQR', `${num(s.q1, 3)} – ${num(s.q3, 3)}`], ['range', `${num(s.min, 3)} – ${num(s.max, 3)}`], ['field', `<span class="mono small">${esc(d.x.field)}</span>`], ['category', esc(d.x.category)]])}${hl ? `<p class="small muted mt-3" style="margin-bottom:0">${state.v === 'pce' ? `${num(vals.filter((v) => v >= 22).length, 0)} records (${(100 * vals.filter((v) => v >= 22).length / Math.max(1, vals.length)).toFixed(1)} %) report ≥ 22 %.` : `${(100 * vals.filter((v) => v >= 1.5 && v <= 1.7).length / Math.max(1, vals.length)).toFixed(1)} % of records sit in 1.5–1.7 eV.`}</p>` : ''}<p class="small muted mt-3" style="margin-bottom:0">${esc(d.note)}</p>`;
  }
  load();
}

async function trend({ $, $$, replaceUrl, main, api, href, route }) {
  const p = route.params; const state = { ...pick({}, p) };
  const facets = await api.facets().catch(() => null);
  main.innerHTML = pageHead('Trend by year', 'Median reverse-scan PCE by publication year for the filtered cohort against the whole corpus, with interquartile bands. Reported efficiencies drift upward with time; compare a family against the corpus of the same year.') + filterBar(state, facets) + `<div class="card"><div id="chart">${loading(6)}</div></div><div id="tbl" class="mt-4"></div>`;
  bindFilters($, state, load);
  async function load() {
    replaceUrl(href('explorer', ['trend'], state));
    let d; try { d = await api.trend(pick(state, {})); } catch (e) { $('#chart').innerHTML = errorBox(e); return; }
    const toPts = (rows) => rows.filter((r) => r.n >= 5).map((r) => ({ x: r.year, y: r.median, lo: r.q1, hi: r.q3, n: r.n }));
    const hasFilter = FILTERS.some((k) => state[k]);
    const series = hasFilter ? [{ name: `cohort (n=${d.cohort_n.toLocaleString()})`, points: toPts(d.cohort) }, { name: `corpus (n=${d.corpus_n.toLocaleString()})`, points: toPts(d.corpus) }] : [{ name: `corpus (n=${d.corpus_n.toLocaleString()})`, points: toPts(d.corpus) }];
    lines($('#chart'), series, { xLabel: 'Publication year', yLabel: 'Median reverse-scan PCE (%)' });
    $('#tbl').innerHTML = `<div class="table-wrap"><table class="table dense"><thead><tr><th>Year</th>${hasFilter ? '<th class="num">cohort n</th><th class="num">cohort median</th><th class="num">cohort ≥ 22 %</th>' : ''}<th class="num">corpus n</th><th class="num">corpus median</th><th class="num">corpus ≥ 22 %</th></tr></thead><tbody>${d.corpus.map((c) => { const k = d.cohort.find((x) => x.year === c.year); return `<tr><td>${c.year}</td>${hasFilter ? `<td class="num">${k ? k.n : 0}</td><td class="num">${k ? num(k.median, 2) : '–'}</td><td class="num">${k ? (k.share_above_22 * 100).toFixed(1) + ' %' : '–'}</td>` : ''}<td class="num">${c.n}</td><td class="num">${num(c.median, 2)}</td><td class="num">${(c.share_above_22 * 100).toFixed(1)} %</td></tr>`; }).join('')}</tbody></table></div><p class="small muted mt-3">Years with fewer than 5 records are omitted from the chart; medians describe reported champion devices and are not causal.</p>`;
  }
  load();
}

/* ------------------------------------------------------------------ 3D space: three reported quantities, one point per paper */
async function space({ $, $$, replaceUrl, main, api, href, route }) {
  const p = route.params; const state = { x: p.x || 'bandgap', y: p.y || 'pce', z: p.z || 'year', color: p.color || 'pce', ...pick({}, p) };
  const facets = await api.facets().catch(() => null);
  main.innerHTML = pageHead('3D space', 'Three reported quantities at once, one point per paper\'s champion device. Drag to orbit, scroll to zoom, hover for the DOI and click a point to open its record. The cloud is computed from the released records; out-of-range values are dropped as garbled.') + `
  <div class="toolbar"><label class="small muted">x</label><select class="select" id="ax" aria-label="x axis"></select><label class="small muted">y</label><select class="select" id="ay" aria-label="y axis"></select><label class="small muted">z</label><select class="select" id="az" aria-label="z axis"></select>
    <label class="small muted">colour</label><select class="select" id="col" aria-label="Colour by"><option value="pce">reverse-scan PCE</option><option value="year">publication year</option><option value="arch">architecture</option><option value="family">absorber family (top 3)</option></select>
    <label class="checkbox"><input type="checkbox" id="logx"> log x</label><label class="checkbox"><input type="checkbox" id="logz"> log z</label></div>${filterBar(state, facets)}
  <div class="grid" style="grid-template-columns: minmax(0,1fr) 260px"><div class="card pad-0"><div id="cloud" style="height:600px"></div></div><div class="col" style="gap:var(--sp-4)"><div class="card" id="summary">${loading(5)}</div><div class="card"><div class="card-head"><h3>Reading the cloud</h3></div><p class="small muted" style="margin-bottom:0">Colour by PCE shows the efficiency landscape; colour by year shows how the field moved. Each point is a reported champion device (publication-biased); the bandgap window and the area trend from the paper are visible as structure in the x–y and x–z faces.</p></div></div></div>`;
  bindFilters($, state, load);
  $('#col').value = state.color; $('#col').onchange = (e) => { state.color = e.target.value; load(); }; $('#logx').onchange = load; $('#logz').onchange = load;
  let axesList = null; let dispose = null;
  async function load() {
    replaceUrl(href('explorer', ['space'], state));
    let d; try { d = await api.explore({ x: state.x, y: state.y, z: state.z, ...pick(state, {}) }); } catch (e) { $('#cloud').innerHTML = errorBox(e); return; }
    if (!axesList) { axesList = d.axes; [['ax', 'x'], ['ay', 'y'], ['az', 'z']].forEach(([id, k]) => { const sel = $(`#${id}`); sel.innerHTML = Object.entries(axesList).map(([key, l]) => `<option value="${key}">${esc(l)}</option>`).join(''); sel.value = state[k]; sel.onchange = (e) => { state[k] = e.target.value; load(); }; }); }
    const logX = $('#logx').checked && d.points.every((q) => q.x > 0); const logZ = $('#logz').checked && d.points.every((q) => q.z > 0);
    let groups = []; if (state.color === 'arch' || state.color === 'family') { const cnt = {}; d.points.forEach((q) => { cnt[q[state.color]] = (cnt[q[state.color]] || 0) + 1; }); groups = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k]) => k).filter((k) => k && k !== 'NULL' && k !== 'unreported').slice(0, 3); }
    if (dispose) dispose();
    dispose = mountCloud($('#cloud'), d.points, { x: { label: d.x.label, log: logX }, y: { label: d.y.label }, z: { label: d.z.label, log: logZ } }, { height: 600, colorBy: state.color, groups, onPick: (q) => openPoint(api, href, q.doi), tipFn: (q) => `<b>${esc(q.doi)}</b><span>${esc(d.x.label)}: ${num(q.x, 3)}</span><span>${esc(d.y.label)}: ${num(q.y, 3)}</span><span>${esc(d.z.label)}: ${num(q.z, 3)}</span><span class="muted">${esc(q.arch)} · ${esc(q.family)} · ${q.year ? num(q.year, 0) : ''}</span>` });
    $('#summary').innerHTML = `<div class="card-head"><h3>Selection</h3></div><div class="stat-row" style="grid-template-columns:1fr 1fr">${stat(num(d.n, 0), 'points plotted')}${stat(num(d.filtered_records, 0), 'records in cohort')}</div><div class="divider"></div>
      ${kv([[d.x.label, `median ${num(d.x.summary.median, 3)}`], [d.y.label, `median ${num(d.y.summary.median, 3)}`], [d.z.label, `median ${num(d.z.summary.median, 3)}`], ['Dropped', `${num(d.dropped_missing, 0)} without all three values · ${num(d.dropped_out_of_range, 0)} out of range`]])}
      ${groups.length ? `<div class="legend mt-3">${groups.map((g, i) => `<span><i style="background:var(--s${i + 1})"></i>${esc(g)}</span>`).join('')}<span><i style="background:var(--s-muted)"></i>Other</span></div>` : state.color === 'pce' ? '<div class="small muted mt-3">blue → red: 10 % → 26 % PCE</div>' : state.color === 'year' ? '<div class="small muted mt-3">blue → red: 2015 → 2025</div>' : ''}
      <p class="small muted mt-3" style="margin-bottom:0">${esc(d.note)}</p>`;
  }
  load();
  return () => { if (dispose) dispose(); };
}
