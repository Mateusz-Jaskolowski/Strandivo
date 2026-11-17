// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Moving where a CDS's protein regions start and end, as dragging their ends in the
// Sequence tab does. An edge lies between two residues; the region whose end is dragged
// moves, and so does one on the same level that meets it there, so regions that met still
// meet (FR1 and CDR1). A parent or child that ends there too stays where it is and only
// limits the move, so a child pulled up to its parent's end can be pulled back alone.
// Holding ⌥ (Alt) moves the region's end alone, which parts two regions that met. It moves
// a codon at a time, as regions are numbered in residues. Pure, so it is unit-tested.

import { codingPositions } from "./genetics.ts";
import { newId, type SeqFeature } from "./seqdata.ts";
import { proteinLength, regionsOf, withRegions, type ProteinRegion } from "./regions.ts";

export interface RegionEdge {
  /** The residue before it, 0 before the first: regions in `starts` begin at `at + 1`, those in `ends` end at `at`. */
  at: number;
  starts: number[];
  ends: number[];
  /**
   * How far it can go: every region keeps a residue, a child stays inside its parent, a
   * parent keeps its children, and none passes the protein's ends.
   */
  min: number;
  max: number;
  /** The CDS's regions as `regionsOf` gives them, each with an id; the indices above are into this. */
  regions: ProteinRegion[];
}

/** The parent a region is drawn under: the one its link names, while that one holds it. */
function parentOf(regions: ProteinRegion[], r: ProteinRegion): ProteinRegion | undefined {
  return regions.find(x => x !== r && x.id !== undefined && x.id === r.parentId && x.start <= r.start && x.end >= r.end);
}

/**
 * The edge at a region's start or end, with what moves along with it, and as `alone` the same
 * edge moving only that region's end, as ⌥ (Alt) does. Both are on the same regions, so a
 * drag can switch between them and the ids given here stay the same.
 */
export function regionEdge(f: SeqFeature, sequence: string, index: number, end: "start" | "end"): (RegionEdge & { alone: RegionEdge }) | null {
  // Ids let the caller find the region again once moving it has changed their order.
  const regions = regionsOf(f).map(r => (r.id ? r : { ...r, id: newId("r") }));
  const grabbed = regions[index];
  if (!grabbed) return null;
  const at = end === "start" ? grabbed.start - 1 : grabbed.end;
  const length = proteinLength(f, sequence);
  const children = (p: ProteinRegion) => regions.filter(c => parentOf(regions, c) === p);
  const edge = (others: number[]): RegionEdge => {
    const starts = end === "start" ? [index] : others;
    const ends = end === "start" ? others : [index];
    let min = 0;
    let max = Math.max(at, length);
    for (const i of starts) {
      const r = regions[i];
      max = Math.min(max, r.end - 1);
      const p = parentOf(regions, r);
      if (p) min = Math.max(min, p.start - 1);
      for (const c of children(r)) max = Math.min(max, c.start - 1);
    }
    for (const i of ends) {
      const r = regions[i];
      min = Math.max(min, r.start);
      const p = parentOf(regions, r);
      if (p) max = Math.min(max, p.end);
      for (const c of children(r)) min = Math.max(min, c.end);
    }
    return { at, starts, ends, min, max, regions };
  };
  // The regions under the same parent, or with none like it, that meet it at this edge.
  const level = parentOf(regions, grabbed);
  const meets = (r: ProteinRegion) => r !== grabbed && parentOf(regions, r) === level && (end === "start" ? r.end === at : r.start - 1 === at);
  return { ...edge(regions.flatMap((r, i) => (meets(r) ? [i] : []))), alone: edge([]) };
}

/** A region given new residues, keeping the exact bases of an end that didn't move. */
function resized(r: ProteinRegion, start: number, end: number): ProteinRegion {
  const { codingBases: exact, ...rest } = r;
  const first = start === r.start && exact ? exact.start : (start - 1) * 3 + 1;
  const last = end === r.end && exact ? exact.end : end * 3;
  const onResidues = first === (start - 1) * 3 + 1 && last === end * 3;
  return {
    ...rest,
    start,
    end,
    ...(onResidues ? {} : { codingBases: { start: first, end: last } }),
    // An entry's numbers move with it; an edit the next import of the entry keeps.
    ...(r.accession
      ? { sourceStart: r.sourceStart + start - r.start, sourceEnd: r.sourceEnd + end - r.end, edited: true, sourceKey: r.sourceKey ?? `${r.kind}:${r.sourceStart}-${r.sourceEnd}` }
      : { sourceStart: start, sourceEnd: end })
  };
}

/** The CDS with the edge moved to after residue `to`, kept within its limits. */
export function moveRegionEdge(f: SeqFeature, edge: RegionEdge, to: number): SeqFeature {
  const at = Math.max(edge.min, Math.min(edge.max, to));
  // Put back, it is as it was: an imported region doesn't count as edited.
  if (at === edge.at) return f;
  const regions = edge.regions.map((r, i) => {
    const start = edge.starts.includes(i);
    const end = edge.ends.includes(i);
    return start || end ? resized(r, start ? at + 1 : r.start, end ? at : r.end) : r;
  });
  return { ...f, notes: withRegions(f.notes ?? {}, regions) };
}

/**
 * The edge between residues nearest a boundary between bases (0 before the first base, the
 * sequence's length after the last), for following the pointer. It counts along the CDS's
 * own bases, so an intron or the origin in between is skipped.
 */
export function edgeNear(f: SeqFeature, n: number, circular: boolean, boundary: number): number {
  const forward = f.strand !== -1;
  const gap = (x: number) => {
    const d = Math.abs(x - boundary);
    return circular ? Math.min(d % n, n - (d % n)) : d;
  };
  let best = 0;
  let bestGap = Infinity;
  codingPositions(f, n).forEach((p, i) => {
    // The boundary before this base in the CDS's own direction, then the one after it.
    const before = gap(forward ? p : p + 1);
    if (before < bestGap) [best, bestGap] = [i, before];
    const after = gap(forward ? p + 1 : p);
    if (after < bestGap) [best, bestGap] = [i + 1, after];
  });
  return Math.round(best / 3);
}
