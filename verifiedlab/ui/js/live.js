/** Live-run instrumentation shared by the AI Scientist session and the harness run: the allocation strip (one cell per GPU,
 *  lit while a call runs on its server) and the agent-call log. Both are driven by the server-sent events of a run. */
import { h, esc, icon } from './ui.js';
import { api } from './api.js';

const ROLE_CLASS = { pi: 'p', critic: 'p', generator: 'g', specialist: 'g', verifier_a: 'v', verifier_b: 'v' };

export function createLivePanel(container) {
  container.innerHTML = `<div class="card"><div class="card-head"><h3>Allocation</h3><span class="right small muted trunc" id="lp-who" style="max-width:60%">idle</span></div>
      <div class="alloc" id="lp-strip"><span class="small muted">loading servers…</span></div>
      <div class="legend" style="margin-bottom:0"><span><i style="background:var(--s1)"></i>PI · critic</span><span><i style="background:var(--s2)"></i>generator · specialists</span><span><i style="background:var(--s3)"></i>verifiers</span></div>
      <div class="small muted mt-2" id="lp-badge"></div></div>
    <div class="card mt-4"><div class="card-head"><h3>Agent calls</h3><span class="right small muted" id="lp-n">0</span></div><div class="calllog" id="lp-log"><span class="small muted">No calls yet.</span></div></div>`;
  const strip = container.querySelector('#lp-strip'); const who = container.querySelector('#lp-who'); const log = container.querySelector('#lp-log'); const nEl = container.querySelector('#lp-n'); const badgeEl = container.querySelector('#lp-badge');
  const SLOT = {}; const busy = {}; let count = 0;
  api.servers().then((s) => {
    strip.innerHTML = '';
    if (!s.servers.length) { strip.innerHTML = '<span class="small muted">No model servers configured.</span>'; return; }
    const nodes = {}; s.servers.forEach((sv) => { (nodes[sv.node] ||= []).push(sv); });
    Object.entries(nodes).forEach(([node, svs]) => {
      const row = h(`<div class="alloc-node"><span class="mono small" style="width:84px">${esc(node)}</span><span class="cells"></span><span class="small muted trunc">${esc([...new Set(svs.map((x) => x.model.split('/').pop()))].join(', '))}</span></div>`);
      const cells = row.querySelector('.cells');
      for (let gi = 0; gi < 4; gi += 1) {
        const sv = svs.find((x) => x.gpus.split(',').includes(String(gi)));
        const c = h(`<i class="cell ${sv && !sv.healthy ? 'down' : ''}" title="${sv ? `${esc(sv.name)} · ${esc(sv.model.split('/').pop())}${sv.healthy ? '' : ' · down'}` : 'unused'}"></i>`);
        if (sv) (SLOT[sv.name] ||= []).push(c);
        cells.appendChild(c);
      }
      strip.appendChild(row);
    });
  }).catch(() => { strip.innerHTML = '<span class="small muted">Server list unavailable.</span>'; });
  const short = (m) => (m || '').split('/').pop();
  function light(e, on) {
    const cls = ROLE_CLASS[e.role] || 'v';
    (SLOT[e.server] || []).forEach((c) => { c.className = on ? `cell on ${cls}` : 'cell'; });
    busy[e.server] = on ? e.tag : null;
    const b = Object.entries(busy).filter(([, v]) => v).map(([k, v]) => `${v}@${k}`);
    who.textContent = b.length ? b.join(' · ') : 'idle'; who.title = who.textContent;
  }
  function line(html, cls = '') {
    if (count === 0) log.innerHTML = '';
    count += 1; nEl.textContent = count;
    log.prepend(h(`<div class="cl ${cls}">${html}</div>`));
    while (log.children.length > 80) log.lastChild.remove();
  }
  function handle(e) {
    switch (e.type) {
      case 'call_start': light(e, true); line(`<b>▶ ${esc(e.tag)}</b> ${esc(short(e.model))} · ${esc(e.node)} gpu ${esc(e.gpus)}`); break;
      case 'call_end': light(e, false); line(`<b>${esc(e.tag)}</b> ${e.seconds}s · ${e.prompt_tokens}+${e.completion_tokens} tok${e.failed ? ' · failed' : ''}`, e.failed ? 'err' : ''); break;
      case 'call_retry': line(`retry ${esc(e.tag)} on ${esc(e.server)} (attempt ${e.attempt + 1}): ${esc(e.error)}`, 'note'); break;
      case 'log': line(esc(e.text), e.level === 'note' ? 'note' : 'dim'); break;
      case 'error': line(esc(e.text), 'err'); break;
      case 'progress': who.textContent = `cohort audit ${e.done}/${e.total} · ${e.server}@${e.node}`; break;
      default: break;
    }
  }
  function reset() { log.innerHTML = '<span class="small muted">No calls yet.</span>'; count = 0; nEl.textContent = '0'; Object.keys(busy).forEach((k) => { busy[k] = null; }); who.textContent = 'idle'; Object.values(SLOT).flat().forEach((c) => { c.className = 'cell'; }); }
  function badge(text) { badgeEl.textContent = text; }
  return { handle, reset, badge, line };
}

/** Open a text resource (device note, Skill, policy, artifact) in a drawer. */
export async function openText(title, url, drawerFn, loadingFn, errorFn) {
  const d = drawerFn(title, loadingFn(8), { modal: true });
  try { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); const t = await r.text(); d.querySelector('.drawer-body').innerHTML = `<div class="row mb-3"><a class="btn btn-sm" href="${url}" target="_blank" rel="noopener">${icon('external-link', 13)}Open raw</a></div><pre class="code" style="max-height:70vh">${esc(t)}</pre>`; }
  catch (e) { d.querySelector('.drawer-body').innerHTML = errorFn(e); }
}
