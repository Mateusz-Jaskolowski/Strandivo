// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Dragging round a circular map. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { sweep, sweptRange } from "./mapDrag.ts";

/** Drags through each boundary in turn, starting at the first. */
function drag(points: number[], n: number) {
  let swept = 0;
  for (let i = 1; i < points.length; i++) swept = sweep(swept, points[i - 1], points[i], n);
  return sweptRange(points[0], swept, n);
}

test("dragging clockwise selects clockwise", () => {
  assert.deepEqual(drag([100, 150, 200], 1000), { start: 100, end: 199 });
});

test("dragging anticlockwise selects anticlockwise, not the rest of the plasmid", () => {
  assert.deepEqual(drag([200, 150, 100], 1000), { start: 100, end: 199 });
});

test("a drag across the origin wraps either way", () => {
  assert.deepEqual(drag([950, 990, 10, 50], 1000), { start: 950, end: 49 });
  assert.deepEqual(drag([50, 10, 990, 950], 1000), { start: 950, end: 49 });
});

test("coming back past the start turns the selection round", () => {
  assert.deepEqual(drag([100, 150, 100, 60], 1000), { start: 60, end: 99 });
});

test("back at the start selects nothing", () => {
  assert.equal(drag([100, 150, 100], 1000), null);
});

test("going on past half way keeps the direction", () => {
  assert.deepEqual(drag([0, 300, 600, 900], 1000), { start: 0, end: 899 });
  assert.deepEqual(drag([0, 700, 400, 100], 1000), { start: 100, end: 999 });
});

test("a whole turn selects every base, and coming back shrinks it to the pointer", () => {
  assert.deepEqual(drag([0, 300, 600, 900, 0, 200], 1000), { start: 0, end: 999 });
  assert.deepEqual(drag([0, 300, 600, 900, 0, 200, 0, 900], 1000), { start: 0, end: 899 });
  assert.deepEqual(drag([500, 200, 900, 700], 1000), { start: 700, end: 499 });
  assert.deepEqual(drag([500, 200, 900, 600, 300], 1000), { start: 500, end: 499 });
});
