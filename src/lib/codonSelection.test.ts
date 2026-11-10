// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { codonRanges, pickCodons, type CodonRef } from "./codonSelection.ts";
import type { SeqData, SeqFeature } from "./seqdata.ts";

const ref = (index: number, feature = "cds"): CodonRef => ({ feature, index });
const data = (over: Partial<SeqFeature> = {}): SeqData => ({
  name: "test", description: "", sequence: "ATGGCTAAACCC".repeat(10), circular: true, primers: [], sources: [],
  features: [{ id: "cds", name: "CDS", type: "CDS", start: 12, end: 41, strand: 1, notes: {}, raw: {}, ...over }]
});
const picks = (index: number) => pickCodons(undefined, ref(index), false, false);

test("dragging includes both complete end codons, in either direction", () => {
  for (const [from, to] of [[2, 5], [5, 2]]) {
    const selected = pickCodons(undefined, ref(to), false, false, ref(from));
    assert.deepEqual(selected.picks.map(p => p.index), [2, 3, 4, 5]);
    assert.deepEqual(codonRanges(data(), selected), [{ start: 15, end: 26 }]);
    assert.deepEqual(selected.anchor, ref(from));
  }
});

test("reverse-strand drags follow residue numbers rather than genomic direction", () => {
  assert.deepEqual(codonRanges(data({ strand: -1 }), pickCodons(undefined, ref(5), false, false, ref(2))), [{ start: 27, end: 38 }]);
});

test("additive clicks toggle separate codons without selecting their gaps", () => {
  let selected = pickCodons(picks(2), ref(5), true, false);
  assert.deepEqual(codonRanges(data(), selected), [{ start: 15, end: 17 }, { start: 24, end: 26 }]);
  assert.deepEqual(selected.anchor, ref(5));
  selected = pickCodons(selected, ref(2), true, false);
  assert.deepEqual(selected.picks, [ref(5)]);
  selected = pickCodons(selected, ref(5), true, false);
  assert.deepEqual(selected.picks, []);
});

test("additive Shift-click fills from the last clicked codon and preserves other picks", () => {
  const previous = pickCodons(picks(1), ref(6), true, false);
  const selected = pickCodons(previous, ref(4), true, true);
  assert.deepEqual(selected.picks.map(p => p.index).sort(), [1, 4, 5, 6]);
  assert.deepEqual(selected.anchor, ref(6));
  assert.deepEqual(pickCodons(selected, ref(3), false, true).picks.map(p => p.index), [3, 4, 5, 6]);
});

test("an additive drag keeps the original picks, even while the dragged span shrinks", () => {
  const previous = picks(1);
  assert.deepEqual(pickCodons(previous, ref(6), true, false, ref(4)).picks, [ref(1), ref(4), ref(5), ref(6)]);
  assert.deepEqual(pickCodons(previous, ref(4), true, false, ref(4)).picks, [ref(1), ref(4)]);
});

test("different CDSs can be picked, while Shift never invents a span between proteins", () => {
  const selected = pickCodons(picks(2), ref(5, "other"), true, false);
  assert.deepEqual(selected.picks, [ref(2), ref(5, "other")]);
  assert.deepEqual(pickCodons(selected, ref(4), false, true).picks, [ref(4)]);
});

test("a forward codon and a reverse codon can cross the origin", () => {
  assert.deepEqual(codonRanges(data({ start: 118, end: 6 }), picks(1)), [{ start: 118, end: 0 }]);
  assert.deepEqual(codonRanges(data({ start: 113, end: 1, strand: -1 }), picks(1)), [{ start: 119, end: 1 }]);
  assert.deepEqual(codonRanges(data({ start: 118, end: 6 }), pickCodons(picks(1), ref(3), false, true)), [{ start: 118, end: 6 }]);
});

test("spliced codons select exactly their three coding bases, leaving introns out", () => {
  const d = data({ start: 12, end: 34, locations: [{ start: 12, end: 13 }, { start: 30, end: 34 }] });
  assert.deepEqual(codonRanges(d, picks(1)), [{ start: 12, end: 13 }, { start: 30, end: 30 }]);
  assert.deepEqual(codonRanges(d, pickCodons(picks(1), ref(2), false, true)), [{ start: 12, end: 13 }, { start: 30, end: 33 }]);
  assert.deepEqual(codonRanges(d, picks(3)), [], "an incomplete terminal codon is not selectable");
});
