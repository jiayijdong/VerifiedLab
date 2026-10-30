/** Skills — the versioned annotation / verification Skills and the workflow policy, plus the field rules that run as code. */
import { $$, esc, pageHead, sectionHead, kv, badge, relBadge, table, loading, errorBox, icon, md } from '../ui.js';

export async function render(ctx) {
  if (ctx.route.section === 'rules') return rules(ctx);
  return list(ctx);
}

async function list({ $, $$, replaceUrl, main, api, href, route }) {
  main.innerHTML = pageHead('Skills', 'Versioned policy files the agents are prompted with: the annotation Skill (generator), the verification Skill (judges) and the workflow policy (gate). Materialized from the manuscript\'s Methods and Supplementary Note.') + `<div id="sk">${loading(6)}</div>`;
  let d; try { d = await api.skills(); } catch (e) { $('#sk').innerHTML = errorBox(e); return; }
  let cur = route.params.skill || d.skills[0]?.file;
  const box = $('#sk');
  const draw = () => {
    const s = d.skills.find((x) => x.file === cur) || d.skills[0];
    const applies = s.kind === 'skill' ? (s.role?.startsWith('annotation') ? `${d.live_fields.length} fields generated live (of 97 in the schema)` : `${d.field_rules.filter((f) => f.deterministic).length} fields with a deterministic rule · the rest judged under the Skill's equivalence rules`) : `${Object.keys(s.json.category_reliability_percent || {}).length} categories · threshold ${s.json.automation_threshold_percent} %`;
    box.innerHTML = `<div class="tabs" role="tablist">${d.skills.map((x) => `<button class="tab" role="tab" aria-selected="${x.file === s.file}" data-f="${esc(x.file)}">${esc(x.name)} <span class="muted">v${esc(x.version)}</span></button>`).join('')}</div>
      <div class="grid" style="grid-template-columns: minmax(0,1.5fr) minmax(280px,1fr)"><div class="card">${md(s.body)}</div>
      <div class="col" style="gap:var(--sp-4)"><div class="card"><div class="card-head"><h3>${esc(s.name)}</h3><span class="right">${badge(`v${s.version}`, 'info', false)}</span></div>${kv([['Kind', s.kind === 'skill' ? 'Skill (prompted)' : 'Workflow policy (executed)'], ['Role', esc(s.role || '')], s.labels ? ['Labels', `<span class="mono small">${esc(s.labels)}</span>`] : null, ['Applies to', applies], ['Source', esc(s.source || 'manuscript Methods')], ['File', `<span class="mono small">${esc(s.file)}</span>`], ['Last modified', esc(s.modified)], ['Size', `${s.chars.toLocaleString()} chars`]])}</div>
        <div class="card"><div class="card-head"><h3>Update record</h3></div><p class="small muted" style="margin-bottom:0">Versions are read from each file's front matter. The demo folder is not yet under version control, so no change history is available beyond the file timestamp. ${s.kind === 'skill' ? `<a href="${href('skills', ['rules'])}">Field rules</a> are the part of the verification Skill that runs as code.` : `The policy's category reliabilities come from the data card; <a href="${href('verification', ['reliability'])}">try a different threshold</a>.`}</p></div>
        ${s.kind === 'policy' ? `<div class="card"><div class="card-head"><h3>Field → category</h3></div>${kv(Object.entries(s.json.field_category).map(([p, c]) => [`<span class="mono">${esc(p)}*</span>`, esc(c)]))}</div>` : ''}</div></div>`;
    $$('.tab', box).forEach((b) => { b.onclick = () => { cur = b.dataset.f; replaceUrl(href('skills', [], { skill: cur })); draw(); }; });
  };
  draw();
}

async function rules({ $, $$, replaceUrl, main, api }) {
  main.innerHTML = pageHead('Field rules', 'What the verifier applies per field: deterministic rules executed by the harness (ordered stacks, numeric tolerances, exact match, aliases) and the Skill\'s equivalence rules applied by the judge models for the rest.') + `<div class="toolbar"><div class="segmented" id="kf"><button type="button" data-k="" aria-pressed="true">All</button><button type="button" data-k="code" aria-pressed="false">Executed as code</button><button type="button" data-k="model" aria-pressed="false">Judged by model</button><button type="button" data-k="live" aria-pressed="false">Live fields</button></div><span class="spacer"></span><span class="small muted" id="n"></span></div><div id="fr">${loading(8)}</div>`;
  let d; try { d = await api.skills(); } catch (e) { $('#fr').innerHTML = errorBox(e); return; }
  let k = '';
  const draw = () => {
    const rows = d.field_rules.filter((f) => !k || (k === 'code' ? f.deterministic : k === 'model' ? !f.deterministic : d.live_fields.includes(f.name)));
    $('#n').textContent = `${rows.length} of ${d.field_rules.length} fields`;
    $('#fr').innerHTML = ''; $('#fr').appendChild(table({ columns: [
      { key: 'name', label: 'Field', render: (r) => `<span class="mono">${esc(r.name)}</span>${d.live_fields.includes(r.name) ? ' <span class="badge plain badge-planned">live</span>' : ''}` }, { key: 'category', label: 'Category', render: (r) => relBadge(r.category, r.reliability ?? 0) },
      { key: 'kind', label: 'Rule kind', render: (r) => (r.deterministic ? badge(`${r.kind}${r.tolerance ? ` · ±${(r.tolerance * 100).toFixed(0)} %` : ''}`, 'info') : badge('verifier model', 'neutral')) }, { key: 'text', label: 'Rule', wrap: true, render: (r) => `<span class="small">${esc(r.text)}</span>` },
    ], rows, dense: true }));
    $('#fr').insertAdjacentHTML('beforeend', `<p class="small muted mt-3">${esc(d.note)}</p>`);
  };
  $$('#kf button').forEach((b) => { b.onclick = () => { k = b.dataset.k; $$('#kf button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); draw(); }; });
  draw();
}
