// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// An enzyme's cut in the enzyme library's lists: its site with the cut marked, and its ends.

import { enzymeCut } from "../lib/enzymes.ts";
import { h } from "../ui/dom.ts";

/** Two cells' contents, site then ends, or null for an enzyme not in REBASE's list of those sold. */
export function cutCells(name: string): [HTMLElement, HTMLElement] | null {
  const c = enzymeCut(name);
  if (!c) return null;
  // REBASE's notation, with the ^ and the bases to a cut outside the site (on either side) marked.
  const site = h(
    "span",
    { class: "sv-cut-site sv-mono" },
    c.notation
      .split(/(\(-?\d+\/-?\d+\)|\^)/)
      .filter(Boolean)
      .map(part =>
        part === "^"
          ? h("span", { class: "sv-cut-mark", title: "Top-strand cut" }, "^")
          : part.startsWith("(")
            ? h("span", { class: "sv-cut-outside", title: "Bases from the site to the cut, top strand/bottom strand" }, part)
            : part
      )
  );
  // "5′ AATT": the bases in the font of sequences.
  const overhang = /^([53]′) (.+)$/.exec(c.ends);
  const ends = h(
    "span",
    { class: "sv-cut-ends" },
    overhang ? [`${overhang[1]} `, h("span", { class: "sv-mono" }, overhang[2])] : c.ends === "Blunt" ? c.ends : h("span", { class: "sv-dim" }, c.ends)
  );
  return [site, ends];
}
