// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import type { Codon } from "../doc/analysis.ts";
import type { Range } from "../lib/seqdata.ts";
import { h } from "../ui/dom.ts";
import { fmt } from "../ui/format.ts";

/** A transparent hit area over a displayed amino acid, shared by both sequence panels. */
export function codonHit(id: string, codon: Codon, left: number, width: number, top: number, height: number): HTMLElement {
  return h("div", {
    class: "sv-codon sv-hit",
    "data-kind": "feature",
    "data-id": id,
    "data-codon-start": String(codon.lo),
    "data-codon-end": String(codon.hi),
    title: `${codon.aa}${codon.index} · ${fmt(codon.lo + 1)}..${fmt(codon.hi + 1)}`,
    style: { position: "absolute", left: `${left}px`, width: `${width}px`, top: `${top}px`, height: `${height}px`, cursor: "pointer" }
  });
}

/** The DNA span of an amino acid; captions and other annotations have none. */
export function codonRange(el: HTMLElement | null): Range | null {
  return el?.dataset.codonStart === undefined ? null : { start: Number(el.dataset.codonStart), end: Number(el.dataset.codonEnd) };
}
