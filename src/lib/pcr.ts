// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// PCR products: what a forward and a reverse primer amplify from a template, and the
// product as a new document (features and primers inside it carried over). Pure functions.

import { alignPrimer, type PrimerAlignment, type PrimerOp } from "./primerAlign.ts";
import { PCR_DNA } from "./methylation.ts";
import { findBindingSites } from "./primers.ts";
import { basesIn, clipRange, insertBases, linearize, rangeLength, replaceRange, reverseComplement, setOrigin, withoutStaleTranslations, type Range, type SeqData } from "./seqdata.ts";

/** A primer at one binding site: `start`…`end` is the part that pairs, on the top strand. */
export interface PlacedPrimer {
  name: string;
  /** 5′→3′, including any 5′ tail. */
  bases: string;
  start: number;
  end: number;
  strand: 1 | -1;
}

export interface PcrProduct {
  forward: PlacedPrimer;
  reverse: PlacedPrimer;
  /** Template bases copied, from the forward primer's site to the reverse primer's (may cross the origin). */
  span: Range;
  /** Product length, tails included. */
  length: number;
  /** Product top strand, 5′→3′: forward tail, template, reverse tail (reverse-complemented). */
  sequence: string;
}

/** Products longer than this aren't offered as side products (long-range PCR aside). */
export const MAX_PRODUCT = 15_000;

/** A change a primer makes on its site, on the top strand: bases `from`…`to` (none for an insertion, put before `from`) become `bases`. */
interface SiteEdit {
  from: number;
  to: number | null;
  bases: string;
}

const DEFINITE = /^[ACGT]$/i;
const AMBIGUOUS = /^[RYSWKMBDHVN]$/i;

/**
 * What a primer writes over its site: each run of changed, inserted or skipped bases, and
 * each template base left ambiguous (N, R, Y…) under a base of the primer that is definite:
 * alignment counts them as matching, but the product holds the primer's own base there.
 */
function siteEdits(a: PrimerAlignment, p: PlacedPrimer, template: string): SiteEdit[] {
  const fwd = p.strand === 1;
  const ops = a.ops.filter(op => op.kind !== "tail");
  const writes = (op: PrimerOp) => op.kind !== "match" || (DEFINITE.test(p.bases[op.i]) && AMBIGUOUS.test(template[op.pos]));
  const out: SiteEdit[] = [];
  for (let k = 0; k < ops.length; k++) {
    if (!writes(ops[k])) continue;
    let e = k;
    while (e + 1 < ops.length && writes(ops[e + 1])) e++;
    const block = ops.slice(k, e + 1);
    const primerBases = block.filter(op => op.i >= 0).map(op => p.bases[op.i]).join("").toUpperCase();
    const positions = block.filter(op => op.pos >= 0).map(op => op.pos);
    const bases = fwd ? primerBases : reverseComplement(primerBases);
    if (positions.length) {
      // In the primer's order: left to right forward, right to left reverse.
      out.push({ from: fwd ? positions[0] : positions[positions.length - 1], to: fwd ? positions[positions.length - 1] : positions[0], bases });
    } else {
      // Inserted bases go after the base before them, in the primer's direction.
      const before = ops[k - 1];
      out.push({ from: before ? (fwd ? before.pos + 1 : before.pos) : (fwd ? p.start : p.end + 1), to: null, bases });
    }
    k = e;
  }
  return out;
}

interface ProductEdit {
  at: number;
  length: number;
  bases: string;
}

/** Both primers' edits, by position from the forward primer's start, last first so earlier ones stay put. */
function productEdits(template: string, circular: boolean, forward: PlacedPrimer, reverse: PlacedPrimer) {
  const n = template.length;
  const offset = (pos: number) => (circular ? (((pos - forward.start) % n) + n) % n : pos - forward.start);
  const span = { start: forward.start, end: reverse.end };
  const editsOf = (p: PlacedPrimer) => {
    const alignment = alignPrimer(p, template);
    const start = offset(p.start);
    const end = offset(p.end) + 1;
    const edits = siteEdits(alignment, p, template).map(e => {
      let at = offset(e.from);
      if (e.to === null && at < start) at += n;
      return { at, length: e.to === null ? 0 : offset(e.to) - at + 1, bases: e.bases };
    });
    return { alignment, start, end, edits };
  };
  const f = editsOf(forward);
  const r = editsOf(reverse);
  const sharedStart = r.start;
  const sharedEnd = f.end;
  const touchesShared = (e: (typeof f.edits)[number]) => e.length
    ? e.at < sharedEnd && e.at + e.length > sharedStart
    : e.at > sharedStart && e.at < sharedEnd;
  const fShared = f.edits.filter(touchesShared);
  const rShared = r.edits.filter(touchesShared);
  let edits = [...f.edits, ...r.edits];
  if (sharedStart < sharedEnd && fShared.length && rShared.length) {
    // Two alignments can put the same indel on opposite sides of a short repeat.
    // Compare the sequence each writes when all its shared edits fit inside the overlap.
    const withinShared = (e: ProductEdit) => e.at >= sharedStart && e.at + e.length <= sharedEnd;
    if ([...fShared, ...rShared].every(withinShared)) {
      const shared = basesIn(template, span).slice(sharedStart, sharedEnd);
      const write = (changes: ProductEdit[]) => writeEdits(shared, changes.map(e => ({ ...e, at: e.at - sharedStart })).sort((a, b) => b.at - a.at)).toUpperCase();
      if (write(fShared) === write(rShared)) edits = [...f.edits, ...r.edits.filter(e => !touchesShared(e))];
      else if (f.start === r.start && f.end === r.end) return null;
    }
  }
  const unique = [...new Map(edits.map(e => [`${e.at}:${e.length}:${e.bases}`, e])).values()];
  unique.sort((a, b) => b.at - a.at || b.length - a.length);
  for (let i = 1; i < unique.length; i++) {
    const right = unique[i - 1];
    const left = unique[i];
    if (left.at + left.length > right.at || (!left.length && !right.length && left.at === right.at)) return null;
  }
  return { edits: unique, fTail: f.alignment.tail.toUpperCase(), rTail: reverseComplement(r.alignment.tail.toUpperCase()) };
}

function writeEdits(sequence: string, edits: ProductEdit[]): string {
  for (const e of edits) sequence = sequence.slice(0, e.at) + e.bases + sequence.slice(e.at + e.length);
  return sequence;
}

/**
 * The product of a forward primer (binding the bottom strand, extending along the top)
 * and a reverse primer, or null if their sites or edits can't make a single product.
 */
export function pcrProduct(template: string, circular: boolean, forward: PlacedPrimer, reverse: PlacedPrimer): PcrProduct | null {
  const n = template.length;
  const placed = (p: PlacedPrimer) => [p.start, p.end].every(x => Number.isInteger(x) && x >= 0 && x < n) && (circular || p.start <= p.end);
  if (!n || forward.strand !== 1 || reverse.strand !== -1 || !placed(forward) || !placed(reverse)) return null;
  const offset = (p: number) => (circular ? (p - forward.start + n) % n : p - forward.start);
  // Where the reverse primer's site starts and ends, counted from the forward primer's start.
  const rs = offset(reverse.start);
  const re = offset(reverse.end);
  const fe = offset(forward.end);
  if (rs < 0 || re < rs || re < fe) return null;
  const span = { start: forward.start, end: reverse.end };
  // The primers' own bases over their sites: a mutagenic primer's change is in the product.
  const written = productEdits(template, circular, forward, reverse);
  if (!written) return null;
  const sequence = written.fTail + writeEdits(basesIn(template, span), written.edits) + written.rTail;
  if (!sequence.length) return null;
  return { forward, reverse, span, length: sequence.length, sequence };
}

/**
 * Everything two primers can amplify together, each primer binding wherever it binds
 * (either may act as forward or reverse). The intended product is usually the shortest.
 */
export function allProducts(template: string, circular: boolean, a: { name: string; bases: string }, b: { name: string; bases: string }, maxLength = MAX_PRODUCT): PcrProduct[] {
  const placed: PlacedPrimer[] = [];
  for (const p of a.bases === b.bases ? [a] : [a, b]) {
    for (const s of findBindingSites(p.bases, template, circular)) placed.push({ name: p.name, bases: p.bases, start: s.start, end: s.end, strand: s.strand });
  }
  const out: PcrProduct[] = [];
  for (const f of placed) {
    if (f.strand !== 1) continue;
    for (const r of placed) {
      if (r.strand !== -1) continue;
      const p = pcrProduct(template, circular, f, r);
      if (p && p.length <= maxLength) out.push(p);
    }
  }
  return out.sort((x, y) => x.length - y.length);
}

/**
 * The product as a linear document, with the template's features and primers that lie inside
 * it. A CDS it starts inside keeps the codons it had, and one whose bases the product
 * changes (cut short, or written over by a primer) loses the /translation it was imported
 * with, which says what its bases were.
 */
export function productDocument(template: SeqData, product: PcrProduct): SeqData {
  const n = template.sequence.length;
  const len = rangeLength(product.span, n);
  let d: SeqData = template;
  if (template.circular) {
    d = setOrigin(d, product.span.start);
    if (len < n) d = clipRange(d, { start: len, end: n - 1 });
  } else {
    if (product.span.end < n - 1) d = clipRange(d, { start: product.span.end + 1, end: n - 1 });
    if (product.span.start > 0) d = clipRange(d, { start: 0, end: product.span.start - 1 });
  }
  d = linearize(d);
  const written = productEdits(template.sequence, template.circular, product.forward, product.reverse)!;
  for (const e of written.edits) {
    d = e.length ? replaceRange(d, { start: e.at, end: e.at + e.length - 1 }, e.bases).data : insertBases(d, e.at, e.bases);
  }
  d = insertBases(d, 0, written.fTail);
  d = insertBases(d, d.sequence.length, written.rTail);
  return withoutStaleTranslations(template, {
    ...d,
    name: `${template.name} PCR`,
    description: `PCR product of ${product.forward.name} and ${product.reverse.name} on ${template.name} (${product.length} bp).`,
    circular: false,
    ends: undefined,
    methylation: PCR_DNA
  });
}
