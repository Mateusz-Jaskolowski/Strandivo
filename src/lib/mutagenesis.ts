// Site-directed mutagenesis: a primer pair that writes a change into a plasmid as it copies
// the whole of it. Two layouts, as the two common kits use them:
// - back to back (Q5 SDM): the primers' 5′ ends meet at the change and don't overlap; the
//   forward primer carries the change at its 5′ end, and ligating the product's ends closes
//   the plasmid again;
// - overlapping (QuikChange): two complementary primers with the change in the middle.
// Each 3′ arm (the bases that pair after the change) is sized to a target Tm with
// `meltingTemp`, so it follows Settings. Pure functions.

import { featurePositions, translateCodon } from "./genetics.ts";
import { hasGoodClamp, meltingTemp } from "./primers.ts";
import { complement, insertBases, replaceRange, reverseComplement, type SeqData, type SeqFeature } from "./seqdata.ts";

/** On the top strand: `length` bases from `start` become `bases`; a length of 0 inserts before `start`. */
export interface SdmChange {
  start: number;
  length: number;
  bases: string;
}

export type SdmLayout = "back-to-back" | "overlapping";

export interface SdmOptions {
  /** Tm each 3′ arm is sized to. */
  tm: number;
  minArm: number;
  maxArm: number;
}

// Overlapping primers pair with both arms at once, so each arm can be cooler; 15 bases at
// least, as finding a primer's site needs 15 at its 3′ end.
export const DEFAULT_SDM: Record<SdmLayout, SdmOptions> = {
  "back-to-back": { tm: 60, minArm: 15, maxArm: 35 },
  overlapping: { tm: 55, minArm: 15, maxArm: 30 }
};

export interface SdmPrimer {
  /** 5′→3′, upper case. */
  bases: string;
  /** The site it pairs with, changes included (as `SeqPrimer` stores it). */
  start: number;
  end: number;
  strand: 1 | -1;
  /** Tm of the 3′ arm, and of the bases that pair before the change (null when none do). */
  tm3: number | null;
  tm5: number | null;
}

export interface SdmDesign {
  layout: SdmLayout;
  /** The change as made, trimmed of bases it would leave as they are. */
  change: SdmChange;
  forward: SdmPrimer;
  reverse: SdmPrimer;
}

/** An insertion longer than this is split between both primers' 5′ ends, so neither gets a long tail. */
export const SPLIT_INSERTION = 6;

const mod = (i: number, n: number) => ((i % n) + n) % n;

/** Bases from `from` for `length`, around the origin of a circular sequence; null off the end of a linear one. */
function stretch(seq: string, circular: boolean, from: number, length: number): string | null {
  const n = seq.length;
  if (length > n) return null;
  if (!circular && (from < 0 || from + length > n)) return null;
  let out = "";
  for (let i = 0; i < length; i++) out += seq[mod(from + i, n)];
  return out.toUpperCase();
}

/**
 * The length of a 3′ arm whose Tm is nearest `o.tm` (shorter on a tie); a 3′ end that
 * fails the G/C clamp check counts as 3 °C off, as in `designPairs`. `arm(len)` gives the
 * arm's bases as the primer reads them, or null where the sequence runs out. Null if no
 * length fits.
 */
function sizeArm(arm: (len: number) => string | null, o: SdmOptions): { bases: string; tm: number | null } | null {
  let best: { bases: string; tm: number | null; score: number } | null = null;
  for (let len = o.minArm; len <= o.maxArm; len++) {
    const bases = arm(len);
    if (!bases) break;
    const tm = meltingTemp(bases);
    const score = (tm === null ? 50 : Math.abs(tm - o.tm)) + (hasGoodClamp(bases) ? 0 : 3);
    if (!best || score < best.score) best = { bases, tm, score };
  }
  return best && { bases: best.bases, tm: best.tm };
}

/**
 * The change without the bases it leaves alone at either end (replacing GCT with GAT is
 * one base), or null if it changes nothing.
 */
export function trimChange(seq: string, circular: boolean, c: SdmChange): SdmChange | null {
  const n = seq.length;
  const old = stretch(seq, circular, c.start, c.length);
  if (old === null) return null;
  const bases = c.bases.toUpperCase();
  let p = 0;
  while (p < old.length && p < bases.length && old[p] === bases[p]) p++;
  let s = 0;
  while (s < old.length - p && s < bases.length - p && old[old.length - 1 - s] === bases[bases.length - 1 - s]) s++;
  const length = old.length - p - s;
  const added = bases.slice(p, bases.length - s);
  if (!length && !added) return null;
  const start = c.start + p;
  return { start: circular ? mod(start, n) : start, length, bases: added };
}

/**
 * A primer pair that makes `change`, or null if there's no room for it (near the end of a
 * linear sequence, or arms that can't be sized). Both layouts copy the whole plasmid, so
 * they are meant for circular sequences.
 */
export function designMutagenesis(seq: string, circular: boolean, change: SdmChange, layout: SdmLayout, o: SdmOptions = DEFAULT_SDM[layout]): SdmDesign | null {
  const n = seq.length;
  const c = trimChange(seq, circular, change);
  if (!c || n - c.length < 2 * o.minArm) return null;
  const s = c.start;
  const after = s + c.length;
  // Arms as the primers read them: rightwards from the change on the top strand, leftwards
  // from it on the bottom strand.
  const right = sizeArm(len => stretch(seq, circular, after, len), o);
  const left = sizeArm(len => {
    const b = stretch(seq, circular, s - len, len);
    return b && reverseComplement(b);
  }, o);
  if (!right || !left) return null;
  const r = right.bases.length;
  const l = left.bases.length;
  const at = (i: number) => (circular ? mod(i, n) : i);

  if (layout === "overlapping") {
    const forward = reverseComplement(left.bases) + c.bases + right.bases;
    const site = { start: at(s - l), end: at(after + r - 1) };
    return {
      layout,
      change: c,
      forward: { bases: forward, ...site, strand: 1, tm3: right.tm, tm5: left.tm },
      reverse: { bases: reverseComplement(forward), ...site, strand: -1, tm3: left.tm, tm5: right.tm }
    };
  }

  // Back to back. A replacement's bases pair (or mismatch) with the bases they replace, so
  // the forward primer's site starts at the change; a deletion's starts after it, and an
  // insertion is a 5′ tail, split between the two when it's long.
  const split = !c.length && c.bases.length > SPLIT_INSERTION ? Math.floor(c.bases.length / 2) : 0;
  const forwardStart = c.bases ? s : after;
  return {
    layout,
    change: c,
    forward: { bases: c.bases.slice(split) + right.bases, start: at(forwardStart), end: at(after + r - 1), strand: 1, tm3: right.tm, tm5: null },
    reverse: { bases: reverseComplement(c.bases.slice(0, split)) + left.bases, start: at(s - l), end: at(s - 1), strand: -1, tm3: left.tm, tm5: null }
  };
}

/** The sequence with the change made, features and primers carried along. */
export function applyChange(d: SeqData, c: SdmChange): SeqData {
  const n = d.sequence.length;
  if (!c.length) return insertBases(d, c.start, c.bases);
  return replaceRange(d, { start: c.start, end: (c.start + c.length - 1) % n }, c.bases).data;
}

/**
 * 1-based HGVS-style name of a change on the top strand: A123G, 123_125delinsGGC,
 * 123_124insGG, 123del. `short` writes more than 8 added bases as their count (ins18), for
 * primer names.
 */
export function changeName(seq: string, c: SdmChange, short = false): string {
  const n = seq.length;
  const first = c.start + 1;
  const last = mod(c.start + c.length - 1, n) + 1;
  const span = c.length > 1 ? `${first}_${last}` : `${first}`;
  const added = short && c.bases.length > 8 ? String(c.bases.length) : c.bases;
  if (!c.length) return `${mod(c.start - 1, n) + 1}_${first}ins${added}`;
  if (!c.bases) return `${span}del`;
  if (c.length === 1 && c.bases.length === 1) return `${seq[c.start].toUpperCase()}${first}${c.bases}`;
  return `${span}delins${added}`;
}

// ---------- codons ----------

export interface CodonSite {
  /** 1-based, as the interface numbers residues. */
  residue: number;
  /** On the coding strand. */
  codon: string;
  aa: string;
  /** Top-strand position of each of its bases, in reading order. */
  positions: number[];
  strand: 1 | -1;
}

/** Residue `residue` of a CDS, or null past its end. */
export function codonAt(seq: string, f: Pick<SeqFeature, "start" | "end" | "strand" | "locations">, residue: number): CodonSite | null {
  const n = seq.length;
  const all = featurePositions(f, n);
  const k = (residue - 1) * 3;
  if (residue < 1 || !Number.isInteger(residue) || k + 3 > all.length) return null;
  const positions = all.slice(k, k + 3);
  const strand = f.strand === -1 ? -1 : 1;
  const codon = positions.map(p => (strand === 1 ? seq[p] : complement(seq[p]))).join("").toUpperCase();
  return { residue, codon, aa: aminoAcid(codon), positions, strand };
}

/** The residue a position falls in, 1-based, or null outside the CDS. */
export function residueAt(seq: string, f: Pick<SeqFeature, "start" | "end" | "strand" | "locations">, pos: number): number | null {
  const k = featurePositions(f, seq.length).indexOf(pos);
  return k < 0 ? null : Math.floor(k / 3) + 1;
}

/**
 * The amino acid a codon is made to code for. TAG stays a stop even when Settings read it
 * as Q for amber suppressor strains: a plasmid made that way would only work in one.
 */
const aminoAcid = (codon: string) => (codon === "TAG" ? "*" : translateCodon(codon));

// The codons Rosetta 2 strains add tRNAs for, as they are rare in E. coli: only a tie-break.
const RARE_IN_E_COLI = new Set(["AGA", "AGG", "ATA", "CTA", "CCC", "GGA", "CGG"]);

export interface CodonChoice {
  codon: string;
  aa: string;
  /** Bases that differ from the codon there now. */
  changes: number;
  rareInEColi: boolean;
  /** On the top strand, spanning the changed bases. */
  change: SdmChange;
}

const ALL_CODONS = (() => {
  const out: string[] = [];
  for (const a of "TCAG") for (const b of "TCAG") for (const c of "TCAG") out.push(a + b + c);
  return out;
})();

/**
 * Codons for `aa` at a site, best first: fewest bases changed, then not rare in E. coli,
 * then the changed bases closest together. The codon there now is left out.
 */
export function codonChoices(seq: string, site: CodonSite, aa: string): CodonChoice[] {
  const n = seq.length;
  const target = aa.toUpperCase();
  // The codon's bases left to right on the top strand, as offsets from its leftmost base
  // (a spliced codon's offsets have a gap; across the origin they still count up).
  const leftmost = site.strand === 1 ? site.positions[0] : site.positions[2];
  const offset = (p: number) => mod(p - leftmost, n);
  const out: CodonChoice[] = [];
  for (const codon of ALL_CODONS) {
    if (codon === site.codon || aminoAcid(codon) !== target) continue;
    const changed: { off: number; base: string }[] = [];
    for (let k = 0; k < 3; k++) {
      if (codon[k] === site.codon[k]) continue;
      changed.push({ off: offset(site.positions[k]), base: site.strand === 1 ? codon[k] : complement(codon[k]) });
    }
    const lo = Math.min(...changed.map(x => x.off));
    const hi = Math.max(...changed.map(x => x.off));
    let bases = "";
    for (let off = lo; off <= hi; off++) bases += changed.find(x => x.off === off)?.base ?? seq[mod(leftmost + off, n)].toUpperCase();
    out.push({ codon, aa: target, changes: changed.length, rareInEColi: RARE_IN_E_COLI.has(codon), change: { start: mod(leftmost + lo, n), length: hi - lo + 1, bases } });
  }
  return out.sort((a, b) => a.changes - b.changes || Number(a.rareInEColi) - Number(b.rareInEColi) || a.change.length - b.change.length || a.codon.localeCompare(b.codon));
}
