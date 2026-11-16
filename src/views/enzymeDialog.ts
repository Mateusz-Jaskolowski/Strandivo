// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Enzyme details: one restriction enzyme in a dialog (the one dialog per kind of thing
// AGENTS.md allows under "Where things go"): its cut drawn on both strands, who sells it,
// the enzymes with its site, where it cuts the open sequence and what that leaves, and the
// lab's stock of it. It opens from the inspector, a cut site's right-click menu, or a
// double-click on a cut site. Its site and suppliers come from REBASE; products, buffers
// and methylation come later (docs/enzyme-data-plan.md).

import { cutDrawing, enzymeCut, enzymeName, enzymeRelatives, enzymeSites, enzymeSuppliers, type CutDrawing } from "../lib/enzymes.ts";
import { digestSequence, fragmentSize } from "../lib/gel.ts";
import { enzymeLibrary } from "../enzymeLibrary.ts";
import { personalEnzymes } from "../personalEnzymes.ts";
import { h, toast } from "../ui/dom.ts";
import { fmt } from "../ui/format.ts";
import { openDialog } from "../ui/modal.ts";
import { openDigestDialog } from "./digestDialog.ts";
import type { DocContext } from "../doc/context.ts";

/** Positions and fragments past this many are counted, not listed. */
const LISTED = 24;
/** Width of a base in the drawing, and of the 5′ and 3′ labels either side. */
const BASE = 15;
const LABEL = 26;

const SVG = "http://www.w3.org/2000/svg";
function svg(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Both strands, the site shaded, and each cut as the step it makes between the strands. */
function cutFigure(name: string, d: CutDrawing, label: string): SVGElement {
  const width = LABEL * 2 + d.top.length * BASE;
  const fig = svg("svg", { class: "sv-enzyme-cut-figure", width, height: 62, viewBox: `0 0 ${width} 62`, role: "img", "aria-label": label });
  const x = (i: number) => LABEL + i * BASE;
  fig.append(svg("rect", { class: "sv-enzyme-cut-site", x: x(d.site[0]), y: 4, width: (d.site[1] - d.site[0]) * BASE, height: 54, rx: 4 }));
  for (const [strand, y, ends] of [[d.top, 24, ["5′", "3′"]], [d.bottom, 50, ["3′", "5′"]]] as const) {
    fig.append(svg("text", { class: "sv-enzyme-cut-end", x: LABEL - 8, y, "text-anchor": "end" }, ends[0]), svg("text", { class: "sv-enzyme-cut-end", x: x(strand.length) + 8, y }, ends[1]));
    [...strand].forEach((base, i) => {
      const inSite = i >= d.site[0] && i < d.site[1];
      fig.append(svg("text", { class: inSite ? "sv-enzyme-cut-base" : "sv-enzyme-cut-base sv-enzyme-cut-n", x: x(i) + BASE / 2, y, "text-anchor": "middle" }, base));
    });
  }
  for (const c of d.cuts) fig.append(svg("path", { class: "sv-enzyme-cut-line", d: `M${x(c.top)} 8V32H${x(c.bottom)}V56` }));
  fig.dataset.enzyme = name;
  return fig;
}

/** "396", "12 · 456 · 2,001", or the first ones and how many more. */
function listed(values: number[], unit = ""): string {
  const shown = values.slice(0, LISTED).map(fmt).join(" · ");
  return `${shown}${unit}${values.length > LISTED ? `, and ${fmt(values.length - LISTED)} more` : ""}`;
}

export function openEnzymeDialog(ctx: DocContext, written: string) {
  const name = enzymeName(written) ?? written;
  const cut = enzymeCut(name);
  const drawing = cutDrawing(name);
  const relatives = enzymeRelatives(name);
  const suppliers = enzymeSuppliers(name);
  const d = ctx.store.data;
  const sites = enzymeSites(d.sequence, d.circular, name);
  const digest = sites.length ? digestSequence(d, [name]) : null;
  let saving = false;
  const dlg = openDialog({ title: name, note: "Site, cut and suppliers from REBASE.", width: 640, onClose: () => (offPersonal(), offLab()) });
  const facts = (rows: [string, Node | string][]) => h("dl", { class: "sv-facts sv-enzyme-facts" }, rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]));
  const section = (title: string, ...body: (Node | null)[]) =>
    h("section", { class: "sv-protein-section", "aria-label": title }, h("div", { class: "sv-section-head sv-protein-head" }, h("h3", { class: "sv-section-title" }, title)), ...body);
  // Another enzyme's details take this one's place.
  const names = (list: string[]) =>
    h("span", { class: "sv-enzyme-names" }, list.map(other => h("button", { type: "button", class: "sv-link", title: `${enzymeCut(other)?.notation ?? other}: show its details`, onclick: () => { dlg.close(); openEnzymeDialog(ctx, other); } }, other)));

  const enzymePart = () => {
    if (!cut || !drawing) return section("Cut", h("p", { class: "sv-small sv-dim" }, "Not in this version's enzyme list."));
    const rows: [string, Node | string][] = [["Site", h("span", { class: "sv-mono" }, cut.notation)]];
    if (cut.rebase !== cut.notation) rows.push(["REBASE writes", h("span", { class: "sv-mono" }, cut.rebase)]);
    rows.push(["Ends", cut.ends]);
    rows.push(["Sold by", suppliers.join(", ")]);
    if (relatives.isoschizomers.length) rows.push(["Isoschizomers", names(relatives.isoschizomers)]);
    if (relatives.neoschizomers.length) rows.push(["Neoschizomers", names(relatives.neoschizomers)]);
    return section(
      "Cut",
      h("div", { class: "sv-enzyme-cut" }, cutFigure(name, drawing, `${name} cuts ${cut.notation}: ${cut.ends}`)),
      facts(rows),
      relatives.isoschizomers.length || relatives.neoschizomers.length ? h("p", { class: "sv-small sv-dim" }, "Isoschizomers cut the same site the same way; neoschizomers cut it elsewhere, leaving other ends.") : null
    );
  };

  const sequencePart = () => {
    if (!sites.length) return section("In this sequence", h("p", { class: "sv-small sv-dim" }, `${name} doesn't cut ${d.name || "this sequence"}.`));
    const sizes = digest?.fragments.map(fragmentSize) ?? [];
    return section(
      "In this sequence",
      facts([
        [sites.length === 1 ? "Site" : `${fmt(sites.length)} sites`, h("span", { class: "sv-mono" }, listed(sites.map(s => s.start + 1)))],
        [sizes.length === 1 ? "Fragment" : `${fmt(sizes.length)} fragments`, h("span", { class: "sv-mono" }, listed(sizes, " bp"))]
      ])
    );
  };

  const labPart = () => {
    const tubes = enzymeLibrary.all.filter(e => enzymeName(e.enzyme) === name);
    return section(
      "Lab stock",
      tubes.length
        ? h("ul", { class: "sv-enzyme-tubes" }, tubes.map(t => h("li", null, [t.product, t.location].filter(Boolean).join(" · ") || name, t.notes ? h("span", { class: "sv-dim" }, ` · ${t.notes}`) : null)))
        : h("p", { class: "sv-small sv-dim" }, enzymeLibrary.loaded ? "Not in your lab's stock." : "Loading…")
    );
  };

  const toggleMine = () => {
    const add = !personalEnzymes.all.some(n => (enzymeName(n) ?? n) === name);
    saving = true;
    render();
    void personalEnzymes
      .set(name, add)
      .then(() => toast(add ? `Added ${name} to My enzymes.` : `Removed ${name} from My enzymes.`, "success"))
      .catch(e => toast(e instanceof Error ? e.message : String(e), "error", 7000))
      .finally(() => {
        saving = false;
        render();
      });
  };

  function render() {
    dlg.body.replaceChildren(enzymePart(), sequencePart(), labPart());
    const mine = personalEnzymes.all.some(n => (enzymeName(n) ?? n) === name);
    const close = h("button", { type: "button", class: sites.length ? "sv-btn" : "sv-btn sv-btn-primary", onclick: () => dlg.close() }, "Close");
    const digestButton = h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => { dlg.close(); openDigestDialog(ctx, [name]); } }, `Digest with ${name}…`);
    dlg.footer.replaceChildren(
      h(
        "div",
        { class: "sv-foot-start" },
        h("button", { type: "button", class: "sv-btn", disabled: saving || !cut || !personalEnzymes.loaded || !!personalEnzymes.error, onclick: toggleMine }, mine ? "Remove from My enzymes" : "Add to My enzymes")
      ),
      close,
      ...(sites.length ? [digestButton] : [])
    );
  }

  const offPersonal = personalEnzymes.onChange(() => !saving && render());
  const offLab = enzymeLibrary.onChange(render);
  render();
}
