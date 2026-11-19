// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Virtual digests and how their fragments would run on an agarose gel.

import { digest, fragmentLength, type Fragment } from "./cloning.ts";
import type { DnaMethylation } from "./methylation.ts";
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
 * The ladder a gel opens on while nobody has picked one: the first whose smallest band is at
 * or below `smallest`, the smallest band the gel runs, or, if none reaches that low, the
 * first that goes lowest. `bandY` leaves little room under a ladder's smallest band and
 * draws anything under about 60% of it at the bottom edge, where small bands sit level and
 * can't be told apart (everything of 312 bp or less on the 1 kb ladder).
 */
export function ladderReaching(smallest: number, ladders: readonly Ladder[] = LADDERS): Ladder {
  const low = (l: Ladder) => Math.min(...l.bands);
  return ladders.find(l => low(l) <= smallest) ?? ladders.reduce((best, l) => (low(l) < low(best) ? l : best));
}

/**
 * An uncut plasmid is drawn where linear DNA of this share of its length runs. Supercoiled
 * DNA runs ahead of linear DNA of the same length, by an amount that depends on the gel and
 * the plasmid, so this is a drawing convention, not a measurement.
 */
export const SUPERCOILED_RUNS_AS = 0.7;

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

/**
 * What the enzymes cut a sequence into. With no enzymes or no cuts a linear sequence stays
 * whole. Given where the DNA was grown, sites methylation blocks don't cut.
 */
export function digestSequence(d: SeqData, enzymes: string[], methylation?: DnaMethylation): DigestResult {
  const fragments = digest(d, enzymes, methylation);
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

/** Up to this many fragments a lane's sizes are named one by one; more are counted instead. */
export const NAMED_SIZES = 4;

/** "2,635 + 51 bp", or "6 fragments, 2,686 bp in all": what a lane runs, as a key beside the gel says it. */
export function laneSizesText(sizes: readonly number[]): string {
  if (sizes.length <= NAMED_SIZES) return `${sizes.map(size => INTEGER.format(Math.round(size))).join(" + ")} bp`;
  return `${sizes.length} fragments, ${INTEGER.format(sizes.reduce((a, b) => a + b, 0))} bp in all`;
}

/**
 * "pUC19 · EcoRI, HindIII · 2,635 + 51 bp": one of the Digest dialog's lanes in the key
 * under a gel saved as an image, where nothing can be hovered to ask.
 */
export function digestLaneText(title: string, enzymes: readonly string[], result: DigestResult, length: number): string {
  const sizes = result.uncut ? `uncut plasmid, ${INTEGER.format(length)} bp` : laneSizesText(result.fragments.map(fragmentSize));
  return `${title} · ${enzymes.length ? enzymes.join(", ") : "no enzyme"} · ${sizes}`;
}

/** "pUC19 EcoRI–HindIII 2,635 bp": what a fragment opened in its own tab is called. */
export function fragmentName(f: Fragment, sourceName: string): string {
  const ends = `${f.left.enzyme ?? "end"}–${f.right.enzyme ?? "end"}`;
  return `${sourceName || "Fragment"} ${ends} ${INTEGER.format(fragmentSize(f))} bp`;
}
