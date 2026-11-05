// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Layout of the Reads tab's alignment: every aligned read (or piece of a read that crosses
// the origin) stacked under one reference, with the lookups the drawing code needs.
// Pure functions, so they can be unit-tested with plain Node.

import { orientChromatogram } from "./chromatogram.ts";
import { columnOfReferencePosition, rowSpan, stackAlignments } from "./msa.ts";
import type { Chromatogram, ReadResult, TraceKey } from "./types.ts";

export interface AlignedTrack {
  /** Index into the read results. */
  result: number;
  /** Which piece of the read this is (reads crossing the origin align in two pieces). */
  piece: number;
  pieces: number;
  /** The read's row of the stacked alignment ("-" outside the read and in its gaps). */
  row: string;
  firstColumn: number;
  lastColumn: number;
  /** Columns that hold read bases, in read order, and each base's index in the oriented read. */
  baseColumns: Int32Array;
  baseIndex: Int32Array;
  /** Whole read, turned to the strand it aligned to; null for reads without a trace. */
  chromatogram: Chromatogram | null;
  /** Quality of each oriented read base, if the file has real scores. */
  qualities: number[] | null;
  /** Trace value drawn at the full track height. */
  traceMax: number;
}

export interface AlignmentLayout {
  /** Reference with gap columns where reads have extra bases. */
  reference: string;
  length: number;
  /** Column of each reference position; index n (one past the end) is `length`. */
  columnOf: number[];
  /** Reference position of each column, or -1 for a column of inserted bases. */
  refAt: Int32Array;
  tracks: AlignedTrack[];
}

export interface ReadForLayout {
  chromatogram: Chromatogram | null;
}

export type LayoutResult = { layout: AlignmentLayout } | { error: string } | null;

const TRACE: Record<string, TraceKey> = { A: "aTrace", C: "cTrace", G: "gTrace", T: "tTrace" };

/** Height to scale a trace to: a bit above most called peaks, so a few spikes don't flatten it. */
function traceScale(c: Chromatogram, indices: Int32Array): number {
  const peaks: number[] = [];
  for (const i of indices) {
    const key = TRACE[c.baseCalls[i]];
    const pos = Math.round(c.basePos[i]);
    if (!key || pos < 0) continue;
    const v = c[key][pos];
    if (v > 0) peaks.push(v);
  }
  if (!peaks.length) return 1;
  peaks.sort((a, b) => a - b);
  return Math.max(1, peaks[Math.floor(peaks.length * 0.9)] * 1.15);
}

function usable(q: number[] | undefined, n: number): number[] | null {
  if (!q || q.length !== n || !q.some(v => v > 1)) return null;
  return q;
}

/**
 * Stacks the aligned reads under the reference, in `order` (indices into `results`) if
 * given. Returns null when no read aligned, or an error message when the alignment can't
 * be shown (e.g. the sequence is too long).
 */
export function layoutAlignment(reference: string, results: ReadResult[], reads: ReadForLayout[], order?: number[]): LayoutResult {
  const pieces: { result: number; piece: number; pieces: number; readFrom: number; readTo: number; row: { gappedReference: string; gappedRead: string } }[] = [];
  for (const i of order ?? results.keys()) {
    const r = results[i];
    if (r?.status !== "aligned") continue;
    r.segments.forEach((s, k) => pieces.push({ result: i, piece: k, pieces: r.segments.length, readFrom: s.readFrom, readTo: s.readTo, row: s }));
  }
  if (!pieces.length) return null;
  if (pieces.some(p => !p.row.gappedReference)) {
    return { error: "This sequence is too long to show the alignment; the table lists every difference." };
  }
  let stacked;
  try {
    stacked = stackAlignments(reference, pieces.map(p => p.row));
  } catch {
    return { error: "The alignment couldn't be drawn; the table lists every difference." };
  }
  const length = stacked.reference.length;
  const columnOf = columnOfReferencePosition(stacked.reference);
  const refAt = new Int32Array(length).fill(-1);
  for (let p = 0; p < reference.length; p++) refAt[columnOf[p]] = p;

  const oriented = new Map<number, Chromatogram | null>();
  const tracks: AlignedTrack[] = pieces.map((p, t) => {
    const row = stacked.rows[t];
    const r = results[p.result];
    if (!oriented.has(p.result)) {
      const c = reads[p.result]?.chromatogram;
      oriented.set(p.result, c ? orientChromatogram(c, r.strand === "reverse") : null);
    }
    const cols: number[] = [];
    for (let c = 0; c < row.length; c++) if (row[c] !== "-") cols.push(c);
    const baseColumns = Int32Array.from(cols);
    const baseIndex = Int32Array.from(cols, (_, k) => p.readFrom + k);
    let chromatogram = oriented.get(p.result) ?? null;
    // Only trust the trace if the piece's bases line up with the read's base calls.
    if (chromatogram && (cols.length !== p.readTo - p.readFrom || p.readTo > chromatogram.basePos.length)) chromatogram = null;
    const qualities = chromatogram ? usable(chromatogram.qualNums, chromatogram.baseCalls.length) : null;
    return {
      result: p.result,
      piece: p.piece,
      pieces: p.pieces,
      row,
      ...spanOf(row),
      baseColumns,
      baseIndex,
      chromatogram,
      qualities,
      traceMax: chromatogram ? traceScale(chromatogram, baseIndex) : 1
    };
  });
  return { layout: { reference: stacked.reference, length, columnOf, refAt, tracks } };
}

function spanOf(row: string) {
  const s = rowSpan(row);
  return { firstColumn: s.firstColumn, lastColumn: s.lastColumn };
}

/** Reference position for a column: the column's own base, or the next one for an insertion column. */
export function refPosAtColumn(layout: AlignmentLayout, column: number, n: number): number {
  const c = Math.max(0, Math.min(layout.length - 1, column));
  for (let k = c; k < layout.length; k++) if (layout.refAt[k] >= 0) return layout.refAt[k];
  return n - 1;
}

/** Index of the first entry in sorted `cols` that is >= `column`. */
export function firstAtOrAfter(cols: Int32Array, column: number): number {
  let lo = 0;
  let hi = cols.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cols[mid] < column) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Stacks column spans in lines, each on the first line it fits: spans that only touch share
 * one, so a run of neighbouring features stays on a line. Longer spans go first where
 * several start together. Returns each span's line, in the order given, and how many.
 */
export function stackInLanes(spans: { c0: number; c1: number }[]): { lanes: number[]; count: number } {
  const lanes = new Array<number>(spans.length);
  const ends: number[] = [];
  const order = spans.map((_, i) => i).sort((a, b) => spans[a].c0 - spans[b].c0 || spans[b].c1 - spans[a].c1);
  for (const i of order) {
    const { c0, c1 } = spans[i];
    let lane = ends.findIndex(e => e < c0);
    if (lane < 0) lane = ends.length;
    ends[lane] = c1;
    lanes[i] = lane;
  }
  return { lanes, count: ends.length };
}
