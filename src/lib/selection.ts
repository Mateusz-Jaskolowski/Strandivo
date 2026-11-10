// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { basesIn, deleteRange, pieces, type Range, type SeqData } from "./seqdata.ts";

export interface BaseSelection {
  /** Only present for one continuous stretch. */
  range: Range | null;
  /** Separate stretches; never their bounding span. */
  ranges?: Range[];
}

export const selectedRanges = (s: BaseSelection): Range[] => s.ranges ?? (s.range ? [s.range] : []);

/** Merge overlaps and neighbours, including neighbours across a circular origin. */
export function mergeRanges(ranges: Range[], n: number, circular = true): Range[] {
  if (!n) return [];
  const parts = ranges.flatMap(r => pieces({ start: Math.max(0, Math.min(n - 1, r.start)), end: Math.max(0, Math.min(n - 1, r.end)) }, n)).sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const r of parts) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  if (circular && merged.length > 1 && merged[0].start === 0 && merged[merged.length - 1].end === n - 1) {
    const first = merged.shift()!;
    const last = merged.pop()!;
    merged.unshift({ start: last.start, end: first.end });
  }
  return merged;
}

/** Selected DNA on the top strand, leaving out unselected gaps. */
export const selectedBases = (sequence: string, s: BaseSelection): string => selectedRanges(s).map(r => basesIn(sequence, r)).join("");

/** Delete just the selected bases, mapping annotations once per stretch and undoing as one edit. */
export function deleteSelected(data: SeqData, s: BaseSelection): { data: SeqData; caret: number } {
  const parts = mergeRanges(selectedRanges(s), data.sequence.length, data.circular).flatMap(r => pieces(r, data.sequence.length)).sort((a, b) => b.start - a.start);
  let next = data;
  for (const r of parts) next = deleteRange(next, r);
  return { data: next, caret: parts.length ? parts[parts.length - 1].start : 0 };
}
