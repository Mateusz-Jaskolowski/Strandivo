// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// A read's translation in a coding frame, for the Reads tab's alignment. The frame comes
// from the reference, so a read's messy start doesn't matter: translation starts at the
// first in-frame codon in a good stretch, whichever strand the read is on, and goes along
// the coding feature's direction with the read's own bases. A variable region has no
// bases of its own to match, so there any good call counts. It stops at the clone's
// frameshift (see AGENTS.md); indels nobody is sure of don't change the frame.
// Pure functions, so they can be unit-tested with plain Node.

import { firstAtOrAfter, type AlignedTrack, type AlignmentLayout } from "./alignLayout.ts";
import { complementBase } from "./chromatogram.ts";
import { translateCodon } from "./genetics.ts";
import type { Difference } from "./types.ts";

/**
 * Matching bases at or above the quality threshold that translation starts on. They may
 * run on past the feature's end, so a short feature can be translated too.
 */
export const GOOD_BASES = 10;

export interface ReadFrame {
  name: string;
  /** Reference positions in reading order, three for each codon. */
  positions: number[];
  forward: boolean;
}

export type CodonState = "same" | "differs" | "weak" | "afterStop";

export interface ReadCodon {
  c0: number;
  c1: number;
  /** Column of its middle base. */
  cm: number;
  aa: string;
  state: CodonState;
  odd: boolean;
}

export interface FrameStop {
  column: number;
  /** "L54fs". */
  label: string;
  /** The read starts past the frameshift, so nothing of it is translated. */
  past: boolean;
}

export interface ReadTranslation {
  codons: ReadCodon[];
  /** Columns of indels that nobody is sure of, read as if they weren't there. */
  uncertain: number[];
  stop: FrameStop | null;
}

export interface TranslationOptions {
  minQuality: number;
  /** Columns of the clone's confident indels (`indelColumns`). */
  confirmed: Set<number>;
  /** The clone's frameshift in this frame. */
  frameshift: { refPos: number; label: string } | null;
  /** Positions in variable regions, whose contents are not changes. */
  variable?: (position: number) => boolean;
}

/** The columns of these insertions and deletions. */
export function indelColumns(indels: Difference[], L: AlignmentLayout): Set<number> {
  const out = new Set<number>();
  const n = L.columnOf.length - 1;
  for (const d of indels) {
    if (d.kind === "insertion") {
      const from = d.refPos > 0 ? L.columnOf[d.refPos - 1] + 1 : 0;
      for (let c = from; c < L.columnOf[d.refPos]; c++) out.add(c);
    } else if (d.kind === "deletion") for (let i = 0; i < d.refBases.length; i++) out.add(L.columnOf[Math.min(d.refPos + i, n - 1)]);
  }
  return out;
}

interface Step {
  column: number;
  /** Index into the frame's positions (the next one, for inserted bases). */
  at: number;
  /** A reference base, or a column of inserted bases. */
  ref: boolean;
}

/** The track's columns inside the frame, in reading order. */
function steps(track: AlignedTrack, L: AlignmentLayout, frame: ReadFrame): Step[] {
  const out: Step[] = [];
  const inSpan = (c: number) => c >= track.firstColumn && c <= track.lastColumn;
  frame.positions.forEach((p, at) => {
    const prev = frame.positions[at - 1];
    // Inserted bases, between neighbours: not across an intron or the origin.
    if (at > 0 && Math.abs(p - prev) === 1) {
      const from = L.columnOf[Math.min(p, prev)] + 1;
      const to = L.columnOf[Math.max(p, prev)] - 1;
      for (let i = 0; i <= to - from; i++) {
        const c = frame.forward ? from + i : to - i;
        if (inSpan(c)) out.push({ column: c, at, ref: false });
      }
    }
    const c = L.columnOf[p];
    if (inSpan(c)) out.push({ column: c, at, ref: true });
  });
  return out;
}

export function translateTrack(track: AlignedTrack, L: AlignmentLayout, frame: ReadFrame, o: TranslationOptions): ReadTranslation {
  const none: ReadTranslation = { codons: [], uncertain: [], stop: null };
  const walk = steps(track, L, frame);
  if (!walk.length) return none;

  const quality = (c: number): number | null => {
    if (!track.qualities) return null;
    const k = firstAtOrAfter(track.baseColumns, c);
    return track.baseColumns[k] === c ? (track.qualities[track.baseIndex[k]] ?? 0) : null;
  };
  const goodCall = (c: number) => (quality(c) ?? Infinity) >= o.minQuality;

  // Where the reference doesn't say what to expect, any clear base will do.
  const anyBase = (p: number) => (o.variable?.(p) ?? false) || !/[ACGT]/i.test(L.reference[L.columnOf[p]]);
  const certain = (p: number) => {
    const c = L.columnOf[p];
    if (p < 0 || c === undefined || c < track.firstColumn || c > track.lastColumn) return false;
    const b = track.row[c].toUpperCase();
    return (anyBase(p) ? /[ACGT]/.test(b) : b === L.reference[c].toUpperCase()) && goodCall(c);
  };
  // Positions in reading order, on along the reference past the frame's end.
  const size = frame.positions.length;
  const positionAt = (at: number) => (at < size ? frame.positions[at] : frame.positions[size - 1] + (frame.forward ? 1 : -1) * (at - size + 1));

  // Where the clone's frameshift ends this read's translation.
  const shiftAt = o.frameshift ? frame.positions.indexOf(o.frameshift.refPos) : -1;
  const end = shiftAt < 0 ? -1 : walk.findIndex(s => s.at >= shiftAt);
  const stop = end >= 0 && o.frameshift ? { column: walk[end].column, label: o.frameshift.label, past: end === 0 } : null;
  const last = end >= 0 ? end : walk.length;

  // A read already in a good stretch before the frame reads on into it: a feature next to
  // another is no new start, and a weak base at its edge shouldn't blank it.
  const solidBefore = () => {
    const step = frame.forward ? -1 : 1;
    const inRead = (p: number) => L.columnOf[p] >= track.firstColumn && L.columnOf[p] <= track.lastColumn;
    let run = 0;
    for (let p = frame.positions[0] + step; inRead(p); p += step) {
      run = certain(p) ? run + 1 : 0;
      if (run === GOOD_BASES) return true;
    }
    return false;
  };

  const start = solidBefore() ? walk.findIndex((s, i) => i < last && s.ref && s.at % 3 === 0) : walk.findIndex((s, i) => {
    if (i >= last || !s.ref || s.at % 3 !== 0) return false;
    for (let k = 0; k < GOOD_BASES; k++) {
      const x = walk[i + k];
      if (end >= 0 && i + k >= end) return false;
      if (x ? !x.ref || x.at !== s.at + k : s.at + k < size) return false;
      if (!certain(positionAt(s.at + k))) return false;
    }
    return true;
  });
  if (start < 0) return { ...none, stop };

  const refBase = (p: number) => {
    const b = L.reference[L.columnOf[p]].toUpperCase();
    return frame.forward ? b : complementBase(b);
  };
  const out: ReadTranslation = { ...none, stop };
  let held: { base: string; step: Step; weak: boolean }[] = [];
  let afterStop = false;

  const emit = () => {
    const codon = held.map(x => x.base).join("");
    const aa = translateCodon(codon);
    const index = Math.floor(held[0].step.at / 3);
    const refCodon = frame.positions.slice(index * 3, index * 3 + 3);
    const refAa = translateCodon(refCodon.map(refBase).join(""));
    const inserted = held.some(x => !x.step.ref);
    const columns = held.map(x => x.step.column);
    const free = o.variable ? held.some(x => o.variable!(frame.positions[Math.min(x.step.at, frame.positions.length - 1)])) : false;
    const differs = (aa !== refAa || inserted) && !free && refAa !== "X";
    const state: CodonState = afterStop ? "afterStop" : held.some(x => x.weak) ? "weak" : differs ? "differs" : "same";
    out.codons.push({ c0: Math.min(...columns), c1: Math.max(...columns), cm: columns[1], aa, state, odd: index % 2 === 1 });
    // A stop that belongs there ends the feature, so there is nothing after it anyway.
    if (aa === "*" && refAa !== "*") afterStop = true;
    held = [];
  };

  for (let i = start; i < last; i++) {
    const step = walk[i];
    const raw = track.row[step.column].toUpperCase();
    const sure = o.confirmed.has(step.column);
    if (!step.ref) {
      if (raw === "-") continue;
      if (!sure) {
        out.uncertain.push(step.column);
        continue;
      }
    } else if (raw === "-") {
      if (sure) continue;
      out.uncertain.push(step.column);
    }
    const missing = raw === "-";
    const base = missing ? "N" : frame.forward ? raw : complementBase(raw);
    held.push({ base, step, weak: missing || !/[ACGT]/.test(raw) || !goodCall(step.column) });
    if (held.length === 3) emit();
  }
  return out;
}
