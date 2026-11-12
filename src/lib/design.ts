// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Designing a PCR primer pair to amplify a region, optionally with 5′ additions such as
// restriction sites.

import { DIMER_BASES, findBindingSites, gcContent, meltingTemp, hasGoodClamp, threePrimeComplementarity } from "./primers.ts";
import { reverseComplement } from "./seqdata.ts";

export interface DesignOptions {
  tmMin: number;
  tmMax: number;
  minLength: number;
  maxLength: number;
  /** Bases added at the 5′ end of the forward / reverse primer (e.g. a restriction site). */
  forwardTail?: string;
  reverseTail?: string;
  /**
   * Shorten a tail whose end is already the template's next bases (NdeI's CATATG before an
   * ATG). On unless false; assembly overlaps must be added whole.
   */
  trimTails?: boolean;
  /**
   * How far each end may move outward from the region, so a primer stuck on an AT-rich or
   * GC-rich stretch can sit on a better one. The product only grows, so the region stays
   * covered. 0, the default, keeps each primer on the region's own edge. An end that gets
   * a 5′ addition never moves: a site is added for that edge (NdeI on a start codon), and
   * bases between the two would undo it.
   */
  moveEnds?: number;
}

export const DEFAULT_DESIGN: DesignOptions = { tmMin: 58, tmMax: 62, minLength: 18, maxLength: 30, moveEnds: 0 };

export interface DesignedPrimer {
  /** Whole primer, 5′→3′: tail in lower case, binding part in upper case. */
  bases: string;
  /** The part that pairs with the template, on the top strand. */
  start: number;
  end: number;
  strand: 1 | -1;
  /** Tm of the binding part. */
  tm: number;
  /** Places the binding part primes on the template; more than one means mispriming. */
  sites: number;
  /** Bases at its own 3′ end that pair with itself (a self-dimer from `DIMER_BASES` up). */
  selfDimer: number;
  /** Bases this end sits outward of the region's edge; 0 is on the edge. */
  moved: number;
}

export interface DesignedPair {
  forward: DesignedPrimer;
  reverse: DesignedPrimer;
  /** Lower is better: distance from the Tm window and between the two Tms, weak 3′ ends. */
  score: number;
}

/** Bases from `start` for `length` along a (possibly circular) sequence. */
function take(seq: string, start: number, length: number, circular: boolean): string | null {
  const n = seq.length;
  if (!circular && (start < 0 || start + length > n)) return null;
  let out = "";
  for (let i = 0; i < length; i++) out += seq[(((start + i) % n) + n) % n];
  return out;
}

/**
 * The 5′ addition actually needed in front of a binding part: when the end of `tail` is
 * already the start of the binding part (NdeI's CATATG before a start codon ATG), only
 * the rest is added.
 */
export function joinTail(tail: string, binding: string): string {
  const t = tail.toUpperCase();
  const b = binding.toUpperCase();
  for (let k = Math.min(t.length, b.length); k > 0; k--) if (t.slice(-k) === b.slice(0, k)) return tail.slice(0, tail.length - k);
  return tail;
}

interface Candidate {
  binding: string;
  tm: number;
  len: number;
  /** Where its 5′-most paired base sits (forward) or its 3′ end does (reverse). */
  at: number;
  /** Bases that position lies outward of the region's edge. */
  moved: number;
  /** Places it primes on the template, and bases its 3′ end pairs with itself. */
  sites: number;
  selfDimer: number;
}

/**
 * A primer designed into a repeated stretch — a second terminator, a promoter the plasmid
 * uses twice — amplifies more than the region asked for, and one whose 3′ end pairs with
 * itself makes dimer instead of product. Both are weighed with Tm and the 3′ clamp, so a
 * length that avoids them is preferred where one exists.
 */
const MISPRIMING_PENALTY = 12;

/**
 * A moved end costs this much a base, so the pair on the region's own edges wins whenever
 * a moved one is no better, and only a clearly better stretch pulls a primer away.
 */
const MOVE_PENALTY = 0.1;

/**
 * A binding part outside 40–60% GC costs this much a point outside, and `GC_WARN_PENALTY`
 * more once it is past the 35–65% `primerReport` warns on. Mild on purpose: Tm, the clamp
 * and mispriming still decide, and a region's own edges may be the only place to bind.
 */
const GC_PENALTY = 0.2;
const GC_WARN_PENALTY = 3;

/** What a binding part's GC content costs it. */
function gcCost(binding: string): number {
  const gc = gcContent(binding);
  return (gc < 40 ? 40 - gc : gc > 60 ? gc - 60 : 0) * GC_PENALTY + (gc < 35 || gc > 65 ? GC_WARN_PENALTY : 0);
}

/**
 * Looking for mispriming means a scan of the whole template, which moving the ends would
 * ask for hundreds of times: only this many of the best candidates are scanned. Ends that
 * stay put are all scanned, as they always were.
 */
const KEEP_SCANNED = 24;

/**
 * Lengths, and positions up to `move` bases outward, that a primer at this end of the
 * region could have: `at` is the region's edge, and a primer moves away from the region,
 * left for a forward primer and right for a reverse one.
 */
function candidates(seq: string, circular: boolean, at: number, o: DesignOptions, reverse: boolean, move = 0): Candidate[] {
  const n = seq.length;
  const target = (o.tmMin + o.tmMax) / 2;
  const rough: Omit<Candidate, "sites">[] = [];
  for (let moved = 0; moved <= move; moved++) {
    // Off the end of a linear sequence there is nowhere to move to; a circle wraps.
    const raw = reverse ? at + moved : at - moved;
    if (!circular && (raw < 0 || raw >= n)) continue;
    const pos = circular ? (((raw % n) + n) % n) : raw;
    for (let len = o.minLength; len <= o.maxLength; len++) {
      const bases = take(seq, reverse ? pos - len + 1 : pos, len, circular);
      if (!bases) continue;
      const binding = (reverse ? reverseComplement(bases) : bases).toUpperCase();
      const tm = meltingTemp(binding);
      if (tm === null) continue;
      rough.push({ binding, tm, len, at: pos, moved, selfDimer: threePrimeComplementarity(binding, binding) });
    }
  }
  // What a candidate costs on its own; mispriming needs the scan below.
  const alone = (c: Omit<Candidate, "sites">) =>
    Math.abs(c.tm - target) +
    (c.tm < o.tmMin || c.tm > o.tmMax ? 10 : 0) +
    (hasGoodClamp(c.binding) ? 0 : 3) +
    Math.max(0, c.selfDimer - (DIMER_BASES - 1)) * 2 +
    gcCost(c.binding) +
    c.moved * MOVE_PENALTY;
  const scanned = rough
    .sort((a, b) => alone(a) - alone(b))
    .slice(0, move ? KEEP_SCANNED : rough.length)
    .map(c => ({ ...c, sites: findBindingSites(c.binding, seq, circular).length }));
  const own = (c: Candidate) => alone(c) + Math.max(0, c.sites - 1) * MISPRIMING_PENALTY;
  // More places to pair from once the ends may move; the same five as ever when they can't.
  return scanned.sort((a, b) => own(a) - own(b)).slice(0, move ? 8 : 5);
}

/**
 * Primer pairs that amplify [start, end], best first: a forward primer at `start` and a
 * reverse primer at `end`, each as long as needed to reach the Tm window, with matched
 * Tms. With `moveEnds` either primer may sit that far outward of the region instead, which
 * only lengthens the product, so [start, end] is amplified either way.
 */
export function designPairs(seq: string, circular: boolean, start: number, end: number, o: DesignOptions = DEFAULT_DESIGN, count = 5): DesignedPair[] {
  const n = seq.length;
  if (!n) return [];
  const move = Math.max(0, Math.floor(o.moveEnds ?? 0));
  const fwd = candidates(seq, circular, start, o, false, o.forwardTail ? 0 : move);
  const rev = candidates(seq, circular, end, o, true, o.reverseTail ? 0 : move);
  const target = (o.tmMin + o.tmMax) / 2;
  const pairs: DesignedPair[] = [];
  for (const f of fwd) {
    for (const r of rev) {
      const trim = o.trimTails !== false;
      const fTail = trim ? joinTail(o.forwardTail ?? "", f.binding) : (o.forwardTail ?? "");
      const rTail = trim ? joinTail(o.reverseTail ?? "", r.binding) : (o.reverseTail ?? "");
      const fBases = fTail.toLowerCase() + f.binding;
      const rBases = rTail.toLowerCase() + r.binding;
      const window = (tm: number) => (tm < o.tmMin ? o.tmMin - tm : tm > o.tmMax ? tm - o.tmMax : 0);
      const dimer = Math.max(threePrimeComplementarity(fBases, rBases), threePrimeComplementarity(rBases, fBases));
      const misprimes = Math.max(0, f.sites - 1) + Math.max(0, r.sites - 1);
      const selfDimers = Math.max(0, f.selfDimer - (DIMER_BASES - 1)) + Math.max(0, r.selfDimer - (DIMER_BASES - 1));
      const score =
        Math.abs(f.tm - target) +
        Math.abs(r.tm - target) +
        2 * Math.abs(f.tm - r.tm) +
        5 * (window(f.tm) + window(r.tm)) +
        (hasGoodClamp(f.binding) ? 0 : 3) +
        (hasGoodClamp(r.binding) ? 0 : 3) +
        Math.max(0, dimer - 3) * 2 +
        misprimes * MISPRIMING_PENALTY +
        selfDimers * 2 +
        gcCost(f.binding) +
        gcCost(r.binding) +
        (f.moved + r.moved) * MOVE_PENALTY;
      pairs.push({
        forward: { bases: fBases, start: f.at, end: (f.at + f.len - 1) % n, strand: 1, tm: f.tm, sites: f.sites, selfDimer: f.selfDimer, moved: f.moved },
        reverse: { bases: rBases, start: (((r.at - r.len + 1) % n) + n) % n, end: r.at, strand: -1, tm: r.tm, sites: r.sites, selfDimer: r.selfDimer, moved: r.moved },
        score
      });
    }
  }
  return pairs.sort((a, b) => a.score - b.score).slice(0, count);
}

/** The best pair, or null. */
export function designPair(seq: string, circular: boolean, start: number, end: number, o: DesignOptions = DEFAULT_DESIGN): DesignedPair | null {
  return designPairs(seq, circular, start, end, o, 1)[0] ?? null;
}
