// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Designing a PCR primer pair to amplify a region, optionally with 5′ additions such as
// restriction sites.

import { meltingTemp, hasGoodClamp, threePrimeComplementarity } from "./primers.ts";
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
}

export const DEFAULT_DESIGN: DesignOptions = { tmMin: 58, tmMax: 62, minLength: 18, maxLength: 30 };

export interface DesignedPrimer {
  /** Whole primer, 5′→3′: tail in lower case, binding part in upper case. */
  bases: string;
  /** The part that pairs with the template, on the top strand. */
  start: number;
  end: number;
  strand: 1 | -1;
  /** Tm of the binding part. */
  tm: number;
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
}

function candidates(seq: string, circular: boolean, at: number, o: DesignOptions, reverse: boolean): Candidate[] {
  const out: Candidate[] = [];
  for (let len = o.minLength; len <= o.maxLength; len++) {
    const raw = take(seq, reverse ? at - len + 1 : at, len, circular);
    if (!raw) continue;
    const binding = (reverse ? reverseComplement(raw) : raw).toUpperCase();
    const tm = meltingTemp(binding);
    if (tm !== null) out.push({ binding, tm, len });
  }
  const target = (o.tmMin + o.tmMax) / 2;
  const own = (c: Candidate) => Math.abs(c.tm - target) + (c.tm < o.tmMin || c.tm > o.tmMax ? 10 : 0) + (hasGoodClamp(c.binding) ? 0 : 3);
  return out.sort((a, b) => own(a) - own(b)).slice(0, 5);
}

/**
 * Primer pairs that amplify exactly [start, end], best first: a forward primer starting
 * at `start` and a reverse primer ending at `end`, each as long as needed to reach the
 * Tm window, with matched Tms.
 */
export function designPairs(seq: string, circular: boolean, start: number, end: number, o: DesignOptions = DEFAULT_DESIGN, count = 5): DesignedPair[] {
  const n = seq.length;
  if (!n) return [];
  const fwd = candidates(seq, circular, start, o, false);
  const rev = candidates(seq, circular, end, o, true);
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
      const score =
        Math.abs(f.tm - target) + Math.abs(r.tm - target) + 2 * Math.abs(f.tm - r.tm) + 5 * (window(f.tm) + window(r.tm)) + (hasGoodClamp(f.binding) ? 0 : 3) + (hasGoodClamp(r.binding) ? 0 : 3) + Math.max(0, dimer - 3) * 2;
      pairs.push({
        forward: { bases: fBases, start, end: (start + f.len - 1) % n, strand: 1, tm: f.tm },
        reverse: { bases: rBases, start: (((end - r.len + 1) % n) + n) % n, end, strand: -1, tm: r.tm },
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
