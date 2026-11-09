// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { h } from "../ui/dom.ts";
import { layoutRegions, regionColor, regionRange, regionsOf, regionTextColor, regionTitle, regionTree, type ProteinRegion } from "../lib/regions.ts";
import { openDialog } from "../ui/modal.ts";
import type { DocContext } from "../doc/context.ts";
import type { SeqFeature } from "../lib/seqdata.ts";
import { protein } from "../doc/analysis.ts";
import { openProteinRegionDialog } from "./proteinRegionDialog.ts";

/** A compact, interactive protein schematic, independent of the plasmid's DNA coordinates. */
export function proteinDiagram(regions: ProteinRegion[], length: number, selected: number | undefined, pick: (index: number) => void) {
  const rows = layoutRegions(regions);
  const lanes = Math.max(1, ...rows.map(r => r.lane + 1));
  return h("div", { class: "sv-protein-diagram", "aria-label": "Protein regions" },
    h("div", { class: "sv-protein-ruler sv-mono" }, h("span", null, "1"), h("span", null, `${length.toLocaleString()} aa`)),
    h("div", { class: "sv-protein-tracks", style: { height: `${lanes * 28 + 6}px` } },
      rows.map(({ region, index, lane }) => h("button", {
        class: `sv-protein-region${selected === index ? " sv-selected" : ""}`,
        type: "button", title: regionTitle(region), "aria-label": `${region.name}, residues ${region.start} to ${region.end}`, "aria-pressed": String(selected === index),
        style: `left:${100 * (region.start - 1) / length}%;width:${100 * (Math.min(length, region.end) - region.start + 1) / length}%;top:${lane * 28 + 3}px;--region-color:${regionColor(region)};color:${regionTextColor(region)}`,
        onclick: () => pick(index)
      }, region.name))));
}

export function openProteinDiagram(ctx: DocContext, f: SeqFeature) {
  const regions = regionsOf(f);
  const length = protein(f, ctx.store.data.sequence).replace(/\*$/, "").length || 1;
  let selected = ctx.store.selection.focus?.region;
  const dlg = openDialog({ title: f.name, note: "Protein regions, numbered in amino acids from the start of this CDS.", width: 860 });
  const render = () => {
    const pick = (index: number) => {
      selected = index;
      const range = regionRange(f, regions[index], ctx.store.length);
      if (range) ctx.store.selectRange(range, { kind: "feature", id: f.id, region: index }, "inspector");
      render();
    };
    dlg.body.replaceChildren(proteinDiagram(regions, length, selected, pick), h("div", { class: "sv-list" }, regionTree(regions).map(({ region: r, index, depth }) => h("button", { type: "button", class: `sv-list-row${index === selected ? " sv-selected" : ""}`, style: { paddingLeft: `${8 + depth * 16}px` }, onclick: () => pick(index) }, h("span", { class: "sv-swatch", style: { background: regionColor(r) } }), h("span", { class: "sv-list-name" }, r.name), h("span", { class: "sv-list-meta" }, r.kind), h("span", { class: "sv-list-meta sv-mono" }, `${r.start}–${r.end} aa`)))));
    dlg.footer.replaceChildren(h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Close"), h("button", { type: "button", class: "sv-btn sv-btn-primary", disabled: selected === undefined, onclick: () => { dlg.close(); openProteinRegionDialog(ctx, f, selected); } }, "Edit region…"));
  };
  render();
}
