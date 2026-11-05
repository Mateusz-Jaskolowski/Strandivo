// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Virtual digests and how their fragments would run on an agarose gel.

import { digest, fragmentLength, type Fragment } from "./cloning.ts";
import type { Range, SeqData } from "./seqdata.ts";

export interface Ladder {
  id: string;
  name: string;
  /** Band sizes in bp, largest first. */
  bands: number[];
  /** The brighter reference bands. */
  bright: number[];
}

export const LADDERS: Ladder[] = [
  { id: "1kb", name: "1 kb ladder", bands: [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 500], bright: [3000] },
  {
    id: "1kb-plus",
    name: "1 kb Plus ladder",
    bands: [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
    bright: [3000, 1000, 500]
  },
  { id: "100bp", name: "100 bp ladder", bands: [1517, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100], bright: [1000, 500] }
];

/**
 * How far down the gel a band of `size` bp runs, 0 (wells) to 1 (bottom). DNA runs about
 * linearly with the log of its size, so the ladder's range is spread that way, with some
 * room above its largest band and below its smallest; anything beyond stays at the edges.
 */
export function bandY(size: number, ladder: Ladder): number {
  const top = Math.log(ladder.bands[0] * 1.6);
  const bottom = Math.log(ladder.bands[ladder.bands.length - 1] * 0.6);
  const y = (top - Math.log(Math.max(1, size))) / (top - bottom);
  return Math.min(0.99, Math.max(0.01, y));
}

/**
 * A fragment's size as gels and tables give it: its top strand, so the fragments of a
 * plasmid add up to its length. (The fragment itself also holds the bases of its
 * single-stranded ends.)
 */
export function fragmentSize(f: Fragment): number {
  return fragmentLength(f) - (f.left.kind === "3'" ? f.left.bases.length : 0) - (f.right.kind === "5'" ? f.right.bases.length : 0);
}

/** Where a fragment's top strand lies on its source (0-based, inclusive; may cross the origin). */
export function fragmentSpan(f: Fragment, n: number): Range {
  const start = (f.source.start + (f.left.kind === "3'" ? f.left.bases.length : 0)) % n;
  return { start, end: (start + fragmentSize(f) - 1) % n };
}

export interface DigestResult {
  /** Fragments, largest first. */
  fragments: Fragment[];
  /** A circular sequence the enzymes don't cut: it runs as a plasmid, not as a fragment. */
  uncut: boolean;
}

/** What the enzymes cut a sequence into. With no enzymes or no cuts a linear sequence stays whole. */
export function digestSequence(d: SeqData, enzymes: string[]): DigestResult {
  const fragments = digest(d, enzymes);
  if (!fragments.length && d.circular) return { fragments: [], uncut: true };
  return { fragments: [...fragments].sort((a, b) => fragmentSize(b) - fragmentSize(a)), uncut: false };
}

export interface Band {
  /** Mean size of the fragments in it. */
  size: number;
  /** The fragments that run together, as indexes into the lane's fragment list. */
  fragments: number[];
  /** Total bases, which sets how bright the band is. */
  mass: number;
}

/** Fragments that run together (within `resolution` of each other's size) make one band. */
export function bands(sizes: number[], resolution = 0.02): Band[] {
  const order = sizes.map((size, i) => ({ size, i })).sort((a, b) => b.size - a.size);
  const out: Band[] = [];
  for (const { size, i } of order) {
    const last = out[out.length - 1];
    const prev = last ? sizes[last.fragments[last.fragments.length - 1]] : 0;
    if (last && (prev - size) / prev <= resolution) {
      last.fragments.push(i);
      last.mass += size;
      last.size = last.mass / last.fragments.length;
    } else out.push({ size, fragments: [i], mass: size });
  }
  return out;
}

const INTEGER = new Intl.NumberFormat("en-US");

/** "pUC19 EcoRI–HindIII 2,635 bp": what a fragment opened in its own tab is called. */
export function fragmentName(f: Fragment, sourceName: string): string {
  const ends = `${f.left.enzyme ?? "end"}–${f.right.enzyme ?? "end"}`;
  return `${sourceName || "Fragment"} ${ends} ${INTEGER.format(fragmentSize(f))} bp`;
}
