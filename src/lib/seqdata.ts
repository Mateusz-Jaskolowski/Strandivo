// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The document model: a sequence with its features and primers, and the edits that can be
// made to it. Pure functions with no DOM, so they are easy to test.
//
// Coordinates are 0-based and inclusive, like GenBank's 1-based ranges minus one. On a
// circular sequence a range may cross the origin, in which case start > end.

import { carryRegions } from "./regions.ts";
import type { DnaMethylation } from "./methylation.ts";

export type Strand = 1 | -1 | 0;

export interface Range {
  start: number;
  end: number;
}

export interface SeqFeature {
  id: string;
  name: string;
  type: string;
  start: number;
  end: number;
  /** 1 = forward, -1 = reverse, 0 = no direction. */
  strand: Strand;
  /**
   * The parts of a feature made of several pieces (exons, SnapGene segments), in the file's
   * order; `start` and `end` then span them all. Absent for a feature in one piece.
   */
  locations?: Range[];
  color?: string;
  notes: Record<string, unknown>;
  /** Everything else the file had for this feature, written back unchanged. */
  raw: Record<string, unknown>;
}

export interface SeqPrimer {
  id: string;
  name: string;
  /** Where the primer's 3′ part binds. */
  start: number;
  end: number;
  strand: 1 | -1;
  /** Full primer sequence 5′→3′, which may include a 5′ tail that doesn't bind. */
  bases: string;
  /** The user's colour; never red, which marks a primer's changes. */
  color?: string;
  notes: Record<string, unknown>;
  raw: Record<string, unknown>;
}

/** A linear DNA end, with any overhang written as top-strand letters. */
export interface FragmentEnd {
  kind: "blunt" | "5'" | "3'";
  bases: string;
  enzyme?: string;
}

export interface FragmentEnds {
  left: FragmentEnd;
  right: FragmentEnd;
}

export interface SeqData {
  name: string;
  description: string;
  circular: boolean;
  sequence: string;
  features: SeqFeature[];
  primers: SeqPrimer[];
  /** GenBank "source" features: not shown, but kept on their bases through edits and saved. */
  sources: SeqFeature[];
  /** When present, the sequence includes the bases on both strands' overhangs. */
  ends?: FragmentEnds;
  /** How a product's DNA was made, used when no host is given. */
  methylation?: DnaMethylation;
}

export const BLUNT_END: FragmentEnd = { kind: "blunt", bases: "" };

const leftBottomOnly = (ends?: FragmentEnds) => ends?.left.kind === "3'" ? ends.left.bases.length : 0;
const rightBottomOnly = (ends?: FragmentEnds) => ends?.right.kind === "5'" ? ends.right.bases.length : 0;

/** Length of the top strand, excluding bases stored only for the other strand's ends. */
export function topStrandLength(sequence: string, ends?: FragmentEnds): number {
  return sequence.length - leftBottomOnly(ends) - rightBottomOnly(ends);
}

/** The strand used for a plain sequence export. */
export function topStrandSequence(sequence: string, ends?: FragmentEnds): string {
  return sequence.slice(leftBottomOnly(ends), sequence.length - rightBottomOnly(ends));
}

/** Keep the ends only where their overhangs still correspond to the sequence. */
export function validFragmentEnds(d: Pick<SeqData, "circular" | "sequence" | "ends">, ends = d.ends): FragmentEnds | undefined {
  if (!ends || d.circular || ends.left.bases.length + ends.right.bases.length >= d.sequence.length) return undefined;
  const left = d.sequence.slice(0, ends.left.bases.length).toUpperCase() === ends.left.bases ? ends.left : BLUNT_END;
  const right = d.sequence.slice(d.sequence.length - ends.right.bases.length).toUpperCase() === ends.right.bases ? ends.right : BLUNT_END;
  return left === BLUNT_END && right === BLUNT_END ? undefined : { left, right };
}

/** The other strand's view of an end, as the top strand of the reversed fragment. */
export const reverseEnd = (end: FragmentEnd): FragmentEnd => ({ ...end, bases: reverseComplement(end.bases) });

/** Open at the origin, keeping features as ordered parts if they span both ends. */
export function linearize(d: SeqData): SeqData {
  if (!d.circular) return d;
  const n = d.sequence.length;
  const split = (f: SeqFeature): SeqFeature => {
    if (!wraps(f) && !f.locations?.some(wraps)) return f;
    const locations = (f.locations ?? [f]).flatMap(r => pieces(r, n));
    return locations.length > 1 ? { ...f, locations } : f;
  };
  return { ...d, circular: false, features: d.features.map(split), primers: d.primers.filter(p => !wraps(p)), sources: d.sources.map(split) };
}

// ---------- ranges ----------

export const wraps = (r: Range) => r.start > r.end;

export function rangeLength(r: Range, n: number): number {
  return r.start <= r.end ? r.end - r.start + 1 : n - r.start + r.end + 1;
}

/** Is base `pos` inside the range? */
export function inRange(r: Range, pos: number): boolean {
  return r.start <= r.end ? pos >= r.start && pos <= r.end : pos >= r.start || pos <= r.end;
}

/** Splits a range into pieces that don't cross the origin. */
export function pieces(r: Range, n: number): Range[] {
  if (r.start <= r.end) return [{ start: r.start, end: r.end }];
  const out: Range[] = [{ start: r.start, end: n - 1 }];
  if (r.end >= 0) out.push({ start: 0, end: r.end });
  return out;
}

/** Is `inner` entirely within `outer`? */
export function rangeWithin(inner: Range, outer: Range, n: number): boolean {
  if (rangeLength(inner, n) > rangeLength(outer, n)) return false;
  // Walk from outer.start; inner must start and end within outer's span, in order.
  const offset = (p: number) => (p - outer.start + n) % n;
  const len = rangeLength(outer, n);
  const s = offset(inner.start);
  const e = offset(inner.end);
  return s < len && e < len && s <= e;
}

export function rangesOverlap(a: Range, b: Range, n: number): boolean {
  for (const x of pieces(a, n)) for (const y of pieces(b, n)) if (x.start <= y.end && y.start <= x.end) return true;
  return false;
}

/** Bases in a range (following the origin on circular sequences), top strand. */
export function basesIn(sequence: string, r: Range): string {
  return r.start <= r.end ? sequence.slice(r.start, r.end + 1) : sequence.slice(r.start) + sequence.slice(0, r.end + 1);
}

// ---------- bases ----------

const COMPLEMENT: Record<string, string> = {
  A: "T", T: "A", G: "C", C: "G", U: "A", R: "Y", Y: "R", S: "S", W: "W", K: "M", M: "K", B: "V", V: "B", D: "H", H: "D", N: "N",
  a: "t", t: "a", g: "c", c: "g", u: "a", r: "y", y: "r", s: "s", w: "w", k: "m", m: "k", b: "v", v: "b", d: "h", h: "d", n: "n"
};

export function complement(s: string): string {
  let out = "";
  for (const c of s) out += COMPLEMENT[c] ?? c;
  return out;
}

export function reverseComplement(s: string): string {
  let out = "";
  for (let i = s.length - 1; i >= 0; i--) out += COMPLEMENT[s[i]] ?? s[i];
  return out;
}

/** Characters accepted as DNA when typing or pasting (IUPAC codes). */
export const DNA_CHARS = /[ACGTURYSWKMBDHVN]/i;

/** Keeps only DNA letters from pasted text. */
export function cleanBases(text: string): string {
  return text.replace(/[^ACGTURYSWKMBDHVN]/gi, "");
}

/** What pasted text holds as bases: the bases, or the letters that make it not DNA. */
export interface PastedBases {
  /** Upper case, U read as T; "" when the text isn't a sequence. */
  bases: string;
  /** Letters other than IUPAC codes, at most a few, when the text isn't a sequence. */
  stray: string[];
  /**
   * Characters left out that a sequence listing wouldn't hold: not whitespace, not the
   * position numbers of GenBank's ORIGIN lines, not a header line — a gap's dashes, say.
   */
  dropped: number;
}

/**
 * The bases in text pasted from elsewhere. FASTA header (">") and comment (";") lines and a
 * GenBank record's text before ORIGIN and after "//" are left out, as are numbers and
 * punctuation. Any other letter that isn't an IUPAC code means the text is not a sequence,
 * since keeping only the letters that are would put words in as bases ("ORIGIN" as RGN).
 */
export function basesFromText(text: string): PastedBases {
  let lines = text.split(/\r?\n/);
  const origin = lines.findIndex(l => /^\s*ORIGIN\b/.test(l));
  if (origin >= 0) {
    lines = lines.slice(origin + 1);
    const end = lines.findIndex(l => l.trim() === "//");
    if (end >= 0) lines = lines.slice(0, end);
  }
  const kept = lines.filter(l => !/^\s*[>;]/.test(l)).join("\n");
  const stray = [...new Set((kept.match(/[^\WACGTURYSWKMBDHVN\d_]/gi) ?? []).map(c => c.toUpperCase()))].slice(0, 5);
  const bases = stray.length ? "" : cleanBases(kept).toUpperCase().replace(/U/g, "T");
  // Whitespace, position numbers and skipped header lines are how sequences are written,
  // so only anything else is worth telling the user about.
  const dropped = stray.length ? 0 : kept.replace(/[\s\d]/g, "").length - bases.length;
  return { bases, stray, dropped };
}

// ---------- edits ----------

type Positioned = { start: number; end: number };
type Located = Positioned & { locations?: Range[] };

/**
 * Which annotations take new bases put in at their edge: those ending right before them,
 * those starting right after them, or neither, the default, as which side they belong to
 * can't be known. The edit card asks (`src/views/editCard.ts`). Only features and their
 * protein regions take them, never primers, whose bases say where they bind.
 */
export type EdgeSide = "before" | "after" | "neither";

/** Shifts annotation coordinates for `len` bases inserted before position `pos` (0…n). */
function shiftForInsert<T extends Positioned>(a: T, pos: number, len: number): T {
  return { ...a, start: a.start >= pos ? a.start + len : a.start, end: a.end >= pos ? a.end + len : a.end };
}

/**
 * `shiftForInsert`, with an annotation that ends right before position `pos` or starts
 * right at it (in a sequence of length n) taking the new bases when `side` says so.
 */
function insertAtEdge<T extends Positioned>(x: T, pos: number, len: number, n: number, circular: boolean, side: EdgeSide): T {
  const m = shiftForInsert(x, pos, len);
  if (side === "neither") return m;
  const wrap = (p: number) => (circular ? ((p % n) + n) % n : p);
  if (side === "before" && x.end === wrap(pos - 1) && !inRange(x, wrap(pos))) return { ...m, end: pos + len - 1 };
  if (side === "after" && x.start === wrap(pos) && !inRange(x, wrap(pos - 1))) return { ...m, start: pos };
  return m;
}

/**
 * Maps an annotation through the deletion of [a, b] (not crossing the origin) from a
 * sequence of length n. Returns null if nothing of it is left.
 */
function mapThroughDelete<T extends Positioned>(x: T, a: number, b: number, n: number): T | null {
  const len = b - a + 1;
  const n2 = n - len;
  if (n2 <= 0) return null;
  const mapStart = (p: number) => (p < a ? p : p > b ? p - len : a);
  const mapEnd = (p: number) => (p < a ? p : p > b ? p - len : a - 1);
  if (x.start <= x.end) {
    const s = mapStart(x.start);
    const e = mapEnd(x.end);
    return e < s ? null : { ...x, start: s, end: e };
  }
  // Crosses the origin: [start, n-1] and [0, end].
  let s = mapStart(x.start);
  let e = mapEnd(x.end);
  const firstGone = x.start >= a && n - 1 <= b;
  const secondGone = a <= 0 && x.end <= b;
  if (firstGone && secondGone) return null;
  if (firstGone) return { ...x, start: 0, end: e };
  if (secondGone) return { ...x, start: s, end: n2 - 1 };
  if (s >= n2) s = 0;
  if (e < 0) e = n2 - 1;
  return { ...x, start: s, end: e };
}

/**
 * Maps an annotation through replacing [a, b] (not crossing the origin) of a sequence of
 * length n with `len` bases, a different number from what was there (as many move nothing:
 * `replaceRange` doesn't call this). What held the whole range holds the new bases, so a
 * codon typed over keeps its feature; what crossed one of its edges keeps only its part
 * outside, as which side the new bases belong to can't be known, unless `side` says (what
 * crossed the range's start is before the new bases, what crossed its end after them);
 * what lay inside it goes. Everything else moves with its bases. Returns null if nothing
 * of it is left.
 */
function mapThroughReplace<T extends Positioned>(x: T, a: number, b: number, len: number, n: number, side: EdgeSide = "neither"): T | null {
  const delta = len - (b - a + 1);
  const n2 = n + delta;
  const after = (p: number) => (p > b ? p + delta : p);
  const to = (s: number, e: number) => ({ ...x, start: ((s % n2) + n2) % n2, end: ((e % n2) + n2) % n2 });
  // Where a part ending at the range's start ends, and one starting at its end starts.
  const end = side === "before" ? a + len - 1 : a - 1;
  const start = side === "after" ? a : a + len;
  const { start: s, end: e } = x;
  if (s <= e) {
    if (e < a || s > b) return to(after(s), after(e));
    if (s <= a && e >= b) return e + delta < s ? null : to(s, e + delta);
    if (s >= a && e <= b) return null;
    return s < a ? to(s, end) : to(start, e + delta);
  }
  // Crosses the origin: [start, n-1] and [0, end]. The range can reach into either piece.
  const inFirst = b >= s;
  const inSecond = a <= e;
  if (!inFirst && !inSecond) return to(after(s), e);
  // The range takes in the gap between the two pieces: both keep their part outside it.
  if (inFirst && inSecond) return a === 0 && b === n - 1 ? null : to(start, end);
  if (inFirst) return a >= s ? to(s, e) : to(start, e);
  return b <= e ? to(s + delta, e + delta) : to(s + delta, end);
}

/**
 * Applies a position mapping to an annotation and to each of its parts. A part that
 * disappears is dropped; the annotation disappears when nothing of it is left.
 */
function mapLocated<T extends Located>(x: T, f: (r: Positioned) => Positioned | null): T | null {
  if (!x.locations || x.locations.length < 2) {
    const m = f(x);
    return m ? { ...x, start: m.start, end: m.end } : null;
  }
  const parts = x.locations.map(l => f(l)).filter((l): l is Positioned => !!l).map(l => ({ start: l.start, end: l.end }));
  if (!parts.length) return null;
  const { locations: _old, ...rest } = x;
  const span = { start: parts[0].start, end: parts[parts.length - 1].end };
  return (parts.length > 1 ? { ...rest, ...span, locations: parts } : { ...rest, ...span }) as unknown as T;
}

/** `onFeatures` maps features and their regions, when they take new bases at an edge (`EdgeSide`) and the rest don't. */
function mapAnnotations(d: SeqData, f: (r: Positioned) => Positioned | null, nextLength = d.sequence.length, onFeatures = f): Pick<SeqData, "features" | "primers" | "sources"> {
  const all = <T extends Located>(xs: T[]) => xs.map(x => mapLocated(x, f)).filter((x): x is T => !!x);
  const n = d.sequence.length;
  const features = d.features.flatMap(x => {
    const next = mapLocated(x, onFeatures);
    return next ? [carryRegions(x, next, n, nextLength, onFeatures)] : [];
  });
  return { features, primers: all(d.primers), sources: all(d.sources) };
}

/**
 * Inserts bases before position `pos` (0 = at the start, n = at the end). Features ending
 * right before them or starting right after them take them only when `side` says so.
 */
export function insertBases(d: SeqData, pos: number, bases: string, side: EdgeSide = "neither"): SeqData {
  if (!bases) return d;
  const n = d.sequence.length;
  const p = Math.max(0, Math.min(n, pos));
  const len = bases.length;
  return {
    ...d,
    sequence: d.sequence.slice(0, p) + bases + d.sequence.slice(p),
    ...(d.ends ? { ends: editedEnds(d, p, p) } : {}),
    ...mapAnnotations(d, x => shiftForInsert(x, p, len), n + len, x => insertAtEdge(x, p, len, n, d.circular, side))
  };
}

/** Deletes the bases in a range (which may cross the origin). */
export function deleteRange(d: SeqData, r: Range): SeqData {
  const n = d.sequence.length;
  if (!n) return d;
  if (r.start > r.end) {
    // Delete the end part first so the start part's coordinates stay valid.
    return deleteRange(deleteRange(d, { start: r.start, end: n - 1 }), { start: 0, end: r.end });
  }
  const a = Math.max(0, r.start);
  const b = Math.min(n - 1, r.end);
  if (b < a) return d;
  return {
    ...d,
    sequence: d.sequence.slice(0, a) + d.sequence.slice(b + 1),
    ...(d.ends ? { ends: editedEnds(d, a, b + 1) } : {}),
    ...mapAnnotations(d, x => mapThroughDelete(x, a, b, n), n - (b - a + 1))
  };
}

/**
 * Replaces the bases in a range; returns the new data and where the inserted bases are.
 * As many bases as were there is a substitution: every annotation keeps its place. Any
 * other number maps them with `mapThroughReplace`, never as a deletion and then an
 * insertion, which leaves new bases at an annotation's edge outside it. `side` says which
 * features crossing an edge of the range take the new bases, if any.
 */
export function replaceRange(d: SeqData, r: Range, bases: string, side: EdgeSide = "neither"): { data: SeqData; inserted: Range | null; caret: number } {
  const n = d.sequence.length;
  const across = r.start > r.end;
  if (!bases || !n) {
    const data = deleteRange(d, r);
    // Across the origin, the bases before it now end the sequence.
    const at = across ? data.sequence.length : Math.min(r.start, data.sequence.length);
    return { data, inserted: null, caret: at };
  }
  const length = rangeLength(r, n);
  if (bases.length === length) {
    const tail = n - r.start;
    const sequence = across
      ? bases.slice(tail) + d.sequence.slice(r.end + 1, r.start) + bases.slice(0, tail)
      : d.sequence.slice(0, r.start) + bases + d.sequence.slice(r.end + 1);
    return { data: { ...d, sequence, ...(d.ends ? { ends: validFragmentEnds({ ...d, sequence }, d.ends) } : {}) }, inserted: r, caret: r.end + 1 };
  }
  if (across) {
    // Turn the sequence so the range starts it, then so the new bases end it, as they always have.
    const turned = replaceRange(setOrigin(d, r.start), { start: 0, end: length - 1 }, bases, side).data;
    const n2 = turned.sequence.length;
    return { data: setOrigin(turned, bases.length % n2), inserted: { start: n2 - bases.length, end: n2 - 1 }, caret: n2 };
  }
  const a = Math.max(0, r.start);
  const b = Math.min(n - 1, r.end);
  const n2 = n - (b - a + 1) + bases.length;
  return {
    data: {
      ...d,
      sequence: d.sequence.slice(0, a) + bases + d.sequence.slice(b + 1),
      ...(d.ends ? { ends: editedEnds(d, a, b + 1) } : {}),
      ...mapAnnotations(d, x => mapThroughReplace(x, a, b, bases.length, n), n2, x => mapThroughReplace(x, a, b, bases.length, n, side))
    },
    inserted: { start: a, end: a + bases.length - 1 },
    caret: a + bases.length
  };
}

/** Only edits within an existing overhang or at its outer boundary replace that end. */
function editedEnds(d: SeqData, start: number, end: number): FragmentEnds | undefined {
  if (!d.ends) return undefined;
  const { left, right } = d.ends;
  const next = {
    left: start < Math.max(1, left.bases.length) ? BLUNT_END : left,
    right: end > d.sequence.length - Math.max(1, right.bases.length) ? BLUNT_END : right
  };
  return next.left === BLUNT_END && next.right === BLUNT_END ? undefined : next;
}

/** The bases a feature covers on the top strand, joining its parts and skipping gaps. */
export function featureBases(sequence: string, f: { start: number; end: number; locations?: Range[] }): string {
  return (f.locations && f.locations.length > 1 ? f.locations : [f]).map(l => basesIn(sequence, l)).join("");
}

/** Stretches a feature in parts skips (introns), in order along the sequence. */
export function featureGaps(f: { start: number; end: number; locations?: Range[] }, n: number): Range[] {
  const parts = f.locations;
  if (!parts || parts.length < 2 || !n) return [];
  const out: Range[] = [];
  for (let i = 0; i + 1 < parts.length; i++) {
    const from = (parts[i].end + 1) % n;
    if (parts[i + 1].start === from) continue;
    const gap = { start: from, end: (parts[i + 1].start - 1 + n) % n };
    // Overlapping or out-of-order parts aren't gaps.
    if (rangeWithin(gap, f, n)) out.push(gap);
  }
  return out;
}

/**
 * Moves a feature's ends. A feature in parts keeps the parts inside its new span, with
 * the first and last stretched or trimmed to the new ends; across the origin it becomes
 * one piece.
 */
export function withSpan(f: SeqFeature, start: number, end: number): SeqFeature {
  const { locations, ...rest } = f;
  if (!locations || start > end || locations.some(l => l.start > l.end)) return { ...rest, start, end };
  const parts = [...locations]
    .sort((a, b) => a.start - b.start)
    .map(l => ({ start: Math.max(l.start, start), end: Math.min(l.end, end) }))
    .filter(l => l.start <= l.end);
  if (!parts.length) return { ...rest, start, end };
  parts[0].start = start;
  parts[parts.length - 1].end = end;
  return parts.length > 1 ? { ...rest, start, end, locations: parts } : { ...rest, start, end };
}

/** Makes base `pos` the first base (circular sequences). Annotations keep their bases. */
export function setOrigin(d: SeqData, pos: number): SeqData {
  const n = d.sequence.length;
  if (!n) return d;
  const c = ((pos % n) + n) % n;
  if (c === 0) return d;
  const m = (p: number) => (p - c + n) % n;
  return {
    ...d,
    sequence: d.sequence.slice(c) + d.sequence.slice(0, c),
    ...mapAnnotations(d, x => ({ ...x, start: m(x.start), end: m(x.end) }))
  };
}

/**
 * Reverse-complements the whole sequence, or one stretch of it (not crossing the origin).
 * Annotations inside the stretch turn round with it; others keep their place.
 */
export function reverseComplementRange(d: SeqData, r: Range | null): SeqData {
  const n = d.sequence.length;
  if (!n) return d;
  const a = r ? r.start : 0;
  const b = r ? r.end : n - 1;
  if (a > b) return d;
  const m = (p: number) => a + b - p;
  const inside = (x: Positioned) => (r ? x.start <= x.end && x.start >= a && x.end <= b : true);
  const flipStrand = <S extends Strand>(s: S): S => (s === 0 ? s : (-s as S));
  // Parts swap ends and order, so the first part is still the one nearest the start.
  const turn = <T extends Located & { strand: Strand }>(x: T): T => {
    if (!inside(x)) return x;
    const out = { ...x, start: m(x.end), end: m(x.start), strand: flipStrand(x.strand) };
    if (x.locations) out.locations = x.locations.map(l => ({ start: m(l.end), end: m(l.start) })).reverse();
    return out;
  };
  return {
    ...d,
    sequence: d.sequence.slice(0, a) + reverseComplement(d.sequence.slice(a, b + 1)) + d.sequence.slice(b + 1),
    ...(d.ends ? { ends: a === 0 && b === n - 1 ? { left: reverseEnd(d.ends.right), right: reverseEnd(d.ends.left) } : editedEnds(d, a, b + 1) } : {}),
    features: d.features.map(turn),
    primers: d.primers.map(turn),
    sources: d.sources.map(turn)
  };
}

// ---------- ids and defaults ----------

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** Feature types offered when creating or editing a feature (GenBank feature keys). */
export const FEATURE_TYPES = [
  "CDS",
  "gene",
  "promoter",
  "terminator",
  "rep_origin",
  "RBS",
  "misc_feature",
  "protein_bind",
  "primer_bind",
  "polyA_signal",
  "enhancer",
  "sig_peptide",
  "LTR",
  "mRNA",
  "5'UTR",
  "3'UTR",
  "intron",
  "exon",
  "regulatory",
  "misc_RNA",
  "ncRNA",
  "tRNA",
  "rRNA",
  "repeat_region",
  "mobile_element",
  "oriT",
  "misc_recomb",
  "stem_loop",
  "variation"
];
