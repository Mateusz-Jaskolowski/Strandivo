// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { featurePositions } from "./genetics.ts";
import { mergeRanges } from "./selection.ts";
import type { Range, SeqData } from "./seqdata.ts";

export interface CodonRef {
  feature: string;
  /** Residue number, from 1. */
  index: number;
}

export interface CodonSelection {
  picks: CodonRef[];
  /** The last ordinary or additive click; Shift keeps this fixed. */
  anchor: CodonRef;
}

export const sameCodon = (a: CodonRef, b: CodonRef) => a.feature === b.feature && a.index === b.index;

/** Whole residues between two ends, in their CDS's reading order. */
function between(from: CodonRef, to: CodonRef): CodonRef[] {
  if (from.feature !== to.feature) return [to];
  const lo = Math.min(from.index, to.index);
  return Array.from({ length: Math.abs(from.index - to.index) + 1 }, (_, i) => ({ feature: to.feature, index: lo + i }));
}

/** Click, toggle, Shift-click, or drag; a drag always includes its starting codon. */
export function pickCodons(previous: CodonSelection | undefined, to: CodonRef, add: boolean, extend: boolean, dragFrom?: CodonRef): CodonSelection {
  const anchor = extend && previous?.anchor.feature === to.feature ? previous.anchor : dragFrom ?? to;
  const span = between(anchor, to);
  if (add && !extend && !dragFrom) {
    const found = previous?.picks.some(p => sameCodon(p, to));
    return { anchor: to, picks: found ? previous!.picks.filter(p => !sameCodon(p, to)) : [...(previous?.picks ?? []), to] };
  }
  const kept = add ? previous?.picks ?? [] : [];
  const keys = new Set(kept.map(p => `${p.feature}:${p.index}`));
  return { anchor, picks: [...kept, ...span.filter(p => !keys.has(`${p.feature}:${p.index}`))] };
}

/** The actual coding bases, including codons split by an intron or the origin. */
export function codonRanges(data: SeqData, selection: CodonSelection): Range[] {
  const positions = new Map<string, number[]>();
  const ranges: Range[] = [];
  for (const p of selection.picks) {
    let ps = positions.get(p.feature);
    if (!ps) {
      const f = data.features.find(f => f.id === p.feature);
      if (!f) continue;
      ps = featurePositions(f, data.sequence.length);
      positions.set(p.feature, ps);
    }
    if (p.index < 1 || p.index * 3 > ps.length) continue;
    for (const at of ps.slice((p.index - 1) * 3, p.index * 3)) ranges.push({ start: at, end: at });
  }
  return mergeRanges(ranges, data.sequence.length, data.circular);
}
