// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { DocStore } from "../doc/store.ts";
import { deleteSelected, invertedRanges, mergeRanges, selectedBases, selectedRanges } from "./selection.ts";
import { pickCodons } from "./codonSelection.ts";
import { pieces, type Range, type SeqData } from "./seqdata.ts";

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

test("inverting selects the bases a selection left out, across the origin on a circular sequence", () => {
  const one = (start: number, end: number) => ({ range: { start, end } });
  // An insert's inverse is its backbone: one stretch across the origin.
  assert.deepEqual(invertedRanges(one(3, 5), 12, true), [{ start: 6, end: 2 }]);
  // On a linear sequence it is the two ends.
  assert.deepEqual(invertedRanges(one(3, 5), 12, false), [{ start: 0, end: 2 }, { start: 6, end: 11 }]);
  assert.deepEqual(invertedRanges(one(0, 5), 12, true), [{ start: 6, end: 11 }]);
  assert.deepEqual(invertedRanges(one(6, 11), 12, false), [{ start: 0, end: 5 }]);
  // A stretch across the origin inverts to the middle.
  assert.deepEqual(invertedRanges(one(10, 1), 12, true), [{ start: 2, end: 9 }]);
  // Several stretches: the gaps either side of the origin join only on a circular sequence.
  const several = { range: null, ranges: [{ start: 2, end: 3 }, { start: 6, end: 8 }] };
  assert.deepEqual(invertedRanges(several, 12, true), [{ start: 9, end: 1 }, { start: 4, end: 5 }]);
  assert.deepEqual(invertedRanges(several, 12, false), [{ start: 0, end: 1 }, { start: 4, end: 5 }, { start: 9, end: 11 }]);
  // Nothing selected inverts to everything, everything to nothing.
  assert.deepEqual(invertedRanges({ range: null }, 12, true), [{ start: 0, end: 11 }]);
  assert.deepEqual(invertedRanges({ range: null }, 12, false), [{ start: 0, end: 11 }]);
  assert.deepEqual(invertedRanges(one(0, 11), 12, true), []);
  assert.deepEqual(invertedRanges(one(5, 4), 12, true), []);
  assert.deepEqual(invertedRanges({ range: null }, 0, true), []);
  assert.deepEqual(invertedRanges({ range: null }, 0, false), []);
});

test("an inverse is every unselected base, in as few stretches as there can be", () => {
  let seed = 7;
  const rand = (k: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648) % k);
  const bases = (ranges: Range[], n: number) => new Set(ranges.flatMap(r => pieces(r, n)).flatMap(r => Array.from({ length: r.end - r.start + 1 }, (_, i) => r.start + i)));
  for (let trial = 0; trial < 500; trial++) {
    const n = 1 + rand(14);
    const circular = rand(2) === 0;
    const ranges = Array.from({ length: rand(4) }, () => ({ start: rand(n), end: rand(n) })).filter(r => circular || r.start <= r.end);
    const inverse = invertedRanges({ range: null, ranges }, n, circular);
    const selected = bases(ranges, n);
    const left = bases(inverse, n);
    for (let b = 0; b < n; b++) assert.equal(left.has(b), !selected.has(b), `${JSON.stringify(ranges)} in ${n}, base ${b}`);
    assert.deepEqual(inverse, mergeRanges(inverse, n, circular));
    // Inverting again gives back what was selected.
    assert.deepEqual(bases(invertedRanges({ range: null, ranges: inverse }, n, circular), n), selected);
  }
});

test("inverting drops the clicked annotation and picked codons or enzymes", () => {
  const store = new DocStore(data());
  const invert = () => store.select({ ranges: invertedRanges(store.selection, store.length, store.data.circular) });
  store.selectRange({ start: 3, end: 5 }, { kind: "feature", id: "gap" });
  invert();
  assert.deepEqual(store.selection.range, { start: 6, end: 2 });
  assert.equal(store.selection.focus, null);
  assert.equal(store.selection.caret, 3);
  store.select({ ...selection, codons: pickCodons(undefined, { feature: "cds", index: 1 }, false, false) });
  invert();
  assert.equal(store.selection.codons, undefined);
  assert.equal(store.selection.range, null);
  assert.deepEqual(store.selection.ranges, [{ start: 3, end: 5 }, { start: 9, end: 11 }]);
  store.select({ range: { start: 4, end: 9 }, focus: { kind: "cutsite", id: "EcoRI:4" }, enzymes: ["EcoRI", "BamHI"] });
  invert();
  assert.equal(store.selection.enzymes, undefined);
  assert.deepEqual(store.selection.range, { start: 10, end: 3 });
  // Everything selected leaves a cursor where it was.
  store.select({ range: { start: 0, end: 11 }, caret: 12, anchor: 0 });
  invert();
  assert.equal(store.selection.range, null);
  assert.equal(store.selection.ranges, undefined);
  assert.equal(store.selection.caret, 12);
  // A cursor inverts to everything.
  invert();
  assert.deepEqual(store.selection.range, { start: 0, end: 11 });
  // Two stretches on a linear sequence stay apart.
  const linear = new DocStore({ ...data(), circular: false });
  linear.selectRange({ start: 3, end: 5 });
  linear.select({ ranges: invertedRanges(linear.selection, linear.length, false) });
  assert.equal(linear.selection.range, null);
  assert.deepEqual(linear.selection.ranges, [{ start: 0, end: 2 }, { start: 6, end: 11 }]);
});
