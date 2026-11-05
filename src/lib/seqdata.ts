// The document model: a sequence with its features and primers, and the edits that can be
// made to it. Pure functions with no DOM, so they are easy to test.
//
// Coordinates are 0-based and inclusive, like GenBank's 1-based ranges minus one. On a
// circular sequence a range may cross the origin, in which case start > end.

import { carryRegions } from "./regions.ts";

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

export interface SeqData {
  name: string;
  description: string;
  circular: boolean;
  sequence: string;
  features: SeqFeature[];
  primers: SeqPrimer[];
  /** GenBank "source" features: not shown, but kept on their bases through edits and saved. */
  sources: SeqFeature[];
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

// ---------- edits ----------

type Positioned = { start: number; end: number };
type Located = Positioned & { locations?: Range[] };

/** Shifts annotation coordinates for `len` bases inserted before position `pos` (0…n). */
function shiftForInsert<T extends Positioned>(a: T, pos: number, len: number): T {
  return { ...a, start: a.start >= pos ? a.start + len : a.start, end: a.end >= pos ? a.end + len : a.end };
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

function mapAnnotations(d: SeqData, f: (r: Positioned) => Positioned | null, nextLength = d.sequence.length): Pick<SeqData, "features" | "primers" | "sources"> {
  const all = <T extends Located>(xs: T[]) => xs.map(x => mapLocated(x, f)).filter((x): x is T => !!x);
  const n = d.sequence.length;
  const move = (pos: number) => f({ start: pos, end: pos })?.start ?? null;
  const features = d.features.flatMap(x => {
    const next = mapLocated(x, f);
    return next ? [carryRegions(x, next, n, nextLength, move)] : [];
  });
  return { features, primers: all(d.primers), sources: all(d.sources) };
}

/** Inserts bases before position `pos` (0 = at the start, n = at the end). */
export function insertBases(d: SeqData, pos: number, bases: string): SeqData {
  if (!bases) return d;
  const p = Math.max(0, Math.min(d.sequence.length, pos));
  return {
    ...d,
    sequence: d.sequence.slice(0, p) + bases + d.sequence.slice(p),
    ...mapAnnotations(d, x => shiftForInsert(x, p, bases.length), d.sequence.length + bases.length)
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
    ...mapAnnotations(d, x => mapThroughDelete(x, a, b, n), n - (b - a + 1))
  };
}

/** Replaces the bases in a range; returns the new data and where the inserted bases are. */
export function replaceRange(d: SeqData, r: Range, bases: string): { data: SeqData; inserted: Range | null; caret: number } {
  const after = deleteRange(d, r);
  // Across the origin, the bases before the origin now end the sequence: insert there.
  const at = r.start > r.end ? after.sequence.length : r.start;
  const data = insertBases(after, at, bases);
  return { data, inserted: bases ? { start: at, end: at + bases.length - 1 } : null, caret: at + bases.length };
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
