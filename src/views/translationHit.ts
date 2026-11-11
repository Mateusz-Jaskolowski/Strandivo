// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { codons, type Codon } from "../doc/analysis.ts";
import type { DocContext } from "../doc/context.ts";
import type { Selection } from "../doc/store.ts";
import { codonRanges, pickCodons, type CodonRef, type CodonSelection } from "../lib/codonSelection.ts";
import { h } from "../ui/dom.ts";
import { fmtRange } from "../ui/format.ts";

/** A transparent hit area over a displayed amino acid, shared by both sequence panels. */
export function codonHit(id: string, codon: Codon, left: number, width: number, top: number, height: number): HTMLElement {
  return h("div", {
    class: "sv-codon sv-hit",
    "data-kind": "feature",
    "data-id": id,
    "data-codon-start": String(codon.lo),
    "data-codon-end": String(codon.hi),
    "data-codon-index": String(codon.index),
    title: `${codon.aa}${codon.index} · ${fmtRange(codon.lo + 1, codon.hi + 1)}`,
    style: { position: "absolute", left: `${left}px`, width: `${width}px`, top: `${top}px`, height: `${height}px`, cursor: "pointer" }
  });
}

function codonOf(el: HTMLElement | null): CodonRef | null {
  return el?.dataset.codonIndex === undefined ? null : { feature: el.dataset.id!, index: Number(el.dataset.codonIndex) };
}

export function markCodonSelection(root: HTMLElement, selection: Selection) {
  const picked = new Set(selection.codons?.picks.map(p => `${p.feature}:${p.index}`));
  for (const el of root.querySelectorAll<HTMLElement>(".sv-codon")) el.classList.toggle("sv-codon-selected", picked.has(`${el.dataset.id}:${el.dataset.codonIndex}`));
}

/** Shared click and drag behaviour; a gesture keeps the CDS and its initial picks fixed. */
export class TranslationDrag {
  private gesture: { from: CodonRef; previous?: CodonSelection; add: boolean; extend: boolean } | null = null;

  constructor(private ctx: DocContext, private source: string) {}

  get active() { return this.gesture !== null; }

  begin(el: HTMLElement | null, e: MouseEvent): boolean {
    const from = codonOf(el);
    this.gesture = from ? { from, previous: this.ctx.store.selection.codons, add: (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? e.metaKey : e.ctrlKey) && !e.altKey, extend: e.shiftKey } : null;
    if (from) this.select(from, false);
    return !!from;
  }

  move(x: number, y: number, position: number): boolean {
    const gesture = this.gesture;
    if (!gesture) return false;
    // Captured pointer events name the canvas, so inspect what is actually under it.
    let to = codonOf(document.elementFromPoint(x, y)?.closest<HTMLElement>(".sv-codon") ?? null);
    if (to?.feature !== gesture.from.feature) {
      const d = this.ctx.store.data;
      const f = d.features.find(f => f.id === gesture.from.feature);
      if (!f) return true;
      const distance = (mid: number) => {
        const gap = Math.abs(mid - position);
        return d.circular ? Math.min(gap, d.sequence.length - gap) : gap;
      };
      const nearest = codons(f, d.sequence).reduce<Codon | null>((best, c) => !best || distance(c.mid) < distance(best.mid) ? c : best, null);
      to = nearest ? { feature: f.id, index: nearest.index } : null;
    }
    if (to) this.select(to, true);
    return true;
  }

  end() { this.gesture = null; }

  private select(to: CodonRef, dragging: boolean) {
    const g = this.gesture!;
    const picked = pickCodons(g.previous, to, g.add, g.extend, dragging ? g.from : undefined);
    const d = this.ctx.store.data;
    const f = d.features.find(f => f.id === to.feature);
    if (!f) return;
    const c = codons(f, d.sequence)[to.index - 1];
    if (!c) return;
    this.ctx.store.select({ ranges: codonRanges(d, picked), codons: picked, caret: c.hi + 1, anchor: c.lo }, this.source);
  }
}
