/** Small rendering helpers shared by every page: escaping, elements, badges, tables, empty states, formatting. */
import { icon } from './icons.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Build an element from an HTML string (single root). */
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

export function isNull(v) { return v === null || v === undefined || v === '' || String(v).trim().toLowerCase() === 'null'; }
export function val(v, { mono = false } = {}) { return isNull(v) ? '<span class="null">Null</span>' : `<span class="${mono ? 'mono' : ''}">${esc(v)}</span>`; }
export function num(v, d = 2) { if (v === null || v === undefined || Number.isNaN(+v)) return '–'; const n = +v; return Number.isInteger(n) && d > 0 && Math.abs(n) >= 1000 ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: d }); }
export function pct(v, d = 1) { return v === null || v === undefined ? '–' : `${(+v).toFixed(d)} %`; }
export function fmtDate(iso) { if (!iso) return '–'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }
export function ago(iso) { if (!iso) return ''; const s = (Date.now() - new Date(iso).getTime()) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`; if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`; }
export function doiLink(doi, cls = '') { return isNull(doi) ? val(doi) : `<a class="doi ${cls}" href="https://doi.org/${encodeURIComponent(doi).replace(/%2F/g, '/')}" target="_blank" rel="noopener" title="Open at publisher">${esc(doi)}</a>`; }

const STATUS_ICON = { ok: 'circle-check', warn: 'triangle-alert', bad: 'circle-x', info: 'info', neutral: 'circle-dot' };
export function badge(text, kind = 'neutral', withIcon = true) { return `<span class="badge ${kind}">${withIcon && STATUS_ICON[kind] ? icon(STATUS_ICON[kind], 12) : ''}${esc(text)}</span>`; }
export function planned() { return `<span class="badge badge-planned" title="Not implemented yet">Planned</span>`; }

/** Verification label → status kind. */
export function labelKind(label) { return ['TP', 'TN', 'SUPPORTED', 'CONTINUE', 'PASS'].includes(label) ? 'ok' : ['FP', 'FN', 'FP_mismatch', 'FAIL'].includes(label) ? 'bad' : ['WITHHELD', 'HUMAN_REVIEW', 'HUMAN REVIEW'].includes(label) ? 'warn' : 'neutral'; }
export function labelBadge(label) { return isNull(label) ? '<span class="null">–</span>' : badge(label, labelKind(label)); }
export function relBadge(cat, rel, thr = 85) { const r = +rel; return `<span class="badge ${r > thr ? 'ok' : 'warn'}" title="Category judged accuracy (data card); not per-value confidence">${esc(cat)} · ${r.toFixed(2)} %</span>`; }
export function routeBadge(route) { return route === 'CONTINUE' ? badge('Continue', 'ok') : badge('Human review', 'warn'); }

export function empty(title, body, ic = 'inbox', action = '') { return `<div class="empty">${icon(ic, 28)}<h3>${esc(title)}</h3><p>${body}</p>${action}</div>`; }
export function loading(lines = 4) { return `<div class="col" aria-busy="true">${Array.from({ length: lines }, (_, i) => `<div class="skeleton" style="width:${[92, 70, 84, 55, 76][i % 5]}%"></div>`).join('')}</div>`; }
export function errorBox(err, retry = '') { return `<div class="callout bad">${icon('circle-alert', 16)}<div><b>Could not load.</b> ${esc(err?.message || err)}${retry}</div></div>`; }
export function kv(pairs) { return `<dl class="kv">${pairs.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`; }
export function pageHead(title, sub = '', actions = '') { return `<div class="page-head"><div class="titles"><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`; }
export function sectionHead(title, count = '', right = '') { return `<div class="section-head"><h2>${esc(title)}</h2>${count !== '' ? `<span class="count">${count}</span>` : ''}${right ? `<span class="right">${right}</span>` : ''}</div>`; }
export function stat(v, l, title = '') { return `<div class="stat" ${title ? `title="${esc(title)}"` : ''}><span class="v">${v}</span><span class="l">${l}</span></div>`; }

/** Sortable table. columns: [{key,label,num?,render?,sortable?,width?}] */
export function table({ columns, rows, sort, dir, onSort, rowClass, dense = false, emptyText = 'No rows.' }) {
  const wrap = h(`<div class="table-wrap"></div>`);
  const t = h(`<table class="table ${dense ? 'dense' : ''}"><thead><tr></tr></thead><tbody></tbody></table>`);
  const tr = t.tHead.rows[0];
  columns.forEach((c) => {
    const sorted = sort === c.key;
    const th = h(`<th class="${c.num ? 'num' : ''} ${sorted ? 'sorted' : ''}" ${c.width ? `style="width:${c.width}"` : ''} ${sorted ? `aria-sort="${dir === 'asc' ? 'ascending' : 'descending'}"` : ''}></th>`);
    if (c.sortable !== false && onSort) {
      const b = h(`<button type="button">${esc(c.label)}<span class="sort">${icon(sorted ? (dir === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down', 12)}</span></button>`);
      b.onclick = () => onSort(c.key, sorted && dir === 'desc' ? 'asc' : 'desc');
      th.appendChild(b);
    } else th.textContent = c.label;
    tr.appendChild(th);
  });
  if (!rows.length) t.tBodies[0].innerHTML = `<tr><td colspan="${columns.length}" class="muted" style="text-align:center;padding:28px">${esc(emptyText)}</td></tr>`;
  rows.forEach((r, i) => {
    const row = h(`<tr class="${rowClass ? rowClass(r, i) : ''}"></tr>`);
    columns.forEach((c) => { const td = h(`<td class="${c.num ? 'num' : ''} ${c.wrap ? 'wrap' : ''}" ${c.title ? `title="${esc(c.title(r))}"` : ''}></td>`); td.innerHTML = c.render ? c.render(r, i) : val(r[c.key]); row.appendChild(td); });
    t.tBodies[0].appendChild(row);
  });
  wrap.appendChild(t);
  return wrap;
}

export function pager({ page, pages, total, size, onPage, onSize }) {
  const el = h(`<div class="pager"><span>${total.toLocaleString()} rows · page ${page} of ${pages}</span><span class="spacer"></span></div>`);
  if (onSize) { const s = h(`<select class="select btn-sm" aria-label="Rows per page">${[25, 50, 100, 200].map((n) => `<option ${n === size ? 'selected' : ''} value="${n}">${n} / page</option>`).join('')}</select>`); s.onchange = () => onSize(+s.value); el.appendChild(s); }
  const mk = (ic, p, label) => { const b = h(`<button class="btn btn-ghost btn-sm btn-icon" type="button" aria-label="${label}" ${p < 1 || p > pages ? 'disabled' : ''}>${icon(ic, 14)}</button>`); b.onclick = () => onPage(p); return b; };
  el.append(mk('chevrons-left', 1, 'First page'), mk('chevron-left', page - 1, 'Previous page'), mk('chevron-right', page + 1, 'Next page'), mk('chevrons-right', pages, 'Last page'));
  return el;
}

export function toast(msg, ms = 3200) { const t = h(`<div class="toast">${esc(msg)}</div>`); $('#toasts').appendChild(t); setTimeout(() => t.remove(), ms); }

/** Right-side drawer dialog. */
export function drawer(title, bodyHtml, { modal = false } = {}) {
  $$('dialog.drawer, dialog.modal').forEach((d) => d.remove());
  const d = h(`<dialog class="${modal ? 'modal' : 'drawer'}"><div class="drawer-head"><span class="grow trunc">${esc(title)}</span><button class="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Close">${icon('x', 16)}</button></div><div class="drawer-body"></div></dialog>`);
  d.querySelector('.drawer-body').innerHTML = bodyHtml;
  d.querySelector('button').onclick = () => d.close();
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  d.addEventListener('close', () => d.remove());
  document.body.appendChild(d); d.showModal();
  return d;
}

/** Minimal Markdown → HTML for the brief and skill files (headings, lists, code fences, inline code, bold). */
export function md(src) {
  const lines = String(src || '').split('\n'); let out = ''; let inCode = false; let inList = null;
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const closeList = () => { if (inList) { out += `</${inList}>`; inList = null; } };
  for (const raw of lines) {
    if (raw.startsWith('```')) { closeList(); inCode = !inCode; out += inCode ? '<pre>' : '</pre>'; continue; }
    if (inCode) { out += `${esc(raw)}\n`; continue; }
    const hm = raw.match(/^(#{1,4})\s+(.*)/); if (hm) { closeList(); out += `<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`; continue; }
    const ul = raw.match(/^\s*[-*]\s+(.*)/); const ol = raw.match(/^\s*\d+\.\s+(.*)/);
    if (ul || ol) { const kind = ul ? 'ul' : 'ol'; if (inList !== kind) { closeList(); out += `<${kind}>`; inList = kind; } out += `<li>${inline((ul || ol)[1])}</li>`; continue; }
    closeList(); if (raw.trim()) out += `<p>${inline(raw)}</p>`;
  }
  closeList(); if (inCode) out += '</pre>';
  return `<div class="prose">${out}</div>`;
}

export function download(filename, content, type = 'text/plain') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
export function debounce(fn, ms = 250) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export { icon };
