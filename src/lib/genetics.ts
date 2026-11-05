// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What a difference does to the features it falls in: coding consequences and coverage.
// Pure functions so they can be tested with plain Node.

import type { Difference, Feature, ReadResult } from "./types.ts";

const BASES = "TCAG";
// Standard genetic code, codons ordered TTT, TTC, TTA, TTG, TCT, ...
const AA = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";

let amberAsQ = false;

/**
 * Reads TAG as glutamine (Q) everywhere the app translates, as amber suppressor strains
 * (TG1, XL1-Blue) do. Each window applies Settings, like the Tm method.
 */
export function useAmberSuppression(on: boolean) {
  amberAsQ = on;
}
export const amberSuppressed = () => amberAsQ;

export function translateCodon(codon: string): string {
  const c = codon.toUpperCase().replace(/U/g, "T");
  if (c.length !== 3) return "?";
  if (amberAsQ && c === "TAG") return "Q";
  let idx = 0;
  for (const ch of c) {
    const v = BASES.indexOf(ch);
    if (v < 0) return "X";
    idx = idx * 4 + v;
  }
  return AA[idx];
}

const THREE: Record<string, string> = {
  A: "Ala", R: "Arg", N: "Asn", D: "Asp", C: "Cys", Q: "Gln", E: "Glu", G: "Gly", H: "His", I: "Ile",
  L: "Leu", K: "Lys", M: "Met", F: "Phe", P: "Pro", S: "Ser", T: "Thr", W: "Trp", Y: "Tyr", V: "Val",
  "*": "Stop", X: "Xaa"
};
export const threeLetter = (aa: string) => THREE[aa] ?? aa;

const COMP: Record<string, string> = { A: "T", T: "A", G: "C", C: "G" };
const complement = (b: string) => COMP[b.toUpperCase()] ?? "N";

export function isForward(f: Feature): boolean {
  if (typeof f.forward === "boolean") return f.forward;
  if (typeof f.strand === "number") return f.strand !== -1;
  return true;
}

/** Reference positions covered by a feature, in its own 5'→3' order. Handles joins and origin-spanning features. */
export function featurePositions(f: Feature, seqLength: number): number[] {
  const ranges = f.locations && f.locations.length ? f.locations : [{ start: f.start, end: f.end }];
  const pos: number[] = [];
  for (const r of ranges) {
    if (r.end >= r.start) {
      for (let i = r.start; i <= r.end; i++) pos.push(i);
    } else {
      // wraps the origin of a circular sequence
      for (let i = r.start; i < seqLength; i++) pos.push(i);
      for (let i = 0; i <= r.end; i++) pos.push(i);
    }
  }
  return isForward(f) ? pos : pos.reverse();
}

export function featureLength(f: Feature, seqLength: number): number {
  return featurePositions(f, seqLength).length;
}

export function featureContains(f: Feature, seqLength: number, pos: number): boolean {
  const ranges = f.locations && f.locations.length ? f.locations : [{ start: f.start, end: f.end }];
  return ranges.some(r => (r.end >= r.start ? pos >= r.start && pos <= r.end : pos >= r.start || pos <= r.end) && pos < seqLength);
}

export const isCoding = (f: Feature) => (f.type || "").toUpperCase() === "CDS";

/**
 * Whether a variable region that isn't annotated as coding carries on a CDS's frame: it
 * touches one that runs the same way, both in whole codons, and isn't already inside one.
 * Libraries are often annotated this way, as a CDS per framework with CDRs between them.
 */
export function continuesFrame(region: Feature, coding: Feature[]): boolean {
  const whole = (f: Feature) => (f.end - f.start + 1) % 3 === 0;
  if (region.start > region.end || !whole(region)) return false;
  if (coding.some(c => c.start <= region.start && c.end >= region.end)) return false;
  return coding.some(c => isForward(c) === isForward(region) && whole(c) && (c.end + 1 === region.start || region.end + 1 === c.start));
}

/**
 * The features grouped by the frame they share, each group in reading order: one runs on
 * into the next when they touch, go the same way, are whole codons and the first doesn't
 * end in a stop. A frameworks-and-CDRs annotation is then one protein, and a frameshift in
 * one part carries on through the rest. Most features are a group of their own.
 */
export function frameChains<T extends Feature>(features: T[], reference: string, circular: boolean): T[][] {
  const n = reference.length;
  const spans = features.map(f => featurePositions(f, n));
  const whole = (i: number) => spans[i].length > 0 && spans[i].length % 3 === 0;
  const endsInStop = (i: number) => {
    const codon = spans[i].slice(-3).map(p => (isForward(features[i]) ? reference[p].toUpperCase() : complement(reference[p]))).join("");
    return translateCodon(codon) === "*";
  };
  const next = new Map<number, number>();
  const taken = new Set<number>();
  features.forEach((f, i) => {
    if (!whole(i) || endsInStop(i)) return;
    const after = spans[i][spans[i].length - 1] + (isForward(f) ? 1 : -1);
    if (!circular && (after < 0 || after >= n)) return;
    const j = features.findIndex((g, k) => k !== i && !taken.has(k) && whole(k) && isForward(g) === isForward(f) && spans[k][0] === (after + n) % n);
    if (j < 0) return;
    next.set(i, j);
    taken.add(j);
  });
  const chains: T[][] = [];
  const seen = new Set<number>();
  const walk = (first: number) => {
    const chain: T[] = [];
    for (let i: number | undefined = first; i !== undefined && !seen.has(i); i = next.get(i)) {
      seen.add(i);
      chain.push(features[i]);
    }
    chains.push(chain);
  };
  features.forEach((_, i) => {
    if (!taken.has(i)) walk(i);
  });
  // Around a whole plasmid every feature follows another.
  features.forEach((_, i) => {
    if (!seen.has(i)) walk(i);
  });
  return chains;
}

export interface Consequence {
  feature: Feature;
  /** e.g. "K102R", "silent (L54)", "frameshift", "in-frame deletion of 2 aa" */
  label: string;
  severity: "silent" | "missense" | "nonsense" | "frameshift" | "inframe" | "noncoding";
  detail?: string;
}

/**
 * Effect of a difference on one feature it falls in.
 * `reference` is the full reference sequence (any case).
 */
export function consequenceIn(f: Feature, d: Difference, reference: string): Consequence {
  const n = reference.length;
  if (!isCoding(f)) return { feature: f, label: "in " + (f.name || f.type || "feature"), severity: "noncoding" };
  const positions = featurePositions(f, n);
  const forward = isForward(f);
  const baseAt = (p: number) => {
    const b = reference[p].toUpperCase();
    return forward ? b : complement(b);
  };

  if (d.kind === "substitution") {
    const idx = positions.indexOf(d.refPos);
    if (idx < 0) return { feature: f, label: "in " + (f.name || "CDS"), severity: "noncoding" };
    const codonIndex = Math.floor(idx / 3);
    const codonStart = codonIndex * 3;
    if (codonStart + 3 > positions.length) return { feature: f, label: "in incomplete last codon", severity: "noncoding" };
    const codonPos = positions.slice(codonStart, codonStart + 3);
    const refCodon = codonPos.map(baseAt).join("");
    const readBase = d.readBases.toUpperCase();
    const altBase = forward ? readBase : complement(readBase);
    const altCodon = codonPos.map((p, k) => (k === idx - codonStart ? altBase : baseAt(p))).join("");
    const a = translateCodon(refCodon);
    const b = translateCodon(altCodon);
    const num = codonIndex + 1;
    const detail = `${refCodon}→${altCodon}`;
    if (b === "X") return { feature: f, label: `ambiguous codon ${num}`, severity: "missense", detail };
    if (a === b) return { feature: f, label: `silent (${a}${num})`, severity: "silent", detail };
    if (b === "*") return { feature: f, label: `${a}${num}* (stop)`, severity: "nonsense", detail };
    return { feature: f, label: `${a}${num}${b}`, severity: "missense", detail };
  }

  const len = d.kind === "insertion" ? d.readBases.length : d.refBases.length;
  // Where in the CDS it lands, for the label.
  const anchor = positions.indexOf(d.refPos);
  const codon = anchor >= 0 ? Math.floor(anchor / 3) + 1 : undefined;
  const where = codon ? ` at codon ${codon}` : "";
  if (len % 3 !== 0) {
    return { feature: f, label: `frameshift${where}`, severity: "frameshift", detail: `${len} bp ${d.kind}` };
  }
  const aa = len / 3;
  return {
    feature: f,
    label: `in-frame ${d.kind} of ${aa} aa${where}`,
    severity: "inframe",
    detail: `${len} bp`
  };
}

/** Features a difference falls in (insertions count for the feature containing the base they precede and the one before). */
export function featuresAt(features: Feature[], seqLength: number, d: Difference): Feature[] {
  const probe: number[] = [];
  if (d.kind === "insertion") {
    probe.push((d.refPos - 1 + seqLength) % seqLength, d.refPos % seqLength);
  } else if (d.kind === "deletion") {
    for (let i = 0; i < d.refBases.length; i++) probe.push((d.refPos + i) % seqLength);
  } else {
    probe.push(d.refPos);
  }
  return features.filter(f => {
    if (d.kind === "insertion") return probe.every(p => featureContains(f, seqLength, p));
    return probe.some(p => featureContains(f, seqLength, p));
  });
}

export interface FeatureCoverage {
  feature: Feature;
  length: number;
  covered: number;
  /** Confident differences inside the feature. */
  differences: number;
}

/**
 * How much of each feature the aligned reads cover (trimmed, aligned part only), and how
 * many confident differences fall in it: `differences` when given (clones', so a change
 * two reads show counts once), otherwise each read's own.
 */
export function featureCoverage(features: Feature[], seqLength: number, reads: ReadResult[], differences?: Difference[]): FeatureCoverage[] {
  const covered = new Uint8Array(seqLength);
  for (const r of reads) {
    if (r.status !== "aligned") continue;
    for (let i = 0; i < r.refSpan; i++) covered[(r.refStart + i) % seqLength] = 1;
  }
  return features
    .filter(f => (f.type || "").toLowerCase() !== "source")
    .map(f => {
      const pos = featurePositions(f, seqLength);
      let c = 0;
      for (const p of pos) if (covered[p]) c++;
      const all = differences ?? reads.flatMap(r => (r.status === "aligned" ? r.differences : []));
      const diffs = all.filter(d => d.confident && featuresAt([f], seqLength, d).length).length;
      return { feature: f, length: pos.length, covered: c, differences: diffs };
    });
}

/** Human-readable description of a difference, 1-based coordinates. */
export function describeDifference(d: Difference, seqLength: number): string {
  if (d.kind === "substitution") return `${d.refBases}${d.refPos + 1}${d.readBases}`;
  if (d.kind === "deletion") {
    const a = d.refPos + 1;
    const b = d.refPos + d.refBases.length;
    return d.refBases.length === 1 ? `del ${d.refBases}${a}` : `del ${a}–${b} (${d.refBases.length} bp)`;
  }
  const after = d.refPos === 0 ? seqLength : d.refPos;
  const ins = d.readBases.length > 12 ? `${d.readBases.length} bp` : d.readBases;
  return `ins ${ins} after ${after}`;
}
