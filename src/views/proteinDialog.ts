// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Protein details: one protein in a dialog, with what the inspector has no room for (the
// one dialog per kind of thing AGENTS.md allows under "Where things go"): its mass and
// extinction coefficient with the counts behind them, its regions drawn as a figure to
// copy or save, and its sequence numbered in tens. The inspector keeps the summary.

import { h, toast } from "../ui/dom.ts";
import { iconSvg } from "../ui/icons.ts";
import { fmt } from "../ui/format.ts";
import { layoutRegions, regionColor, regionRange, regionsOf, regionTitle, regionTree } from "../lib/regions.ts";
import { absorbance, extinctionNote, kilodaltons, proteinProperties, residueLines } from "../lib/proteinProperties.ts";
import { figureSvg, proteinFigure } from "../lib/proteinFigure.ts";
import { chooseSavePath, copyImage, saveBytes, saveText } from "../platform.ts";
import { basename } from "../lib/files.ts";
import { openDialog } from "../ui/modal.ts";
import { figureElement, figureFont, figureMeasure, figurePng } from "./proteinFigure.ts";
import type { DocContext } from "../doc/context.ts";
import type { SeqFeature } from "../lib/seqdata.ts";
import { protein } from "../doc/analysis.ts";
import { openProteinRegionDialog } from "./proteinRegionDialog.ts";
import { copyText } from "./inspector.ts";

/** Kept for the visit, so the next figure is drawn the same way. */
const figureChoice: { detail: "domains" | "all"; scale: boolean } = { detail: "all", scale: true };

/** The protein of a CDS, or of an ORF (`orfFeature`, which has no regions): `of` names which. */
export function openProteinDialog(ctx: DocContext, f: SeqFeature, of: "CDS" | "ORF" = "CDS") {
  const translated = protein(f, ctx.store.data.sequence);
  const shown = translated.replace(/\*$/, "");
  const regions = regionsOf(f);
  const length = shown.length || 1;
  const focus = ctx.store.selection.focus;
  let selected = focus?.kind === "feature" && focus.id === f.id ? focus.region : undefined;
  const nested = layoutRegions(regions).some(r => r.depth > 0);
  const font = figureFont();
  const measure = figureMeasure(font);
  const figure = () => proteinFigure(regions, { length, detail: nested ? figureChoice.detail : "all", scale: figureChoice.scale, measure });
  const dlg = openDialog({ title: f.name || "Protein", note: `Numbered in amino acids from the start of this ${of}.`, width: regions.length ? 980 : 760 });
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
  const sectionHead = (title: string, ...actions: Node[]) => h("div", { class: "sv-section-head sv-protein-head" }, h("h3", { class: "sv-section-title" }, title), ...actions);

  const properties = () => {
    const p = proteinProperties(translated);
    const note = extinctionNote(p);
    const eps = (e: number) => `${fmt(e)} M⁻¹ cm⁻¹ · A280 ${absorbance(e, p.mass!).toFixed(3)} at 1 mg/mL`;
    const rows: [string, string][] = [["Length", `${fmt(p.residues)} aa`]];
    if (p.mass !== null) rows.push(["Mass", `${kilodaltons(p.mass)} · ${fmt(Math.round(p.mass * 100) / 100)} Da`]);
    if (p.reduced !== null && (p.trp || p.tyr || p.cys)) {
      if (p.cys >= 2) rows.push(["ε280, Cys reduced", eps(p.reduced)], ["ε280, disulfides", eps(p.cystines!)]);
      else rows.push(["ε280", eps(p.reduced)]);
    }
    if (p.mass !== null) rows.push(["Counted", `${p.trp} Trp · ${p.tyr} Tyr · ${p.cys} Cys`]);
    return h(
      "section",
      { class: "sv-protein-section", "aria-label": "Properties" },
      sectionHead("Properties"),
      h("dl", { class: "sv-facts sv-protein-facts" }, rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
      p.earlyStop !== null ? h("p", { class: "sv-small sv-text-warn" }, `A stop at codon ${fmt(p.earlyStop)} ends the protein, so these are for the ${fmt(p.residues)} residues before it.`) : null,
      note ? h("p", { class: p.unknown ? "sv-small sv-text-warn" : "sv-small sv-dim" }, note) : null,
      h("p", { class: "sv-small sv-dim" }, "ε280 from Trp, Tyr and cystines (Pace et al. 1995), as ExPASy ProtParam works it out; disulfides counts every pair of Cys.")
    );
  };

  const regionsPart = () => {
    const detail = h("select", { class: "sv-input sv-input-small", "aria-label": "Regions to draw", onchange: (e: Event) => { figureChoice.detail = (e.target as HTMLSelectElement).value as "domains" | "all"; render(); } },
      h("option", { value: "all", selected: figureChoice.detail === "all" }, "All regions"), h("option", { value: "domains", selected: figureChoice.detail === "domains" }, "Top level"));
    const scale = h("input", { type: "checkbox", checked: figureChoice.scale, onchange: (e: Event) => { figureChoice.scale = (e.target as HTMLInputElement).checked; render(); } });
    return h(
      "section",
      { class: "sv-protein-section", "aria-label": "Regions" },
      sectionHead("Regions", h("div", { class: "sv-figure-controls" }, nested ? h("label", { class: "sv-figure-control" }, "Show", detail) : null, h("label", { class: "sv-figure-control" }, scale, "Residue scale"))),
      h("div", { class: "sv-figure-paper" }, figureElement(figure(), font, { label: `Protein regions of ${f.name}`, selected, title: index => regionTitle(regions[index]), pick })),
      h("div", { class: "sv-list" }, regionTree(regions).map(({ region: r, index, depth }) => h("button", { type: "button", class: `sv-list-row${index === selected ? " sv-selected" : ""}`, style: { paddingLeft: `${8 + depth * 16}px` }, onclick: () => pick(index) }, h("span", { class: "sv-swatch", style: { background: regionColor(r) } }), h("span", { class: "sv-list-name" }, r.name), h("span", { class: "sv-list-meta" }, r.kind), h("span", { class: "sv-list-meta sv-mono" }, `${r.start}–${r.end} aa`))))
    );
  };

  const sequence = () =>
    h(
      "section",
      { class: "sv-protein-section", "aria-label": "Sequence" },
      sectionHead("Sequence", h("button", { type: "button", class: "sv-link", onclick: () => void copyText(translated, "protein sequence") }, iconSvg("copy", 13), "Copy")),
      h(
        "div",
        { class: "sv-protein-seq" },
        residueLines(shown).map(line => h("div", null, h("span", { class: "sv-protein-seq-num" }, String(line.first)), line.blocks.join(" ")))
      )
    );

  const render = () => {
    dlg.body.replaceChildren(properties(), ...(regions.length ? [regionsPart()] : []), sequence());
    const close = h("button", { type: "button", class: regions.length ? "sv-btn" : "sv-btn sv-btn-primary", onclick: () => dlg.close() }, "Close");
    if (!regions.length) return dlg.footer.replaceChildren(close);
    dlg.footer.replaceChildren(
      h("div", { class: "sv-foot-start sv-foot-group" },
        h("button", { type: "button", class: "sv-btn", onclick: copy }, iconSvg("copy", 14), "Copy image"),
        h("button", { type: "button", class: "sv-btn", onclick: () => save("png") }, iconSvg("download", 14), "Save as PNG…"),
        h("button", { type: "button", class: "sv-btn", onclick: () => save("svg") }, "Save as SVG…")),
      close,
      h("button", { type: "button", class: "sv-btn sv-btn-primary", disabled: selected === undefined, onclick: () => { dlg.close(); openProteinRegionDialog(ctx, f, selected); } }, "Edit region…")
    );
  };
  render();
}
