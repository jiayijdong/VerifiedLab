/** Settings — model placement, data paths, appearance, about. Only settings the back end actually exposes. */
import { $$, esc, pageHead, sectionHead, kv, badge, table, loading, errorBox, icon, toast } from '../ui.js';

export async function render(ctx) {
  const s = ctx.route.section;
  if (s === 'data') return data(ctx);
  if (s === 'appearance') return appearance(ctx);
  if (s === 'about') return about(ctx);
  return models(ctx);
}

async function models({ $, $$, replaceUrl, main, api, href }) {
  main.innerHTML = pageHead('Model placement', 'Which served open-weight model plays which agent role, and the health of every vLLM endpoint. Placement is configured in code and the Slurm launch script; this page reads it.', `<button class="btn" id="rf">${icon('refresh-cw', 14)}Re-check health</button>`) + `<div id="m">${loading(6)}</div>`;
  async function load() {
    const [sv, ab] = await Promise.all([api.servers(), api.about()]).catch((e) => [null, null, e]);
    if (!sv) { $('#m').innerHTML = errorBox('servers unavailable'); return; }
    $('#m').innerHTML = `${sv.configured ? '' : `<div class="callout mb-4">${icon('info', 14)}<div><b>No endpoints file.</b> <code>${esc(sv.endpoints_file)}</code> is written by <code>slurm/launch_servers.sh</code> inside an allocation. Without it, live agent features stay disabled and every other page works from the released data and recorded runs.</div></div>`}
      <section class="section">${sectionHead('Roles', 'preference order; first healthy server wins')}<div class="table-wrap"><table class="table"><thead><tr><th>Role</th><th>Preferred servers</th><th>Resolved</th></tr></thead><tbody>${Object.entries(ab?.roles || {}).map(([r, prefs]) => { const v = sv.roles?.[r]; return `<tr><td><b>${esc(r)}</b></td><td class="mono small">${prefs.map(esc).join(' → ')}</td><td>${v && !v.error ? `${v.models.map((m) => esc(m.split('/').pop())).join(', ')} ${badge(`×${v.replicas}`, 'ok', false)} <span class="small muted">${v.servers.map(esc).join(', ')}</span>` : badge('no healthy server', 'warn')}</td></tr>`; }).join('')}</tbody></table></div></section>
      <section class="section">${sectionHead('Endpoints', sv.configured ? `${sv.healthy} of ${sv.total} healthy` : 'none configured')}<div class="table-wrap"><table class="table dense"><thead><tr><th>Server</th><th>Model</th><th>Node</th><th>GPUs</th><th>URL</th><th>Health</th></tr></thead><tbody>${sv.servers.map((s) => `<tr><td class="mono">${esc(s.name)}</td><td class="small">${esc(s.model)}</td><td class="mono small">${esc(s.node)}</td><td><span class="gpu">${[0, 1, 2, 3].map((g) => `<i class="${s.gpus.split(',').includes(String(g)) ? 'on' : ''}"></i>`).join('')}</span> <span class="small muted">${esc(s.gpus)}</span></td><td class="mono small">${esc(s.url)}</td><td>${s.healthy ? badge('healthy', 'ok') : badge('down', 'bad')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">No servers configured.</td></tr>'}</tbody></table></div></section>
      <p class="small muted">Edit <code>verifiedlab/config.py::ROLES</code> and <code>slurm/launch_servers.sh</code> to change placement. All weights are read offline from <code>$HF_HOME</code>; no external API is called.</p>`;
  }
  $('#rf').onclick = () => { $('#m').innerHTML = loading(6); load().then(() => toast('Health re-checked')); };
  load();
}

async function data({ $, $$, replaceUrl, main, api }) {
  main.innerHTML = pageHead('Data & paths', 'Where the workspace reads from. Override the dataset with VL_DATASET and the runs directory with VL_RUNS in the server\'s environment.') + `<div id="d">${loading(6)}</div>`;
  try { const a = await api.about(); $('#d').innerHTML = `<div class="card">${kv([['Dataset (parquet)', `<span class="mono small" style="overflow-wrap:anywhere">${esc(a.dataset)}</span>`], ['SHA-256', `<span class="mono small" style="overflow-wrap:anywhere">${esc(a.dataset_sha256)}</span>`], ['Runs directory', `<span class="mono small">${esc(a.runs_dir)}</span>`], ['Policies (Skills)', `<span class="mono small">${esc(a.policies_dir)}</span>`], ['Sources (device notes, PDFs)', `<span class="mono small">${esc(a.sources_dir)}</span> · place article PDFs at <code>sources/pdf/&lt;doi_folder&gt;.pdf</code>`], ['Endpoints file', `<span class="mono small">${esc(a.endpoints_file)}</span>`], ['Example record', `<span class="mono">${esc(a.hero_doi)}</span>`], ['Live fields', `${a.live_fields.length} of 97 generated in the harness run`], ['Python · pandas', `${esc(a.python)} · ${esc(a.pandas)}`]])}</div>`; }
  catch (e) { $('#d').innerHTML = errorBox(e); }
}

async function appearance({ $, $$, replaceUrl, main }) {
  const get = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  main.innerHTML = pageHead('Appearance', 'Per-browser preferences. Stored locally; nothing is sent to the server.') + `<div class="card" style="max-width:640px">
    <div class="field mb-4"><label>Density</label><div class="segmented" id="den"><button type="button" data-v="comfortable">Comfortable</button><button type="button" data-v="compact">Compact</button></div><span class="small muted mt-2">Compact reduces type size and table padding for dense data work.</span></div>
    <div class="field mb-4"><label>Sidebar on load</label><div class="segmented" id="sb"><button type="button" data-v="open">Expanded</button><button type="button" data-v="collapsed">Collapsed</button></div></div>
    <div class="field"><label>Theme</label><div class="segmented" id="th"><button type="button" data-v="light">${icon('sun', 13)} Light</button><button type="button" data-v="dark">${icon('moon', 13)} Dark</button><button type="button" data-v="system">${icon('monitor', 13)} System</button></div><span class="small muted mt-2">Both palettes live in <code>ui/css/tokens.css</code>; the 3D viewers read the active tokens.</span></div></div>`;
  const sync = () => { const th = get('vl.theme', 'system'); $$('#th button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === th))); const den = get('vl.density', 'comfortable'); document.body.classList.toggle('dense', den === 'compact'); $$('#den button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === den))); const sb = get('vl.sidebar', 'open'); $$('#sb button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === sb))); };
  $$('#den button').forEach((b) => { b.onclick = () => { set('vl.density', b.dataset.v); sync(); }; });
  $$('#th button').forEach((b) => { b.onclick = () => { window.VerifiedLab.setTheme(b.dataset.v); sync(); }; });
  $$('#sb button').forEach((b) => { b.onclick = () => { set('vl.sidebar', b.dataset.v); sync(); toast('Applies on next load'); }; });
  sync();
}

async function about({ $, $$, replaceUrl, main, api, href }) {
  main.innerHTML = pageHead('About', 'VerifiedLab: harnessing verified literature for AI scientists.') + `<div class="grid grid-2"><div class="card"><div class="card-head"><h3>What this workspace is</h3></div><p class="small">A research platform over the released verified device records: literature view, field-level verification studio, structured database, data explorer, a reliability-scoped AI scientist and inspectable agent workflows. Agent dialogue is generated live by open-weight models and varies between runs; queries, statistics, rule decisions, the gate and the written files are computed from the released records and are deterministic.</p><p class="small muted" style="margin-bottom:0">Category reliabilities are the data card's judged accuracies; they are not per-value confidence. The 85 % threshold is an illustrative policy. The cohort audit checks each record's internal consistency, not the source articles.</p></div>
    <div class="card"><div class="card-head"><h3>Links</h3></div>${kv([['Harness run', `<a href="${href('workflows', ['film'])}">the full workflow, executed live</a>`], ['Dataset repository', '<a href="https://github.com/jiayijdong/VerifiedLab" target="_blank" rel="noopener">jiayijdong/VerifiedLab</a>'], ['Pipeline', `<a href="${href('workflows', ['pipeline'])}">as implemented</a>`], ['Icons', 'Lucide (ISC) · <span class="mono small">ui/vendor/LUCIDE-LICENSE.txt</span>'], ['Front end', 'vanilla ES modules + CSS tokens, served by FastAPI; no build step']])}</div></div>`;
}
