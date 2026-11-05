// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { guessClones } from "./clones.ts";

const labels = (names: string[]) => guessClones(names).map(g => g.label);
const keys = (names: string[]) => guessClones(names).map(g => g.key);

test("reads named by well and primer group by well", () => {
  assert.deepEqual(labels(["A01_M13F.ab1", "A01_M13R.ab1", "A02_M13F.ab1", "A02_M13R.ab1"]), ["A01", "A01", "A02", "A02"]);
  assert.deepEqual(labels(["B3-T7.ab1", "B3-T7term.ab1", "B4-T7.ab1"]), ["B3", "B3", "B4-T7.ab1"]);
});

test("a direction after the sample name is the primer", () => {
  assert.deepEqual(labels(["clone3-F.ab1", "clone3-R.ab1", "clone4-F.ab1"]), ["clone3", "clone3", "clone4-F.ab1"]);
  assert.deepEqual(labels(["c5_bla_fwd.seq", "c5_bla_rev.seq"]), ["c5_bla", "c5_bla"]);
  assert.deepEqual(labels(["mut 2 forward.ab1", "mut 2 reverse.ab1"]), ["mut 2", "mut 2"]);
});

test("numbered and named universal primers", () => {
  assert.deepEqual(labels(["pUC-mut1_M13(-21).ab1", "pUC-mut1_M13rev.ab1"]), ["pUC-mut1", "pUC-mut1"]);
  assert.deepEqual(labels(["pX1_M13-40.ab1", "pX1_M13R.ab1"]), ["pX1", "pX1"]);
  assert.deepEqual(labels(["v12_SP6.ab1", "v12_T7.ab1", "v13_pGEX-5.ab1", "v13_pGEX-3.ab1"]), ["v12", "v12", "v13", "v13"]);
  assert.deepEqual(labels(["k7_BGH-R.ab1", "k7_CMV-F.ab1"]), ["k7", "k7"]);
});

test("a well or running number from the provider doesn't split a sample", () => {
  // The provider's own plate: forward and reverse reads sit in different wells.
  assert.deepEqual(labels(["GW01_M13F_A01.ab1", "GW01_M13R_B01.ab1", "GW02_M13F_A02.ab1", "GW02_M13R_B02.ab1"]), ["GW01", "GW01", "GW02", "GW02"]);
  assert.deepEqual(labels(["S1_T7_001.ab1", "S1_T7term_002.ab1", "S2_T7_003.ab1"]), ["S1", "S1", "S2_T7_003.ab1"]);
});

test("dates and order numbers that every read shares are kept out of the way", () => {
  assert.deepEqual(labels(["2026-10-13_A01_M13F.ab1", "2026-10-13_A01_M13R.ab1"]), ["A01", "A01"]);
  assert.deepEqual(labels(["20261013_A01_M13F.ab1", "20261013_A01_M13R.ab1"]), ["A01", "A01"]);
  assert.deepEqual(keys(["11-ABC123_E7_M13F.ab1", "11-ABC123_E7_M13R.ab1"]), ["11_abc123_e7", "11_abc123_e7"]);
});

test("a plate well that names the clone isn't dropped", () => {
  // Six clones read with one primer, named by well and construct.
  const plate = ["A01_bla", "A02_bla", "A03_bla", "A04_bla"];
  assert.deepEqual(keys(plate), [null, null, null, null]);
  assert.deepEqual(labels([...plate, "c7_bla-F", "c7_bla-R"]), [...plate, "c7_bla", "c7_bla"]);
});

test("custom primers on a plate of clones: wells that vary are dropped", () => {
  // F1 is a well and also a common primer name; read as wells, clone3 still groups.
  assert.deepEqual(labels(["clone3_F1.ab1", "clone3_R1.ab1"]), ["clone3", "clone3"]);
});

test("reads that don't pair stay clones of their own, named as the read", () => {
  // The library reads in testdata/: three clones, one read each.
  const library = ["2026-10-13_A01_MJF3PRIMER", "2026-10-13_A02_MJE4PRIMER", "2026-10-13_C01_MJG5PRIMER"];
  assert.deepEqual(labels(library), library);
  assert.deepEqual(labels(["bla-check", "teselagen-example1", "3730"]), ["bla-check", "teselagen-example1", "3730"]);
  // The same sample and primer twice is two reads, not a pair.
  assert.deepEqual(keys(["A01_M13F.ab1", "A01_M13F.ab1"]), [null, null]);
  // A name that is only a primer has no clone in it.
  assert.deepEqual(labels(["M13F.ab1", "M13R.ab1"]), ["M13F.ab1", "M13R.ab1"]);
});

test("one odd name doesn't stop the others pairing", () => {
  assert.deepEqual(guessClones(["A01_M13F.ab1", "A01_M13R.ab1", "control.ab1"]), [
    { key: "a01", label: "A01" },
    { key: "a01", label: "A01" },
    { key: null, label: "control.ab1" }
  ]);
});
