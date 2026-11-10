// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { DocStore } from "../doc/store.ts";
import { deleteSelected, mergeRanges, selectedBases, selectedRanges } from "./selection.ts";
import { pickCodons } from "./codonSelection.ts";
import type { SeqData } from "./seqdata.ts";

const data = (): SeqData => ({ name: "test", description: "", sequence: "AAACCCGGGTTT", circular: true, primers: [], sources: [], features: [
  { id: "gap", name: "Unselected feature", type: "misc_feature", start: 3, end: 5, strand: 1, notes: {}, raw: {} }
] });
const selection = { range: null, ranges: [{ start: 0, end: 2 }, { start: 6, end: 8 }] };

test("range unions merge overlaps and neighbours without mutating their inputs", () => {
  const ranges = [{ start: 5, end: 8 }, { start: 2, end: 5 }, { start: 9, end: 9 }];
  assert.deepEqual(mergeRanges(ranges, 12), [{ start: 2, end: 9 }]);
  assert.deepEqual(ranges[0], { start: 5, end: 8 });
  assert.deepEqual(mergeRanges([{ start: 10, end: 1 }, { start: 2, end: 4 }], 12), [{ start: 10, end: 4 }]);
  assert.deepEqual(mergeRanges([{ start: 0, end: 2 }, { start: 9, end: 11 }], 12, false), [{ start: 0, end: 2 }, { start: 9, end: 11 }]);
});

test("copying and deleting separate ranges leave their unselected gap intact", () => {
  const d = data();
  assert.equal(selectedBases(d.sequence, selection), "AAAGGG");
  const result = deleteSelected(d, selection);
  assert.equal(result.data.sequence, "CCCTTT");
  assert.deepEqual(result.data.features[0], { ...d.features[0], start: 0, end: 2 });
  assert.equal(result.caret, 0);
  assert.equal(d.sequence, "AAACCCGGGTTT");
});

test("deleting around the origin does not shift the other ranges before they are removed", () => {
  const d = data();
  assert.equal(deleteSelected(d, { range: null, ranges: [{ start: 11, end: 0 }, { start: 6, end: 8 }] }).data.sequence, "AACCCTT");
});

test("the store has no single range while separate codons are selected", () => {
  const store = new DocStore(data());
  const codons = pickCodons(undefined, { feature: "cds", index: 1 }, false, false);
  store.select({ ...selection, codons });
  assert.equal(store.selection.range, null);
  assert.deepEqual(selectedRanges(store.selection), selection.ranges);
  const before = store.selection;
  const deleted = deleteSelected(store.data, store.selection);
  store.apply(deleted.data, "Delete", { caret: deleted.caret });
  assert.equal(store.selection.ranges, undefined);
  store.undo();
  assert.deepEqual(store.selection, before);
  assert.equal(store.data.sequence, data().sequence);
  store.selectRange({ start: 0, end: 5 });
  assert.equal(store.selection.ranges, undefined);
  assert.equal(store.selection.codons, undefined);
});

test("adjacent picks become one ordinary range and clear when the last codon is unpicked", () => {
  const store = new DocStore(data());
  store.select({ ranges: [{ start: 0, end: 2 }, { start: 3, end: 5 }] });
  assert.deepEqual(store.selection.range, { start: 0, end: 5 });
  assert.equal(store.selection.ranges, undefined);
  store.select({ ranges: [], codons: pickCodons(undefined, { feature: "cds", index: 1 }, false, false) });
  assert.equal(store.selection.codons, undefined);
  assert.deepEqual(selectedRanges(store.selection), []);
});
