/** Hand-rolled SVG charts (no dependency): scatter, histogram, line with band. Thin marks, recessive axes, hover tooltips. */
import { h, esc, num } from './ui.js';

const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)'];
function scale(domain, range) { const [d0, d1] = domain; const [r0, r1] = range; const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0); return (v) => r0 + (v - d0) * k; }
function ticks(d0, d1, n = 6) {
  const span = d1 - d0 || 1; const step0 = span / n; const mag = 10 ** Math.floor(Math.log10(step0)); const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag; const out = [];
  for (let v = Math.ceil(d0 / step) * step; v <= d1 + 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
function nice(domain, pad = 0.04) { let [a, b] = domain; if (a === b) { a -= 1; b += 1; } const p = (b - a) * pad; return [a - p, b + p]; }
function axes(W, H, m, xs, ys, xd, yd, xLabel, yLabel, { integerX = false, xFmt } = {}) {
  const xt = ticks(xd[0], xd[1], 7).filter((t) => !integerX || Number.isInteger(t)); const yt = ticks(yd[0], yd[1], 6);
  const fx = xFmt || ((t) => num(t, 2));
  return `<g class="axis">${yt.map((t) => `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${ys(t)}" y2="${ys(t)}"/>`).join('')}
  <line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>
  ${xt.map((t) => `<text x="${xs(t)}" y="${H - m.b + 16}" text-anchor="middle">${fx(t)}</text>`).join('')}
  ${yt.map((t) => `<text x="${m.l - 8}" y="${ys(t) + 3.5}" text-anchor="end">${num(t, 2)}</text>`).join('')}
  <text class="label" x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle">${esc(xLabel)}</text>
  <text class="label" transform="translate(12,${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text></g>`;
}
function tooltip(container) { const tip = h('<div class="chart-tip" role="status"></div>'); container.appendChild(tip); return tip; }

/** Scatter plot. points: [{x,y,...}]; colorKey → categorical slot by `groups` order (max 3, rest muted). */
export function scatter(container, points, { xLabel, yLabel, colorKey, groups = [], onPick, tipFn, W = 720, H = 420, logX = false }) {
  container.classList.add('chart'); container.innerHTML = '';
  if (!points.length) { container.innerHTML = '<div class="empty" style="padding:48px">No points match the current filters.</div>'; return; }
  const m = { l: 56, r: 16, t: 12, b: 44 };
  const tx = (v) => (logX ? Math.log10(v) : v);
  const xs0 = points.map((p) => tx(p.x)); const ys0 = points.map((p) => p.y);
  const xd = nice([Math.min(...xs0), Math.max(...xs0)]); const yd = nice([Math.min(...ys0), Math.max(...ys0)]);
  const xs = scale(xd, [m.l, W - m.r]); const ys = scale(yd, [H - m.b, m.t]);
  const slot = (p) => { if (!colorKey) return 0; const i = groups.indexOf(p[colorKey]); return i >= 0 && i < 3 ? i : -1; };
  const color = (p) => { const s = slot(p); return s >= 0 ? SERIES[s] : 'var(--s-muted)'; };
  const sorted = colorKey ? [...points].sort((a, b) => (slot(a) >= 0 ? 1 : 0) - (slot(b) >= 0 ? 1 : 0)) : points;
  const r = points.length > 3000 ? 2.2 : points.length > 800 ? 3 : 4;
  const isYear = xLabel.toLowerCase().includes('year');
  const ax = axes(W, H, m, xs, ys, xd, yd, logX ? `${xLabel} (log scale)` : xLabel, yLabel, { integerX: isYear || logX, xFmt: logX ? (t) => num(10 ** t, 4) : undefined });
  const svg = h(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Scatter plot of ${yLabel} against ${xLabel}, ${points.length} points`)}">${ax}<g class="marks">${sorted.map((p) => `<circle cx="${xs(tx(p.x)).toFixed(1)}" cy="${ys(p.y).toFixed(1)}" r="${r}" fill="${color(p)}" fill-opacity="${points.length > 2000 ? 0.55 : 0.75}" stroke="var(--surface)" stroke-width="0.6"/>`).join('')}</g><circle class="hl" r="${r + 3}" fill="none" stroke="var(--fg)" stroke-width="1.5" style="display:none"/></svg>`);
  container.appendChild(svg); const tip = tooltip(container); const hl = svg.querySelector('.hl');
  let near = null;
  const nearest = (ev) => { const rect = svg.getBoundingClientRect(); const px = (ev.clientX - rect.left) * (W / rect.width); const py = (ev.clientY - rect.top) * (H / rect.height); let best = null; let bd = 14 * 14; for (const p of points) { const dx = xs(tx(p.x)) - px; const dy = ys(p.y) - py; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = p; } } return best; };
  svg.addEventListener('mousemove', (ev) => { const p = nearest(ev); near = p; if (!p) { tip.classList.remove('show'); hl.style.display = 'none'; return; } const rect = svg.getBoundingClientRect(); hl.setAttribute('cx', xs(tx(p.x))); hl.setAttribute('cy', ys(p.y)); hl.style.display = ''; tip.innerHTML = tipFn ? tipFn(p) : `${esc(xLabel)}: ${num(p.x, 3)}<br>${esc(yLabel)}: ${num(p.y, 3)}`; tip.style.left = `${(xs(tx(p.x)) / W) * rect.width}px`; tip.style.top = `${(ys(p.y) / H) * rect.height}px`; tip.classList.add('show'); });
  svg.addEventListener('mouseleave', () => { tip.classList.remove('show'); hl.style.display = 'none'; });
  if (onPick) { svg.style.cursor = 'crosshair'; svg.addEventListener('click', () => { if (near) onPick(near); }); }
  if (colorKey && groups.length) container.appendChild(h(`<div class="legend">${groups.slice(0, 3).map((g, i) => `<span><i style="background:${SERIES[i]}"></i>${esc(g)}</span>`).join('')}${points.some((p) => slot(p) < 0) ? '<span><i style="background:var(--s-muted)"></i>Other</span>' : ''}</div>`));
}

/** Histogram of numeric values. */
export function histogram(container, values, { xLabel, bins = 30, W = 720, H = 300, highlight, tipFn }) {
  container.classList.add('chart'); container.innerHTML = '';
  if (!values.length) { container.innerHTML = '<div class="empty" style="padding:48px">No values match the current filters.</div>'; return null; }
  const m = { l: 56, r: 16, t: 12, b: 44 }; const lo = Math.min(...values); const hi = Math.max(...values); const span = hi - lo || 1; const bw = span / bins;
  const counts = new Array(bins).fill(0); values.forEach((v) => { counts[Math.min(bins - 1, Math.floor((v - lo) / bw))] += 1; });
  const xd = [lo, hi]; const yd = [0, Math.max(...counts) * 1.05]; const xs = scale(xd, [m.l, W - m.r]); const ys = scale(yd, [H - m.b, m.t]);
  const w = (W - m.l - m.r) / bins;
  const svg = h(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Histogram of ${xLabel}, ${values.length} values`)}">${axes(W, H, m, xs, ys, xd, yd, xLabel, 'Records')}<g>${counts.map((c, i) => { const x0 = m.l + i * w; const y = ys(c); const hgt = H - m.b - y; return `<rect data-i="${i}" x="${(x0 + 1).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0.5, w - 2).toFixed(1)}" height="${hgt.toFixed(1)}" rx="${Math.min(3, w / 3)}" fill="${highlight && highlight(lo + i * bw, lo + (i + 1) * bw) ? SERIES[1] : SERIES[0]}"/>`; }).join('')}</g></svg>`);
  container.appendChild(svg); const tip = tooltip(container);
  svg.querySelectorAll('rect').forEach((rc) => { rc.addEventListener('mouseenter', () => { const i = +rc.dataset.i; const rect = svg.getBoundingClientRect(); tip.innerHTML = tipFn ? tipFn(lo + i * bw, lo + (i + 1) * bw, counts[i]) : `${num(lo + i * bw, 2)} – ${num(lo + (i + 1) * bw, 2)}: <b>${counts[i]}</b> records`; tip.style.left = `${((+rc.getAttribute('x') + w / 2) / W) * rect.width}px`; tip.style.top = `${(+rc.getAttribute('y') / H) * rect.height}px`; tip.classList.add('show'); }); rc.addEventListener('mouseleave', () => tip.classList.remove('show')); });
  return { lo, hi, counts, bw };
}

/** Line chart with optional IQR band per series: series [{name, points:[{x,y,lo,hi,n}]}]. */
export function lines(container, series, { xLabel, yLabel, W = 720, H = 320, tipFn }) {
  container.classList.add('chart'); container.innerHTML = '';
  const all = series.flatMap((s) => s.points); if (!all.length) { container.innerHTML = '<div class="empty" style="padding:48px">No data.</div>'; return; }
  const m = { l: 56, r: 16, t: 12, b: 44 }; const xd = [Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.x))];
  const yd = nice([Math.min(...all.map((p) => p.lo ?? p.y)), Math.max(...all.map((p) => p.hi ?? p.y))], 0.08);
  const xs = scale(xd, [m.l, W - m.r]); const ys = scale(yd, [H - m.b, m.t]);
  const path = (pts, key) => pts.map((p, i) => `${i ? 'L' : 'M'}${xs(p.x).toFixed(1)},${ys(p[key]).toFixed(1)}`).join(' ');
  const band = (pts) => pts.some((p) => p.lo !== undefined) ? `M${pts.map((p) => `${xs(p.x).toFixed(1)},${ys(p.hi).toFixed(1)}`).join(' L')} L${[...pts].reverse().map((p) => `${xs(p.x).toFixed(1)},${ys(p.lo).toFixed(1)}`).join(' L')} Z` : '';
  const svg = h(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`${yLabel} by ${xLabel}`)}">${axes(W, H, m, xs, ys, xd, yd, xLabel, yLabel, { integerX: true, xFmt: (t) => String(t) })}${series.map((s, i) => `<path d="${band(s.points)}" fill="${SERIES[i]}" fill-opacity="0.10"/><path d="${path(s.points, 'y')}" fill="none" stroke="${SERIES[i]}" stroke-width="2" stroke-linejoin="round"/>${s.points.map((p) => `<circle cx="${xs(p.x)}" cy="${ys(p.y)}" r="3.5" fill="${SERIES[i]}" stroke="var(--surface)" stroke-width="1.5"/>`).join('')}`).join('')}<line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="var(--border-strong)" stroke-dasharray="3 3" style="display:none"/></svg>`);
  container.appendChild(svg); const tip = tooltip(container); const cross = svg.querySelector('.cross');
  svg.addEventListener('mousemove', (ev) => { const rect = svg.getBoundingClientRect(); const px = (ev.clientX - rect.left) * (W / rect.width); const xsAll = [...new Set(all.map((p) => p.x))]; let best = xsAll[0]; xsAll.forEach((x) => { if (Math.abs(xs(x) - px) < Math.abs(xs(best) - px)) best = x; }); cross.setAttribute('x1', xs(best)); cross.setAttribute('x2', xs(best)); cross.style.display = ''; const rows = series.map((s, i) => { const p = s.points.find((q) => q.x === best); return p ? `<span style="color:${SERIES[i]}">●</span> ${esc(s.name)}: <b>${num(p.y, 2)}</b>${p.n !== undefined ? ` (n=${p.n})` : ''}` : ''; }).filter(Boolean); tip.innerHTML = tipFn ? tipFn(best, series) : `<b>${best}</b><br>${rows.join('<br>')}`; tip.style.left = `${(xs(best) / W) * rect.width}px`; tip.style.top = `${(m.t / H) * rect.height + 10}px`; tip.classList.add('show'); });
  svg.addEventListener('mouseleave', () => { tip.classList.remove('show'); cross.style.display = 'none'; });
  container.appendChild(h(`<div class="legend">${series.map((s, i) => `<span><i style="background:${SERIES[i]}"></i>${esc(s.name)}</span>`).join('')}</div>`));
}

/** Horizontal bars. items: [{label, value, n?, sub?, hl?, doi?}]. Click → onPick(item). */
export function hbars(container, items, { xLabel = '', fmt = (v) => num(v, 2), onPick, W = 420, compact = false } = {}) {
  container.classList.add('chart'); container.innerHTML = '';
  if (!items.length) { container.innerHTML = '<div class="small muted">no groups</div>'; return; }
  const rowH = compact ? 18 : 22; const hasSub = items.some((i) => i.sub); const m = { l: Math.min(170, 8 + 6.6 * Math.min(24, Math.max(...items.map((i) => i.label.length)))), r: compact ? 44 : hasSub ? 168 : 110, t: 4, b: xLabel ? 20 : 4 }; const H = m.t + m.b + rowH * items.length;
  const max = Math.max(...items.map((i) => i.value || 0)) || 1; const xs = (v) => m.l + ((W - m.l - m.r) * v) / max;
  const svg = h(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(xLabel || 'bars')}">${items.map((it, i) => { const y = m.t + i * rowH; const w = Math.max(1, xs(it.value) - m.l); return `<g class="bar" data-i="${i}" style="${onPick && it.doi ? 'cursor:pointer' : ''}"><text class="lab" x="${m.l - 6}" y="${y + rowH * 0.68}" text-anchor="end">${esc(it.label.length > 24 ? `${it.label.slice(0, 23)}…` : it.label)}</text><rect x="${m.l}" y="${y + 3}" width="${w.toFixed(1)}" height="${rowH - 6}" rx="3" fill="${it.hl ? SERIES[1] : SERIES[0]}" fill-opacity="${it.hl ? 0.95 : 0.75}"/><text class="val" x="${m.l + w + 5}" y="${y + rowH * 0.68}">${esc(fmt(it.value))}${it.n != null && !compact ? ` <tspan class="n">n=${num(it.n, 0)}</tspan>` : ''}${it.sub && !compact ? ` <tspan class="n">${esc(it.sub)}</tspan>` : ''}</text></g>`; }).join('')}${xLabel ? `<text class="label" x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle">${esc(xLabel)}</text>` : ''}</svg>`);
  container.appendChild(svg);
  if (onPick) svg.querySelectorAll('g.bar').forEach((g) => { g.addEventListener('click', () => onPick(items[+g.dataset.i])); });
}

/** Vertical bars over ordered categories (binned data). items: [{label, value, hl?}]. */
export function vbars(container, items, { xLabel = '', yLabel = '', fmt = (v) => num(v, 0), W = 420, H = 200 } = {}) {
  container.classList.add('chart'); container.innerHTML = '';
  if (!items.length) { container.innerHTML = '<div class="small muted">no bins</div>'; return; }
  const m = { l: 44, r: 8, t: 10, b: 40 }; const max = Math.max(...items.map((i) => i.value || 0)) || 1; const bw = (W - m.l - m.r) / items.length; const ys = (v) => H - m.b - ((H - m.b - m.t) * v) / max;
  const yt = ticks(0, max, 4);
  const svg = h(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel || 'bars')}"><g class="axis">${yt.map((t) => `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${ys(t)}" y2="${ys(t)}"/><text x="${m.l - 6}" y="${ys(t) + 3.5}" text-anchor="end">${num(t, 0)}</text>`).join('')}<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/></g>${items.map((it, i) => `<g><rect x="${(m.l + i * bw + 1).toFixed(1)}" y="${ys(it.value).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${(H - m.b - ys(it.value)).toFixed(1)}" rx="2" fill="${it.hl ? SERIES[1] : SERIES[0]}"><title>${esc(it.label)}: ${esc(fmt(it.value))}</title></rect>${items.length <= 16 || i % 2 === 0 ? `<text class="axis-t" x="${m.l + i * bw + bw / 2}" y="${H - m.b + 14}" text-anchor="middle">${esc(it.label)}</text>` : ''}</g>`).join('')}${xLabel ? `<text class="label" x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle">${esc(xLabel)}</text>` : ''}${yLabel ? `<text class="label" transform="translate(11,${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>` : ''}</svg>`);
  container.appendChild(svg);
}
