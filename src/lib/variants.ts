// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What a clone carries, from its consensus: mutations named in protein notation inside a
// CDS (codon by codon, so two changes in one codon are one amino-acid change) and as DNA
// changes outside one, whether it has a stop or a frameshift, what its reads cover, what
// it has in each variable region, and a key that is the same for identical clones. With
// the clone's double peaks (`src/lib/mixes.ts`) it also says whether the clone is a mix,
// and leaves out calls made among double peaks. Pure, so it is unit-tested.

import { complementBase } from "./chromatogram.ts";
import { codingPositions, continuesFrame, describeDifference, featureContains, featuresAt, featurePositions, frameChains, isCoding, isForward, translateCodon } from "./genetics.ts";
import { deleteRange, insertBases, replaceRange, type Range, type SeqData } from "./seqdata.ts";
import { regionKey, type ClonePeaks } from "./mixes.ts";
import type { CloneDifference, CloneResult, Feature } from "./types.ts";
import { inVariable, variableFeatures } from "./variable.ts";

export interface Mutation {
  /** "W163R", "W163*", "L54=", "L54fs", "G50_S52del", or a DNA change ("A2000G") outside a CDS. */
  label: string;
  /** The feature it is in (its name), if any. */
  feature: string | null;
  kind: "missense" | "nonsense" | "silent" | "frameshift" | "inframe" | "dna";
  /** First reference position involved (0-based). */
  refPos: number;
}

/**
 * Most important first. "mixed": two plasmids, from double peaks. "design": bases a
 * variable region's design doesn't allow. "poor": double peaks all along a read.
 * "partial": a coding feature or variable region the reads reach isn't read to its ends.
 */
export type CloneFlag = "unaligned" | "mixed" | "stop" | "frameshift" | "design" | "conflict" | "poor" | "partial";

/** What a clone has in one variable region. */
export interface RegionCall {
  /** The region's feature name. */
  feature: string;
  /**
   * The clone's bases there, in the direction the region is read (its CDS's, if it is in
   * one), with bases inserted right before or after it; lower case below the quality
   * threshold. Empty unless the reads cover all of it.
   */
  bases: string;
  /** Its amino acids, when it is coding or in a CDS; X for a codon with an uncertain base. */
  protein: string | null;
  read: "all" | "part" | "none";
  /** The closest of the design's versions, if it has versions. */
  alternative: string | null;
  /** Differences from that version, named like mutations. */
  mutations: Mutation[];
  /** Bases the design doesn't allow: "T at 412 not allowed by NNK". */
  violations: string[];
  /** The clone is a mix and its reads have double peaks here: the bases aren't one plasmid's. */
  mixed: boolean;
}

export interface CloneVariants {
  mutations: Mutation[];
  flags: CloneFlag[];
  /** Reference ranges read (0-based, inclusive; may cross the origin), and the rest. */
  covered: Range[];
  uncovered: Range[];
  /** Each coding feature the reads reach, translated from the clone; X where not read. */
  proteins: { feature: string; protein: string }[];
  /** One per variable region, in sequence order. */
  regions: RegionCall[];
  /** Rough share of the second plasmid (0.1 to 0.5) when the clone is a mix. */
  mixed: number | null;
  /** Changes left out because every read has double peaks around them, as DNA changes. */
  leftOut: string[];
  /** The clone's confident changes outside variable regions, left-out ones not among them. */
  changes: CloneDifference[];
  /** Positions read, but among double peaks in every read: no call there counts. */
  unreliable: Set<number>;
  /** The same for clones with the same DNA changes and flags. */
  key: string;
}

// Keeps IUPAC codes (a parent can spell its design out) and lower case (uncertain bases).
const complement = complementBase;
const revcomp = (s: string) => [...s].reverse().map(complement).join("");
const FLAG_ORDER: CloneFlag[] = ["unaligned", "mixed", "stop", "frameshift", "design", "conflict", "poor", "partial"];
// IUPAC codes as bit sets over A, C, G, T.
const IUPAC: Record<string, number> = { A: 1, C: 2, G: 4, T: 8, R: 5, Y: 10, S: 6, W: 9, K: 12, M: 3, B: 14, D: 13, H: 11, V: 7, N: 15 };

/** The reference ranges a clone's reads cover, joining the two ends of a circular sequence. */
export function coveredRanges(clone: CloneResult, n: number, circular: boolean): Range[] {
  const ranges = clone.pieces.map(p => ({ start: p.refFrom, end: p.refTo - 1 }));
  if (circular && ranges.length > 1 && ranges[0].start === 0 && ranges[ranges.length - 1].end === n - 1) {
    const last = ranges.pop()!;
    ranges[0] = { start: last.start, end: ranges[0].end };
  }
  return ranges;
}

function uncoveredRanges(clone: CloneResult, n: number, circular: boolean): Range[] {
  const out: Range[] = [];
  let at = 0;
  for (const p of clone.pieces) {
    if (p.refFrom > at) out.push({ start: at, end: p.refFrom - 1 });
    at = Math.max(at, p.refTo);
  }
  if (at < n) out.push({ start: at, end: n - 1 });
  // Joined across the origin, like the covered ranges.
  if (circular && out.length > 1 && out[0].start === 0 && out[out.length - 1].end === n - 1) {
    const last = out.pop()!;
    out[0] = { start: last.start, end: out[0].end };
  }
  return out;
}

/**
 * HGVS-style name of an in-frame change: reference amino acids `R` from codon index
 * `k` (0-based) became `M`. Amino acids the two share at either end are left out, so a
 * pure insertion is "L7_L8insYLGDTIEYSS" and a pure deletion "S9del"; anything else is
 * "…delins…". `aa(c)` is the reference amino acid of codon index c, null outside the CDS.
 */
function indelName(R: string, M: string, k: number, aa: (c: number) => string | null): string {
  let p = 0;
  while (p < R.length && p < M.length && R[p] === M[p]) p++;
  let s = 0;
  while (s < R.length - p && s < M.length - p && R[R.length - 1 - s] === M[M.length - 1 - s]) s++;
  const from = k + p;
  const to = k + R.length - s - 1;
  const span = (a: number, b: number) => `${aa(a)}${a + 1}${b > a ? `_${aa(b)}${b + 1}` : ""}`;
  const added = M.slice(p, M.length - s);
  if (from > to) {
    // Nothing replaced: bases inserted between codons from - 1 and from.
    if (from > 0 && aa(from - 1) && aa(from)) return `${aa(from - 1)}${from}_${aa(from)}${from + 1}ins${added}`;
    return `${span(k, k + R.length - 1)}delins${M}`;
  }
  return added ? `${span(from, to)}delins${added}` : `${span(from, to)}del`;
}

/**
 * What a clone's consensus changes in one frame: a coding feature, or several that run on
 * into one another (`frameChains`). Codons number from 1 in each feature. Codons in a
 * variable region (`variable` tells which differences are) are the clone's contents, not
 * mutations: only a stop or a frameshift there is reported. Bases inserted next to a
 * variable region in the frame (`regions`) count as the frame's, even at its ends.
 * `uncertain` positions read as N. Features past a frameshift get no protein, as they
 * aren't read in their own frame.
 */
function cdsChanges(chain: Feature[], reference: string, covered: (p: number) => boolean, diffs: CloneDifference[], variable: (d: CloneDifference) => boolean, regions: Feature[], uncertain: Set<number>) {
  const n = reference.length;
  const forward = isForward(chain[0]);
  let codon = 0;
  const parts = chain.map(f => {
    const positions = codingPositions(f, n);
    const from = codon;
    codon += Math.floor(positions.length / 3);
    return { f, name: f.name || "CDS", positions, from, to: codon };
  });
  const partOf = (k: number) => parts.find(x => k < x.to) ?? parts[parts.length - 1];
  const positions = parts.flatMap(x => x.positions);
  const inFrame = new Set(positions);
  const within = (p: number) => inFrame.has((p + n) % n);
  // Bases inserted where two of the features meet are the frame's too.
  const mine = diffs.filter(d => (d.kind === "insertion" ? (within(d.refPos) && within(d.refPos - 1)) || inVariable(d, regions, n) : featuresAt(chain, n, d).length));
  const subs = new Map<number, string>();
  const dels = new Set<number>();
  const ins = new Map<number, string>();
  // Positions changed by a variable region's contents, and where its bases are inserted.
  const varAt = new Set<number>();
  const varIns = new Set<number>();
  for (const d of mine) {
    if (d.kind === "substitution") subs.set(d.refPos, d.readBases.toUpperCase());
    else if (d.kind === "deletion") for (let i = 0; i < d.refBases.length; i++) dels.add((d.refPos + i) % n);
    else ins.set(d.refPos, d.readBases.toUpperCase());
    if (!variable(d)) continue;
    if (d.kind === "insertion") varIns.add(d.refPos);
    else for (let i = 0; i < Math.max(1, d.refBases.length); i++) varAt.add((d.refPos + i) % n);
  }
  const codonCount = codon;
  // The clone's bases for each reference codon, in reading order (insertions go with the
  // codon after them); N where the reads don't reach.
  const chunks = new Array<string>(codonCount).fill("");
  // Codons holding a variable region's contents.
  const varCodon = new Set<number>();
  const inRegion = (k: number) => positions.slice(k * 3, k * 3 + 3).some(p => regions.some(r => featureContains(r, n, p)));
  // Bases inserted before reading position i (i = 0: before the feature, only a variable
  // region's), by the reference position they precede.
  const before = (i: number) => (i === 0 ? (forward ? positions[0] : (positions[0] + 1) % n) : forward ? positions[i] : positions[i - 1]);
  const addInserted = (at: number, k: number) => {
    const inserted = ins.get(at);
    if (!inserted) return;
    chunks[k] += forward ? inserted : revcomp(inserted);
    if (varIns.has(at)) varCodon.add(k);
  };
  for (let i = 0; i < codonCount * 3; i++) {
    const p = positions[i];
    const k = Math.floor(i / 3);
    if (i > 0 || varIns.has(before(0))) addInserted(before(i), k);
    if (varAt.has(p) || uncertain.has(p)) varCodon.add(k);
    if (dels.has(p)) continue;
    const b = !covered(p) || uncertain.has(p) ? "N" : (subs.get(p) ?? reference[p].toUpperCase());
    chunks[k] += forward ? b : complement(b);
  }
  // And after its last base, when they belong to a variable region.
  if (codonCount) {
    const last = positions[codonCount * 3 - 1];
    const after = forward ? (last + 1) % n : last;
    if (varIns.has(after)) addInserted(after, codonCount - 1);
  }
  const refCodon = (k: number) =>
    positions
      .slice(k * 3, k * 3 + 3)
      .map(p => (forward ? reference[p].toUpperCase() : complement(reference[p].toUpperCase())))
      .join("");
  const translate = (s: string) => {
    let aa = "";
    for (let i = 0; i + 3 <= s.length; i += 3) aa += translateCodon(s.slice(i, i + 3));
    return aa;
  };

  const mutations: Mutation[] = [];
  let stop = false;
  let frameshift = false;
  let shiftedAt = Infinity;
  const at = (k: number) => positions[k * 3];
  const number = (k: number) => k - partOf(k).from + 1;
  const add = (label: string, kind: Mutation["kind"], k: number) => mutations.push({ label, feature: partOf(k).name, kind, refPos: at(k) });
  if (mine.length) {
    for (let k = 0; k < codonCount; k++) {
      const chunk = chunks[k];
      if (chunk.length === 3) {
        const ref = refCodon(k);
        if (chunk === ref || chunk.includes("N")) continue;
        const a = translateCodon(ref);
        const b = translateCodon(chunk);
        if (varCodon.has(k)) {
          if (b === "*") stop = true;
          continue;
        }
        if (a === b) add(`${a}${number(k)}=`, "silent", k);
        else if (b === "*") {
          add(`${a}${number(k)}*`, "nonsense", k);
          stop = true;
        } else add(`${a}${number(k)}${b}`, "missense", k);
        continue;
      }
      // An insertion or deletion: take the codons it changes together, and find where the
      // frame is back, if it ever is.
      let j = k;
      let shift = chunks[k].length - 3;
      while (j + 1 < codonCount && (shift % 3 !== 0 || chunks[j + 1].length !== 3)) shift += chunks[++j].length - 3;
      const a = translateCodon(refCodon(k));
      // A length change that isn't a multiple of 3 is a frameshift, in a variable region too.
      if (shift % 3 !== 0) {
        add(`${a}${number(k)}fs`, "frameshift", k);
        frameshift = true;
        shiftedAt = k;
        break;
      }
      const R = translate(chunks.slice(k, j + 1).map((_, x) => refCodon(k + x)).join(""));
      const M = translate(chunks.slice(k, j + 1).join(""));
      if (M !== R) {
        const truncated = M.includes("*") && !R.includes("*");
        // Loops of another length are what a variable region is for; a framework read out
        // of frame between two of them is not.
        const expected = chunks.slice(k, j + 1).every((_, x) => varCodon.has(k + x) || inRegion(k + x));
        const first = partOf(k).from;
        if (!expected) add(indelName(R, M, k - first, c => (c + first >= 0 && c + first < codonCount ? translateCodon(refCodon(c + first)) : null)), truncated ? "nonsense" : "inframe", k);
        if (truncated) stop = true;
      }
      k = j;
    }
  }
  // The clone's protein in each feature, up to its first stop.
  const proteins = parts
    .filter(x => x.from <= shiftedAt)
    .map(x => {
      const mutant = translate(chunks.slice(x.from, x.to).join(""));
      const end = mutant.indexOf("*");
      return { f: x.f, protein: end >= 0 ? mutant.slice(0, end + 1) : mutant };
    });
  return { mine, mutations, stop, frameshift, proteins };
}

/**
 * Mutations, flags, coverage, region contents and identity of a clone (see the file
 * comment). Bases of a variable region below `minQuality` count as uncertain, and so do
 * `peaks.unreliable` positions anywhere.
 */
export function cloneVariants(clone: CloneResult, reference: string, circular: boolean, features: Feature[], minQuality = 20, peaks?: ClonePeaks): CloneVariants {
  const n = reference.length;
  const covered = coveredRanges(clone, n, circular);
  const uncovered = uncoveredRanges(clone, n, circular);
  const isCovered = (p: number) => clone.pieces.some(x => p >= x.refFrom && p < x.refTo);
  const annotated = features.filter(f => (f.type || "").toLowerCase() !== "source");
  const coding = annotated.filter(isCoding);
  const regions = variableFeatures(annotated);
  // Differences in variable regions are the clone's contents; they still make its
  // proteins and tell clones apart.
  const all = [...clone.differences, ...(clone.variable ?? [])];
  const isVariable = (d: CloneDifference) => inVariable(d, regions, n);
  // Calls among double peaks: a mix's, or a read's noisy ends.
  const unreliable = peaks?.unreliable ?? new Set<number>();
  const amongDoubles = (d: CloneDifference) => {
    if (d.kind === "insertion") return unreliable.has(d.refPos) || unreliable.has((d.refPos - 1 + n) % n);
    for (let i = 0; i < d.refBases.length; i++) if (unreliable.has((d.refPos + i) % n)) return true;
    return false;
  };
  const leftOut = all.filter(d => d.confident && amongDoubles(d));
  const confident = all.filter(d => d.confident && !amongDoubles(d));
  const uncertain = new Set([...unreliable, ...all.filter(d => !d.confident && d.kind === "substitution" && isVariable(d)).map(d => d.refPos)]);
  const flags = new Set<CloneFlag>();
  if (!clone.pieces.length) flags.add("unaligned");
  if (clone.conflicts.length) flags.add("conflict");
  if (peaks?.mixed) flags.add("mixed");
  if (peaks?.poor) flags.add("poor");

  const mutations: Mutation[] = [];
  // Where each mutation sorts: a CDS's changes stay together in reading order.
  const order = new Map<Mutation, number>();
  const proteins: { feature: string; protein: string }[] = [];
  const explained = new Set<CloneDifference>();
  // A variable region between two CDSs is read in their frame.
  const framed = [...coding, ...regions.filter(r => !isCoding(r) && continuesFrame(r, coding))];
  for (const chain of frameChains(framed, reference, circular)) {
    const reached = chain.filter(f => {
      const positions = featurePositions(f, n);
      const read = positions.filter(isCovered).length;
      if (read && read < positions.length) flags.add("partial");
      return read > 0;
    });
    if (!reached.length) continue;
    const inside = regions.filter(r => featurePositions(r, n).every(p => chain.some(f => featureContains(f, n, p))));
    const c = cdsChanges(chain, reference, isCovered, confident, isVariable, inside, uncertain);
    const starts = new Map(chain.map(f => [f.name || "CDS", Math.min(f.start, f.end)]));
    for (const d of c.mine) explained.add(d);
    for (const m of c.mutations) order.set(m, starts.get(m.feature!)!);
    mutations.push(...c.mutations);
    for (const p of c.proteins) if (reached.includes(p.f)) proteins.push({ feature: p.f.name || "CDS", protein: p.protein });
    if (c.stop) flags.add("stop");
    if (c.frameshift) flags.add("frameshift");
  }
  for (const d of confident) {
    if (explained.has(d) || isVariable(d)) continue;
    const inside = featuresAt(annotated, n, d)[0];
    mutations.push({ label: describeDifference(d, n), feature: inside ? inside.name || inside.type || null : null, kind: "dna", refPos: d.refPos });
  }
  const calls: RegionCall[] = [];
  for (const f of [...regions].sort((a, b) => a.start - b.start)) {
    const call = regionCall(clone, f, reference, coding, minQuality, peaks?.mixedRegions.has(regionKey(f)) ?? false);
    calls.push(call);
    for (const m of call.mutations) order.set(m, Math.min(f.start, f.end));
    mutations.push(...call.mutations);
    if (call.violations.length) flags.add("design");
    if (call.read === "part") flags.add("partial");
  }
  mutations.sort((a, b) => (order.get(a) ?? a.refPos) - (order.get(b) ?? b.refPos));
  const ordered = FLAG_ORDER.filter(f => flags.has(f));
  // Identical means the same DNA: TGA and TAG are both W163* but not the same clone.
  const key = [...ordered, ...[...confident].sort((a, b) => a.refPos - b.refPos).map(d => describeDifference(d, n))].join("|");
  return {
    mutations,
    flags: ordered,
    covered,
    uncovered,
    proteins,
    regions: calls,
    mixed: peaks?.mixed ?? null,
    leftOut: leftOut.filter(d => !isVariable(d)).map(d => describeDifference(d, n)),
    changes: confident.filter(d => !isVariable(d)),
    unreliable,
    key
  };
}

/** Edit distance, for picking the closest version of a region. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Where a variable region is read: its positions in reading order, and, when it is coding
 * or lies in a CDS, that CDS's positions and where the region starts in them.
 */
function regionFrame(f: Feature, coding: Feature[], n: number): { positions: number[]; forward: boolean; cds: number[] | null; offset: number } {
  const own = featurePositions(f, n);
  for (const g of isCoding(f) ? [f] : coding) {
    const cds = codingPositions(g, n);
    const offset = cds.findIndex(p => featureContains(f, n, p));
    if (offset < 0 || offset + own.length > cds.length) continue;
    const positions = cds.slice(offset, offset + own.length);
    if (positions.every(p => featureContains(f, n, p))) return { positions, forward: isForward(g), cds, offset };
  }
  return { positions: own, forward: isForward(f), cds: null, offset: 0 };
}

/** The IUPAC pattern a region's contents of a given length are held to, if any. */
function designPattern(f: Feature, parent: string, length: number): string | null {
  const design = f.variable!;
  if (design.kind === "pattern") return design.pattern;
  return design.kind === "any" && /[RYSWKMBDHV]/.test(parent) && parent.length === length ? parent : null;
}

/** A codon of a variable region that the design lets vary. */
export interface DegenerateCodon {
  /** Where it starts in a clone's bases for the region (`RegionCall.bases`). */
  at: number;
  /** Its number in the CDS, from 1. */
  number: number;
  /** Its first base on the reference. */
  refPos: number;
  /** "NNK". */
  pattern: string;
  /** Every codon the pattern allows. */
  allowed: string[];
}

/** The codons a region's pattern lets vary; none when it isn't in a CDS or has no pattern. */
export function degenerateCodons(f: Feature, reference: string, features: Feature[]): DegenerateCodon[] {
  const n = reference.length;
  const { positions, forward, cds, offset } = regionFrame(f, features.filter(isCoding), n);
  if (!cds) return [];
  const parent = positions.map(p => (forward ? reference[p].toUpperCase() : complement(reference[p].toUpperCase()))).join("");
  const pattern = designPattern(f, parent, parent.length);
  if (!pattern) return [];
  const out: DegenerateCodon[] = [];
  // Whole codons of the CDS only: bases from the region's first full one on.
  for (let at = (3 - (offset % 3)) % 3; at + 3 <= positions.length; at += 3) {
    const codon = [0, 1, 2].map(i => pattern[(at + i) % pattern.length]).join("");
    const allowed = [...codon].reduce((all, code) => all.flatMap(c => [..."ACGT"].filter(b => (IUPAC[code] ?? 15) & IUPAC[b]).map(b => c + b)), [""]);
    if (allowed.length > 1) out.push({ at, number: (offset + at) / 3 + 1, refPos: positions[at], pattern: codon, allowed });
  }
  return out;
}

/** What a clone has in one variable region (see `RegionCall`). */
function regionCall(clone: CloneResult, f: Feature, reference: string, coding: Feature[], minQuality: number, mixed: boolean): RegionCall {
  const n = reference.length;
  const name = f.name || f.type || "Region";
  const { positions, forward, cds, offset } = regionFrame(f, coding, n);
  const out: RegionCall = { feature: name, bases: "", protein: null, read: "none", alternative: null, mutations: [], violations: [], mixed };
  if (!positions.length) return out;

  // The consensus by reference position: its base there (none for a missing base) and the
  // bases inserted before it, lower case where uncertain.
  const cased = (b: string, q: number) => (q >= minQuality ? b.toUpperCase() : b.toLowerCase());
  const base = new Map<number, string>();
  const inserted = new Map<number, string>();
  for (const piece of clone.pieces) {
    let pos = piece.refFrom;
    for (let i = 0; i < piece.gappedReference.length; i++) {
      const c = piece.gappedConsensus[i];
      const q = piece.qualities[i] ?? 0;
      if (piece.gappedReference[i] === "-") {
        if (c !== "-") inserted.set(pos, (inserted.get(pos) ?? "") + cased(c, q));
      } else {
        base.set(pos, c === "-" ? "" : cased(c, q));
        pos++;
      }
    }
  }
  const inOrder = forward ? positions : [...positions].reverse();
  let top = "";
  let read = 0;
  for (const p of inOrder) {
    top += inserted.get(p) ?? "";
    const b = base.get(p);
    if (b !== undefined) read++;
    top += b ?? "";
  }
  top += inserted.get((inOrder[inOrder.length - 1] + 1) % n) ?? "";
  out.read = read === positions.length ? "all" : read ? "part" : "none";
  if (out.read !== "all") return out;
  const bases = forward ? top : revcomp(top);
  out.bases = bases;
  const content = bases.toUpperCase();
  const parentBase = (p: number) => (forward ? reference[p].toUpperCase() : complement(reference[p].toUpperCase()));

  // Amino acids, from the codon the region starts in; X where a base is uncertain.
  const phase = offset % 3;
  if (cds) {
    const coded = cds.slice(offset - phase, offset).map(parentBase).join("") + bases;
    let protein = "";
    for (let i = 0; i + 3 <= coded.length; i += 3) {
      const codon = coded.slice(i, i + 3);
      protein += codon === codon.toUpperCase() ? translateCodon(codon) : "X";
    }
    out.protein = protein;
  }

  // Two plasmids' bases: neither a version nor the design can be told from them.
  if (mixed) return out;
  const design = f.variable!;
  if (design.kind === "alternatives") {
    const best = design.options.reduce((a, b) => (distance(b.bases, content) < distance(a.bases, content) ? b : a));
    out.alternative = best.name;
    const alt = best.bases;
    const add = (label: string, kind: Mutation["kind"], refPos: number) => out.mutations.push({ label, feature: name, kind, refPos });
    if (alt.length !== content.length) {
      const change = content.length - alt.length;
      add(`${best.name} ${change > 0 ? "+" : ""}${change} bp`, cds ? (change % 3 ? "frameshift" : "inframe") : "dna", positions[0]);
    } else if (cds && phase === 0) {
      for (let i = 0; i + 3 <= alt.length; i += 3) {
        const a = alt.slice(i, i + 3);
        const b = content.slice(i, i + 3);
        if (a === b || bases.slice(i, i + 3) !== b) continue;
        const A = translateCodon(a);
        const B = translateCodon(b);
        const k = (offset + i) / 3 + 1;
        if (A === B) add(`${A}${k}=`, "silent", positions[i]);
        else add(`${A}${k}${B}`, B === "*" ? "nonsense" : "missense", positions[i]);
      }
    } else {
      for (let i = 0; i < alt.length; i++) if (alt[i] !== bases[i] && bases[i] === content[i]) add(`${alt[i]}${positions[i] + 1}${bases[i]}`, "dna", positions[i]);
    }
  }

  // Bases the design doesn't allow: a pattern repeated over the region, or the parent's
  // own IUPAC codes when it spells the design out (then only if the length is unchanged).
  const parent = positions.map(parentBase).join("");
  const pattern = designPattern(f, parent, content.length);
  if (pattern) {
    for (let i = 0; i < bases.length; i++) {
      const b = bases[i];
      const code = pattern[i % pattern.length];
      if (!"ACGT".includes(b) || (IUPAC[code] ?? 15) & IUPAC[b]) continue;
      out.violations.push(`${b} at ${positions[Math.min(i, positions.length - 1)] + 1} not allowed by ${design.kind === "pattern" ? pattern : code}`);
    }
  }
  return out;
}

/**
 * The clone as a sequence: the reference with the clone's confident differences, so
 * parts no read covered stay as the reference. Features follow the edits.
 */
export function cloneSequence(data: SeqData, clone: CloneResult): SeqData {
  const diffs = [...clone.differences, ...(clone.variable ?? [])].filter(d => d.confident);
  // From the end, so earlier positions stay put; at one position the base before the
  // bases inserted ahead of it.
  const order = { substitution: 0, deletion: 0, insertion: 1 };
  diffs.sort((a, b) => b.refPos - a.refPos || order[a.kind] - order[b.kind]);
  let out = data;
  for (const d of diffs) {
    if (d.kind === "substitution") out = replaceRange(out, { start: d.refPos, end: d.refPos + d.refBases.length - 1 }, d.readBases.toUpperCase()).data;
    else if (d.kind === "deletion") out = deleteRange(out, { start: d.refPos, end: d.refPos + d.refBases.length - 1 });
    else out = insertBases(out, d.refPos, d.readBases.toUpperCase());
  }
  return out;
}

/** The bases each stretch of a clone's reads gives, for a DNA FASTA. */
export function consensusPieces(clone: CloneResult): { range: Range; bases: string }[] {
  return clone.pieces.map(p => ({ range: { start: p.refFrom, end: p.refTo - 1 }, bases: p.gappedConsensus.replace(/-/g, "") }));
}
