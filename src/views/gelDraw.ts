// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// One renderer for every simulated agarose gel: the Digest dialog's lanes and the PCR
// product's own. Sizes are top-strand lengths, as src/lib/gel.ts gives them, and the gel
// keeps its own colours in every theme.

import { h } from "../ui/dom.ts";
import { s } from "../ui/svg.ts";
import { gelLayout, LADDERS, type Ladder } from "../lib/gel.ts";

export interface GelBand {
  /** Size in bp, which is what the band is called. */
  size: number;
  /** Where it runs, when that is not its size: supercoiled plasmid DNA runs ahead of it. */
  runsAs?: number;
  /** Bases in the band, which set how bright it is against the lane's total. */
  mass: number;
  /** What hovering it says. */
  title: string;
  /** Drawn as the picked band. */
  on?: boolean;
  /** An extra class, as for a plasmid that runs uncut. */
  class?: string;
  onClick?: () => void;
}

export interface GelLane {
  /** Over the well: a lane number, or what was loaded. The ladder's own is always "M". */
  label: string;
  on?: boolean;
  bands: GelBand[];
}

export interface GelShape {
  /** The gel itself, wells to the bottom. */
  height?: number;
  laneWidth?: number;
  /** Room on the left for the ladder's sizes. */
  labelWidth?: number;
  ariaLabel?: string;
}

/** The ladder every gel in this window runs beside, so a choice made in one holds in the next. */
const chosen: { ladder: string | null } = { ladder: null };
/** The ladder picked, or until one is, `opening`: the first, for a gel with nothing to say about it. */
export const currentLadder = (opening: Ladder = LADDERS[0]): Ladder => LADDERS.find(l => l.id === chosen.ladder) ?? opening;

export function ladderSelect(className: string, onChange: () => void, opening: Ladder = LADDERS[0]): HTMLSelectElement {
  return h(
    "select",
    {
      class: className,
      "aria-label": "Ladder",
      onchange: (e: Event) => {
        chosen.ladder = (e.target as HTMLSelectElement).value;
        onChange();
      }
    },
    LADDERS.map(l => h("option", { value: l.id, selected: l.id === currentLadder(opening).id }, l.name))
  ) as HTMLSelectElement;
}

/** The ladder in the first lane, then one lane per sample. */
export function gelSvg(lanes: GelLane[], ladder: Ladder, shape: GelShape = {}): SVGSVGElement {
  const layout = gelLayout(
    lanes.map(lane => ({ label: lane.label, bands: lane.bands.map(b => ({ size: b.size, runsAs: b.runsAs, mass: b.mass, uncut: b.class === "sv-gel-uncut" })) })),
    ladder,
    shape
  );
  const root = s("svg", { width: layout.width, height: layout.height, viewBox: `0 0 ${layout.width} ${layout.height}`, class: "sv-gel", role: "img", "aria-label": shape.ariaLabel ?? "Simulated agarose gel" });
  root.appendChild(s("rect", { x: layout.gelX, y: layout.gelY, width: layout.gelWidth, height: layout.gelHeight, rx: 6, class: "sv-gel-bg" }));
  for (const w of layout.wells) root.appendChild(s("rect", { x: w.x, y: w.y, width: w.width, height: w.height, rx: 1, class: "sv-gel-well" }));
  for (const l of layout.laneLabels) {
    const on = l.lane > 0 && lanes[l.lane - 1]?.on;
    root.appendChild(s("text", { x: l.x, y: l.y, "text-anchor": "middle", "data-lane": l.lane || null, class: `sv-gel-lane-label${on ? " sv-gel-lane-on" : ""}` }, l.label));
  }
  for (const lb of layout.ladderBands) {
    root.appendChild(s("rect", { x: lb.x, y: lb.y, width: lb.width, height: lb.height, class: "sv-gel-band", opacity: lb.opacity }));
    if (lb.label !== null) root.appendChild(s("text", { x: lb.labelX, y: lb.labelY, "text-anchor": "end", class: "sv-gel-size" }, lb.label));
  }
  for (const sb of layout.sampleBands) {
    const b = lanes[sb.lane - 1].bands[sb.bandIndex];
    const band = s(
      "rect",
      {
        x: sb.x,
        y: sb.y,
        width: sb.width,
        height: sb.height,
        "data-size": String(Math.round(b.size)),
        "data-lane": sb.lane,
        class: `sv-gel-band${b.class ? ` ${b.class}` : ""}${b.onClick ? " sv-gel-pick" : ""}${b.on ? " sv-gel-band-on" : ""}`,
        opacity: sb.opacity
      },
      s("title", null, b.title)
    );
    if (b.onClick) band.addEventListener("click", b.onClick);
    root.appendChild(band);
  }
  return root;
}
