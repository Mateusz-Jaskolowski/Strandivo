// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Virtual digests and how their fragments would run on an agarose gel.

import { fragmentDigest, type Fragment } from "./cloning.ts";
import type { DnaMethylation } from "./methylation.ts";
import { topStrandLength, type Range, type SeqData } from "./seqdata.ts";

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
  return topStrandLength(f.data.sequence, f);
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
  problem?: string;
}

/**
 * What the enzymes cut a sequence into. With no enzymes or no cuts a linear sequence stays
 * whole. Given where the DNA was grown, sites methylation blocks don't cut.
 */
export function digestSequence(d: SeqData, enzymes: string[], methylation?: DnaMethylation): DigestResult {
  const { fragments, cut, problem } = fragmentDigest(d, enzymes, methylation);
  if (problem) return { fragments: [], uncut: false, problem };
  if (!cut && d.circular) return { fragments: [], uncut: true };
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

/**
 * Fragments that run together make one band: those within `resolution` of the band's largest
 * size, so a run of close sizes (1000, 985, 970, …) doesn't chain into one band. The mean
 * only places the band.
 */
export function bands(sizes: number[], resolution = 0.02): Band[] {
  const order = sizes.map((size, i) => ({ size, i })).sort((a, b) => b.size - a.size);
  const out: Band[] = [];
  for (const { size, i } of order) {
    const last = out[out.length - 1];
    const top = last ? sizes[last.fragments[0]] : 0;
    if (last && (top - size) / top <= resolution) {
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

/** The opened fragment retains the end information used for its gel band and future joins. */
export function fragmentDocument(f: Fragment, sourceName: string, methylation?: DnaMethylation): SeqData {
  return { ...f.data, name: fragmentName(f, sourceName), ends: { left: f.left, right: f.right }, methylation: methylation ?? f.data.methylation };
}
