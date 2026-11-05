// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Selecting several reads and clones. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { cloneItem, extendPick, listItems, NO_PICKS, pickedReads, prunePicks, togglePick } from "./readSelection.ts";

const items = listItems([
  { key: "a", reads: ["r1"] },
  { key: "b", reads: ["r2", "r3"] },
  { key: "c", reads: ["r4"] }
]);

test("the list's rows: lone reads, a clone, then its reads", () => {
  assert.deepEqual(items.map(x => x.id), ["r1", cloneItem("b"), "r2", "r3", "r4"]);
});

test("toggling adds a row and takes it out again", () => {
  const one = togglePick(NO_PICKS, "r1");
  const two = togglePick(one, "r4");
  assert.deepEqual(two.ids, ["r1", "r4"]);
  assert.deepEqual(togglePick(two, "r1").ids, ["r4"]);
});

test("Shift takes every row between the anchor and the row, either way", () => {
  const start = togglePick(NO_PICKS, "r4");
  assert.deepEqual(extendPick(start, "r2", items).ids, ["r2", "r3", "r4"]);
  const down = extendPick(togglePick(NO_PICKS, "r1"), "r2", items);
  assert.deepEqual(down.ids, ["r1", cloneItem("b"), "r2"]);
  assert.equal(down.anchor, "r1");
});

test("Shift with nothing picked takes only that row", () => {
  assert.deepEqual(extendPick(NO_PICKS, "r3", items).ids, ["r3"]);
});

test("a clone stands for its reads, a read in a clone only for itself, and none twice", () => {
  assert.deepEqual(pickedReads({ ids: [cloneItem("b")], anchor: null }, items), ["r2", "r3"]);
  assert.deepEqual(pickedReads({ ids: ["r3"], anchor: null }, items), ["r3"]);
  assert.deepEqual(pickedReads({ ids: ["r2", cloneItem("b"), "r4"], anchor: null }, items), ["r2", "r3", "r4"]);
});

test("rows that are gone leave the selection", () => {
  const p = prunePicks({ ids: ["r1", cloneItem("b")], anchor: cloneItem("b") }, listItems([{ key: "a", reads: ["r1"] }]));
  assert.deepEqual(p, { ids: ["r1"], anchor: null });
});
