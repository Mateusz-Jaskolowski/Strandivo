// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What replacing selected bases would do, for the card that asks before it happens
// (`src/views/replaceCard.ts`): how many bases go in for how many, the change to each
// protein it touches, and what becomes of the annotations there by the rules of
// `replaceRange`. Pure, so it is unit-tested.

import { codingPositions, isCoding, isForward, translateCodon } from "./genetics.ts";
import { regionRange, regionsOf } from "./regions.ts";
import { basesIn, complement, inRange, rangeLength, rangesOverlap, rangeWithin, replaceRange, type Range, type SeqData, type SeqFeature } from "./seqdata.ts";
import { indelName } from "./variants.ts";

export interface Replacement {
  /** Bases selected, and bases to put in their place. */
  selected: number;
  typed: number;
  /** "ok" for as many as were selected, "warn" when it shifts a CDS's frame. */
  kind: "ok" | "warn" | "plain";
  /** "✓ 3 bases for 3 · same length", "⚠ 28 of 30 bases · shifts EGFP's frame", "6 bases for 3 · adds 1 residue". */
  status: string;
  /** Each CDS whose protein changes, named as in the Reads tab: I15A, I15fs, I15delinsAA. */
  effects: { name: string; change: string }[];
  /**
   * Features, primers and protein regions by what happens to them, empty when as many bases
   * go in as were selected, as then nothing moves: those holding the whole selection take
   * the new bases, those crossing an edge of it keep only their bases outside, and those
   * inside it go.
   */
  holds: string[];
  outside: string[];
  removed: string[];
}

const COUNT = new Intl.NumberFormat("en-US");
const bases = (k: number) => `${COUNT.format(k)} ${k === 1 ? "base" : "bases"}`;
const residues = (k: number) => `${COUNT.format(k)} ${k === 1 ? "residue" : "residues"}`;

/**
 * `typing` says the bases were typed rather than pasted: fewer than were selected is then
 * a replacement still being typed, counted as "28 of 30 bases". What it would do is said
 * all the same, a frameshift included, as Enter replaces with what is there.
 */
export function describeReplacement(d: SeqData, sel: Range, typed: string, typing: boolean): Replacement {
  const n = d.sequence.length;
  const selected = rangeLength(sel, n);
  const after = replaceRange(d, sel, typed).data;
  const coding = d.features.filter(f => isCoding(f) && codingPositions(f, n).some(p => inRange(sel, p)));
  const shifts: string[] = [];
  let residueChange = 0;
  const effects: Replacement["effects"] = [];
  for (const f of coding) {
    const g = after.features.find(x => x.id === f.id);
    if (!g) continue;
    const delta = codingPositions(g, after.sequence.length).length - codingPositions(f, n).length;
    if (delta % 3) shifts.push(f.name || "CDS");
    else if (!residueChange) residueChange = delta / 3;
    const change = proteinChange(d, after, f, g, sel, typed);
    if (change) effects.push({ name: f.name || "CDS", change });
  }
  const [holds, outside, removed] = typed.length === selected ? [[], [], []] : fates(d, sel);
  const count = typing && typed.length < selected ? `${COUNT.format(typed.length)} of ${bases(selected)}` : `${bases(typed.length)} for ${COUNT.format(selected)}`;
  let kind: Replacement["kind"] = "plain";
  let status: string;
  if (typed.length === selected) {
    kind = "ok";
    status = `✓ ${bases(typed.length)} for ${COUNT.format(selected)} · same length`;
  } else if (shifts.length) {
    kind = "warn";
    const whose = shifts.length === 1 ? `${shifts[0]}'s frame` : `the frame of ${shifts.length} CDSs`;
    status = `⚠ ${count} · shifts ${whose}`;
  } else {
    const more = residueChange > 0 ? ` · adds ${residues(residueChange)}` : residueChange < 0 ? ` · removes ${residues(-residueChange)}` : "";
    status = `${count}${more}`;
  }
  return { selected, typed: typed.length, kind, status, effects, holds, outside, removed };
}

/** The protein of a CDS, codon by codon from its first whole one, stops included. */
function protein(sequence: string, f: SeqFeature): string {
  const positions = codingPositions(f, sequence.length);
  const forward = isForward(f);
  let aa = "";
  for (let i = 0; i + 3 <= positions.length; i += 3) {
    let codon = "";
    for (let j = i; j < i + 3; j++) {
      const b = sequence[positions[j]].toUpperCase();
      codon += forward ? b : complement(b);
    }
    aa += translateCodon(codon);
  }
  return aa;
}

/** How CDS `f` (`g` after the replacement) changes, or null if its protein doesn't. */
function proteinChange(before: SeqData, after: SeqData, f: SeqFeature, g: SeqFeature, sel: Range, typed: string): string | null {
  const n = before.sequence.length;
  const positions = codingPositions(f, n);
  const R = protein(before.sequence, f);
  const M = protein(after.sequence, g);
  const delta = codingPositions(g, after.sequence.length).length - positions.length;
  if (delta % 3) {
    let p = 0;
    while (p < R.length && p < M.length && R[p] === M[p]) p++;
    return p < R.length ? `${R[p]}${p + 1}fs` : "frameshift";
  }
  if (delta) return R === M ? null : indelName(R, M, 0, c => R[c] ?? null);
  const changed: number[] = [];
  for (let i = 0; i < R.length; i++) if (R[i] !== M[i]) changed.push(i);
  if (changed.length > 3) return `${residues(changed.length)} change`;
  if (changed.length) return changed.map(i => `${R[i]}${i + 1}${M[i]}`).join(", ");
  // Other codons for the same amino acids.
  if (basesIn(before.sequence, sel).toUpperCase() === typed.toUpperCase()) return null;
  const k = Math.floor(positions.findIndex(p => inRange(sel, p)) / 3);
  return R[k] ? `silent (${R[k]}${k + 1})` : null;
}

/** Names of what holds the whole selection, crosses an edge of it, or lies inside it. */
function fates(d: SeqData, sel: Range): [string[], string[], string[]] {
  const n = d.sequence.length;
  const holds = new Set<string>();
  const outside = new Set<string>();
  const removed = new Set<string>();
  const sort = (name: string, spans: Range[], whole: Range) => {
    if (!spans.some(s => rangesOverlap(s, sel, n))) return;
    if (spans.some(s => rangeWithin(sel, s, n))) holds.add(name);
    else if (rangeWithin(whole, sel, n)) removed.add(name);
    else outside.add(name);
  };
  for (const f of d.features) {
    const name = f.name || f.type || "feature";
    sort(name, f.locations?.length ? f.locations : [f], f);
    for (const r of regionsOf(f)) {
      const range = regionRange(f, r, n);
      if (range) sort(r.name, [range], range);
    }
  }
  for (const p of d.primers) sort(p.name || "primer", [p], p);
  return [[...holds], [...outside], [...removed]];
}
