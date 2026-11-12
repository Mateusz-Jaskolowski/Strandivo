// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Selecting by dragging round a circular map. The selection follows the way the pointer
// went, not clockwise from where it was pressed: dragging anticlockwise once selected
// nearly the whole plasmid and shrank it as the pointer went on. No DOM here, so it is
// unit-tested.

import type { Range } from "./seqdata.ts";

/**
 * Bases swept so far, signed (positive is clockwise), after the pointer moved from boundary
 * `from` to `to`. Each step takes the shorter way round, so crossing the origin is a small
 * step, not a whole turn. The total may pass a whole turn: it keeps counting, so that
 * coming back shrinks the selection from where the pointer is.
 */
export function sweep(swept: number, from: number, to: number, n: number): number {
  if (n <= 0) return 0;
  let step = (((to - from) % n) + n) % n;
  if (step > n / 2) step -= n;
  return swept + step;
}

/** The bases swept from boundary `anchor`, or null for none. A whole turn or more is every base. */
export function sweptRange(anchor: number, swept: number, n: number): Range | null {
  if (!swept || n <= 0) return null;
  const at = (i: number) => (((i % n) + n) % n);
  if (Math.abs(swept) >= n) return { start: at(anchor), end: at(anchor - 1) };
  return swept > 0 ? { start: at(anchor), end: at(anchor + swept - 1) } : { start: at(anchor + swept), end: at(anchor - 1) };
}
