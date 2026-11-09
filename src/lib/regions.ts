// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Regions of a protein: domains, helices, linkers and CDRs marked inside a
// CDS rather than as features of their own, so a protein stays one feature. They
// live in the CDS's /strandivo_regions qualifier, one value per region, numbered in
// residues of that CDS: rotating the sequence, turning it round or cloning the CDS then
// moves them with no work at all. Only an edit that changes the CDS's length or its first
// base (turning its direction, cutting it short) has to carry them along (`carryRegions`).
// Pure, so it is unit-tested.

import { featurePositions, translateCodon } from "./genetics.ts";
import { complement, inRange, rangeWithin, type Range, type SeqData, type SeqFeature } from "./seqdata.ts";
import type { Feature, VariableDesign } from "./types.ts";
import { formatDesign, parseDesign } from "./variable.ts";

/** The GenBank qualifier that holds a CDS's regions, one value per region. */
export const REGIONS_QUALIFIER = "strandivo_regions";

/** Map selected DNA into the CDS's frame, including whole codons at either edge. */
export function selectedProteinResidues(f: SeqFeature, range: Range, sequence: string) {
  if (!rangeWithin(range, f, sequence.length)) return null;
  const positions = featurePositions(f, sequence.length);
  let length = Math.floor(positions.length / 3);
  const lastCodon = positions.slice((length - 1) * 3, length * 3)
    .map(p => f.strand === -1 ? complement(sequence[p]) : sequence[p]).join("");
  if (translateCodon(lastCodon) === "*") length--;
  let first = -1;
  let last = -1;
  for (let i = 0; i < length * 3; i++) {
    if (!inRange(range, positions[i])) continue;
    if (first < 0) first = i;
    last = i;
  }
  return first < 0 ? null : {
    start: Math.floor(first / 3) + 1,
    end: Math.floor(last / 3) + 1,
    rounded: first % 3 !== 0 || (last + 1) % 3 !== 0
  };
}

/** Every CDS that can own a region made from this selection; overlaps need a choice. */
export function proteinRegionTargets(data: SeqData, range: Range) {
  return data.features.flatMap(feature => {
    if (feature.type.toUpperCase() !== "CDS") return [];
    const residues = selectedProteinResidues(feature, range, data.sequence);
    return residues ? [{ feature, ...residues }] : [];
  });
}

export interface ProteinRegion {
  /** Stable identity for nesting; old files need none until a region is edited. */
  id?: string;
  name: string;
  /** A protein annotation kind, either chosen by the user or imported from UniProt. */
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
  color?: string;
  parentId?: string;
  variable?: VariableDesign;
  /** Imported annotations edited locally survive another import of their entry. */
  edited?: boolean;
  sourceKey?: string;
}

interface Noted {
  notes?: Record<string, unknown>;
}

const clean = (s: string) => s.replace(/\|/g, "/").trim();

/** `TM1|Transmembrane|13-33|Q9UKG4:13-33|predicted` */
export function formatRegion(r: ProteinRegion): string {
  const parts = [clean(r.name), clean(r.kind), `${r.start}-${r.end}`, `${r.accession}:${r.sourceStart}-${r.sourceEnd}`];
  const metadata = { id: r.id, color: r.color, parentId: r.parentId, variable: r.variable ? formatDesign(r.variable) : undefined, edited: r.edited, sourceKey: r.sourceKey };
  if (Object.values(metadata).some(v => v !== undefined)) return [...parts, r.predicted ? "predicted" : "", encodeURIComponent(JSON.stringify(metadata))].join("|");
  return (r.predicted ? [...parts, "predicted"] : parts).join("|");
}

export function parseRegion(value: string): ProteinRegion | null {
  const [name, kind, here, source, evidence, metadata] = value.split("|").map(s => s.trim());
  const at = /^(\d+)-(\d+)$/.exec(here ?? "");
  const from = /^([^:]*):(\d+)-(\d+)$/.exec(source ?? "");
  if (!name || !at || Number(at[1]) < 1 || Number(at[2]) < Number(at[1])) return null;
  let extra: Partial<ProteinRegion> = {};
  try {
    const m = metadata ? JSON.parse(decodeURIComponent(metadata)) : {};
    if (m && typeof m === "object") extra = {
      ...(typeof m.id === "string" ? { id: m.id } : {}),
      ...(typeof m.color === "string" && /^#[0-9a-f]{6}$/i.test(m.color) ? { color: m.color } : {}),
      ...(typeof m.parentId === "string" ? { parentId: m.parentId } : {}),
      ...(typeof m.variable === "string" ? { variable: parseDesign(m.variable) } : {}),
      ...(m.edited === true ? { edited: true } : {}),
      ...(typeof m.sourceKey === "string" ? { sourceKey: m.sourceKey } : {})
    };
  } catch { /* Keep the annotation even if its optional metadata cannot be read. */ }
  return {
    ...extra,
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

export const REGION_KINDS = ["Domain", "Linker", "Transmembrane", "Intramembrane", "Topological domain", "Signal peptide", "Transit peptide", "CDR", "Framework", "Tag", "Repeat", "Region", "Motif"];
const COLORS = ["#4F8FBA", "#B47EB3", "#D99049", "#58A68C", "#D57479", "#8F91C4", "#849B48"];
/** Follow neighbouring hues around the palette; keep COLORS's legacy hash order intact. */
const REGION_PALETTE = [0, 3, 6, 2, 4, 1, 5].map(i => COLORS[i]);

/** New annotations use successive coordinated colours, starting near their CDS's colour.
 * Saved colours stay fixed when names, annotation order or the CDS's own colour change. */
export function nextRegionColor(regions: readonly ProteinRegion[], cdsColor?: string): string {
  const rgb = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16));
  let first = 0;
  if (cdsColor && /^#[0-9a-f]{6}$/i.test(cdsColor)) {
    const base = rgb(cdsColor);
    const distance = (color: string) => rgb(color).reduce((sum, value, i) => sum + (value - base[i]) ** 2, 0);
    for (let i = 1; i < REGION_PALETTE.length; i++) if (distance(REGION_PALETTE[i]) < distance(REGION_PALETTE[first])) first = i;
  }
  const palette = [...REGION_PALETTE.slice(first), ...REGION_PALETTE.slice(0, first)];
  const uses = new Map<string, number>();
  for (const r of regions) {
    const color = regionColor(r).toLowerCase();
    uses.set(color, (uses.get(color) ?? 0) + 1);
  }
  // Once every colour is used, repeat the least-used one in palette order.
  return palette.reduce((best, color) => (uses.get(color.toLowerCase()) ?? 0) < (uses.get(best.toLowerCase()) ?? 0) ? color : best);
}

export function regionColor(r: ProteinRegion): string {
  let hash = 0;
  for (const c of r.kind + r.name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return r.color ?? COLORS[hash % COLORS.length];
}
export function regionTextColor(r: ProteinRegion): string {
  const rgb = regionColor(r).slice(1).match(/../g)!.map(c => parseInt(c, 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.179 ? "#15181e" : "#ffffff";
}

export type ProteinDetail = "none" | "domains" | "all";

/** Outline order: a parent immediately followed by its descendants. Invalid links are roots. */
export function regionTree(regions: ProteinRegion[]) {
  const rows = regions.map((region, index) => ({ region, index }));
  const seen = new Set<number>();
  const out: { region: ProteinRegion; index: number; depth: number }[] = [];
  const parentOf = (r: ProteinRegion) => rows.find(x => x.region.id && x.region.id === r.parentId && x.region !== r && x.region.start <= r.start && x.region.end >= r.end);
  const visit = (row: typeof rows[number], depth: number) => {
    if (seen.has(row.index)) return;
    seen.add(row.index);
    out.push({ ...row, depth });
    for (const child of rows) if (parentOf(child.region) === row) visit(child, depth + 1);
  };
  for (const row of rows) if (!parentOf(row.region)) visit(row, 0);
  for (const row of rows) visit(row, 0);
  return out;
}

/** Independent lanes keep nested and overlapping annotations distinguishable. */
export function layoutRegions(regions: ProteinRegion[], detail: ProteinDetail = "all") {
  const ids = new Map(regions.filter(r => r.id).map(r => [r.id!, r]));
  const depthOf = (r: ProteinRegion) => {
    const seen = new Set<ProteinRegion>([r]);
    let depth = 0;
    let parent = r.parentId ? ids.get(r.parentId) : undefined;
    while (parent && !seen.has(parent) && parent.start <= r.start && parent.end >= r.end) {
      seen.add(parent);
      depth++;
      parent = parent.parentId ? ids.get(parent.parentId) : undefined;
    }
    return depth;
  };
  const ends: number[] = [];
  return regions.map((region, index) => ({ region, index, depth: depthOf(region) }))
    .filter(x => detail !== "none" && (detail === "all" || x.depth === 0))
    .sort((a, b) => a.depth - b.depth || a.region.start - b.region.start || b.region.end - a.region.end)
    .map(x => {
      let lane = x.depth;
      while (ends[lane] !== undefined && ends[lane] >= x.region.start) lane++;
      ends[lane] = x.region.end;
      return { ...x, lane };
    });
}

/** Project attached library regions into the existing read-analysis model, never as CDSs. */
export function variableProteinFeatures(f: Located & Noted & { id: string; name: string }, n: number): Feature[] {
  return regionsOf(f).flatMap((r, index) => {
    if (!r.variable) return [];
    const spans = regionSpans(f, r, n);
    if (!spans.length) return [];
    return [{ id: `${f.id}:region:${r.id ?? index}`, name: r.name, type: "misc_feature", start: spans[0].start, end: spans[spans.length - 1].end, strand: f.strand, forward: f.strand !== -1, ...(spans.length > 1 ? { locations: spans } : {}), variable: r.variable }];
  });
}

/** Portable DNA annotations for an exported copy; the document keeps its attached regions. */
export function proteinRegionFeatures(f: SeqFeature, n: number): SeqFeature[] {
  return regionsOf(f).flatMap((r, index) => {
    const spans = regionSpans(f, r, n);
    if (!spans.length) return [];
    return [{ id: `${f.id}:region:${r.id ?? index}`, name: r.name, type: r.kind === "Signal peptide" ? "sig_peptide" : r.kind === "Transit peptide" ? "transit_peptide" : "misc_feature", start: spans[0].start, end: spans[spans.length - 1].end, strand: f.strand, ...(spans.length > 1 ? { locations: spans } : {}), color: regionColor(r), notes: { note: [`${r.kind}; ${f.name}, residues ${r.start}-${r.end}${r.accession ? `; UniProtKB ${r.accession} ${r.sourceStart}-${r.sourceEnd}` : ""}`] }, raw: {} }];
  });
}

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
    const end = Math.max(start, nearestResidue(last + 1));
    kept.push({ ...r, start, end, ...(!r.accession ? { sourceStart: start, sourceEnd: end } : {}) });
  }
  return { ...next, notes: withRegions(next.notes ?? {}, kept) };
}
