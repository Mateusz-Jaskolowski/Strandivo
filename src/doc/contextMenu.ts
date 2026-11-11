// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Runs what the right-click menus offer (`src/lib/contextMenu.ts` decides what that is)
// with the same functions as the inspector and the toolbar.

import { toast } from "../ui/dom.ts";
import { fmt } from "../ui/format.ts";
import { showContextMenu, type ContextMenuEntry } from "../platform.ts";
import { primerLibrary } from "../primerLibrary.ts";
import { personalEnzymes } from "../personalEnzymes.ts";
import { enzymeOf } from "../lib/enzymePick.ts";
import { digestEnzymes, menuFor, type MenuEntry, type MenuItem, type MenuTarget } from "../lib/contextMenu.ts";
import { basesIn, deleteRange, featureBases, inRange, rangeLength, reverseComplement, type Range } from "../lib/seqdata.ts";
import { proteinRegionTargets, regionSpans, regionsOf, withRegions } from "../lib/regions.ts";
import { openProteinRegionDialog, openProteinRegionFromSelection } from "../views/proteinRegionDialog.ts";
import { deleteSelected, selectedBases } from "../lib/selection.ts";
import { cutSites, orfFeature, orfs, protein } from "./analysis.ts";
import type { DocContext, Tab } from "./context.ts";
import type { Focus } from "./store.ts";
import { openMutagenesisDialog } from "../views/mutagenesisDialog.ts";
import { openPcrDialog } from "../views/primerDialogs.ts";

export interface ContextMenuHost {
  ctx: DocContext;
  copy(text: string, what: string): void;
  designPrimers(range: Range, name: string, strand?: 1 | -1 | 0): void;
  addPrimer(strand: 1 | -1): void;
  /** Puts the cursor in the inspector's name field for the selected annotation. */
  rename(): void;
  /** Opens the system colour picker for the selected feature (the inspector's swatch). */
  pickColour(): void;
  /** Opens the Digest dialog with these enzymes chosen. */
  digest(enzymes: string[]): void;
}

/** Shows the menu for `target` at the pointer; `onMap` when it was opened on the map. */
export function openContextMenu(host: ContextMenuHost, target: MenuTarget, at: { x: number; y: number }, onMap: boolean) {
  const convert = (e: MenuEntry): ContextMenuEntry =>
    e === "separator" ? e : "items" in e ? { label: e.label, items: e.items.map(convert) } : { label: e.label, enabled: e.enabled, color: e.color, run: () => run(host, e, target, onMap) };
  const entries = menuFor(target, {
    data: host.ctx.store.data,
    onMap,
    tab: host.ctx.tab,
    inLibrary: bases => primerLibrary.all.some(x => x.bases === bases),
    enzymes: host.ctx.store.selection.enzymes,
    personalEnzymes: host.ctx.options.personalEnzymes
  }).map(convert);
  void showContextMenu(entries, at);
}

/**
 * What a right-click is for, selected first as a click would: the annotation under the
 * pointer, else the selection if the pointer is in it, else the cursor at boundary `b`.
 */
export function menuTargetAt(ctx: DocContext, annotation: Focus | null, b: number | null, selectAnnotation: (f: Focus) => void, source: string): MenuTarget | null {
  const store = ctx.store;
  const { range, focus } = store.selection;
  const ranges = store.selection.ranges;
  if (ranges && b !== null && ranges.some(r => inRange(r, b % store.length) || inRange(r, (b - 1 + store.length) % store.length))) return { kind: "selections", ranges };
  // A deliberately selected stretch inside a CDS takes precedence over its drawn bar.
  if (annotation?.kind === "feature" && !focus && range && b !== null &&
    (inRange(range, b % store.length) || inRange(range, (b - 1 + store.length) % store.length)) &&
    proteinRegionTargets(store.data, range).length) return { kind: "selection", range };
  if (annotation) {
    const f = store.selection.focus;
    // A site of a picked enzyme keeps the pick, so its menu can digest with them all.
    const picked = annotation.kind === "cutsite" && !!store.selection.enzymes?.includes(enzymeOf(annotation.id));
    if (!picked && (f?.kind !== annotation.kind || f.id !== annotation.id || f.region !== annotation.region)) selectAnnotation(annotation);
    return annotation;
  }
  if (b === null) return null;
  const n = store.length;
  const r = store.selection.range;
  // A boundary at either edge of the selection counts as in it.
  if (r && (inRange(r, b % n) || inRange(r, (b - 1 + n) % n))) return { kind: "selection", range: r };
  store.select({ range: null, caret: b, anchor: b }, source);
  return { kind: "cursor", at: b };
}

function run(host: ContextMenuHost, chosen: MenuItem, target: MenuTarget, onMap: boolean) {
  const action = chosen.action;
  const { ctx } = host;
  const store = ctx.store;
  const d = store.data;
  const n = d.sequence.length;
  const annotation = target.kind === "feature" ? d.features.find(f => f.id === target.id) : undefined;
  const region = annotation && target.kind === "feature" && target.region !== undefined ? regionsOf(annotation)[target.region] : undefined;
  const primer = target.kind === "primer" ? d.primers.find(p => p.id === target.id) : undefined;
  // An ORF is read like a coding feature.
  const orf = target.kind === "orf" ? orfs(d, ctx.options.orfOptions).find(o => o.id === target.id) : undefined;
  const feature = orf ? orfFeature(orf) : annotation;
  const range = target.kind === "selection" ? target.range : null;
  const show = (tab: Tab) => ctx.showTab(tab);
  switch (action) {
    case "copy":
      if (target.kind === "selections") {
        const bases = selectedBases(d.sequence, { range: null, ranges: target.ranges });
        host.copy(bases, `${fmt(bases.length)} bp`);
        return;
      }
      if (range) host.copy(basesIn(d.sequence, range), `${fmt(rangeLength(range, n))} bp`);
      return;
    case "copy-revcomp":
      if (target.kind === "selections") {
        const bases = selectedBases(d.sequence, { range: null, ranges: target.ranges });
        host.copy(reverseComplement(bases), `reverse complement (${fmt(bases.length)} bp)`);
        return;
      }
      if (range) host.copy(reverseComplement(basesIn(d.sequence, range)), `reverse complement (${fmt(rangeLength(range, n))} bp)`);
      return;
    case "add-forward-primer":
      return host.addPrimer(1);
    case "add-reverse-primer":
      return host.addPrimer(-1);
    case "design-primers":
      if (feature) host.designPrimers({ start: feature.start, end: feature.end }, feature.name, feature.strand);
      else if (range) host.designPrimers(range, "PCR");
      return;
    case "mutagenesis":
      if (annotation) openMutagenesisDialog(ctx, { cds: annotation.id, range: { start: annotation.start, end: annotation.end } });
      else if (range) openMutagenesisDialog(ctx);
      return;
    case "add-feature":
      return ctx.addFeatureFromSelection();
    case "add-protein-region": {
      if (annotation) openProteinRegionDialog(ctx, annotation);
      else if (range) openProteinRegionFromSelection(ctx, range);
      return;
    }
    case "edit-protein-region":
      if (annotation && target.kind === "feature") openProteinRegionDialog(ctx, annotation, target.region);
      return;
    case "remove-protein-region": {
      if (!annotation || !region) return;
      const notes = withRegions(annotation.notes, regionsOf(annotation).filter(r => r !== region).map(r => r.parentId && r.parentId === region.id ? { ...r, parentId: region.parentId } : r));
      store.apply({ ...d, features: d.features.map(f => f === annotation ? { ...f, notes } : f) }, "Remove region", { range: store.selection.range, focus: null });
      return;
    }
    case "reverse-complement":
    case "reverse-complement-all":
      return ctx.command("reverse-complement");
    case "delete-bases":
      if (target.kind === "selections") {
        const next = deleteSelected(d, { range: null, ranges: target.ranges });
        store.apply(next.data, "Delete", { caret: next.caret });
        return;
      }
      if (range) store.apply(deleteRange(d, range), "Delete", { caret: range.start <= range.end ? range.start : 0 });
      return;
    case "copy-dna":
      if (feature) {
        const spans = region ? regionSpans(feature, region, n) : null;
        const bases = featureBases(d.sequence, spans?.length ? { ...feature, start: spans[0].start, end: spans[spans.length - 1].end, locations: spans } : feature);
        host.copy(feature.strand === -1 ? reverseComplement(bases) : bases, `${region?.name ?? feature.name} (${fmt(bases.length)} bp)`);
      }
      return;
    case "copy-protein":
      if (feature) { const translated = protein(feature, d.sequence); host.copy(region ? translated.slice(region.start - 1, region.end) : translated, "protein sequence"); }
      return;
    case "copy-primer":
      if (primer) host.copy(primer.bases, primer.name);
      return;
    case "copy-for-ordering":
      if (primer) host.copy(`${primer.name}\t${primer.bases}`, `${primer.name} (name and sequence, tab-separated)`);
      return;
    case "digest":
      if (target.kind === "cutsite") host.digest(digestEnzymes(target.id, store.selection.enzymes));
      return;
    case "add-personal-enzyme":
    case "remove-personal-enzyme":
      if (target.kind === "cutsite") {
        const name = enzymeOf(target.id);
        const selected = action === "add-personal-enzyme";
        void personalEnzymes.set(name, selected).then(() => toast(selected ? `Added ${name} to My enzymes.` : `Removed ${name} from My enzymes.`, "success")).catch(e => toast(e instanceof Error ? e.message : String(e), "error", 7000));
      }
      return;
    case "add-orf-feature":
      if (orf) {
        store.select({ range: { start: orf.start, end: orf.end }, focus: { kind: "orf", id: orf.id } }, "menu");
        ctx.addFeatureFromSelection({ name: "New CDS", type: "CDS", strand: orf.strand });
      }
      return;
    case "copy-site": {
      const c = target.kind === "cutsite" ? cutSites(d, ctx.options).find(x => x.id === target.id) : undefined;
      if (c) host.copy(c.site.toUpperCase(), `${c.enzyme} site`);
      return;
    }
    case "show-other":
      return show(onMap ? "sequence" : "map");
    case "show-in-primers":
    case "show-on-map":
    case "show-in-sequence":
      if (primer) {
        show(action === "show-on-map" ? "map" : action === "show-in-sequence" ? "sequence" : "primers");
        // Selected again so the tab scrolls to it.
        store.selectRange({ start: primer.start, end: primer.end }, { kind: "primer", id: primer.id }, "menu");
      }
      return;
    case "pcr-product":
      if (primer) openPcrDialog(ctx, { [primer.strand === 1 ? "forward" : "reverse"]: `p:${primer.id}` });
      return;
    case "save-to-library":
      if (primer) {
        primerLibrary.add([{ name: primer.name, bases: primer.bases, notes: "", color: primer.color }]);
        toast(`Saved ${primer.name} to the lab library.`, "success", 2500);
      }
      return;
    case "flip-primer":
      if (primer) {
        const next = { ...primer, bases: reverseComplement(primer.bases), strand: primer.strand === 1 ? (-1 as const) : (1 as const) };
        store.apply({ ...d, primers: d.primers.map(p => (p.id === primer.id ? next : p)) }, "Flip primer strand");
      }
      return;
    case "rename":
      return host.rename();
    case "set-colour":
    case "default-colour":
      if (feature) {
        const color = action === "set-colour" ? chosen.color : undefined;
        store.apply({ ...d, features: d.features.map(f => (f.id === feature.id ? { ...f, color } : f)) }, "Change colour");
      }
      if (primer) {
        const color = action === "set-colour" ? chosen.color : undefined;
        store.apply({ ...d, primers: d.primers.map(p => (p.id === primer.id ? { ...p, color } : p)) }, "Change colour");
      }
      return;
    case "pick-colour":
      return host.pickColour();
    case "delete-feature":
      if (feature) {
        store.apply({ ...d, features: d.features.filter(f => f.id !== feature.id) }, "Delete feature", { range: { start: feature.start, end: feature.end } });
        ctx.noteEdit(`Deleted ${feature.name} (sequence bases kept).`);
      }
      return;
    case "delete-primer":
      if (primer) {
        store.apply({ ...d, primers: d.primers.filter(p => p.id !== primer.id) }, "Delete primer", { range: { start: primer.start, end: primer.end } });
        ctx.noteEdit(`Deleted ${primer.name}.`);
      }
      return;
    case "select-all":
      return ctx.command("select-all");
    case "set-origin":
      return ctx.command("set-origin");
  }
}
