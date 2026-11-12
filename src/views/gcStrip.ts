// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The GC strip under a row of bases (Sequence, the primer's context) and along the
// Sequence tab's overview strip: runs of one colour, each with its GC in a tooltip.

import { gcRuns, gcRunText } from "../lib/gc.ts";
import { fmtRange } from "../ui/format.ts";

/** Height of the strip in a row, in pixels. */
export const GC_STRIP_HEIGHT = 5;

/**
 * One element per run of a colour among `count` columns: column i shows the GC around
 * base `positionAt(i)`. `x` turns a column count into a CSS length (from the left).
 */
export function drawGcStrip(values: Float64Array, count: number, positionAt: (i: number) => number, x: (columns: number) => string, cls = "sv-gc"): HTMLElement[] {
  return gcRuns(count, i => values[positionAt(i)]).map(run => {
    const el = document.createElement("div");
    el.className = `${cls} sv-gc-${run.level}`;
    el.style.left = x(run.a);
    el.style.width = x(run.b - run.a + 1);
    el.title = `${gcRunText(run)} around ${fmtRange(positionAt(run.a) + 1, positionAt(run.b) + 1)}`;
    return el;
  });
}
