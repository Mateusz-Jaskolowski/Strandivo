// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// PCR products: what a forward and a reverse primer amplify from a template, and the
// product as a new document (features and primers inside it carried over). Pure functions.

import { alignPrimer, type PrimerAlignment } from "./primerAlign.ts";
import { findBindingSites } from "./primers.ts";
import { basesIn, deleteRange, insertBases, rangeLength, replaceRange, reverseComplement, setOrigin, type Range, type SeqData } from "./seqdata.ts";

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

const tailOf = (p: PlacedPrimer, template: string) => alignPrimer(p, template).tail;

/** A change a primer makes on its site, on the top strand: bases `from`…`to` (none for an insertion, put before `from`) become `bases`. */
interface SiteEdit {
  from: number;
  to: number | null;
  bases: string;
}

/** What a primer writes over its site: each run of changed, inserted or skipped bases. */
function siteEdits(a: PrimerAlignment, p: PlacedPrimer): SiteEdit[] {
  const fwd = p.strand === 1;
  const ops = a.ops.filter(op => op.kind !== "tail");
  const out: SiteEdit[] = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].kind === "match") continue;
    let e = k;
    while (e + 1 < ops.length && ops[e + 1].kind !== "match") e++;
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
      if (before) out.push({ from: fwd ? before.pos + 1 : before.pos, to: null, bases });
    }
    k = e;
  }
  return out;
}

/** Both primers' edits, by position from the forward primer's start, last first so earlier ones stay put. */
function productEdits(template: string, circular: boolean, forward: PlacedPrimer, reverse: PlacedPrimer) {
  const n = template.length;
  const offset = (pos: number) => (circular ? (((pos - forward.start) % n) + n) % n : pos - forward.start);
  return [...siteEdits(alignPrimer(forward, template), forward), ...siteEdits(alignPrimer(reverse, template), reverse)]
    .map(e => ({ at: offset(e.from), length: e.to === null ? 0 : offset(e.to) - offset(e.from) + 1, bases: e.bases }))
    .sort((a, b) => b.at - a.at);
}

/**
 * The product of a forward primer (binding the bottom strand, extending along the top)
 * and a reverse primer, or null if they don't face each other on this template.
 */
export function pcrProduct(template: string, circular: boolean, forward: PlacedPrimer, reverse: PlacedPrimer): PcrProduct | null {
  const n = template.length;
  if (!n || forward.strand !== 1 || reverse.strand !== -1) return null;
  const offset = (p: number) => (circular ? (p - forward.start + n) % n : p - forward.start);
  // Where the reverse primer's site starts and ends, counted from the forward primer's start.
  const rs = offset(reverse.start);
  const re = offset(reverse.end);
  const fe = offset(forward.end);
  if (rs < 0 || re < rs || re < fe) return null;
  if (!circular && reverse.end < forward.start) return null;
  const span = { start: forward.start, end: reverse.end };
  const fTail = tailOf(forward, template);
  const rTail = tailOf(reverse, template);
  // The primers' own bases over their sites: a mutagenic primer's change is in the product.
  let inner = basesIn(template, span);
  for (const e of productEdits(template, circular, forward, reverse)) inner = inner.slice(0, e.at) + e.bases + inner.slice(e.at + e.length);
  const sequence = fTail + inner + reverseComplement(rTail);
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

/** The product as a linear document, with the template's features and primers that lie inside it. */
export function productDocument(template: SeqData, product: PcrProduct): SeqData {
  const n = template.sequence.length;
  const len = rangeLength(product.span, n);
  let d: SeqData = template;
  if (template.circular) {
    d = setOrigin(d, product.span.start);
    if (len < n) d = deleteRange(d, { start: len, end: n - 1 });
  } else {
    if (product.span.end < n - 1) d = deleteRange(d, { start: product.span.end + 1, end: n - 1 });
    if (product.span.start > 0) d = deleteRange(d, { start: 0, end: product.span.start - 1 });
  }
  for (const e of productEdits(template.sequence, template.circular, product.forward, product.reverse)) {
    d = e.length ? replaceRange(d, { start: e.at, end: e.at + e.length - 1 }, e.bases).data : insertBases(d, e.at, e.bases);
  }
  const fTail = tailOf(product.forward, template.sequence);
  const rTail = tailOf(product.reverse, template.sequence);
  if (fTail) d = insertBases(d, 0, fTail);
  if (rTail) d = insertBases(d, d.sequence.length, reverseComplement(rTail));
  return {
    ...d,
    name: `${template.name} PCR`,
    description: `PCR product of ${product.forward.name} and ${product.reverse.name} on ${template.name} (${product.length} bp).`,
    circular: false
  };
}
