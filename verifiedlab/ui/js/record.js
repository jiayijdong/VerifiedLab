/** Helpers shared by the record-centred pages (Literature, Verification Studio, Database). */
import { esc, isNull, val, badge, icon } from './ui.js';

export const CATEGORY_ORDER = ['Reference data', 'Cell definition', 'Device stack', 'Material synthesis', 'Device fabrication', 'J-V metrics', 'Stability metrics', 'Other'];

/** Group schema fields by category, in the data card's order. */
export function groupFields(fields) {
  const g = {};
  fields.forEach((f) => { (g[f.category] ||= []).push(f); });
  return CATEGORY_ORDER.filter((c) => g[c]).map((c) => ({ category: c, fields: g[c], reliability: g[c][0].reliability }));
}

/** Layered device stack, substrate first. */
export function stackHtml(stack, { bad = false, label = '' } = {}) {
  if (isNull(stack)) return '<span class="null">Null</span>';
  const layers = String(stack).split('/').map((s) => s.trim()).filter(Boolean);
  return `<div class="stack" ${label ? `aria-label="${esc(label)}"` : ''}>${layers.map((l, i) => `<div class="layer ${bad ? 'bad' : ''}"><span class="n">${i + 1}</span><i><span class="v" title="${esc(l)}">${esc(l)}</span></i></div>`).join('')}</div>`;
}

export function verdictBadge(v) { return v === 'SUPPORTED' ? badge('Supported', 'ok') : v === 'WITHHELD' ? badge('Withheld', 'warn') : badge(v || '–', 'neutral'); }
export function decisionBadge(label) {
  const map = { TP: ['TP · correct', 'ok'], TN: ['TN · both empty', 'ok'], FP: ['FP · over-prediction', 'bad'], FN: ['FN · omission', 'bad'], FP_mismatch: ['FP_mismatch · wrong value', 'bad'] };
  const [t, k] = map[label] || [label || '–', 'neutral'];
  return badge(t, k);
}
export function runTitle(r) { return r.kind === 'film' ? (r.request || 'Harness run') : (r.question || 'Investigation'); }
export function runKindBadge(r) { return r.kind === 'film' ? `<span class="badge">${icon('play', 12)}harness run</span>` : `<span class="badge info">${icon('brain-circuit', 12)}investigation</span>`; }
export function champion(rec) {
  return [['Architecture', val(rec.Cell_architecture)], ['Stack', val(rec.Cell_stack_sequence, { mono: true })], ['Composition', val(rec.Perovskite_composition_long_form, { mono: true })],
    ['Additive', val(rec.Perovskite_additive_compound)], ['Bandgap', val(rec.Perovskite_bandgap)], ['Area', val(rec.Cell_area_measured)], ['Reverse-scan PCE', val(rec.JV_measured_reverse_scan_PCE)],
    ['Voc / Jsc / FF', `${val(rec.JV_measured_reverse_scan_Voc)} · ${val(rec.JV_measured_reverse_scan_Jsc)} · ${val(rec.JV_measured_reverse_scan_FF)}`], ['Retained PCE', `${val(rec.Stability_PCE_after_time_value)} after ${val(rec.Stability_PCE_after_time)}`]];
}
