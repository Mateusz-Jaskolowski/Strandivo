// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What exported images share: their names, sizes and colours. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { cssColor, fitBox, imageFileName, PNG_MAX_PIXELS, PNG_MAX_SIDE, pngScale, svgColor, svgDashes, svgLength } from "./imageExport.ts";

test("an image's file name is the sequence's, made safe, and says what it shows", () => {
  assert.equal(imageFileName("pUC19", "map"), "pUC19 map");
  assert.equal(imageFileName('a/b:c*?"<>|d', "gel"), "a-b-c-d gel");
  assert.equal(imageFileName("  two   spaces ", "map"), "two spaces map");
  // A backslash is a path separator on Windows, and a control character no name may hold.
  assert.equal(imageFileName("a\\b\x01", "map"), "a-b- map");
  // A name of dots alone would hide the file, or name the folder above.
  assert.equal(imageFileName("..", "map"), "Sequence map");
  assert.equal(imageFileName("", "digest gel", "Digest"), "Digest digest gel");
});

test("a PNG is about 3,000 pixels along its longest side, never under three per pixel, within what a canvas holds", () => {
  assert.equal(pngScale(600, 500), 5);
  assert.equal(pngScale(1200, 300), 3);
  assert.equal(pngScale(100, 80), 8);
  // Hundredths, cut rather than rounded: a gel's 344 × 415 is 3,000 / 415 = 7.2289…
  assert.equal(pngScale(344, 415), 7.22);
  // 4,000 × 4,000 holds 16 million pixels at one per pixel, so the 40 million allowed leave √2.5 = 1.58 each way.
  assert.equal(pngScale(4000, 4000), 1.58);
  // A huge drawing gets fewer pixels rather than a canvas that draws blank.
  const big = pngScale(9000, 7000);
  assert.ok(9000 * big <= PNG_MAX_SIDE && 9000 * 7000 * big * big <= PNG_MAX_PIXELS, String(big));
  const long = pngScale(20000, 200);
  assert.ok(20000 * long <= PNG_MAX_SIDE, String(long));
});

test("a drawing is fitted to what it covers, with room round it, on whole pixels", () => {
  assert.deepEqual(fitBox({ x: -10.4, y: 3.2, width: 100.5, height: 20 }, 12), { x: -23, y: -9, width: 126, height: 45 });
});

test("colours are written as other programs read them: #rrggbb and an opacity", () => {
  assert.deepEqual(svgColor(21, 24, 30, 1), { color: "#15181e", opacity: 1 });
  assert.deepEqual(svgColor(35, 150, 138, 0.4), { color: "#23968a", opacity: 0.4 });
  assert.equal(svgColor(0, 0, 0, 0), null);
  assert.deepEqual(cssColor("rgb(21, 24, 30)"), { r: 21, g: 24, b: 30, a: 1 });
  assert.deepEqual(cssColor("rgba(35, 150, 138, 0.4)"), { r: 35, g: 150, b: 138, a: 0.4 });
  assert.deepEqual(cssColor("rgb(35 150 138 / 40%)"), { r: 35, g: 150, b: 138, a: 0.4 });
  // What color-mix() in srgb computes to.
  assert.deepEqual(cssColor("color(srgb 0.5 0.25 1 / 0.5)"), { r: 127.5, g: 63.75, b: 255, a: 0.5 });
  // Without an alpha it is opaque, as a colour mixed from opaque colours is.
  assert.deepEqual(cssColor("color(srgb 0.2 0.4 0.6)"), { r: 51, g: 102, b: 153, a: 1 });
  assert.deepEqual(cssColor("transparent"), { r: 0, g: 0, b: 0, a: 0 });
  assert.equal(cssColor("#abc"), undefined, "left to the browser to read");
});

test("lengths and dashes lose their units", () => {
  assert.equal(svgLength("1.5px"), "1.5");
  assert.equal(svgDashes("3px, 2px"), "3 2");
  assert.equal(svgDashes("none"), "none");
});
