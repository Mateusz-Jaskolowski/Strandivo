// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// An enzyme's cut in the enzyme library's lists: its site with the cut marked, and its ends.

import { enzymeCut } from "../lib/enzymes.ts";
import { h } from "../ui/dom.ts";

/** Two cells' contents, site then ends, or null for an enzyme not in REBASE's list of those sold. */
export function cutCells(name: string): [HTMLElement, HTMLElement] | null {
  const c = enzymeCut(name);
  if (!c) return null;
  const marked = (text: string) => text.split(/(\^)/).filter(Boolean).map(part => (part === "^" ? h("span", { class: "sv-cut-mark", title: "Top-strand cut" }, "^") : part));
  let parts: (HTMLElement | string)[];
  if (c.notation.startsWith("(")) {
    // Cuts on both sides, as REBASE writes them: (10/12)CGANNNNNNTGC(12/10).
    parts = c.notation
      .split(/(\(-?\d+\/-?\d+\))/)
      .filter(Boolean)
      .map(part => (part.startsWith("(") ? h("span", { class: "sv-cut-outside", title: "Bases from the site to the cut, top strand/bottom strand" }, part) : part));
  } else {
    // The site, then the Ns out to a cut past it in a lighter shade: GGTCTC N^NNNN.
    let at = 0;
    for (let letters = 0; at < c.notation.length && letters < c.site.length; at++) if (c.notation[at] !== "^") letters++;
    const rest = c.notation.slice(at);
    parts = [...marked(c.notation.slice(0, at)), ...(rest ? [h("span", { class: "sv-cut-spacer" }, ...marked(rest))] : [])];
  }
  const site = h("span", { class: "sv-cut-site sv-mono", title: c.notation === c.rebase ? null : `REBASE writes ${c.rebase}` }, ...parts);
  // "5′ AATT": the bases in the font of sequences.
  const overhang = /^([53]′) (.+)$/.exec(c.ends);
  const ends = h(
    "span",
    { class: "sv-cut-ends" },
    overhang ? [`${overhang[1]} `, h("span", { class: "sv-mono" }, overhang[2])] : c.ends === "Blunt" ? c.ends : h("span", { class: "sv-dim" }, c.ends)
  );
  return [site, ends];
}
