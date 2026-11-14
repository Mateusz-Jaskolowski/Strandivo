// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The GC strip under a row of bases (Sequence, the primer's context) and along the
// Sequence tab's overview strip: runs of one colour, each with its GC in a tooltip. Also
// the button that shows it, here and on the map.

import { gcRuns, gcRunText, type GcRun } from "../lib/gc.ts";
import { fmt, fmtRange } from "../ui/format.ts";

/** Height of the strip in a row, in pixels. */
export const GC_STRIP_HEIGHT = 5;

/** The button that shows GC content, in Sequence, the primer's context and the map. */
export const GC_CHIP_LABEL = "GC%";

/**
 * The button's tooltip: what is counted (`over`, such as "the 21 bases around each base"),
 * then what each colour means, as the strip has no legend of its own.
 */
export function gcChipTitle(over: string, forPrimers: boolean): string {
  return [
    `GC content of ${over}`,
    `Grey: 40–60%${forPrimers ? ", best for primers" : ""}`,
    "Teal: AT-rich, below 40% (pale at 35–40%)",
    "Orange: GC-rich, above 60% (pale at 60–65%)"
  ].join("\n");
}

/** A window's size as the tooltip says it. */
export const gcWindowText = (window: number) => `${fmt(window)} bp`;

/** A run's tooltip: its GC and the bases it covers, 1-based (`a` after `b` across the origin). */
export const gcRunTitle = (run: GcRun, positionAt: (i: number) => number = i => i) => `${gcRunText(run)} around ${fmtRange(positionAt(run.a) + 1, positionAt(run.b) + 1)}`;

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
    el.title = gcRunTitle(run, positionAt);
    return el;
  });
}
