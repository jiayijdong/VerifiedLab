/** VerifiedLab shell: module registry, hash router, App Launcher (native Popover API), contextual sidebar, breadcrumbs. */
import { icon } from './icons.js';
import { $, $$, h, esc, toast, planned } from './ui.js';
import { api } from './api.js';

/* ------------------------------------------------------------------ modules (Level 1 navigation) */
export const MODULES = [
  { id: 'overview', name: 'Overview', icon: 'layout-dashboard', blurb: 'Research workbench', nav: [
    { id: '', label: 'Workbench', icon: 'layout-dashboard' },
  ] },
  { id: 'literature', name: 'Literature', icon: 'book-open', blurb: 'Verified device records by paper', nav: [
    { id: '', label: 'All papers', icon: 'library' },
    { id: 'collections', label: 'Collections', icon: 'bookmark', planned: true, why: 'Saved paper collections need a persistence layer; the demo back end is read-only.' },
    { id: 'import', label: 'Import literature', icon: 'upload', planned: true, why: 'Extraction ran on commercial API models outside this repository; the released records, not a re-run, are the reference artifact.' },
    { id: 'extraction', label: 'Extraction runs', icon: 'scan-search' },
  ] },
  { id: 'verification', name: 'Verification', icon: 'shield-check', blurb: 'Field-level evidence and audit', nav: [
    { id: '', label: 'Record inspector', icon: 'file-search' },
    { id: 'queue', label: 'Verification queue', icon: 'inbox' },
    { id: 'history', label: 'Audit history', icon: 'history' },
    { id: 'reliability', label: 'Field reliability', icon: 'gauge' },
  ] },
  { id: 'database', name: 'Database', icon: 'database', blurb: '10,258 structured records', nav: [
    { id: '', label: 'Records', icon: 'table' },
    { id: 'datacard', label: 'Data card', icon: 'file-text' },
  ] },
  { id: 'explorer', name: 'Explorer', icon: 'chart-scatter', blurb: 'Scientific data exploration', nav: [
    { id: '', label: 'Scatter', icon: 'chart-scatter' },
    { id: 'distribution', label: 'Distributions', icon: 'chart-no-axes-column' },
    { id: 'trend', label: 'Trend by year', icon: 'chart-line' },
    { id: 'space', label: '3D space', icon: 'box' },
    { id: 'cohorts', label: 'Saved cohorts', icon: 'bookmark', planned: true, why: 'Cohort saving exists in the terminal workspace (explore.py) but has no server-side store yet.' },
  ] },
  { id: 'scientist', name: 'AI Scientist', icon: 'brain-circuit', blurb: 'PI, librarian, specialists, critic', nav: [
    { id: '', label: 'Research sessions', icon: 'message-square' },
    { id: 'questions', label: 'Key questions', icon: 'circle-help' },
    { id: 'claims', label: 'Claims ledger', icon: 'scale' },
    { id: 'reports', label: 'Research reports', icon: 'file-text' },
  ] },
  { id: 'workflows', name: 'Workflows', icon: 'workflow', blurb: 'Agent runs, steps and traces', nav: [
    { id: '', label: 'Workflow runs', icon: 'list' },
    { id: 'pipeline', label: 'Pipeline', icon: 'route' },
    { id: 'film', label: 'Harness run', icon: 'play' },
  ] },
  { id: 'skills', name: 'Skills', icon: 'sliders-horizontal', blurb: 'Annotation and verification policies', nav: [
    { id: '', label: 'All skills', icon: 'sliders-horizontal' },
    { id: 'rules', label: 'Field rules', icon: 'scroll-text' },
  ] },
  { id: 'settings', name: 'Settings', icon: 'settings', blurb: 'Models, data, appearance', nav: [
    { id: '', label: 'Model placement', icon: 'server' },
    { id: 'data', label: 'Data & paths', icon: 'folder' },
    { id: 'appearance', label: 'Appearance', icon: 'eye' },
    { id: 'about', label: 'About', icon: 'info' },
  ] },
];
const byId = Object.fromEntries(MODULES.map((m) => [m.id, m]));
byId.presentation = { id: 'presentation', name: 'VerifiedLab', icon: 'layout-grid', blurb: 'Presentation', nav: [] };   // #/intro and #/finale, not in the launcher

/* ------------------------------------------------------------------ router */
export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart, query = ''] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
  if (segs[0] === 'intro' || segs[0] === 'finale') return { module: 'presentation', path: segs, section: segs[0], params: Object.fromEntries(new URLSearchParams(query)) };
  const module = byId[segs[0]] ? segs[0] : 'overview';
  const path = byId[segs[0]] ? segs.slice(1) : [];
  return { module, path, section: path[0] || '', params: Object.fromEntries(new URLSearchParams(query)) };
}
export function href(module, path = [], params = {}) {
  const p = [module, ...path.map((s) => encodeURIComponent(s))].join('/');
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null));
  return `#/${p}${q.toString() ? `?${q}` : ''}`;
}
export function navigate(module, path, params) { location.hash = href(module, path, params); }

let cleanup = null;
let current = null;
let renderEpoch = 0;
const pageCache = {};
async function route() {
  const r = parseHash();
  const mod = byId[r.module];
  closeLauncher();
  document.body.classList.remove('presenting');
  renderSidebar(r); renderLauncherActive(r.module);
  setCrumbs([{ label: mod.name, href: href(mod.id) }]);
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const host = $('#main'); host.className = 'main'; host.innerHTML = ''; host.scrollTop = 0;
  document.title = `${mod.name} · VerifiedLab`;
  current = r;
  // Each route renders into its own root. A page whose async work finishes after the user has moved on keeps writing
  // into its detached root (harmless) and its URL / breadcrumb / title updates are dropped by the `alive` guard.
  const epoch = ++renderEpoch;
  const page = document.createElement('div'); page.className = 'page'; host.appendChild(page);
  const alive = () => epoch === renderEpoch;
  try {
    pageCache[mod.id] ||= await import(`./pages/${mod.id}.js`);
    const ctx = { main: page, route: r, module: mod, navigate, href, api, alive,
      $: (sel, rootEl = page) => rootEl.querySelector(sel), $$: (sel, rootEl = page) => [...rootEl.querySelectorAll(sel)],
      setCrumbs: (items) => { if (alive()) setCrumbs(items); }, setTitle: (t) => { if (alive()) document.title = `${t} · ${mod.name} · VerifiedLab`; },
      replaceUrl: (hash) => { if (alive()) history.replaceState(null, '', hash); } };
    const ret = await pageCache[mod.id].render(ctx);
    if (typeof ret === 'function') { if (alive()) cleanup = ret; else ret(); }
  } catch (e) {
    console.error(e);
    if (alive()) page.innerHTML = `<div class="callout bad">${icon('circle-alert', 16)}<div><b>This page failed to render.</b> ${esc(e.message)}</div></div>`;
  }
  $('#shell').classList.remove('mobile-open');
}

/* ------------------------------------------------------------------ breadcrumbs */
export function setCrumbs(items) {
  const el = $('#crumbs');
  el.innerHTML = items.map((it, i) => {
    const last = i === items.length - 1;
    const node = last || !it.href ? `<span class="${last ? 'cur' : ''}" ${last ? 'aria-current="page"' : ''}>${esc(it.label)}</span>` : `<a href="${it.href}">${esc(it.label)}</a>`;
    return (i ? `<span class="sep">${icon('chevron-right', 12)}</span>` : '') + node;
  }).join('');
}

/* ------------------------------------------------------------------ sidebar (Level 2 navigation) */
function renderSidebar(r) {
  const mod = byId[r.module];
  $('#sidebar-module').innerHTML = `${icon(mod.icon, 16)}<span>${esc(mod.name)}<small>${esc(mod.blurb)}</small></span>`;
  const nav = $('#sidebar-nav');
  nav.innerHTML = `<div class="nav-label">Sections</div>` + mod.nav.map((n) => {
    const active = n.id === r.section || (!n.id && !r.section) || (n.id && r.section === n.id);
    if (n.planned) return `<span class="nav-item planned" aria-disabled="true" title="${esc(n.why || 'Planned')}">${icon(n.icon, 16)}<span class="grow">${esc(n.label)}</span>${planned()}</span>`;
    return `<a class="nav-item ${active ? 'active' : ''}" href="${href(mod.id, n.id ? [n.id] : [])}" ${active ? 'aria-current="page"' : ''}>${icon(n.icon, 16)}<span class="grow">${esc(n.label)}</span></a>`;
  }).join('');
  const s = $('#nav-settings');
  s.innerHTML = `${icon('settings', 16)}<span class="grow">Settings</span>`;
  s.classList.toggle('active', r.module === 'settings');
}

/* ------------------------------------------------------------------ App Launcher */
const pop = $('#app-launcher'); const trig = $('#launcher-trigger'); const grid = $('#launcher-grid');
const supportsPopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

function renderLauncher() {
  grid.innerHTML = MODULES.map((m) => `<a class="launcher-item" role="listitem" href="${href(m.id)}" data-module="${m.id}" title="${esc(m.blurb)}">${icon(m.icon, 22)}<span>${esc(m.name)}</span></a>`).join('');
  $('#launcher-grip').innerHTML = icon('layout-grid', 14); $('#launcher-chev').innerHTML = icon('chevron-down', 14);
}
function renderLauncherActive(moduleId) {
  $$('.launcher-item', grid).forEach((a) => { const on = a.dataset.module === moduleId; a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
}
function isOpen() { return supportsPopover ? pop.matches(':popover-open') : pop.classList.contains('open'); }
function position() {
  const r = trig.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 336 - 8));
  pop.style.top = `${r.bottom + 6}px`; pop.style.left = `${left}px`;
}
function onToggle(open) {
  trig.setAttribute('aria-expanded', String(open));
  if (open) { position(); const cur = $('.launcher-item.active', grid) || $('.launcher-item', grid); cur && cur.focus({ preventScroll: true }); }
}
export function closeLauncher() {
  if (!isOpen()) return;
  if (supportsPopover) pop.hidePopover(); else { pop.classList.remove('open'); onToggle(false); }
}
function openLauncher() {
  if (isOpen()) return;
  if (supportsPopover) pop.showPopover(); else { pop.classList.add('open'); onToggle(true); }
}
function setupLauncher() {
  renderLauncher();
  if (supportsPopover) {
    pop.addEventListener('toggle', (e) => onToggle(e.newState === 'open'));
  } else {
    // Fallback (no Popover API): manual toggle, light dismiss and Escape.
    trig.addEventListener('click', (e) => { e.preventDefault(); isOpen() ? closeLauncher() : openLauncher(); });
    document.addEventListener('pointerdown', (e) => { if (isOpen() && !pop.contains(e.target) && !trig.contains(e.target)) closeLauncher(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) { closeLauncher(); trig.focus(); } });
  }
  window.addEventListener('resize', () => { if (isOpen()) position(); });
  // Keyboard grid navigation (3 × 3): arrows move, Home/End jump, Enter/Space follow the link.
  grid.addEventListener('keydown', (e) => {
    const items = $$('.launcher-item', grid); const i = items.indexOf(document.activeElement); if (i < 0) return;
    const map = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + 3, ArrowUp: i - 3, Home: 0, End: items.length - 1 };
    if (e.key in map) { e.preventDefault(); const j = Math.max(0, Math.min(items.length - 1, map[e.key])); items[j].focus(); }
  });
  // Global shortcut: Ctrl/⌘ + K opens the launcher.
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); isOpen() ? closeLauncher() : openLauncher(); } });
}

/* ------------------------------------------------------------------ sidebar collapse / mobile */
function setupSidebar() {
  const shell = $('#shell'); const btn = $('#sidebar-toggle'); btn.innerHTML = icon('panel-left', 16);
  let collapsed = false; try { collapsed = localStorage.getItem('vl.sidebar') === 'collapsed'; } catch { /* storage unavailable */ }
  const mobile = () => window.matchMedia('(max-width: 900px)').matches;
  const apply = () => { shell.classList.toggle('collapsed', collapsed && !mobile()); btn.setAttribute('aria-pressed', String(collapsed)); };
  apply();
  btn.onclick = () => { if (mobile()) { shell.classList.toggle('mobile-open'); return; } collapsed = !collapsed; try { localStorage.setItem('vl.sidebar', collapsed ? 'collapsed' : 'open'); } catch { /* ignore */ } apply(); };
  $('#scrim').onclick = () => shell.classList.remove('mobile-open');
  window.addEventListener('resize', apply);
  $('#user-avatar').innerHTML = icon('user', 14);
}

/* ------------------------------------------------------------------ top bar: model-server status */
async function serverPill() {
  const el = $('#topbar-right');
  el.innerHTML = `<span class="badge plain" id="server-pill" title="Checking model servers…">${icon('loader-circle', 12, 'spin')}models</span><button class="btn btn-ghost btn-sm btn-icon" id="theme-btn" type="button" aria-label="Toggle dark mode" title="Toggle dark mode"></button><a class="btn btn-ghost btn-sm" href="${href('workflows', ['film'])}" title="Run the full harness workflow live">${icon('play', 14)}Run</a>`;
  const tb = $('#theme-btn'); const paint = () => { tb.innerHTML = icon(isDark() ? 'sun' : 'moon', 15); }; paint(); tb.onclick = () => { setTheme(isDark() ? 'light' : 'dark'); paint(); };
  try {
    const s = await api.servers();
    const p = $('#server-pill');
    if (!s.configured) { p.className = 'badge plain'; p.innerHTML = `${icon('server', 12)}no model servers configured`; p.title = `No endpoints file at ${s.endpoints_file}. Launch the vLLM servers inside a Slurm allocation to enable live agents.`; }
    else if (s.healthy === 0) { p.className = 'badge warn'; p.innerHTML = `${icon('server', 12)}models offline`; p.title = `${s.total} configured endpoints, none healthy. Live agent features are disabled; recorded runs remain inspectable.`; }
    else { p.className = 'badge ok'; p.innerHTML = `${icon('server', 12)}${s.healthy}/${s.total} model servers`; p.title = 'Healthy vLLM endpoints'; }
    p.onclick = () => navigate('settings');
    p.style.cursor = 'pointer';
  } catch (e) { const p = $('#server-pill'); p.className = 'badge warn'; p.innerHTML = `${icon('server', 12)}status unavailable`; }
}

/* ------------------------------------------------------------------ theme */
export function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
export function applyTheme() { let t = 'system'; try { t = localStorage.getItem('vl.theme') || 'system'; } catch { /* ignore */ } const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.toggleAttribute('data-theme', dark); if (dark) document.documentElement.setAttribute('data-theme', 'dark'); document.dispatchEvent(new CustomEvent('vl:theme', { detail: { dark } })); }
export function setTheme(t) { try { localStorage.setItem('vl.theme', t); } catch { /* ignore */ } applyTheme(); const b = $('#theme-btn'); if (b) b.innerHTML = icon(isDark() ? 'sun' : 'moon', 15); }
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* ------------------------------------------------------------------ boot */
try { if (localStorage.getItem('vl.density') === 'compact') document.body.classList.add('dense'); } catch { /* ignore */ }
applyTheme(); setupLauncher(); setupSidebar(); serverPill();
window.addEventListener('hashchange', route);
if (!location.hash) history.replaceState(null, '', '#/overview');
route();
window.VerifiedLab = { MODULES, parseHash, href, navigate, closeLauncher, openLauncher, setTheme, applyTheme };
