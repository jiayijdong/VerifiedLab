/** Overview — the research workbench: next actions, recent runs, corpus and reliability at a glance. */
import { esc, pageHead, sectionHead, stat, kv, badge, loading, errorBox, fmtDate, ago, icon, num } from '../ui.js';
import { runTitle, runKindBadge } from '../record.js';
import { mountDevice, mountCloud, roleLegend } from '../device3d.js';

export async function render({ $, $$, replaceUrl, main, api, href }) {
  main.innerHTML = pageHead('Research workbench', 'Verified device records from 10,258 perovskite solar-cell papers, field-level verification and reliability-scoped research sessions.') + `<div id="ov">${loading(6)}</div>`;
  const el = main.querySelector('#ov');
  let d;
  try { d = await api.overview(); } catch (e) { el.innerHTML = errorBox(e); return; }
  const c = d.corpus; const live = d.servers.healthy > 0;
  const actions = [
    { icon: 'shield-check', t: 'Inspect the verified example record', s: `DOI ${c.hero_doi}: 97 fields, device note, ${d.runs.film} recorded field-level audits.`, href: href('verification', [], { doi: c.hero_doi }) },
    { icon: 'inbox', t: 'Work the verification queue', s: `${num(c.flagged, 0)} released records fail a deterministic stack-consistency rule and want a human look.`, href: href('verification', ['queue']) },
    { icon: 'brain-circuit', t: live ? 'Ask the AI Scientist a key question' : 'Replay a recorded research session', s: live ? `${d.key_questions} key questions of the field with fixed evidence recipes; or ask your own.` : `${d.runs.investigations} investigations on disk; live sessions need the model servers (currently offline).`, href: href('scientist', live ? ['questions'] : []) },
    { icon: 'chart-scatter', t: 'Explore the bandgap window', s: 'Reverse-scan PCE against bandgap for every record that reports both; filter by architecture or family.', href: href('explorer') },
  ];
  el.innerHTML = `<div class="hero3d">
    <div class="card"><div class="hero-cap"><div><h3>Verified example record</h3><div class="s">DOI ${esc(c.hero_doi)} · rendered from <span class="mono">Cell_stack_sequence</span> and the reported thicknesses</div></div><span class="spacer" style="flex:1"></span><a class="btn btn-sm" href="${href('verification', [], { doi: c.hero_doi })}">${icon('shield-check', 13)}Inspect</a></div><div id="hero-dev" style="height:360px"></div></div>
    <div class="card"><div class="hero-cap"><div><h3>The corpus in 3D</h3><div class="s">bandgap × reverse-scan PCE × year · one point per paper</div></div><span class="spacer" style="flex:1"></span><a class="btn btn-sm" href="${href('explorer', ['space'])}">${icon('box', 13)}Open</a></div><div id="hero-cloud" style="height:360px"></div></div>
  </div>
  <div class="grid" style="grid-template-columns: minmax(0, 1.6fr) minmax(280px, 1fr)">
    <div>
      <section class="section">${sectionHead('Next steps')}<div class="card pad-0">${actions.map((a) => `<a class="row-link" href="${a.href}">${icon(a.icon, 18)}<span class="grow"><span class="t">${esc(a.t)}</span><span class="s">${esc(a.s)}</span></span>${icon('chevron-right', 16)}</a>`).join('')}</div></section>
      <section class="section">${sectionHead('Recent activity', `${d.runs.film + d.runs.investigations} runs on disk`, `<a class="small" href="${href('workflows')}">All workflow runs</a>`)}
        <div class="card pad-0">${d.runs.latest.length ? d.runs.latest.map((r) => `<a class="row-link" href="${href(r.kind === 'film' ? 'workflows' : 'scientist', r.kind === 'film' ? ['run', r.id] : ['session', r.id])}"><span class="grow"><span class="t">${esc(runTitle(r))}</span><span class="s">${r.kind === 'film' ? `${r.accepted ?? '–'}/${r.fields ?? '–'} fields accepted · ${r.llm_calls ?? '–'} model calls` : `${r.supported ?? 0} supported · ${r.withheld ?? 0} withheld · ${r.evidence_items ?? 0} evidence items`}${r.started ? ` · ${ago(r.started)}` : ''}</span></span>${runKindBadge(r)}</a>`).join('') : `<div class="empty" style="border:0">${icon('inbox', 24)}<h3>No runs yet</h3><p>Runs appear here once a nine-chapter workflow or an investigation has been executed.</p></div>`}</div>
      </section>
    </div>
    <div class="col" style="gap: var(--sp-4)">
      <div class="card"><div class="card-head"><h3>Corpus</h3><span class="right small muted">released records</span></div>
        <div class="stat-row">${stat(num(c.records, 0), 'papers / records')}${stat(num(c.with_pce, 0), 'with reverse-scan PCE')}${stat(`${c.year_min}–${c.year_max}`, 'publication years')}${stat(num(c.journals, 0), 'journals')}</div>
        <div class="divider"></div>${kv([['Schema', `${c.schema_fields} fields in 7 categories`], ['Stability reported', `${num(c.with_stability, 0)} records`], ['Rule-flagged', `<a href="${href('verification', ['queue'])}">${num(c.flagged, 0)} records</a>`], ['Dataset', `<span class="mono small" title="${esc(c.dataset)}">${esc(c.dataset.split('/').slice(-2).join('/'))}</span>`]])}</div>
      <div class="card"><div class="card-head"><h3>Reliability by category</h3><span class="right small muted">threshold ${d.threshold} %</span></div>
        ${Object.entries(d.reliability).map(([cat, r]) => `<div class="row" style="padding:4px 0;gap:var(--sp-3)"><span class="small" style="width:132px">${esc(cat)}</span><span class="meter grow"><b class="${r > d.threshold ? '' : 'warn'}" style="width:${r}%"></b><s style="left:${d.threshold}%"></s></span><span class="small tnum" style="width:56px;text-align:right">${r.toFixed(2)} %</span></div>`).join('')}
        <p class="small muted mt-3" style="margin-bottom:0">${esc(d.reliability_scope)} <a href="${href('verification', ['reliability'])}">Field reliability</a></p></div>
      <div class="card"><div class="card-head"><h3>Models & skills</h3></div>
        ${kv([['Model servers', d.servers.configured ? (live ? badge(`${d.servers.healthy} of ${d.servers.total} healthy`, 'ok') : badge(`${d.servers.total} configured, offline`, 'warn')) : badge('not configured', 'neutral')], ...d.skills.map((s) => [s.name, `<span class="mono">v${esc(s.version)}</span>`])])}
        <p class="small muted mt-3" style="margin-bottom:0">${live ? 'Live agents run on local open-weight models inside the Slurm allocation.' : 'Live agent features are disabled until the vLLM servers are up; recorded runs, records and evidence stay inspectable.'} <a href="${href('settings')}">Settings</a></p></div>
    </div></div>`;
  const disposers = [];
  api.record(c.hero_doi).then((r) => { const host = el.querySelector('#hero-dev'); if (host) disposers.push(mountDevice(host, r.record, { height: 360, explode: 0.35 })); }).catch(() => {});
  api.explore({ x: 'bandgap', y: 'pce', z: 'year' }).then((d) => { const host = el.querySelector('#hero-cloud'); if (host) disposers.push(mountCloud(host, d.points, { x: { label: d.x.label }, y: { label: d.y.label }, z: { label: d.z.label } }, { height: 360, colorBy: 'pce', onPick: (q) => { location.hash = href('literature', ['paper', q.doi]); }, tipFn: (q) => `<b>${esc(q.doi)}</b><span>${num(q.x, 2)} eV · ${num(q.y, 2)} % · ${q.year ? num(q.year, 0) : ''}</span><span class="muted">${esc(q.arch)} · ${esc(q.family)}</span>` })); }).catch(() => {});
  return () => disposers.forEach((f) => f());
}
