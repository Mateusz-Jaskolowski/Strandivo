// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { h, toast } from "../ui/dom.ts";
import { openDialog } from "../ui/modal.ts";
import type { DocContext } from "../doc/context.ts";
import { featureStyles, protein } from "../doc/analysis.ts";
import { newId, type Range, type SeqFeature } from "../lib/seqdata.ts";
import { nextRegionColor, proteinRegionTargets, REGION_KINDS, regionColor, regionRange, regionsOf, selectedProteinResidues, withRegions, type ProteinRegion } from "../lib/regions.ts";
import { designOf, parseDesign, versionsFromText } from "../lib/variable.ts";

/** Amino-acid coordinates belong to this CDS, including on reverse and spliced sequences. */
export function openProteinRegionDialog(ctx: DocContext, f: SeqFeature, index?: number, selection = ctx.store.selection.range) {
  const d = ctx.store.data;
  const regions = regionsOf(f).map(r => ({ ...r, id: r.id ?? newId("r") }));
  const old = index === undefined ? undefined : regions[index];
  const length = protein(f, d.sequence).replace(/\*$/, "").length;
  if (!length) return;
  const residues = selection ? selectedProteinResidues(f, selection, d.sequence) : null;
  const start = old?.start ?? residues?.start ?? 1;
  const end = old?.end ?? residues?.end ?? length;
  const dlg = openDialog({ title: old ? "Edit protein region" : "Add protein region", note: `Amino-acid positions in ${f.name} (1–${length.toLocaleString()}), counted from the start of its CDS.`, width: 520 });
  const input = (label: string, value: string, type = "text") => h("input", { class: "sv-input", type, value, "aria-label": label, ...(type === "text" ? { autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: "false" } : {}), ...(type === "number" ? { min: "1", max: String(length), step: "1" } : {}) }) as HTMLInputElement;
  const name = input("Region name", old?.name ?? "");
  name.placeholder = "Domain, linker, CDR1…";
  const initialKind = old?.kind ?? "Domain";
  const customKind = input("Custom region kind", REGION_KINDS.includes(initialKind) ? "" : initialKind);
  customKind.placeholder = "Custom kind";
  const kind = h("select", { class: "sv-input", "aria-label": "Region kind" },
    REGION_KINDS.map(k => h("option", { value: k, selected: k === initialKind }, k)),
    h("option", { value: "custom", selected: !REGION_KINDS.includes(initialKind) }, "Custom…")) as HTMLSelectElement;
  const refreshKind = () => { customKind.hidden = kind.value !== "custom"; };
  kind.addEventListener("change", () => { refreshKind(); if (!customKind.hidden) customKind.focus(); });
  refreshKind();
  const from = input("First residue", String(start), "number");
  const to = input("Last residue", String(end), "number");
  const color = input("Region colour", old ? regionColor(old) : nextRegionColor(regions, featureStyles(d).get(f.id)?.fill), "color");
  const suggestedParent = old ? old.parentId : [...regions]
    .filter(r => r.start <= start && r.end >= end && (r.start < start || r.end > end))
    .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0]?.id;
  const parent = h("select", { class: "sv-input", "aria-label": "Parent region" }, h("option", { value: "" }, "Whole protein"), regions.filter(r => r !== old).map(r => h("option", { value: r.id, selected: suggestedParent === r.id }, r.name))) as HTMLSelectElement;
  const variable = h("input", { type: "checkbox", checked: !!old?.variable, "aria-label": "Varies between clones" }) as HTMLInputElement;
  const oldDesign = old?.variable;
  const oldChoice = oldDesign?.kind === "alternatives" && oldDesign.protein ? "protein" : oldDesign?.kind;
  const design = h("select", { class: "sv-input", "aria-label": "Variable design" }, [ ["any", "Anything"], ["pattern", "Pattern"], ["alternatives", "DNA versions"], ["protein", "Protein versions"] ].map(([value, label]) => h("option", { value, selected: oldChoice === value }, label))) as HTMLSelectElement;
  const specification = h("textarea", { class: "sv-input sv-mono", rows: "3", "aria-label": "Variable pattern or versions", spellcheck: "false" }) as HTMLTextAreaElement;
  specification.value = oldDesign?.kind === "pattern" ? oldDesign.pattern : oldDesign?.kind === "alternatives" ? oldDesign.options.map(o => `${o.name}: ${o.bases}`).join("\n") : "NNK";
  const variableControls = h("div", { class: "sv-region-design" }, design, specification);
  const hint = h("p", { class: "sv-small sv-dim sv-region-message" });
  const error = h("p", { class: "sv-small sv-text-warn sv-region-message", role: "alert" });
  const refresh = () => {
    variableControls.hidden = !variable.checked;
    specification.hidden = design.value === "any";
    specification.placeholder = design.value === "pattern" ? "NNK" : design.value === "protein" ? "v1: GFTFSSYA…\nv2: GRTFSNYA…" : "v1: ATGGCT…\nv2: ATGGGT…";
    hint.textContent = !variable.checked ? "" : design.value === "any" ? "Each clone’s sequence is reported separately from mutations." : design.value === "pattern" ? "IUPAC codes repeated over the region, written in the CDS’s direction." : design.value === "protein" ? "One version per line, as name: amino acids." : "One version per line, as name: DNA bases in the CDS’s direction.";
  };
  variable.addEventListener("change", refresh);
  // Versions typed before choosing DNA or protein stay, so they can be read the other way.
  const isVersions = (v: string) => v === "alternatives" || v === "protein";
  let chosen = design.value;
  design.addEventListener("change", () => {
    if (!isVersions(chosen) || !isVersions(design.value)) specification.value = design.value === "pattern" ? "NNK" : "";
    chosen = design.value;
    error.textContent = "";
    refresh();
  });
  const row = (label: string, control: HTMLElement) => h("label", { class: "sv-region-field" }, h("span", { class: "sv-design-label" }, label), control);
  dlg.body.replaceChildren(h("div", { class: "sv-region-form" }, row("Name", name), row("Kind", h("div", { class: "sv-region-kind" }, kind, customKind)), row("First residue", from), row("Last residue", to), row("Colour", color), row("Within", parent)),
    ...(!old && residues?.rounded ? [h("p", { class: "sv-small sv-dim" }, "The selection includes part of a codon, so the region includes the whole codon.")] : []),
    h("label", { class: "sv-check-row" }, variable, "Varies between clones"), variableControls, hint, error);
  const save = () => {
    const a = Number(from.value), b = Number(to.value);
    if (!name.value.trim()) { error.textContent = "Enter a name for this region."; name.focus(); return; }
    const regionKind = kind.value === "custom" ? customKind.value.trim() : kind.value;
    if (!regionKind) { error.textContent = "Enter a kind for this region."; customKind.focus(); return; }
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a || b > length) { error.textContent = `Enter a residue range from 1 to ${length.toLocaleString()}, with the first before the last.`; return; }
    const p = regions.find(r => r.id === parent.value);
    const ancestors = new Set<string>();
    for (let at = p; at && !ancestors.has(at.id!); at = regions.find(r => r.id === at?.parentId)) ancestors.add(at.id!);
    if (p && (p.start > a || p.end < b || (old?.id && ancestors.has(old.id)))) { error.textContent = "Choose a parent that contains this region and isn’t one of its children."; return; }
    if (old && regions.some(r => r.parentId === old.id && (r.start < a || r.end > b))) { error.textContent = "Keep this region large enough to contain its children, or move them first."; return; }
    let variableDesign = old?.variable;
    if (variable.checked) {
      if (designOf(f.notes)) { error.textContent = "This CDS already varies as a whole. Unmark it before choosing individual regions."; return; }
      if (regions.some(r => r !== old && r.variable && r.start <= b && r.end >= a)) { error.textContent = "Variable regions cannot overlap. Mark the individual parts that vary."; return; }
      if (design.value === "any") variableDesign = { kind: "any" };
      else if (design.value === "pattern") {
        variableDesign = parseDesign(specification.value.split("\n").filter(l => l.trim()).join("|"));
        if (variableDesign.kind !== "pattern") { error.textContent = "Enter an IUPAC pattern, such as NNK."; specification.focus(); return; }
      } else {
        const versions = versionsFromText(specification.value, design.value === "protein");
        if (typeof versions === "string") { error.textContent = versions; specification.focus(); return; }
        variableDesign = versions;
      }
    }
    const current = ctx.store.data;
    if (current.features.find(x => x.id === f.id) !== f) { error.textContent = "The CDS changed while this dialog was open. Close it and open it again."; return; }
    const region: ProteinRegion = { ...old, id: old?.id ?? newId("r"), name: name.value.trim(), kind: regionKind, start: a, end: b, color: color.value, parentId: parent.value || undefined, accession: old?.accession ?? "", sourceStart: old?.accession ? old.sourceStart : a, sourceEnd: old?.accession ? old.sourceEnd : b, predicted: old?.predicted ?? false, variable: variable.checked ? variableDesign : undefined, ...(old?.accession ? { edited: true, sourceKey: old.sourceKey ?? `${old.kind}:${old.sourceStart}-${old.sourceEnd}` } : {}) };
    const next = old ? regions.map(r => r === old ? region : r) : [...regions, region];
    const feature = { ...f, notes: withRegions(f.notes, next) };
    const sorted = regionsOf(feature);
    ctx.store.apply({ ...current, features: current.features.map(x => x.id === f.id ? feature : x) }, old ? "Edit protein region" : "Add protein region", { range: regionRange(feature, sorted.find(r => r.id === region.id)!, current.sequence.length), focus: { kind: "feature", id: f.id, region: sorted.findIndex(r => r.id === region.id) } });
    dlg.close();
  };
  dlg.footer.append(h("button", { class: "sv-btn", type: "button", onclick: () => dlg.close() }, "Cancel"), h("button", { class: "sv-btn sv-btn-primary", type: "button", onclick: save }, old ? "Save region" : "Add region"));
  dlg.body.addEventListener("keydown", e => { if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "checkbox") { e.preventDefault(); save(); } });
  refresh();
}

/** The selection stays unchanged until the user adds the named region. */
export function openProteinRegionFromSelection(ctx: DocContext, range: Range | null = ctx.store.selection.range) {
  if (!range) return;
  const targets = proteinRegionTargets(ctx.store.data, range);
  if (!targets.length) { toast("Select bases within a CDS to add a protein region.", "info"); return; }
  if (targets.length === 1) { openProteinRegionDialog(ctx, targets[0].feature, undefined, range); return; }
  const dlg = openDialog({ title: "Add as region", note: "Choose which coding sequence this region belongs to.", width: 520 });
  dlg.body.append(h("div", { class: "sv-list" }, targets.map(({ feature, start, end }) => h("button", {
    type: "button", class: "sv-list-row", onclick: () => { dlg.close(); openProteinRegionDialog(ctx, feature, undefined, range); }
  }, h("span", { class: "sv-list-name" }, feature.name), h("span", { class: "sv-list-meta sv-mono" }, `${start}–${end} aa`)))));
  dlg.footer.append(h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Cancel"));
}
