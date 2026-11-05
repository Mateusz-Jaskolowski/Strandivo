// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What dropping reads in the list means. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { applyDrop, type ListGroup } from "./readDrag.ts";

const groups: ListGroup[] = [
  { key: "a", reads: ["r1"] },
  { key: "b", reads: ["r2", "r3"] },
  { key: "c", reads: ["r4"] },
  { key: "d", reads: ["r5", "r6"] }
];

test("a lone read on another read joins it", () => {
  const d = applyDrop(groups, ["r1"], false, { kind: "join", key: "c" });
  assert.deepEqual(d, { order: ["r2", "r3", "r4", "r1", "r5", "r6"], moved: { ids: ["r1"], key: "c" } });
});

test("a read on a clone joins it, at its end", () => {
  const d = applyDrop(groups, ["r4"], false, { kind: "join", key: "b" });
  assert.deepEqual(d, { order: ["r1", "r2", "r3", "r4", "r5", "r6"], moved: { ids: ["r4"], key: "b" } });
});

test("several reads join together, and those already in the clone stay", () => {
  const d = applyDrop(groups, ["r3", "r5"], false, { kind: "join", key: "b" });
  assert.deepEqual(d?.moved, { ids: ["r5"], key: "b" });
  assert.deepEqual(d?.order, ["r1", "r2", "r3", "r5", "r4", "r6"]);
});

test("dropping a clone's own read on it changes nothing", () => {
  assert.equal(applyDrop(groups, ["r3"], false, { kind: "join", key: "b" }), null);
});

test("a lone read between rows only moves", () => {
  const d = applyDrop(groups, ["r1"], false, { kind: "between", before: "d" });
  assert.deepEqual(d, { order: ["r2", "r3", "r4", "r1", "r5", "r6"], moved: null });
});

test("a read dragged out of a clone leaves it", () => {
  const d = applyDrop(groups, ["r2"], false, { kind: "between", before: "c" });
  assert.deepEqual(d, { order: ["r1", "r3", "r2", "r4", "r5", "r6"], moved: { ids: ["r2"], key: null } });
});

test("below the last row: to the end, out of any clone", () => {
  const d = applyDrop(groups, ["r2"], false, { kind: "between", before: null });
  assert.deepEqual(d, { order: ["r1", "r3", "r4", "r5", "r6", "r2"], moved: { ids: ["r2"], key: null } });
});

test("reads reorder inside their clone", () => {
  const d = applyDrop(groups, ["r3"], false, { kind: "inside", key: "b", before: "r2" });
  assert.deepEqual(d, { order: ["r1", "r3", "r2", "r4", "r5", "r6"], moved: null });
});

test("a read dropped between another clone's reads joins it there", () => {
  const d = applyDrop(groups, ["r1"], false, { kind: "inside", key: "d", before: "r6" });
  assert.deepEqual(d, { order: ["r2", "r3", "r4", "r5", "r1", "r6"], moved: { ids: ["r1"], key: "d" } });
});

test("a read dropped at the end of another clone's reads joins it at its end", () => {
  const d = applyDrop(groups, ["r1"], false, { kind: "inside", key: "b", before: null });
  assert.deepEqual(d, { order: ["r2", "r3", "r1", "r4", "r5", "r6"], moved: { ids: ["r1"], key: "b" } });
});

test("a whole clone only reorders, keeping its reads together", () => {
  const d = applyDrop(groups, ["r2", "r3"], true, { kind: "between", before: "d" });
  assert.deepEqual(d, { order: ["r1", "r4", "r2", "r3", "r5", "r6"], moved: null });
});

test("a whole clone dropped on another doesn't merge", () => {
  const d = applyDrop(groups, ["r2", "r3"], true, { kind: "join", key: "d" });
  assert.equal(d?.moved, null);
  assert.deepEqual(d?.order, ["r1", "r4", "r2", "r3", "r5", "r6"]);
});

test("with a whole clone in a selection, a read of another clone stays where it is", () => {
  const d = applyDrop(groups, ["r2", "r3", "r5"], true, { kind: "between", before: null });
  assert.deepEqual(d, { order: ["r1", "r4", "r5", "r6", "r2", "r3"], moved: null });
});

test("dropping a row where it already is changes nothing", () => {
  assert.equal(applyDrop(groups, ["r4"], false, { kind: "between", before: "c" }), null);
  assert.equal(applyDrop(groups, ["r4"], false, { kind: "between", before: "d" }), null);
});
