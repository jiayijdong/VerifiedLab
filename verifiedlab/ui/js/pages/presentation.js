/** Presentation screens: #/intro (title card) and #/finale (closing card). Full-bleed, animated, fed with live numbers from the API. */
import { esc, num, icon } from '../ui.js';
import { MODULES } from '../app.js';

const FLOW = [['book-open', 'Literature'], ['file-json', 'Structured records'], ['shield-check', 'Field-level verification'], ['database', 'Verified database'], ['brain-circuit', 'AI scientist']];

export async function render({ main, route, api }) {
  document.body.classList.add('presenting');
  main.className = 'main full';
  const finale = route.section === 'finale';
  let d = null; try { d = await api.overview(); } catch { d = null; }
  const stats = d ? [[d.corpus.records, 'papers, one verified record each'], [d.corpus.schema_fields, 'fields per record'], [Object.keys(d.reliability).length, 'categories with judged accuracy'], [d.servers.healthy || 0, 'open-weight model servers live']] : [];
  main.innerHTML = `<section class="pres ${finale ? 'finale' : 'intro'}" aria-label="${finale ? 'Closing' : 'Title'}">
    <div class="pres-glow"></div><div class="pres-grid"></div>
    <div class="pres-body">
      <div class="pres-mark a1"><span class="pres-badge">${icon('layout-grid', 30)}</span><span class="pres-word">VerifiedLab</span></div>
      <div class="pres-tag a2">${finale ? 'Harnessing knowns for unknowns.' : 'A research workbench over verified literature'}</div>
      ${finale ? `
      <div class="pres-flow a3"><svg class="pres-line" viewBox="0 0 1000 8" preserveAspectRatio="none" aria-hidden="true"><path d="M0 4 H1000" pathLength="100"/></svg>
        ${FLOW.map(([ic, l], i) => `<div class="pres-node" style="animation-delay:${1.3 + i * 0.35}s"><span class="pres-node-ic">${icon(ic, 22)}</span><span>${esc(l)}</span></div>`).join('')}</div>
      <div class="pres-stats a4">${stats.map(([v, l]) => `<div class="pres-stat"><span class="v" data-v="${v}">0</span><span class="l">${esc(l)}</span></div>`).join('')}</div>
      <div class="pres-modules a5">${MODULES.map((m, i) => `<span class="pres-mod" style="animation-delay:${3.6 + i * 0.12}s" title="${esc(m.name)}">${icon(m.icon, 18)}<small>${esc(m.name)}</small></span>`).join('')}</div>
      <div class="pres-foot a6">Recorded from the live workspace · local open-weight models · released records</div>`
      : `<div class="pres-sub a3">Scientific literature → structured extraction → field-level verification → verified knowledge → AI scientist</div>
      <div class="pres-foot a4">Recorded from the live workspace · local open-weight models · released records</div>`}
    </div></section>`;
  if (finale) {
    const t0 = performance.now() + 2600; const els = [...main.querySelectorAll('.pres-stat .v')];
    const tick = () => { const t = performance.now(); let going = false; els.forEach((el) => { const target = +el.dataset.v; const p = Math.min(1, Math.max(0, (t - t0) / 1700)); const e = 1 - (1 - p) ** 3; el.textContent = num(Math.round(target * e), 0); if (p < 1) going = true; }); if (going || t < t0) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  return () => { document.body.classList.remove('presenting'); };
}
