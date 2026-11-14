// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The name in the middle of the circular map. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { layoutName, LENGTH_SIZE, type NameLines } from "./mapName.ts";

// Every character 0.6 of the font size wide, near enough to a sans-serif's average.
const measure = (text: string, size: number) => text.length * size * 0.6;
const R = 95;

/** Every line, and the length under them, lies inside the circle. */
function assertInside(fit: NameLines, radius = R) {
  const inside = (y: number, size: number, width: number) => {
    // The line's box, from its ascent to its descent, against the circle's chord there.
    const far = Math.max(Math.abs(y - size * 0.95), Math.abs(y + size * 0.25));
    return width <= 2 * Math.sqrt(Math.max(0, radius * radius - far * far)) + 1e-6;
  };
  for (const l of fit.lines) assert.ok(inside(l.y, fit.size, measure(l.text, fit.size)), `"${l.text}" at ${fit.size}px sticks out`);
  assert.ok(inside(fit.lengthY, LENGTH_SIZE, measure("10,898 bp", LENGTH_SIZE)), "the length sticks out");
  const ys = [...fit.lines.map(l => l.y), fit.lengthY];
  assert.ok(ys.every((y, i) => !i || y > ys[i - 1]), "lines go down the page");
}

test("a short name is one large line", () => {
  const fit = layoutName("pUC19", R, measure);
  assert.deepEqual(fit.lines.map(l => l.text), ["pUC19"]);
  assert.equal(fit.size, 18);
  assert.equal(fit.cut, false);
  assertInside(fit);
});

test("a longer name stays on one line while it can be read, smaller", () => {
  const fit = layoutName("pET-28a(+) GFP fusion", R, measure);
  assert.equal(fit.lines.length, 1);
  assert.ok(fit.size >= 13 && fit.size < 18, String(fit.size));
  assertInside(fit);
});

test("a long name wraps between words, inside the circle", () => {
  const name = "testing how it works and seeing how the long text works";
  const fit = layoutName(name, R, measure);
  assert.ok(fit.lines.length >= 2 && fit.lines.length <= 3, fit.lines.map(l => l.text).join(" / "));
  assert.equal(fit.lines.map(l => l.text).join(" "), name);
  assert.equal(fit.cut, false);
  assertInside(fit);
});

test("a long word breaks after an underscore or hyphen before anywhere else", () => {
  const fit = layoutName("pLenti_CMV_GFP_Puro_WPRE_long", R, measure);
  assert.ok(fit.lines.length > 1);
  assert.equal(fit.lines.map(l => l.text).join(""), "pLenti_CMV_GFP_Puro_WPRE_long");
  for (const l of fit.lines.slice(0, -1)) assert.match(l.text, /_$/);
  assertInside(fit);
});

test("a name too long for three lines is cut short with an ellipsis", () => {
  const name = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
  const fit = layoutName(name, R, measure);
  assert.equal(fit.cut, true);
  assert.equal(fit.lines.length, 3);
  assert.equal(fit.size, 11);
  assert.match(fit.lines[2].text, /…$/);
  assert.ok(name.startsWith(fit.lines.slice(0, 2).map(l => l.text).join(" ")));
  assertInside(fit);
});

test("a smaller circle holds a smaller name", () => {
  const big = layoutName("pcDNA3.1 hygro", R, measure);
  const small = layoutName("pcDNA3.1 hygro", 45, measure);
  assert.ok(small.size < big.size || small.lines.length > big.lines.length);
  assertInside(small, 45);
});
