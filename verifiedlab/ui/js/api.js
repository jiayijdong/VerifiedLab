/** Thin fetch wrapper over the FastAPI back end. All workspace reads go through /api/*; live runs use the pre-existing routes. */
const cache = new Map();

export async function get(path, { cacheMs = 0 } = {}) {
  const hit = cache.get(path);
  if (hit && cacheMs && Date.now() - hit.t < cacheMs) return hit.v;
  const r = await fetch(path, { headers: { accept: 'application/json' } });
  if (!r.ok) {
    let detail = r.statusText;
    try { detail = (await r.json()).detail || detail; } catch { /* non-JSON error body */ }
    const err = new Error(`${r.status} ${detail}`); err.status = r.status; throw err;
  }
  const v = await r.json();
  if (cacheMs) cache.set(path, { t: Date.now(), v });
  return v;
}

export async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export async function text(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.text();
}

export function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v)); });
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Subscribe to a run's server-sent events. Returns a closer. */
export function stream(runId, onEvent, onEnd, onError) {
  const es = new EventSource(`/events/${runId}`);
  es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch (e) { console.error(e); } };
  es.addEventListener('end', () => { es.close(); onEnd && onEnd(); });
  es.onerror = () => { es.close(); onError && onError(); };
  return () => es.close();
}

export const api = {
  overview: () => get('/api/overview'),
  schema: () => get('/api/schema', { cacheMs: 600000 }),
  facets: () => get('/api/facets', { cacheMs: 600000 }),
  records: (p) => get(`/api/records${qs(p)}`),
  record: (doi) => get(`/api/records/${doi}`),
  queue: (p) => get(`/api/queue${qs(p)}`),
  explore: (p) => get(`/api/explore${qs(p)}`),
  trend: (p) => get(`/api/trend${qs(p)}`),
  runs: () => get('/api/runs'),
  run: (id) => get(`/api/runs/${id}`),
  trace: (id, i) => get(`/api/runs/${id}/trace${qs({ i, full: i === undefined ? undefined : true })}`),
  skills: () => get('/api/skills', { cacheMs: 60000 }),
  claims: () => get('/api/claims'),
  servers: () => get('/api/servers'),
  questions: () => get('/api/questions', { cacheMs: 600000 }),
  about: () => get('/api/about', { cacheMs: 600000 }),
  defaults: () => get('/default', { cacheMs: 600000 }),
  policy: () => get('/policies/workflow-policy.json', { cacheMs: 600000 }),
  investigate: (body) => post('/investigate', body),
  runFilm: (body) => post('/run', body),
};
