// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { h, toast } from "../ui/dom.ts";
import { iconSvg } from "../ui/icons.ts";
import { layoutRegions, regionColor, regionRange, regionsOf, regionTextColor, regionTitle, regionTree, type ProteinRegion } from "../lib/regions.ts";
import { figureSvg, proteinFigure } from "../lib/proteinFigure.ts";
import { chooseSavePath, copyImage, saveBytes, saveText } from "../platform.ts";
import { basename } from "../lib/files.ts";
import { openDialog } from "../ui/modal.ts";
import { figureElement, figureFont, figureMeasure, figurePng } from "./proteinFigure.ts";
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

/** Kept for the visit, so the next figure is drawn the same way. */
const figureChoice: { detail: "domains" | "all"; scale: boolean } = { detail: "all", scale: true };

/** Expand…: the protein drawn as a figure to copy or save, above the list of its regions. */
export function openProteinDiagram(ctx: DocContext, f: SeqFeature) {
  const regions = regionsOf(f);
  const length = protein(f, ctx.store.data.sequence).replace(/\*$/, "").length || 1;
  const focus = ctx.store.selection.focus;
  let selected = focus?.kind === "feature" && focus.id === f.id ? focus.region : undefined;
  const nested = layoutRegions(regions).some(r => r.depth > 0);
  const font = figureFont();
  const measure = figureMeasure(font);
  const figure = () => proteinFigure(regions, { length, detail: nested ? figureChoice.detail : "all", scale: figureChoice.scale, measure });
  const dlg = openDialog({ title: f.name, note: "Protein regions, numbered in amino acids from the start of this CDS.", width: 980 });
  const fileName = `${f.name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "Protein"} regions`;
  const save = async (kind: "png" | "svg") => {
    const path = await chooseSavePath(`${fileName}.${kind}`, [kind === "png" ? { name: "PNG image", extensions: ["png"] } : { name: "SVG image", extensions: ["svg"] }]);
    if (!path) return;
    try {
      const fig = figure();
      if (kind === "png") await saveBytes(path, figurePng(fig, font));
      else await saveText(path, figureSvg(fig, font));
      toast(`Saved ${basename(path)}`, "success", 3000);
    } catch (e) {
      toast(`Couldn't save the figure: ${e instanceof Error ? e.message : e}`, "error", 6000);
    }
  };
  const copy = async () => {
    try {
      await copyImage(figurePng(figure(), font));
      toast("Copied the figure", "success", 1800);
    } catch {
      toast("Couldn't copy the figure. Save it as a PNG instead.", "error", 5000);
    }
  };
  const pick = (index: number) => {
    selected = index;
    const range = regionRange(f, regions[index], ctx.store.length);
    if (range) ctx.store.selectRange(range, { kind: "feature", id: f.id, region: index }, "inspector");
    render();
  };
  const render = () => {
    const detail = h("select", { class: "sv-input sv-input-small", "aria-label": "Regions to draw", onchange: (e: Event) => { figureChoice.detail = (e.target as HTMLSelectElement).value as "domains" | "all"; render(); } },
      h("option", { value: "all", selected: figureChoice.detail === "all" }, "All regions"), h("option", { value: "domains", selected: figureChoice.detail === "domains" }, "Top level"));
    const scale = h("input", { type: "checkbox", checked: figureChoice.scale, onchange: (e: Event) => { figureChoice.scale = (e.target as HTMLInputElement).checked; render(); } });
    dlg.body.replaceChildren(
      h("div", { class: "sv-figure-controls" }, nested ? h("label", { class: "sv-figure-control" }, "Show", detail) : null, h("label", { class: "sv-figure-control" }, scale, "Residue scale")),
      h("div", { class: "sv-figure-paper" }, figureElement(figure(), font, { label: `Protein regions of ${f.name}`, selected, title: index => regionTitle(regions[index]), pick })),
      h("div", { class: "sv-list" }, regionTree(regions).map(({ region: r, index, depth }) => h("button", { type: "button", class: `sv-list-row${index === selected ? " sv-selected" : ""}`, style: { paddingLeft: `${8 + depth * 16}px` }, onclick: () => pick(index) }, h("span", { class: "sv-swatch", style: { background: regionColor(r) } }), h("span", { class: "sv-list-name" }, r.name), h("span", { class: "sv-list-meta" }, r.kind), h("span", { class: "sv-list-meta sv-mono" }, `${r.start}–${r.end} aa`))))
    );
    dlg.footer.replaceChildren(
      h("div", { class: "sv-foot-start sv-foot-group" },
        h("button", { type: "button", class: "sv-btn", onclick: copy }, iconSvg("copy", 14), "Copy image"),
        h("button", { type: "button", class: "sv-btn", onclick: () => save("png") }, iconSvg("download", 14), "Save as PNG…"),
        h("button", { type: "button", class: "sv-btn", onclick: () => save("svg") }, "Save as SVG…")),
      h("button", { type: "button", class: "sv-btn", onclick: () => dlg.close() }, "Close"),
      h("button", { type: "button", class: "sv-btn sv-btn-primary", disabled: selected === undefined, onclick: () => { dlg.close(); openProteinRegionDialog(ctx, f, selected); } }, "Edit region…"));
  };
  render();
}
