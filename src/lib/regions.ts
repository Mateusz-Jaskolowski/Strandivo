// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Regions of a protein: helices, topological domains and signal peptides marked inside a
// CDS rather than as features of their own, so a membrane protein stays one feature. They
// live in the CDS's /strandivo_regions qualifier, one value per region, numbered in
// residues of that CDS: rotating the sequence, turning it round or cloning the CDS then
// moves them with no work at all. Only an edit that changes the CDS's length or its first
// base (turning its direction, cutting it short) has to carry them along (`carryRegions`).
// Pure, so it is unit-tested.

import { featurePositions } from "./genetics.ts";
import type { Range } from "./seqdata.ts";

/** The GenBank qualifier that holds a CDS's regions, one value per region. */
export const REGIONS_QUALIFIER = "strandivo_regions";

export interface ProteinRegion {
  name: string;
  /** What UniProt calls it: Transmembrane, Topological domain, Signal peptide… */
  kind: string;
  /** Residues of this CDS, from 1, inclusive. */
  start: number;
  end: number;
  /** The UniProt entry it came from and its own numbers there, which differ in a fusion. */
  accession: string;
  sourceStart: number;
  sourceEnd: number;
  /** UniProt only inferred it from the sequence. */
  predicted: boolean;
}

interface Noted {
  notes?: Record<string, unknown>;
}

const clean = (s: string) => s.replace(/\|/g, "/").trim();

/** `TM1|Transmembrane|13-33|Q9UKG4:13-33|predicted` */
export function formatRegion(r: ProteinRegion): string {
  const parts = [clean(r.name), clean(r.kind), `${r.start}-${r.end}`, `${r.accession}:${r.sourceStart}-${r.sourceEnd}`];
  return (r.predicted ? [...parts, "predicted"] : parts).join("|");
}

export function parseRegion(value: string): ProteinRegion | null {
  const [name, kind, here, source, evidence] = value.split("|").map(s => s.trim());
  const at = /^(\d+)-(\d+)$/.exec(here ?? "");
  const from = /^([^:]*):(\d+)-(\d+)$/.exec(source ?? "");
  if (!name || !at || Number(at[1]) < 1 || Number(at[2]) < Number(at[1])) return null;
  return {
    name,
    kind: kind ?? "",
    start: Number(at[1]),
    end: Number(at[2]),
    accession: from?.[1] ?? "",
    sourceStart: Number(from?.[2] ?? at[1]),
    sourceEnd: Number(from?.[3] ?? at[2]),
    predicted: evidence === "predicted"
  };
}

const parsed = new WeakMap<object, ProteinRegion[]>();

/** The regions in a feature's qualifiers, in order along the protein. */
export function regionsOf(f: Noted): ProteinRegion[] {
  const notes = f.notes;
  const raw = notes?.[REGIONS_QUALIFIER];
  if (!notes || raw === undefined || raw === null) return [];
  const hit = parsed.get(notes);
  if (hit) return hit;
  const values = Array.isArray(raw) ? raw : [raw];
  const out = values
    .map(v => parseRegion(String(v)))
    .filter((r): r is ProteinRegion => !!r)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  parsed.set(notes, out);
  return out;
}

/** The feature's qualifiers with these regions in place of the ones it had. */
export function withRegions(notes: Record<string, unknown>, regions: ProteinRegion[]): Record<string, unknown> {
  const { [REGIONS_QUALIFIER]: _old, ...rest } = notes;
  return regions.length ? { ...rest, [REGIONS_QUALIFIER]: regions.map(formatRegion) } : rest;
}

/** Cut short: a construct holding only part of what UniProt describes. */
export const isClipped = (r: ProteinRegion) => r.end - r.start !== r.sourceEnd - r.sourceStart;

/** The numbers to show: UniProt's, as these are what a paper or the entry will say. */
export const regionLabel = (r: ProteinRegion) => (r.accession ? `${r.sourceStart}–${r.sourceEnd}` : `${r.start}–${r.end}`);

/** For a tooltip: "TM3 · Transmembrane, predicted · 77–97". */
export const regionTitle = (r: ProteinRegion) => `${r.name} · ${r.kind}${r.predicted ? ", predicted" : ""} · ${regionLabel(r)}`;

type Located = Parameters<typeof featurePositions>[0];

/** Runs of neighbouring positions, as ranges: one unless the region crosses an intron. */
function runs(positions: number[], n: number, forward: boolean): Range[] {
  const out: Range[] = [];
  let first = -1;
  let last = -1;
  const step = forward ? 1 : -1;
  const close = () => first >= 0 && out.push(forward ? { start: first, end: last } : { start: last, end: first });
  for (const p of positions) {
    if (first >= 0 && p === (last + step + n) % n) last = p;
    else {
      close();
      first = last = p;
    }
  }
  close();
  return out;
}

const spansCache = new WeakMap<object, { n: number; spans: Map<ProteinRegion, Range[]> }>();

/** Where a region's bases are, in order along the sequence; empty if the CDS has none of it. */
export function regionSpans(f: Located & Noted, r: ProteinRegion, n: number): Range[] {
  let cached = spansCache.get(f);
  if (!cached || cached.n !== n) {
    cached = { n, spans: new Map() };
    spansCache.set(f, cached);
  }
  const hit = cached.spans.get(r);
  if (hit) return hit;
  const forward = (f as { strand?: number }).strand !== -1;
  const spans = runs(featurePositions(f, n).slice((r.start - 1) * 3, r.end * 3), n, forward);
  if (!forward) spans.reverse();
  cached.spans.set(r, spans);
  return spans;
}

/** One range over all of a region, intron included, for selecting it. */
export function regionRange(f: Located & Noted, r: ProteinRegion, n: number): Range | null {
  const spans = regionSpans(f, r, n);
  return spans.length ? { start: spans[0].start, end: spans[spans.length - 1].end } : null;
}

const nearestResidue = (offset: number) => Math.round(offset / 3);

/**
 * Regions after an edit, where `next` is the feature as the edit left it and `move` takes a
 * base's old position to its new one (null if it was deleted). A region keeps the bases it
 * had: an indel upstream moves it, one inside grows or shrinks it, and it goes when none
 * are left. Ends round to the nearest codon rather than down, so replacing a base (a
 * deletion and then an insertion) leaves every region just where it was, and a frameshift
 * doesn't creep regions downstream of it one residue at a time.
 */
export function carryRegions<T extends Located & Noted>(before: T, next: T, n: number, nextLength: number, move: (pos: number) => number | null): T {
  const regions = regionsOf(before);
  if (!regions.length) return next;
  const old = featurePositions(before, n);
  const now = featurePositions(next, nextLength);
  // Same length from the same first base: every residue is where it was.
  if (old.length === now.length && move(old[0]) === now[0]) return next;
  const offsetAt = new Int32Array(nextLength).fill(-1);
  now.forEach((p, i) => (offsetAt[p] = i));
  const offset = (i: number) => {
    const p = move(old[i]);
    return p === null ? -1 : offsetAt[p];
  };
  const kept: ProteinRegion[] = [];
  for (const r of regions) {
    const from = (r.start - 1) * 3;
    const to = Math.min(old.length, r.end * 3) - 1;
    let first = -1;
    let last = -1;
    for (let i = from; i <= to; i++) {
      const o = offset(i);
      if (o < 0) continue;
      if (first < 0 || o < first) first = o;
      if (o > last) last = o;
    }
    if (first < 0) continue;
    const start = nearestResidue(first) + 1;
    kept.push({ ...r, start, end: Math.max(start, nearestResidue(last + 1)) });
  }
  return { ...next, notes: withRegions(next.notes ?? {}, kept) };
}
