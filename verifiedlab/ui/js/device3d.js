/**
 * 3D rendering for VerifiedLab (three.js, vendored under ui/vendor/three, resolved through the import map in index.html).
 *  - mountDevice(el, record, opts): a perovskite solar cell rendered layer by layer from Cell_stack_sequence, with PBR materials,
 *    measured thicknesses where the record reports them, an explode slider, hover provenance and photons entering through the substrate.
 *  - mountCloud(el, points, opts): a 3D point cloud of the corpus (one point per paper) with axes, hover and click-through to the record.
 * Every mount returns a disposer; pages call it from their cleanup so WebGL contexts never leak across routes.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { esc, isNull, h, icon } from './ui.js';

/* ------------------------------------------------------------------ layer chemistry → role, material */
const ROLES = {
  substrate:  { label: 'Substrate',        color: 0xd8eef5, opacity: 0.35, metalness: 0.0, roughness: 0.05, transmission: 0.85, h: 0.9 },
  tco:        { label: 'Transparent oxide', color: 0x8fd3dc, opacity: 0.55, metalness: 0.1, roughness: 0.25, transmission: 0.3, h: 0.22 },
  etl:        { label: 'Electron transport', color: 0x5aa9ff, opacity: 0.78, metalness: 0.05, roughness: 0.35, transmission: 0.0, h: 0.3 },
  perovskite: { label: 'Perovskite absorber', color: 0x3a1f14, opacity: 1.0, metalness: 0.15, roughness: 0.3, transmission: 0.0, h: 0.85, emissive: 0x2a0d05 },
  htl:        { label: 'Hole transport',   color: 0xf0a24b, opacity: 0.82, metalness: 0.05, roughness: 0.4, transmission: 0.0, h: 0.3 },
  interlayer: { label: 'Interlayer',       color: 0xb9a7ff, opacity: 0.8, metalness: 0.1, roughness: 0.4, transmission: 0.0, h: 0.12 },
  metal:      { label: 'Metal contact',    color: 0xd4af37, opacity: 1.0, metalness: 1.0, roughness: 0.22, transmission: 0.0, h: 0.2 },
  carbon:     { label: 'Carbon contact',   color: 0x26262a, opacity: 1.0, metalness: 0.3, roughness: 0.75, transmission: 0.0, h: 0.35 },
  other:      { label: 'Layer',            color: 0xa3a3a3, opacity: 0.85, metalness: 0.1, roughness: 0.5, transmission: 0.0, h: 0.2 },
};
const METALS = { au: 0xd4af37, ag: 0xcfd4d8, cu: 0xb87333, al: 0xc9ccd1, ni: 0xb5b8b2, cr: 0xa9adb0, mo: 0x9ea2a6, pt: 0xd9dadb, bi: 0x9c8f9a, in: 0xc9cdd6, ti: 0xb4b8bb };

export function classifyLayer(raw) {
  const s = String(raw).trim(); const l = s.toLowerCase().replace(/\s+/g, '');
  const has = (...k) => k.some((x) => l.includes(x));
  if (/^(slg|glass|soda|pen$|pet$|pi$|polyimide|quartz|si$|silicon|steel|foil|willow)/.test(l) || has('glass', 'pen/', 'pet/', 'polyimide')) return { role: 'substrate' };
  if (/^(fto|ito|izo|azo|ico|iwo|ihwo|tco)$/.test(l) || has('fto', 'ito', 'izo', 'azo', 'tco', 'iwo')) return { role: 'tco' };
  if (/^(au|ag|cu|al|ni|cr|mo|pt|bi|in|ti)$/.test(l) || /^(au|ag|cu|al|ni|cr|mo|pt|bi|ti)\//.test(l) || /\/(au|ag|cu|al)$/.test(l)) return { role: 'metal', tint: METALS[l.split('/')[0]] || METALS[l] };
  if (has('carbon', 'graphite', 'cnt', 'graphene') && !has('pcbm')) return { role: 'carbon' };
  if (has('pb', 'sn') && has('i', 'br', 'cl') && (has('ma', 'fa', 'cs', 'rb', 'perovskite', 'pbi', 'pbbr', 'sni', 'ba', 'pea', 'gua', 'da', '(')) ) return { role: 'perovskite' };
  if (has('perovskite', 'absorber')) return { role: 'perovskite' };
  if (has('bcp', 'lif', 'bphen', 'moo', 'mox', 'wo3', 'v2o5', 'pfn', 'alq3', 'phen', 'ald-', 'mgf') || l === 'ca') return { role: 'interlayer' };
  if (has('tio2', 'sno2', 'zno', 'pcbm', 'c60', 'icba', 'nb2o5', 'zro2', 'zn2sno4', 'bazro3', 'srtio3', 'fe2o3', 'ceo', 'in2o3', 'wox', 'pc61', 'pc71', 'sno', 'tio')) return { role: 'etl' };
  if (has('spiro', 'ptaa', 'nio', 'pedot', 'pacz', 'p3ht', 'cuscn', 'cui', 'cuo', 'cupc', 'poly-tpd', 'ptpd', 'pta', 'cz-', 'x60', 'dm', 'ome', 'tpa', 'sam', 'mpa', 'nbdpa', 'pcp', 'bpa', 'cbz', 'tapc', 'npb', 'cu2o', 'poly', 'carbazole', 'oam')) return { role: 'htl' };
  return { role: 'other' };
}

export function parseNm(v) {
  if (isNull(v)) return null;
  const m = String(v).replace(',', '.').match(/([\d.]+)\s*(nm|µm|um|μm|mm)?/i); if (!m) return null;
  const n = parseFloat(m[1]); if (!Number.isFinite(n)) return null;
  const u = (m[2] || 'nm').toLowerCase(); return u === 'nm' ? n : u === 'mm' ? n * 1e6 : n * 1e3;
}

/** Layers of a record, substrate first. Visual heights are role defaults scaled gently by reported thickness (log scale, clamped). */
export function layersOf(record, { badIndices = [], stack } = {}) {
  const seq = stack ?? record?.Cell_stack_sequence;
  if (isNull(seq)) return [];
  const names = String(seq).split('/').map((s) => s.trim()).filter(Boolean);
  // group consecutive layers by role so thickness fields (ETL_thickness etc.) can be attributed
  const nmFor = (role) => parseNm(role === 'perovskite' ? record?.Perovskite_thickness : role === 'etl' ? record?.ETL_thickness : role === 'htl' ? record?.HTL_thickness : role === 'metal' ? record?.Backcontact_thickness : null);
  const methodFor = (role) => (role === 'etl' ? record?.ETL_deposition_method : role === 'htl' ? record?.HTL_deposition_method : role === 'perovskite' ? record?.Perovskite_deposition_method : null);
  const out = names.map((name, i) => {
    const c = classifyLayer(name); const R = ROLES[c.role];
    const nm = nmFor(c.role); const method = methodFor(c.role);
    const scale = nm ? Math.min(1.6, Math.max(0.45, 0.35 + Math.log10(Math.max(5, nm)) / 2.6)) : 1;
    return { i, name, role: c.role, roleLabel: R.label, tint: c.tint, nm, method: isNull(method) ? null : String(method), h: R.h * scale, bad: badIndices.includes(i) };
  });
  // if the perovskite is the last/first layer and the list is reversed (top contact first), flip so the substrate is at the bottom
  // if the sequence was written top contact first (substrate/TCO at the end, contact at the start), flip it so the substrate sits at the bottom
  const isSub = (l) => l.role === 'substrate' || l.role === 'tco'; const isTop = (l) => l.role === 'metal' || l.role === 'carbon';
  if (out.length > 2 && !isSub(out[0]) && (out[out.length - 1].role === 'substrate' || (isSub(out[out.length - 1]) && isTop(out[0])))) out.reverse();
  return out.map((l, i) => ({ ...l, i }));
}

/* ------------------------------------------------------------------ shared renderer plumbing */
function cssVar(name, fb) { try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb; } catch { return fb; } }
function reduced() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
export function webglOk() { try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch { return false; } }

function makeRenderer(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'gl-canvas'; host.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer(); labels.domElement.className = 'gl-labels'; host.appendChild(labels.domElement);
  return { renderer, labels };
}
function environment(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer); const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = env; pmrem.dispose(); return env;
}
function disposeScene(scene) {
  scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { Object.values(m).forEach((v) => { if (v && v.isTexture) v.dispose(); }); m.dispose(); }); } });
}

/* ------------------------------------------------------------------ device viewer */
/**
 * @param {HTMLElement} el  host (position: relative is applied)
 * @param {object} record   a released record (or any object with Cell_stack_sequence)
 * @param {object} opts     { height, stack (override sequence), badIndices, compact, autoRotate, title, onHover(layer|null), explode (0..1) }
 */
export function mountDevice(el, record, opts = {}) {
  const layers = layersOf(record, opts);
  el.classList.add('gl-host'); el.innerHTML = '';
  if (!layers.length) { el.innerHTML = '<div class="gl-empty"><span class="null">Null</span> stack: nothing to render.</div>'; return () => {}; }
  if (!webglOk()) { el.innerHTML = `<div class="gl-empty">WebGL is not available in this browser; the stack is listed below.</div>`; return () => {}; }
  const height = opts.height || 320; el.style.height = `${height}px`;
  const canvasHost = h('<div class="gl-stage"></div>'); el.appendChild(canvasHost);
  const { renderer, labels } = makeRenderer(canvasHost);
  const scene = new THREE.Scene(); environment(renderer, scene);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const W = 3.2, D = 2.2; const total = layers.reduce((s, l) => s + l.h, 0);
  camera.position.set(4.6, total * 0.9 + 1.4, 5.2);
  const controls = new OrbitControls(camera, labels.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 3; controls.maxDistance = 14; controls.maxPolarAngle = Math.PI * 0.62; controls.enablePan = false;
  controls.autoRotate = (opts.autoRotate ?? true) && !reduced(); controls.autoRotateSpeed = opts.compact ? 0.9 : 0.6;
  controls.target.set(0, total / 2, 0);
  // lights (environment gives reflections; these shape the slabs)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa5b1, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.35); key.position.set(5, 8, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfdbfe, 0.5); rim.position.set(-5, 3, -4); scene.add(rim);
  // slabs
  const group = new THREE.Group(); scene.add(group);
  const meshes = []; let y = 0;
  const edgeColor = new THREE.Color(cssVar('--gl-edge', '#334155'));
  layers.forEach((l) => {
    const R = ROLES[l.role];
    const geo = new THREE.BoxGeometry(W, l.h, D);
    const mat = new THREE.MeshPhysicalMaterial({ color: l.tint ?? R.color, metalness: R.metalness, roughness: R.roughness, transparent: R.opacity < 1, opacity: R.opacity, transmission: R.transmission, thickness: 0.4, ior: 1.45, clearcoat: l.role === 'perovskite' ? 0.6 : 0, clearcoatRoughness: 0.25, emissive: R.emissive ?? 0x000000, emissiveIntensity: 0.6, side: THREE.FrontSide });
    if (l.bad) { mat.color.set(0xef4444); mat.emissive.set(0x7f1d1d); mat.emissiveIntensity = 0.5; mat.transparent = true; mat.opacity = 0.92; }
    const m = new THREE.Mesh(geo, mat); m.userData.layer = l; m.userData.baseY = y + l.h / 2; m.position.y = m.userData.baseY; m.renderOrder = l.role === 'substrate' ? 10 : 0;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.35 })); m.add(edges);
    // label on the right side of each slab
    if (opts.labels !== false && (!opts.compact || layers.length <= 8)) {
      const div = document.createElement('div'); div.className = `gl-label role-${l.role}${l.bad ? ' bad' : ''}`; div.innerHTML = `<i></i><span>${esc(l.name)}</span>${l.nm ? `<small>${l.nm >= 1000 ? `${(l.nm / 1000).toFixed(l.nm >= 10000 ? 0 : 1)} µm` : `${Math.round(l.nm)} nm`}</small>` : ''}`;
      const lab = new CSS2DObject(div); lab.position.set(W / 2 + 0.15, 0, -D / 2 + 0.1); lab.center.set(0, 0.5); m.add(lab); m.userData.labelEl = div; m.userData.labelObj = lab;
    }
    group.add(m); meshes.push(m); y += l.h;
  });
  // a thin ground shadow disc for grounding
  const disc = new THREE.Mesh(new THREE.CircleGeometry(3.1, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08 })); disc.rotation.x = -Math.PI / 2; disc.position.y = -0.02; scene.add(disc);
  // photons: points rising from below the substrate into the stack (illumination through the glass side), absorbed at the perovskite
  const pk = meshes.find((m) => m.userData.layer.role === 'perovskite'); const absorbY = pk ? pk.userData.baseY : total;
  const N = opts.compact ? 60 : 140; const pos = new Float32Array(N * 3); const vel = new Float32Array(N);
  for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * (W - 0.3); pos[i * 3 + 1] = -2 - Math.random() * 3; pos[i * 3 + 2] = (Math.random() - 0.5) * (D - 0.3); vel[i] = 0.9 + Math.random() * 1.2; }
  const pgeo = new THREE.BufferGeometry(); pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sprite = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); const gr = g.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,230,150,1)'); gr.addColorStop(0.4, 'rgba(255,200,80,.8)'); gr.addColorStop(1, 'rgba(255,200,80,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const photons = new THREE.Points(pgeo, new THREE.PointsMaterial({ size: 0.16, map: sprite, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 })); scene.add(photons);
  // overlay UI
  const ui = h(`<div class="gl-ui">${opts.tools === false ? '' : `<div class="gl-tools"><label class="gl-explode" title="Explode the stack"><span>explode</span><input type="range" min="0" max="1" step="0.01" value="${opts.explode ?? 0}" aria-label="Explode layers"></label><button type="button" class="gl-btn" data-a="rotate" aria-pressed="${controls.autoRotate}" title="Auto-rotate">${icon('rotate-3d', 14)}</button><button type="button" class="gl-btn" data-a="reset" title="Reset view">${icon('maximize-2', 14)}</button></div>`}<div class="gl-tip" role="status"></div><div class="gl-foot"><span class="gl-arch">${esc(isNull(record?.Cell_architecture) ? '' : String(record.Cell_architecture).toUpperCase() === 'NIP' ? 'n-i-p · light enters through the substrate' : String(record.Cell_architecture).toUpperCase() === 'PIN' ? 'p-i-n · light enters through the substrate' : record.Cell_architecture)}</span><span class="gl-n">${layers.length} layers · substrate → top contact</span></div></div>`);
  el.appendChild(ui);
  const tip = ui.querySelector('.gl-tip'); const slider = ui.querySelector('input[type=range]');
  let explode = slider ? +slider.value : (opts.explode ?? 0); if (slider) slider.oninput = () => { explode = +slider.value; };
  const rb = ui.querySelector('[data-a=rotate]'); if (rb) rb.onclick = (e) => { controls.autoRotate = !controls.autoRotate; e.currentTarget.setAttribute('aria-pressed', String(controls.autoRotate)); };
  const xb = ui.querySelector('[data-a=reset]'); if (xb) xb.onclick = () => { camera.position.set(4.6, total * 0.9 + 1.4, 5.2); controls.target.set(0, total / 2, 0); if (slider) slider.value = 0; explode = 0; };
  // hover
  const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2(-9, -9); let hovered = null;
  const onMove = (ev) => { const r = canvasHost.getBoundingClientRect(); mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); tip.style.left = `${ev.clientX - r.left + 14}px`; tip.style.top = `${ev.clientY - r.top + 14}px`; };
  const onLeave = () => { mouse.set(-9, -9); };
  labels.domElement.addEventListener('pointermove', onMove); labels.domElement.addEventListener('pointerleave', onLeave);
  function setHover(m) {
    if (hovered === m) return;
    if (hovered) { hovered.material.emissiveIntensity = hovered.userData.layer.role === 'perovskite' || hovered.userData.layer.bad ? 0.6 : 0; hovered.userData.labelEl?.classList.remove('hl'); if (!hovered.userData.layer.bad && hovered.userData.layer.role !== 'perovskite') hovered.material.emissive.set(0x000000); }
    hovered = m;
    if (m) { const l = m.userData.layer; if (!l.bad && l.role !== 'perovskite') m.material.emissive.set(0x2563eb); m.material.emissiveIntensity = 0.45; m.userData.labelEl?.classList.add('hl');
      tip.innerHTML = `<b>${esc(l.name)}</b><span class="gl-role">${esc(l.roleLabel)}${l.bad ? ' · flagged' : ''}</span>${l.nm ? `<span>thickness ${esc(l.nm >= 1000 ? `${(l.nm / 1000).toFixed(1)} µm` : `${Math.round(l.nm)} nm`)} <em>(reported)</em></span>` : '<span class="muted">thickness not reported · drawn at a nominal height</span>'}${l.method ? `<span>${esc(l.method)}</span>` : ''}<span class="muted">layer ${l.i + 1} of ${layers.length} · Cell_stack_sequence</span>`; tip.classList.add('show'); }
    else tip.classList.remove('show');
    opts.onHover && opts.onHover(m ? m.userData.layer : null);
  }
  // resize + loop
  const size = () => { const w = canvasHost.clientWidth || el.clientWidth || 320; const hh = canvasHost.clientHeight || height; renderer.setSize(w, hh, false); labels.setSize(w, hh); camera.aspect = w / hh; camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(size); ro.observe(canvasHost); size();
  let raf = 0; let alive = true; const clock = new THREE.Clock(); let visible = true;
  const io = new IntersectionObserver((es) => { visible = es.some((x) => x.isIntersecting); }); io.observe(el);
  function frame() {
    if (!alive) return; raf = requestAnimationFrame(frame);
    if (!visible) return;
    const dt = Math.min(0.05, clock.getDelta());
    // exploded positions (eased)
    let acc = 0; meshes.forEach((m) => { const l = m.userData.layer; const target = acc + l.h / 2 + explode * 0.55 * l.i; m.position.y += (target - m.position.y) * 0.18; acc += l.h; });
    controls.target.y += ((total + explode * 0.55 * (layers.length - 1)) / 2 - controls.target.y) * 0.1;
    // keep the side labels from overlapping: push each label up to at least `gap` above the previous one, then anchor to its slab
    const gap = Math.max(0.22, 0.045 * camera.position.distanceTo(controls.target)); let prev = -Infinity;
    meshes.forEach((m) => { const lo = m.userData.labelObj; if (!lo) return; let yw = Math.max(m.position.y, prev + gap); prev = yw; lo.position.y = yw - m.position.y; });
    // photons
    const arr = pgeo.attributes.position.array; const top = absorbY + (pk ? pk.userData.layer.h * 0.6 : 0) + explode * 0.55 * (pk ? pk.userData.layer.i : 0);
    for (let i = 0; i < N; i++) { arr[i * 3 + 1] += vel[i] * dt * (reduced() ? 0 : 1); if (arr[i * 3 + 1] > top) { arr[i * 3 + 1] = -2 - Math.random() * 3; arr[i * 3] = (Math.random() - 0.5) * (W - 0.3); arr[i * 3 + 2] = (Math.random() - 0.5) * (D - 0.3); } }
    pgeo.attributes.position.needsUpdate = true;
    ray.setFromCamera(mouse, camera); const hits = mouse.x > -5 ? ray.intersectObjects(meshes, false) : []; setHover(hits.length ? hits[0].object : null);
    controls.update(); renderer.render(scene, camera); labels.render(scene, camera);
  }
  frame();
  return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); controls.dispose(); labels.domElement.removeEventListener('pointermove', onMove); labels.domElement.removeEventListener('pointerleave', onLeave); disposeScene(scene); sprite.dispose(); renderer.dispose(); renderer.forceContextLoss?.(); el.innerHTML = ''; };
}

/** Legend chips for the roles, for pages that show a viewer. */
export function roleLegend() {
  return `<div class="gl-legend">${['substrate', 'tco', 'etl', 'perovskite', 'htl', 'interlayer', 'metal', 'carbon'].map((r) => `<span><i class="role-${r}"></i>${esc(ROLES[r].label)}</span>`).join('')}</div>`;
}

/* ------------------------------------------------------------------ corpus point cloud */
/**
 * points: [{x,y,z,doi,arch,family,year,pce}], axes: {x:{label,log?},y:{label},z:{label,log?}}
 * opts: { height, colorBy: 'arch'|'family'|'pce'|'year', groups:[...], onPick(p), tipFn(p) }
 */
export function mountCloud(el, points, axes, opts = {}) {
  el.classList.add('gl-host'); el.innerHTML = '';
  if (!points.length) { el.innerHTML = '<div class="gl-empty">No points match the current filters.</div>'; return () => {}; }
  if (!webglOk()) { el.innerHTML = '<div class="gl-empty">WebGL is not available in this browser.</div>'; return () => {}; }
  const height = opts.height || 560; el.style.height = `${height}px`;
  const canvasHost = h('<div class="gl-stage"></div>'); el.appendChild(canvasHost);
  const { renderer, labels } = makeRenderer(canvasHost);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100); camera.position.set(2.9, 2.1, 3.3);
  const controls = new OrbitControls(camera, labels.domElement); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.autoRotate = (opts.autoRotate ?? true) && !reduced(); controls.autoRotateSpeed = 0.5; controls.minDistance = 1.5; controls.maxDistance = 9; controls.target.set(0, 0, 0);
  const tx = (v, ax) => (ax.log ? Math.log10(v) : v);
  const ext = (k) => { const vs = points.map((p) => tx(p[k], axes[k])); const lo = Math.min(...vs), hi = Math.max(...vs); return [lo, hi === lo ? lo + 1 : hi]; };
  const ex = ext('x'), ey = ext('y'), ez = ext('z');
  const norm = (v, [lo, hi]) => ((v - lo) / (hi - lo)) * 2 - 1;
  // colours
  const S = [cssVar('--s1', '#2A78D6'), cssVar('--s2', '#EB6834'), cssVar('--s3', '#1BAF7A')].map((c) => new THREE.Color(c)); const muted = new THREE.Color(cssVar('--s-muted', '#c4c4c4'));
  const grad = (t) => new THREE.Color().setHSL(0.62 - 0.62 * Math.max(0, Math.min(1, t)), 0.75, 0.5);
  const colorOf = (p) => { if (opts.highlight && !opts.highlight.has(p.doi)) return muted; if (opts.colorBy === 'pce') return grad(((p.pce ?? 0) - 10) / 16); if (opts.colorBy === 'year') return grad(((p.year ?? 2015) - 2015) / 10); if (opts.colorBy === 'arch' || opts.colorBy === 'family') { const i = (opts.groups || []).indexOf(p[opts.colorBy]); return i >= 0 && i < 3 ? S[i] : muted; } return S[0]; };
  const n = points.length; const pos = new Float32Array(n * 3); const col = new Float32Array(n * 3);
  points.forEach((p, i) => { pos[i * 3] = norm(tx(p.x, axes.x), ex); pos[i * 3 + 1] = norm(tx(p.y, axes.y), ey); pos[i * 3 + 2] = norm(tx(p.z, axes.z), ez); const c = colorOf(p); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; });
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const sprite = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.beginPath(); g.arc(32, 32, 28, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,.25)'; g.stroke(); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const mat = new THREE.PointsMaterial({ size: n > 5000 ? 0.028 : n > 1500 ? 0.036 : 0.05, vertexColors: true, map: sprite, alphaTest: 0.3, transparent: true, opacity: opts.highlight ? 0.75 : 0.92, sizeAttenuation: true });
  const cloud = new THREE.Points(geo, mat); scene.add(cloud);
  if (opts.highlight) { const idx = points.map((p, i) => (opts.highlight.has(p.doi) ? i : -1)).filter((i) => i >= 0); const hp = new Float32Array(idx.length * 3); const hc = new Float32Array(idx.length * 3); idx.forEach((i, j) => { hp[j * 3] = pos[i * 3]; hp[j * 3 + 1] = pos[i * 3 + 1]; hp[j * 3 + 2] = pos[i * 3 + 2]; const c = grad(((points[i].pce ?? 0) - 10) / 16); hc[j * 3] = c.r; hc[j * 3 + 1] = c.g; hc[j * 3 + 2] = c.b; }); const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(hp, 3)); hg.setAttribute('color', new THREE.BufferAttribute(hc, 3)); scene.add(new THREE.Points(hg, new THREE.PointsMaterial({ size: 0.07, vertexColors: true, map: sprite, alphaTest: 0.3, transparent: true, sizeAttenuation: true }))); }
  // axes box + ticks
  const edge = new THREE.Color(cssVar('--border-strong', '#D4D4D8')); const gridC = new THREE.Color(cssVar('--grid', '#eee'));
  scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)), new THREE.LineBasicMaterial({ color: edge })));
  const floor = new THREE.GridHelper(2, 8, gridC, gridC); floor.position.y = -1; scene.add(floor);
  const fmt = (v, ax) => { const r = ax.log ? 10 ** v : v; return Math.abs(r) >= 100 ? r.toFixed(0) : Math.abs(r) >= 10 ? r.toFixed(1) : r.toFixed(2); };
  const lab = (text, x, y, z, cls = 'gl-axis') => { const d = document.createElement('div'); d.className = cls; d.textContent = text; const o = new CSS2DObject(d); o.position.set(x, y, z); scene.add(o); };
  [0, 0.5, 1].forEach((t) => { lab(fmt(ex[0] + t * (ex[1] - ex[0]), axes.x), -1 + 2 * t, -1.08, 1.08, 'gl-tick'); lab(fmt(ey[0] + t * (ey[1] - ey[0]), axes.y), -1.08, -1 + 2 * t, 1.08, 'gl-tick'); lab(fmt(ez[0] + t * (ez[1] - ez[0]), axes.z), 1.08, -1.08, -1 + 2 * t, 'gl-tick'); });
  lab(axes.x.label, 0, -1.25, 1.2); lab(axes.y.label, -1.3, 0, 1.2); lab(axes.z.label, 1.25, -1.25, 0);
  // hover / pick
  const tip = h('<div class="gl-tip" role="status"></div>'); el.appendChild(tip);
  const ray = new THREE.Raycaster(); ray.params.Points.threshold = 0.035; const mouse = new THREE.Vector2(-9, -9); let near = -1;
  const hl = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color(cssVar('--fg', '#171717')), wireframe: true })); hl.visible = false; scene.add(hl);
  const onMove = (ev) => { const r = canvasHost.getBoundingClientRect(); mouse.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); tip.style.left = `${ev.clientX - r.left + 14}px`; tip.style.top = `${ev.clientY - r.top + 14}px`; };
  const onLeave = () => { mouse.set(-9, -9); near = -1; hl.visible = false; tip.classList.remove('show'); };
  const onClick = () => { if (near >= 0 && opts.onPick) opts.onPick(points[near]); };
  labels.domElement.addEventListener('pointermove', onMove); labels.domElement.addEventListener('pointerleave', onLeave); labels.domElement.addEventListener('click', onClick);
  labels.domElement.style.cursor = 'crosshair';
  const size = () => { const w = canvasHost.clientWidth || 600; const hh = canvasHost.clientHeight || height; renderer.setSize(w, hh, false); labels.setSize(w, hh); camera.aspect = w / hh; camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(size); ro.observe(canvasHost); size();
  let raf = 0; let alive = true; let visible = true; const io = new IntersectionObserver((es) => { visible = es.some((x) => x.isIntersecting); }); io.observe(el);
  function frame() {
    if (!alive) return; raf = requestAnimationFrame(frame); if (!visible) return;
    if (mouse.x > -5) { ray.setFromCamera(mouse, camera); const hits = ray.intersectObject(cloud, false); if (hits.length) { const i = hits[0].index; if (i !== near) { near = i; const p = points[i]; hl.position.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); hl.visible = true; tip.innerHTML = opts.tipFn ? opts.tipFn(p) : `<b>${esc(p.doi)}</b>`; tip.classList.add('show'); } } else if (near >= 0) { near = -1; hl.visible = false; tip.classList.remove('show'); } }
    controls.update(); renderer.render(scene, camera); labels.render(scene, camera);
  }
  frame();
  return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); controls.dispose(); labels.domElement.removeEventListener('pointermove', onMove); labels.domElement.removeEventListener('pointerleave', onLeave); labels.domElement.removeEventListener('click', onClick); disposeScene(scene); sprite.dispose(); renderer.dispose(); renderer.forceContextLoss?.(); el.innerHTML = ''; };
}
