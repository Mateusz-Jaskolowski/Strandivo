// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { h } from "../ui/dom.ts";
import { layoutRegions, regionColor, regionTextColor, regionTitle, type ProteinRegion } from "../lib/regions.ts";

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
