// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Cloning simulation: cutting sequences into fragments with their ends, and joining the
// fragments by restriction and ligation, overlap assembly (Gibson, In-Fusion) or Golden
// Gate. Products are new linear or circular documents that carry every fragment's
// features and primers. Pure functions.

import { DEFAULT_DESIGN, designPair, type DesignOptions } from "./design.ts";
import { enzymeSite, scanSites } from "./enzymes.ts";
import { DEFAULT_TM, findBindingSites, meltingTemp, TM_METHODS, type TmMethod } from "./primers.ts";
import { carryRegions } from "./regions.ts";
import { basesIn, deleteRange, insertBases, newId, reverseComplement, reverseComplementRange, setOrigin, type Range, type SeqData } from "./seqdata.ts";

export type EndKind = "blunt" | "5'" | "3'";

/** One end of a double-stranded fragment. */
export interface FragmentEnd {
  kind: EndKind;
  /** The single-stranded bases as top-strand letters, upper case; "" when blunt. */
  bases: string;
  /** The enzyme that made the end, if one did. */
  enzyme?: string;
}

export interface Fragment {
  /** Every base on either strand, written as the top strand, with what lies on it. Linear. */
  data: SeqData;
  left: FragmentEnd;
  right: FragmentEnd;
  /** Where it came from: first base on the source (0-based) and length. */
  source: { name: string; start: number; length: number; flipped: boolean };
}

/** Where an enzyme cuts: both strands' cuts as boundaries (top strand cut between top-1 and top). */
export interface Cut {
  enzyme: string;
  top: number;
  bottom: number;
}

const BLUNT: FragmentEnd = { kind: "blunt", bases: "" };
const mod = (x: number, n: number) => ((x % n) + n) % n;
const lo = (c: Cut) => Math.min(c.top, c.bottom);
const hi = (c: Cut) => Math.max(c.top, c.bottom);

/**
 * Where the named enzymes cut, sorted along the sequence. On a circular sequence `top` is
 * 0…n-1 and `bottom` lies within an overhang's length of it (it may pass either end); on
 * a linear one, cuts whose overhang would reach past an end are left out.
 */
export function cutsFor(sequence: string, circular: boolean, enzymes: string[]): Cut[] {
  const n = sequence.length;
  if (!n || !enzymes.length) return [];
  const names = new Set(enzymes);
  const out: Cut[] = [];
  const seen = new Set<string>();
  // Named enzymes outside the curated list (a lab's stock) are searched for too.
  for (const h of scanSites(sequence, circular, enzymes)) {
    if (!names.has(h.enzyme)) continue;
    let top = h.cut;
    let bottom = h.bottomCut;
    if (circular) {
      let d = bottom - top;
      if (d > n / 2) d -= n;
      if (d < -n / 2) d += n;
      top = mod(top, n);
      bottom = top + d;
    } else if (Math.min(top, bottom) <= 0 || Math.max(top, bottom) >= n) continue;
    const key = `${top}:${bottom}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ enzyme: h.enzyme, top, bottom });
  }
  return out.sort((a, b) => lo(a) - lo(b) || a.enzyme.localeCompare(b.enzyme));
}

function endAt(c: Cut, sequence: string): FragmentEnd {
  if (c.top === c.bottom) return { kind: "blunt", bases: "", enzyme: c.enzyme };
  const n = sequence.length;
  const r = { start: mod(lo(c), n), end: mod(hi(c) - 1, n) };
  return { kind: c.top < c.bottom ? "5'" : "3'", bases: basesIn(sequence, r).toUpperCase(), enzyme: c.enzyme };
}

/** Keeps the longer piece of anything that crosses the end of what is now a linear sequence. */
function unwrap(d: SeqData): SeqData {
  const n = d.sequence.length;
  const fix = <T extends { start: number; end: number; locations?: Range[] }>(x: T): T => {
    if (x.start <= x.end && !x.locations?.some(l => l.start > l.end)) return x;
    const { locations: _parts, ...rest } = x;
    return (x.start > x.end && n - x.start >= x.end + 1 ? { ...rest, end: n - 1 } : x.start > x.end ? { ...rest, start: 0 } : rest) as T;
  };
  // A CDS cut short at its start counts its residues from a new first base.
  const features = d.features.map(f => carryRegions(f, fix(f), n, n, p => p));
  return { ...d, features, primers: d.primers.map(fix), sources: d.sources.map(fix) };
}

/** `length` bases from `start` as a linear document (circular sources: past the origin, even round it again). */
function extract(d: SeqData, start: number, length: number): SeqData {
  const n = d.sequence.length;
  let x: SeqData = d;
  if (d.circular) {
    x = setOrigin(d, start);
    if (length < n) x = deleteRange(x, { start: length, end: n - 1 });
    else if (length > n) x = { ...x, sequence: x.sequence + x.sequence.slice(0, length - n) };
  } else {
    if (start + length < n) x = deleteRange(x, { start: start + length, end: n - 1 });
    if (start > 0) x = deleteRange(x, { start: 0, end: start - 1 });
  }
  return unwrap({ ...x, circular: false });
}

/** A stretch of a sequence (or all of it) as a fragment with blunt ends, as PCR or synthesis makes it. */
export function wholeFragment(d: SeqData, range: Range | null = null): Fragment {
  const n = d.sequence.length;
  const r = range ?? { start: 0, end: n - 1 };
  const length = r.start <= r.end ? r.end - r.start + 1 : n - r.start + r.end + 1;
  return { data: extract(d, r.start, length), left: BLUNT, right: BLUNT, source: { name: d.name, start: r.start, length, flipped: false } };
}

/**
 * The fragments the named enzymes cut a sequence into, in order along it. A circular
 * sequence cut once gives one fragment (it is opened up); one that isn't cut gives none.
 */
export function digest(d: SeqData, enzymes: string[]): Fragment[] {
  const seq = d.sequence;
  const n = seq.length;
  const cuts = cutsFor(seq, d.circular, enzymes);
  const out: Fragment[] = [];
  const add = (from: number, to: number, left: FragmentEnd, right: FragmentEnd) => {
    if (to - from <= left.bases.length || to - from <= right.bases.length) return; // overhangs overlap: nothing left
    const start = d.circular ? mod(from, n) : from;
    out.push({ data: extract(d, start, to - from), left, right, source: { name: d.name, start, length: to - from, flipped: false } });
  };
  if (d.circular) {
    for (let i = 0; i < cuts.length; i++) {
      const j = (i + 1) % cuts.length;
      add(lo(cuts[i]), hi(cuts[j]) + (j <= i ? n : 0), endAt(cuts[i], seq), endAt(cuts[j], seq));
    }
  } else {
    for (let i = 0; i <= cuts.length; i++) {
      const prev = cuts[i - 1];
      const next = cuts[i];
      add(prev ? lo(prev) : 0, next ? hi(next) : n, prev ? endAt(prev, seq) : BLUNT, next ? endAt(next, seq) : BLUNT);
    }
  }
  return out;
}

/** The fragment turned round: its ends swap and read on the other strand. */
export function flip(f: Fragment): Fragment {
  const turn = (e: FragmentEnd): FragmentEnd => ({ ...e, bases: reverseComplement(e.bases) });
  return { data: reverseComplementRange(f.data, null), left: turn(f.right), right: turn(f.left), source: { ...f.source, flipped: !f.source.flipped } };
}

/** Can a fragment ending in `right` be ligated to one starting with `left`? */
export function compatible(right: FragmentEnd, left: FragmentEnd): boolean {
  return right.kind === left.kind && right.bases === left.bases;
}

/** "EcoRI (5′ AATT)", "blunt", "BsaI (5′ AATG)". */
export function endLabel(e: FragmentEnd): string {
  const what = e.kind === "blunt" ? "blunt" : `${e.kind === "5'" ? "5′" : "3′"} ${e.bases}`;
  return e.enzyme ? `${e.enzyme} (${what})` : what;
}

/** The fragment's length in bases. */
export const fragmentLength = (f: Fragment) => f.data.sequence.length;

// ---------- joining ----------

/** Where each piece lies in a product, and where the joins are. */
export interface Layout {
  pieces: { name: string; start: number; length: number; flipped: boolean }[];
  /** Joins as the first base of the shared stretch (overhang or overlap) and its length. */
  joins: { at: number; length: number }[];
}

type Positioned = { start: number; end: number; locations?: Range[] };
const shifted = <T extends Positioned>(x: T, by: number): T => {
  const out = { ...x, start: x.start + by, end: x.end + by };
  if (x.locations) out.locations = x.locations.map(l => ({ start: l.start + by, end: l.end + by }));
  return out;
};

/** Every annotation with a new id, so pieces from the same file don't collide. */
function freshIds(d: SeqData): SeqData {
  return {
    ...d,
    features: d.features.map(f => ({ ...f, id: newId("f") })),
    primers: d.primers.map(p => ({ ...p, id: newId("p") })),
    sources: []
  };
}

/**
 * Joins fragments in order, each overlapping the next by `overlaps[i]` bases (an overhang
 * or an assembly overlap, written once in the product); when circular, the last joins the
 * first by `overlaps[last]`.
 */
export function joinFragments(parts: Fragment[], overlaps: number[], circular: boolean): { data: SeqData; layout: Layout } {
  const layout: Layout = { pieces: [], joins: [] };
  let data: SeqData = { ...parts[0].data, features: [], primers: [], sources: [], sequence: "" };
  parts.forEach((f, i) => {
    const k = i === 0 ? 0 : overlaps[i - 1];
    const piece = k ? deleteRange(f.data, { start: 0, end: k - 1 }) : f.data;
    const at = data.sequence.length - k;
    if (i > 0) layout.joins.push({ at, length: k });
    layout.pieces.push({ name: f.source.name, start: at, length: fragmentLength(f), flipped: f.source.flipped });
    const by = data.sequence.length;
    data = {
      ...data,
      sequence: data.sequence + piece.sequence,
      features: [...data.features, ...piece.features.map(x => shifted(x, by))],
      primers: [...data.primers, ...piece.primers.map(x => shifted(x, by))]
    };
  });
  if (circular) {
    const k = overlaps[parts.length - 1] ?? 0;
    const n = data.sequence.length;
    if (k) data = deleteRange(data, { start: n - k, end: n - 1 });
    layout.joins.push({ at: 0, length: k });
  }
  return { data: freshIds({ ...data, circular }), layout };
}

const overhangLength = (e: FragmentEnd) => (e.kind === "blunt" ? 0 : e.bases.length);

// ---------- restriction and ligation ----------

export interface Ligation {
  product: SeqData;
  /** The insert reads the other way round from how it was cut. */
  flipped: boolean;
  layout: Layout;
}

/** The backbone (the largest fragment) and the rest, for a vector cut with one or two enzymes. */
export const largest = (fs: Fragment[]): Fragment | null => fs.reduce<Fragment | null>((a, f) => (!a || fragmentLength(f) > fragmentLength(a) ? f : a), null);

/** How many bases of `region` on the source a fragment carries. */
export function sharedBases(f: Fragment, region: Range, n: number): number {
  const parts = (r: Range) => (r.start <= r.end ? [[r.start, r.end]] : [[r.start, n - 1], [0, r.end]]);
  const s = f.source.start;
  const e = s + f.source.length - 1;
  // A fragment from a circular source may run past the origin (even round it again).
  const spans = [[s, e], [s - n, e - n], [s + n, e + n]];
  let total = 0;
  for (const [a, b] of parts(region)) for (const [x, y] of spans) total += Math.max(0, Math.min(b, y) - Math.max(a, x) + 1);
  return Math.min(total, f.source.length);
}

/** The fragment that carries the most of a region (the one to use as the insert). */
export function fragmentWith(fs: Fragment[], region: Range, n: number): Fragment | null {
  let best: Fragment | null = null;
  let most = 0;
  for (const f of fs) {
    const k = sharedBases(f, region, n);
    if (k > most) [best, most] = [f, k];
  }
  return best;
}

/** Every way an insert ligates into an opened vector (both orientations when the ends allow it). */
export function ligateInsert(backbone: Fragment, insert: Fragment): Ligation[] {
  const out: Ligation[] = [];
  for (const o of [insert, flip(insert)]) {
    if (!compatible(backbone.right, o.left) || !compatible(o.right, backbone.left)) continue;
    const { data, layout } = joinFragments([backbone, o], [overhangLength(o.left), overhangLength(backbone.left)], true);
    out.push({ product: data, flipped: o.source.flipped, layout });
  }
  return out;
}

/** Can the opened vector close on itself (same or blunt ends)? */
export const selfLigates = (backbone: Fragment) => compatible(backbone.right, backbone.left);

// ---------- overlap assembly: Gibson, In-Fusion ----------

/**
 * The bases a fragment brings to an overlap assembly. Single-stranded 3′ ends are trimmed
 * (the polymerase's proofreading removes them); 5′ overhangs are kept, since the strand
 * opposite them is rebuilt on the neighbour's overlap.
 */
export function assemblyBases(f: Fragment): Fragment {
  let data = f.data;
  let { left, right } = f;
  const n = data.sequence.length;
  if (right.kind === "3'") {
    data = deleteRange(data, { start: n - right.bases.length, end: n - 1 });
    right = BLUNT;
  }
  if (left.kind === "3'") {
    data = deleteRange(data, { start: 0, end: left.bases.length - 1 });
    left = BLUNT;
  }
  return data === f.data ? f : { ...f, data, left, right };
}

/** The longest end of `a` (at least `min` bases, at most `max`) that `b` starts with, or 0. */
export function findOverlap(a: string, b: string, min: number, max = 200): number {
  const A = a.toUpperCase();
  const B = b.toUpperCase();
  for (let k = Math.min(max, A.length, B.length); k >= min; k--) if (A.endsWith(B.slice(0, k))) return k;
  return 0;
}

export interface OverlapMethod {
  /** Overlap added by primer tails. */
  overlap: number;
  /** Shortest overlap that counts as one already there. */
  minOverlap: number;
  /**
   * Split an overlap between two PCR pieces' primers (Gibson), or put it all on one of them
   * (In-Fusion): the later piece, or the insert when the other is the vector (the first piece).
   */
  split: boolean;
  /** Overlaps melting below this are flagged. */
  minTm: number;
  /**
   * How `minTm` is measured. A threshold only means something together with the method it
   * was set for: the published 48 °C for this chemistry is a Wallace-rule figure, and the
   * same overlap reads about 8 °C lower under nearest-neighbour. So the check names its own
   * method instead of following the Tm shown elsewhere, which Settings lets the user change.
   */
  tmMethod: TmMethod;
}

/** 20 bp overlaps, split across both primers when both pieces are amplified. */
export const GIBSON: OverlapMethod = { overlap: 20, minOverlap: 15, split: true, minTm: 48, tmMethod: "wallace" };
/** In-Fusion: 15 bp of each neighbour's end on the insert's primers. */
export const IN_FUSION: OverlapMethod = { overlap: 15, minOverlap: 15, split: false, minTm: 0, tmMethod: "wallace" };

/** The Tm of an assembly overlap, always by the method its threshold was set for. */
const overlapTm = (bases: string, method: OverlapMethod): number | null => meltingTemp(bases, { ...DEFAULT_TM, method: method.tmMethod });

export interface AssemblyInput {
  name: string;
  /** The piece as it is: an opened vector, a synthetic fragment, or the stretch PCR copies. */
  fragment: Fragment;
  /** Amplified by PCR from this stretch of the template: primers are designed, with any overlaps as tails. */
  pcr?: { template: SeqData; range: Range };
}

export interface AssemblyPrimer {
  name: string;
  /** 5′→3′: the tail in lower case, the part that binds in upper case. */
  bases: string;
  tail: number;
  tm: number;
  strand: 1 | -1;
}

export interface AssemblyJoin {
  /** Bases shared by the two neighbours, or "" where they don't overlap. */
  bases: string;
  tm: number | null;
  /** Made by primer tails (true) or already in the pieces (false). */
  designed: boolean;
}

/**
 * A join taken from bases the two neighbours already share. Sequence alone can't say
 * whether those bases are one shared stretch or one copy in each piece — a linker or a tag
 * at the end of one part and the start of the next looks exactly the same — so every one of
 * these is reported with both lengths and the user decides.
 */
export interface ReusedOverlap {
  /** Index of the piece on the left of the join. */
  index: number;
  left: string;
  right: string;
  bases: string;
  /** Length of the product as built, keeping one copy; null when no product was built. */
  merged: number | null;
  /** Length it would have with both copies kept; null when no product was built. */
  kept: number | null;
}

export interface AssemblyPlan {
  /** Each piece as it goes into the reaction (PCR pieces with their tails), with its primers. */
  pieces: { name: string; fragment: Fragment; primers: AssemblyPrimer[] }[];
  /** Between piece i and the next (and, circular, the last and the first). */
  joins: AssemblyJoin[];
  product: SeqData | null;
  layout: Layout | null;
  problems: string[];
  /** Worth reading before ordering, but not wrong: reused overlaps, mostly. */
  notes: string[];
  /** Joins built on bases the pieces already shared, in case a view wants to offer a choice. */
  reused: ReusedOverlap[];
}

/**
 * Plans an overlap assembly of pieces in order: neighbours that already share an overlap
 * are joined on it, others get one from tails on the primers of whichever is amplified.
 */
export function planAssembly(inputs: AssemblyInput[], method: OverlapMethod, circular = true, design: DesignOptions = DEFAULT_DESIGN): AssemblyPlan {
  const problems: string[] = [];
  const notes: string[] = [];
  const reused: ReusedOverlap[] = [];
  const m = inputs.length;
  const prepared = inputs.map(i => {
    const f = assemblyBases(i.fragment);
    return { ...f, source: { ...f.source, name: i.name } };
  });
  const seqs = prepared.map(f => f.data.sequence.toUpperCase());
  const tails = inputs.map(() => ({ forward: "", reverse: "" }));
  const lengths: (number | null)[] = [];
  const designed: boolean[] = [];
  const joins = circular ? m : m - 1;
  for (let j = 0; j < joins; j++) {
    const a = j;
    const b = (j + 1) % m;
    const found = findOverlap(seqs[a], seqs[b], method.minOverlap);
    if (found) {
      lengths.push(found);
      designed.push(false);
      reused.push({ index: a, left: inputs[a].name, right: inputs[b].name, bases: seqs[a].slice(-found), merged: null, kept: null });
      continue;
    }
    const L = method.overlap;
    const ampA = !!inputs[a].pcr;
    const ampB = !!inputs[b].pcr;
    designed.push(true);
    // The overlap is cut from the neighbours' ends, so a piece shorter than its share of it
    // can only give what it has. Record what the tails really carry, never what was asked
    // for: joining on more bases than the pieces share eats sequence off the product.
    let added: number | null = null;
    if (ampA && ampB && method.split && a !== b) {
      const half = Math.floor(L / 2);
      tails[b].forward = seqs[a].slice(-half);
      tails[a].reverse = reverseComplement(seqs[b].slice(0, L - half));
      added = tails[b].forward.length + tails[a].reverse.length;
    } else if (ampB && !(ampA && b === 0)) {
      tails[b].forward = seqs[a].slice(-L);
      added = tails[b].forward.length;
    } else if (ampA) {
      tails[a].reverse = reverseComplement(seqs[b].slice(0, L));
      added = tails[a].reverse.length;
    } else problems.push(`${inputs[a].name} and ${inputs[b].name} don't overlap. Amplify one of them by PCR to add the overlap.`);
    // Nothing to join on is not a short overlap, it is not an assembly: a piece with no
    // sequence in it leaves the two neighbours sharing nothing, and keeping every base of
    // nothing is not a product. Say so and build none.
    if (added === 0) {
      problems.push(`There are no bases to join ${inputs[a].name} and ${inputs[b].name} on. Check that both pieces have sequence in them.`);
      lengths.push(null);
    } else {
      lengths.push(added);
      if (added !== null && added < L) {
        const short = added < method.minOverlap ? `, shorter than the ${baseCount(method.minOverlap)} this method needs` : "";
        problems.push(`${inputs[a].name} and ${inputs[b].name} are too short to carry the whole ${L} base overlap, so it can only be ${baseCount(added)}${short}. Lengthen the shorter piece, or join it some other way.`);
      }
    }
  }

  const pieces: AssemblyPlan["pieces"] = [];
  inputs.forEach((input, i) => {
    if (!input.pcr) {
      pieces.push({ name: input.name, fragment: prepared[i], primers: [] });
      return;
    }
    const { template, range } = input.pcr;
    const pair = designPair(template.sequence, template.circular, range.start, range.end, { ...design, forwardTail: tails[i].forward, reverseTail: tails[i].reverse, trimTails: false });
    if (!pair) {
      problems.push(`No primers could be designed for ${input.name}.`);
      pieces.push({ name: input.name, fragment: prepared[i], primers: [] });
      return;
    }
    const f = tails[i].forward.toUpperCase();
    const r = tails[i].reverse.toUpperCase();
    let data = insertBases(prepared[i].data, 0, f);
    data = insertBases(data, data.sequence.length, reverseComplement(r));
    pieces.push({
      name: input.name,
      fragment: { ...prepared[i], data, left: BLUNT, right: BLUNT },
      primers: [
        { name: `${input.name}-F`, bases: pair.forward.bases, tail: f.length, tm: pair.forward.tm, strand: 1 },
        { name: `${input.name}-R`, bases: pair.reverse.bases, tail: r.length, tm: pair.reverse.tm, strand: -1 }
      ]
    });
  });

  const joinInfo: AssemblyJoin[] = lengths.map((L, j) => {
    if (L === null) return { bases: "", tm: null, designed: designed[j] };
    const bases = pieces[(j + 1) % m].fragment.data.sequence.slice(0, L).toUpperCase();
    return { bases, tm: overlapTm(bases, method), designed: designed[j] };
  });
  const tmName = TM_METHODS.find(x => x.id === method.tmMethod)?.short ?? method.tmMethod;
  joinInfo.forEach((x, j) => {
    const other = inputs[(j + 1) % m].name;
    if (!x.bases) return;
    // Whether an overlap can be assessed at all is a separate question from whether it
    // meets a minimum, and it is asked of every method: In-Fusion sets no minimum, which
    // must not switch off the check that the sequence is known. There are two reasons a
    // melting temperature can't be had, and saying the wrong one is worse than saying
    // neither, so they are told apart here rather than reported as one.
    if (x.tm === null) {
      if (/[^ACGT]/.test(x.bases)) problems.push(`The overlap between ${inputs[j].name} and ${other} has bases that aren't A, C, G or T, so there is no telling whether it will anneal. An overlap needs known sequence.`);
      else problems.push(`The overlap between ${inputs[j].name} and ${other} is ${baseCount(x.bases.length)}, too short to work out a melting temperature for.`);
      return;
    }
    if (method.minTm && x.tm < method.minTm) problems.push(`The overlap between ${inputs[j].name} and ${other} melts at ${x.tm.toFixed(1)} °C (${tmName}); ${method.minTm} °C or more joins more reliably.`);
  });

  if (lengths.some(L => L === null) || pieces.some((p, i) => inputs[i].pcr && !p.primers.length)) {
    // No product, so no lengths to quote, but a reused overlap is still worth saying.
    return { pieces, joins: joinInfo, product: null, layout: null, problems, notes: [...notes, ...reusedNotes(reused)], reused };
  }
  const { data, layout } = joinFragments(
    pieces.map(p => p.fragment),
    lengths as number[],
    circular
  );
  // Whether a join's overlap reads the same anywhere else in the product it builds. This
  // looks for repeated sequence, which is what makes a second pairing possible; it does not
  // work out which ends are free to react, so it reports competition as possible, not
  // certain. See the scope note on this check in docs/cloning-plan.md.
  joinInfo.forEach((x, j) => {
    if (!x.bases) return;
    const found = overlapMatches(data.sequence, circular, x.bases);
    const other = inputs[(j + 1) % m].name;
    // By construction the overlap is in the product it was cut from. If it is not, the plan
    // contradicts itself and must not be described as checked.
    if (!found.length) {
      problems.push(`The ${baseCount(x.bases.length)} joining ${inputs[j].name} and ${other} ${x.bases.length === 1 ? "isn't" : "aren't"} in the product this plan builds, so the plan doesn't hold together and shouldn't be relied on.`);
      return;
    }
    if (found.length < 2) return;
    // A short or repetitive overlap can read the same in hundreds of places, and a message
    // that lists them all is a message nobody reads. Name the first few and the total.
    const shown = found.slice(0, 6).map(f => `${(f.start + 1).toLocaleString("en-GB")}${f.direct ? "" : " on the other strand"}`);
    const where = found.length > shown.length ? `${shown.join(", ")} and ${(found.length - shown.length).toLocaleString("en-GB")} more` : shown.join(", ");
    const reads = x.bases.length === 1 ? "reads" : "read";
    problems.push(`The ${baseCount(x.bases.length)} joining ${inputs[j].name} and ${other} ${reads} the same in ${found.length.toLocaleString("en-GB")} places in the product, at ${where}, so more than one of them could pair with the join. An overlap is most dependable as the only match: move the join into sequence that isn't repeated.`);
  });
  // The designed primers, where they bind in full on the product.
  const primers = pieces.flatMap(p => p.primers).flatMap(p => {
    const site = findBindingSites(p.bases, data.sequence, circular).find(s => s.strand === p.strand && s.length === p.bases.length && !s.mismatches && !s.insertions && !s.deletions);
    return site ? [{ id: newId("p"), name: p.name, start: site.start, end: site.end, strand: p.strand, bases: p.bases.toUpperCase(), notes: {}, raw: {} }] : [];
  });
  for (const r of reused) {
    r.merged = data.sequence.length;
    r.kept = data.sequence.length + r.bases.length;
  }
  notes.push(...reusedNotes(reused));
  return { pieces, joins: joinInfo, product: { ...data, primers: [...data.primers, ...primers] }, layout, problems, notes, reused };
}

/** "1 base", "20 bases": lengths appear in several messages and one of them read "1 bases". */
const baseCount = (n: number) => `${n.toLocaleString("en-GB")} base${n === 1 ? "" : "s"}`;

/** Where a stretch of bases reads the same again, and on which strand. */
export interface OverlapMatch {
  /** 0-based start on the sequence; on a circle a match may run on past the end. */
  start: number;
  /** True when it reads the same way round, false when it is the reverse complement. */
  direct: boolean;
}

/**
 * Every place in a sequence that a stretch of bases could pair with, on either strand: a
 * join can land on any of them. Matches are found a base at a time, because copies of a
 * tandem repeat overlap each other and that is the case this exists for. A circular
 * sequence runs on past its end, so the seam is searched too. Case is ignored, since a
 * file's own capitalisation is kept in `SeqData` and says nothing about the bases. A
 * stretch that is its own reverse complement is reported once per place, not twice.
 */
export function overlapMatches(sequence: string, circular: boolean, bases: string): OverlapMatch[] {
  const needle = bases.toUpperCase();
  if (!needle) return [];
  const upper = sequence.toUpperCase();
  const hay = circular && upper.length >= needle.length ? upper + upper.slice(0, needle.length - 1) : upper;
  const out: OverlapMatch[] = [];
  const find = (what: string, direct: boolean) => {
    for (let i = hay.indexOf(what); i >= 0; i = hay.indexOf(what, i + 1)) out.push({ start: i, direct });
  };
  find(needle, true);
  const rc = reverseComplement(needle);
  if (rc !== needle) find(rc, false);
  return out.sort((x, y) => x.start - y.start);
}

/**
 * Joining on bases the pieces already share keeps one copy of them, and two different
 * molecules fit that sequence. Say which one was built and what the other would be.
 *
 * The other one can't be had by trimming the shared bases off a piece and letting the
 * primers put an overlap back: a designed overlap is made from bases the neighbours
 * already have, so it adds nothing and the product comes out the same length.
 *
 * Nor is it enough to group both copies into one piece. The overlap is what has to be
 * unique, and where it isn't split across the junction (In-Fusion) it is taken whole from
 * one piece's end, so a piece ending in a tandem repeat hands the join an overlap that
 * occurs twice inside it. The copies have to be grouped *and* the join moved past them,
 * into sequence that occurs once. `overlapMatches` reports it when they aren't; this note
 * says the one thing that check can't, which of the two molecules was built.
 */
function reusedNotes(reused: ReusedOverlap[]): string[] {
  return reused.map(r => {
    // merged and kept are null when no product was built, so the note turns hypothetical.
    const joined = r.merged === null
      ? `${r.left} ends with the ${r.bases.length} bases ${r.right} starts with, so they would be joined on them and the product would keep one copy.`
      : `${r.left} already ends with the ${r.bases.length} bases ${r.right} starts with, so they were joined on them and the product keeps one copy (${r.merged} bp).`;
    const each = r.kept === null
      ? "If each piece was meant to keep its own copy, that isn't what this builds:"
      : `If each piece was meant to keep its own copy (${r.kept} bp), this won't build it:`;
    return `${joined} ${each} two copies in a row give the join two places to land. Both copies have to go inside one piece, and the join has to sit past them in sequence that occurs only once; grouping them is not enough on its own, as an overlap taken whole from one piece's end can fall inside the repeat.`;
  });
}

// ---------- Golden Gate ----------

/** Type IIS enzymes in the list that Golden Gate kits use. */
export const GOLDEN_GATE_ENZYMES = ["BsaI", "BsmBI", "BbsI", "SapI"];

export interface GoldenGateResult {
  /** The pieces in the order they join, starting with the first part's. */
  order: Fragment[];
  product: SeqData | null;
  layout: Layout | null;
  problems: string[];
}

/** Does the sequence still hold the enzyme's site (either strand)? */
function hasSite(sequence: string, site: string): boolean {
  const s = sequence.toUpperCase();
  return !!site && (s.includes(site) || s.includes(reverseComplement(site)));
}

/**
 * A one-pot Golden Gate reaction: every part is cut, pieces that keep a site are cut
 * again, and the rest join by their overhangs. The first part (the vector) starts the
 * chain; the overhangs decide the order and orientation of the others.
 */
export function goldenGate(parts: { name: string; data: SeqData }[], enzyme: string): GoldenGateResult {
  const problems: string[] = [];
  const site = enzymeSite(enzyme);
  const pool: { part: number; f: Fragment }[] = [];
  parts.forEach((p, i) => {
    const cuts = cutsFor(p.data.sequence, p.data.circular, [enzyme]);
    if (!cuts.length) {
      problems.push(`${enzyme} doesn't cut ${p.name}.`);
      return;
    }
    const kept = digest(p.data, [enzyme]).filter(f => f.left.kind !== "blunt" && f.right.kind !== "blunt" && !hasSite(f.data.sequence, site));
    if (!kept.length) problems.push(`Every piece of ${p.name} keeps a ${enzyme} site, so nothing from it stays cut.`);
    if (kept.length > 1) problems.push(`${enzyme} cuts inside ${p.name} (${cuts.length} sites); its parts may join in other ways.`);
    for (const f of kept) pool.push({ part: i, f: { ...f, source: { ...f.source, name: p.name } } });
  });
  for (const x of pool) {
    for (const e of [x.f.left, x.f.right]) {
      if (e.bases === reverseComplement(e.bases)) problems.push(`${x.f.source.name}'s overhang ${e.bases} pairs with itself, so pieces can join either way round.`);
    }
  }
  const startAt = pool.findIndex(x => x.part === 0);
  if (startAt < 0) return { order: [], product: null, layout: null, problems: [...new Set(problems)] };
  // The first part's largest kept piece is the backbone.
  let first = pool[startAt];
  for (const x of pool) if (x.part === 0 && fragmentLength(x.f) > fragmentLength(first.f)) first = x;
  const used = new Set([first]);
  const order: Fragment[] = [first.f];
  for (;;) {
    const end = order[order.length - 1].right;
    const next = pool
      .filter(x => !used.has(x))
      .flatMap(x => [{ x, f: x.f }, { x, f: flip(x.f) }])
      .filter(c => compatible(end, c.f.left));
    const nextParts = new Set(next.map(c => c.x.part));
    if (nextParts.size > 1) problems.push(`More than one piece has the overhang ${end.bases}: ${[...nextParts].map(i => parts[i].name).join(", ")}.`);
    if (next.length) {
      used.add(next[0].x);
      order.push(next[0].f);
      continue;
    }
    if (order.length > 1 && compatible(end, first.f.left)) break;
    problems.push(`Nothing joins the ${end.bases} end of ${order[order.length - 1].source.name}.`);
    return { order, product: null, layout: null, problems: [...new Set(problems)] };
  }
  const usedParts = new Set([...used].map(x => x.part));
  parts.forEach((p, i) => {
    if (!usedParts.has(i) && pool.some(x => x.part === i)) problems.push(`${p.name} isn't used: its overhangs don't match the others.`);
  });
  const { data, layout } = joinFragments(
    order,
    order.map(f => overhangLength(f.right)),
    true
  );
  if (hasSite(data.sequence, site)) problems.push(`The product still has a ${enzyme} site, so the enzyme would open it again.`);
  return { order, product: data, layout, problems: [...new Set(problems)] };
}
