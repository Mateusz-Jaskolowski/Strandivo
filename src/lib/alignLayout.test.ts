// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { firstAtOrAfter, layoutAlignment, refPosAtColumn, stackInLanes } from "./alignLayout.ts";
import type { Chromatogram, ReadResult } from "./types.ts";

const REF = "ACGTACGTAC";

function result(over: Partial<ReadResult>): ReadResult {
  return {
    name: "r",
    status: "aligned",
    message: null,
    strand: "forward",
    readLength: 0,
    qualityEstimated: false,
    trimStart: 0,
    trimEnd: 0,
    refStart: 0,
    refSpan: 0,
    wrapsOrigin: false,
    matches: 0,
    mismatches: 0,
    insertedBases: 0,
    deletedBases: 0,
    ambiguous: 0,
    identity: 1,
    score: 0,
    differences: [],
    segments: [],
    ...over
  };
}

function chromatogram(calls: string): Chromatogram {
  const len = calls.length * 10;
  const trace = () => new Int16Array(len);
  const c: Chromatogram = { aTrace: trace(), cTrace: trace(), gTrace: trace(), tTrace: trace(), basePos: [], baseCalls: calls.split(""), qualNums: calls.split("").map(() => 30) };
  calls.split("").forEach((b, i) => {
    const pos = i * 10 + 5;
    c.basePos.push(pos);
    c[`${b.toLowerCase()}Trace` as "aTrace"][pos] = 1000;
  });
  return c;
}

test("tracks follow the order given", () => {
  const results = [
    result({ segments: [{ readFrom: 0, readTo: 3, refFrom: 0, refTo: 3, gappedReference: REF, gappedRead: "ACG-------" }] }),
    result({ status: "noMatch" }),
    result({ segments: [{ readFrom: 0, readTo: 3, refFrom: 3, refTo: 6, gappedReference: REF, gappedRead: "---TAC----" }] })
  ];
  const reads = results.map(() => ({ chromatogram: null }));
  const res = layoutAlignment(REF, results, reads, [2, 1, 0]);
  assert.ok(res && "layout" in res);
  assert.deepEqual(res.layout.tracks.map(t => t.result), [2, 0]);
});

test("reads are stacked under one reference with shared insertion columns", () => {
  const results = [
    // GTTCGT on reference 2..7 with a mismatch at 4.
    result({ segments: [{ readFrom: 0, readTo: 6, refFrom: 2, refTo: 8, gappedReference: REF, gappedRead: "--GTTCGT--" }] }),
    // CGATACG with an extra A after reference base 2.
    result({ segments: [{ readFrom: 0, readTo: 7, refFrom: 1, refTo: 7, gappedReference: "ACG-TACGTAC", gappedRead: "-CGATACG---" }] }),
    result({ status: "noMatch" })
  ];
  const res = layoutAlignment(REF, results, [{ chromatogram: chromatogram("GTTCGT") }, { chromatogram: null }, { chromatogram: null }]);
  assert.ok(res && "layout" in res);
  const L = res.layout;
  assert.equal(L.reference, "ACG-TACGTAC");
  assert.equal(L.length, 11);
  assert.deepEqual(L.columnOf, [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(L.refAt[3], -1);
  assert.equal(L.tracks.length, 2);
  const [a, b] = L.tracks;
  assert.equal(a.row, "--G-TTCGT--");
  assert.deepEqual([...a.baseColumns], [2, 4, 5, 6, 7, 8]);
  assert.deepEqual([...a.baseIndex], [0, 1, 2, 3, 4, 5]);
  assert.equal(a.firstColumn, 2);
  assert.equal(a.lastColumn, 8);
  assert.ok(a.chromatogram && a.qualities);
  assert.ok(a.traceMax >= 1000);
  assert.equal(b.row, "-CGATACG---");
  assert.deepEqual([...b.baseColumns], [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(b.chromatogram, null);
  // An insertion column belongs to the next reference base.
  assert.equal(refPosAtColumn(L, 3, REF.length), 3);
  assert.equal(firstAtOrAfter(a.baseColumns, 3), 1);
  assert.equal(firstAtOrAfter(a.baseColumns, 9), 6);
});

test("reverse reads use the reverse-complemented trace", () => {
  const results = [result({ strand: "reverse", segments: [{ readFrom: 0, readTo: 4, refFrom: 0, refTo: 4, gappedReference: REF, gappedRead: "ACGT------" }] })];
  // The file holds the other strand: ACGT reverse-complemented is ACGT.
  const res = layoutAlignment(REF, results, [{ chromatogram: chromatogram("ACGT") }]);
  assert.ok(res && "layout" in res);
  const t = res.layout.tracks[0];
  assert.deepEqual(t.chromatogram?.baseCalls, ["A", "C", "G", "T"]);
  assert.deepEqual(t.chromatogram?.basePos, [4, 14, 24, 34]);
});

test("nothing to lay out, or too long to show", () => {
  assert.equal(layoutAlignment(REF, [result({ status: "noMatch" })], [{ chromatogram: null }]), null);
  const long = layoutAlignment(REF, [result({ segments: [{ readFrom: 0, readTo: 3, refFrom: 0, refTo: 3, gappedReference: "", gappedRead: "" }] })], [{ chromatogram: null }]);
  assert.ok(long && "error" in long);
});

test("spans that touch share a line whatever order they come in", () => {
  // As in a library vector: the CDR comes first in the file, the frameworks around it later.
  const cdr = { c0: 100, c1: 129 };
  const fr1 = { c0: 0, c1: 99 };
  const fr2 = { c0: 130, c1: 170 };
  assert.deepEqual(stackInLanes([cdr, fr1, fr2]), { lanes: [0, 0, 0], count: 1 });
});

test("spans that overlap take a line each, longer ones first", () => {
  assert.deepEqual(stackInLanes([{ c0: 5, c1: 9 }, { c0: 5, c1: 50 }, { c0: 9, c1: 12 }, { c0: 60, c1: 70 }]), { lanes: [1, 0, 2, 0], count: 3 });
  assert.deepEqual(stackInLanes([]), { lanes: [], count: 0 });
});
