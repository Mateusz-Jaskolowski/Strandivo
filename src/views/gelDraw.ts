// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// One renderer for every simulated agarose gel: the Digest dialog's lanes and the PCR
// product's own. Sizes are top-strand lengths, as src/lib/gel.ts gives them, and the gel
// keeps its own colours in every theme.

import { h } from "../ui/dom.ts";
import { s } from "../ui/svg.ts";
import { bandY, LADDERS, type Ladder } from "../lib/gel.ts";

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

/** Room above the wells for the lane labels. */
const TOP = 22;

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
  const gelH = shape.height ?? 300;
  const laneW = shape.laneWidth ?? 46;
  const labelW = shape.labelWidth ?? 52;
  const width = labelW + laneW * (lanes.length + 1) + 8;
  const height = TOP + gelH + 18;
  const y = (size: number) => TOP + 6 + bandY(size, ladder) * (gelH - 12);
  const root = s("svg", { width, height, viewBox: `0 0 ${width} ${height}`, class: "sv-gel", role: "img", "aria-label": shape.ariaLabel ?? "Simulated agarose gel" });
  root.appendChild(s("rect", { x: labelW, y: TOP, width: width - labelW, height: gelH, rx: 6, class: "sv-gel-bg" }));
  const laneX = (i: number) => labelW + 4 + i * laneW;
  // Wells and lane labels, the ladder's own first.
  [{ label: "M", on: false }, ...lanes].forEach((lane, i) => {
    root.appendChild(s("rect", { x: laneX(i) + 5, y: TOP + 2, width: laneW - 10, height: 3, rx: 1, class: "sv-gel-well" }));
    root.appendChild(s("text", { x: laneX(i) + laneW / 2, y: TOP - 8, "text-anchor": "middle", "data-lane": i || null, class: `sv-gel-lane-label${lane.on ? " sv-gel-lane-on" : ""}` }, lane.label));
  });
  // The ladder, with its sizes on the left (the brighter bands' first where they'd crowd).
  let lastLabel = -Infinity;
  for (const size of ladder.bands) {
    const bright = ladder.bright.includes(size);
    root.appendChild(s("rect", { x: laneX(0) + 5, y: y(size) - 1.5, width: laneW - 10, height: bright ? 3.5 : 2.5, class: "sv-gel-band", opacity: bright ? 0.95 : 0.6 }));
    const next = ladder.bands[ladder.bands.indexOf(size) + 1];
    const crowdsBright = next !== undefined && ladder.bright.includes(next) && y(next) - y(size) < 10;
    if (y(size) - lastLabel < 10 || (!bright && crowdsBright)) continue;
    lastLabel = y(size);
    root.appendChild(s("text", { x: labelW - 6, y: y(size) + 3.5, "text-anchor": "end", class: "sv-gel-size" }, size >= 1000 ? `${size / 1000} kb` : `${size}`));
  }
  // Each sample lane is marked, so a key beside the gel can pick one of them out.
  lanes.forEach((lane, li) => {
    const x = laneX(li + 1) + 5;
    const total = lane.bands.reduce((sum, b) => sum + b.mass, 0) || 1;
    for (const b of lane.bands) {
      // Brightness follows how much DNA is in the band.
      const opacity = Math.min(1, 0.3 + (1.4 * b.mass) / total);
      const band = s(
        "rect",
        {
          x,
          y: y(b.runsAs ?? b.size) - 1.5,
          width: laneW - 10,
          height: 3,
          "data-size": String(Math.round(b.size)),
          "data-lane": li + 1,
          class: `sv-gel-band${b.class ? ` ${b.class}` : ""}${b.onClick ? " sv-gel-pick" : ""}${b.on ? " sv-gel-band-on" : ""}`,
          opacity
        },
        s("title", null, b.title)
      );
      if (b.onClick) band.addEventListener("click", b.onClick);
      root.appendChild(band);
    }
  });
  return root;
}
