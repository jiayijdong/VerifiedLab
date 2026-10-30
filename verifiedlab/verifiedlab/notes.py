"""Build a prose device note from any released record, so the generate -> verify -> repair stage can run on any DOI.
The note is a rendering of the released extraction, not article text; it lists the stack top-down like a device schematic."""
from __future__ import annotations
from .rules import is_empty

def _v(rec, k):
    v = rec.get(k, "Null")
    return None if is_empty(v) else str(v)

def device_note(rec: dict, top_down: bool = True) -> str:
    layers = [l.strip() for l in str(rec.get("Cell_stack_sequence", "")).split("/") if l.strip()]
    if top_down: layers = layers[::-1]
    out = [f"# Device note: champion cell of DOI {rec['Ref_DOI']}", "",
           "Scope: prose rendering synthesized from the released structured record for this demo; not article text.",
           f"Journal: {_v(rec,'Ref_journal') or 'n/a'} ({_v(rec,'Ref_publication_year') or 'n/a'}). Title: {_v(rec,'Ref_title') or 'n/a'}", "",
           "## Device schematic (listed " + ("top-down, as drawn" if top_down else "from the substrate up") + ")", ""]
    out += [f"- {l}" for l in layers] or ["- (stack not reported)"]
    arch = _v(rec, "Cell_architecture")
    if arch: out += ["", f"The device is a {'regular (n-i-p)' if arch.upper().replace('-','')=='NIP' else 'inverted (p-i-n)' if arch.upper().replace('-','')=='PIN' else arch} architecture."]
    parts = []
    comp = _v(rec, "Perovskite_composition_long_form"); add = _v(rec, "Perovskite_additive_compound"); addc = _v(rec, "Perovskite_additive_concentration")
    if comp: parts.append(f"The absorber is {comp}" + (f" with {add}" + (f" ({addc})" if addc else "") + " added to the precursor" if add else "") + ".")
    bg = _v(rec, "Perovskite_bandgap");  parts.append(f"Bandgap {bg}.") if bg else None
    sol = _v(rec, "Perovskite_deposition_solvents_compound"); ratio = _v(rec, "Perovskite_deposition_solvents_mixing_ratio")
    if sol: parts.append(f"Precursor solvent {sol}" + (f" at {ratio}" if ratio else "") + ".")
    anti = _v(rec, "Perovskite_deposition_spin_coating_antisolvent"); parts.append(f"Antisolvent: {anti}.") if anti else None
    st = _v(rec, "Perovskite_surface_treatment_material"); parts.append(f"After film formation the absorber surface is treated with {st}.") if st else None
    ta = _v(rec, "Perovskite_deposition_thermal_annealing_temperature"); tt = _v(rec, "Perovskite_deposition_thermal_annealing_time")
    if ta: parts.append(f"Perovskite annealing {ta}" + (f" for {tt}" if tt else "") + ".")
    etl = _v(rec, "ETL_stack_sequence"); etlm = _v(rec, "ETL_deposition_method"); htl = _v(rec, "HTL_stack_sequence"); htlm = _v(rec, "HTL_deposition_method")
    if etl: parts.append(f"Electron-transport layer {etl}" + (f" by {etlm}" if etlm else "") + ".")
    if htl: parts.append(f"Hole-transport layer {htl}" + (f" by {htlm}" if htlm else "") + ".")
    bc = _v(rec, "Backcontact_thickness"); bcm = _v(rec, "Backcontact_deposition_method")
    if bc or bcm: parts.append("Back contact " + (f"{bc} " if bc else "") + (f"by {bcm}" if bcm else "") + ".")
    out += ["", "## Fabrication", ""] + parts
    jv = [(k, _v(rec, f"JV_measured_reverse_scan_{k}")) for k in ("Voc", "Jsc", "FF", "PCE")]
    jvs = ", ".join(f"{k} {v}" for k, v in jv if v)
    light = _v(rec, "JV_measured_light_spectra"); inten = _v(rec, "JV_measured_light_spectra_intensity")
    out += ["", "## Photovoltaic performance (reverse scan" + (f", {light}" if light else "") + (f", {inten}" if inten else "") + ")", "", jvs + "." if jvs else "Not reported."]
    speed = _v(rec, "JV_measured_scan_speed")
    out.append(f"Scan speed {speed}." if speed else "The scan protocol is not described in this note.")
    stab = _v(rec, "Stability_PCE_after_time_value"); dur = _v(rec, "Stability_PCE_after_time")
    cond = ", ".join(x for x in (_v(rec, "Stability_test_atmosphere"), _v(rec, "Stability_test_temperature"), _v(rec, "Stability_test_relative_humidity"), _v(rec, "Stability_test_light_intensity")) if x)
    enc = _v(rec, "Encapsulation_method")
    out += ["", "## Stability", ""]
    out.append((f"{enc} device. " if enc else "") + (f"Retains {stab} of the initial PCE after {dur}" + (f" ({cond})" if cond else "") + "." if stab and dur else "No stability test is described in this note."))
    return "\n".join(out) + "\n"
