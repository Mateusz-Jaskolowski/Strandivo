// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// An enzyme's cut in the enzyme library's lists: its site with the cut marked, and its ends.

import { enzymeCut } from "../lib/enzymes.ts";
import { h } from "../ui/dom.ts";

/** Two cells' contents, site then ends, or null for an enzyme TeselaGen doesn't know. */
export function cutCells(name: string): [HTMLElement, HTMLElement] | null {
  const c = enzymeCut(name);
  if (!c) return null;
  const site = h(
    "span",
    { class: "sv-cut-site sv-mono" },
    c.at === null
      ? [c.site, c.outside ? h("span", { class: "sv-cut-outside", title: "Bases from the site to the cut, top strand/bottom strand" }, c.outside) : null]
      : [c.site.slice(0, c.at), h("span", { class: "sv-cut-mark", title: "Top-strand cut" }, "^"), c.site.slice(c.at)]
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
