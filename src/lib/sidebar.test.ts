// The sidebar's order of sections. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { dropGap, foldedSections, moveSection, sidebarOrder } from "./sidebar.ts";

test("primers, enzymes and features by default", () => {
  assert.deepEqual(sidebarOrder(undefined), ["primers", "enzymes", "features"]);
});

test("a stored order is kept, cleaned and completed", () => {
  assert.deepEqual(sidebarOrder(["features", "primers"]), ["features", "primers", "enzymes"]);
  assert.deepEqual(sidebarOrder(["enzymes", "bogus", "enzymes", 3]), ["enzymes", "primers", "features"]);
  assert.deepEqual(sidebarOrder("features"), ["primers", "enzymes", "features"]);
});

test("folded sections keep only known names", () => {
  assert.deepEqual(foldedSections(["features", "x", "features"]), ["features"]);
  assert.deepEqual(foldedSections(null), []);
});

test("moving a section to each gap", () => {
  const o = sidebarOrder(undefined);
  assert.deepEqual(moveSection(o, "features", 0), ["features", "primers", "enzymes"]);
  assert.deepEqual(moveSection(o, "primers", 3), ["enzymes", "features", "primers"]);
  assert.deepEqual(moveSection(o, "primers", 2), ["enzymes", "primers", "features"]);
  assert.deepEqual(moveSection(o, "enzymes", 0), ["enzymes", "primers", "features"]);
});

test("dropping a section next to itself changes nothing", () => {
  const o = sidebarOrder(undefined);
  assert.equal(moveSection(o, "enzymes", 1), o);
  assert.equal(moveSection(o, "enzymes", 2), o);
});

test("the gap under the pointer is past every section whose middle is above it", () => {
  const rects = [
    { top: 0, bottom: 100 },
    { top: 100, bottom: 140 },
    { top: 140, bottom: 400 }
  ];
  assert.equal(dropGap(rects, 10), 0);
  assert.equal(dropGap(rects, 60), 1);
  assert.equal(dropGap(rects, 130), 2);
  assert.equal(dropGap(rects, 500), 3);
});
