// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Marking variable regions. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { designOf, formatDesign, inVariable, parseDesign, splitVariable, variableRanges, versionsFromText } from "./variable.ts";
import type { Difference, Feature } from "./types.ts";

test("a design is anything, a pattern or a few named versions", () => {
  assert.deepEqual(parseDesign("any"), { kind: "any" });
  assert.deepEqual(parseDesign(""), { kind: "any" });
  assert.deepEqual(parseDesign("nnk"), { kind: "pattern", pattern: "NNK" });
  assert.deepEqual(parseDesign("v1:TGGTTT|v2: tgg gtt"), {
    kind: "alternatives",
    options: [
      { name: "v1", bases: "TGGTTT" },
      { name: "v2", bases: "TGGGTT" }
    ]
  });
  // Versions without names are numbered.
  assert.deepEqual(parseDesign("TGG|TTT"), { kind: "alternatives", options: [{ name: "1", bases: "TGG" }, { name: "2", bases: "TTT" }] });
  for (const v of ["any", "NNK", "v1:TGGTTT|v2:TGGGTT"]) assert.equal(formatDesign(parseDesign(v)), v);
});

test("protein versions are saved with their amino acids", () => {
  const d = parseDesign("protein:v1:GFTFSSYA|v2: grtf snya");
  assert.deepEqual(d, { kind: "alternatives", protein: true, options: [{ name: "v1", bases: "GFTFSSYA" }, { name: "v2", bases: "GRTFSNYA" }] });
  assert.equal(formatDesign(d), "protein:v1:GFTFSSYA|v2:GRTFSNYA");
  // A DNA version that happens to be named "protein" stays DNA.
  assert.deepEqual(parseDesign("protein:ATG|two:TTT"), { kind: "alternatives", options: [{ name: "protein", bases: "ATG" }, { name: "two", bases: "TTT" }] });
});

test("versions typed one per line are DNA bases or amino acids, as chosen", () => {
  // FLAG and His tags are all IUPAC letters, so only the choice says they are peptides.
  assert.deepEqual(versionsFromText("flag: DYKDDDDK\n\nhis: hhhhhh\n", true), { kind: "alternatives", protein: true, options: [{ name: "flag", bases: "DYKDDDDK" }, { name: "his", bases: "HHHHHH" }] });
  assert.deepEqual(versionsFromText("v1: atg gct\nTGG", false), { kind: "alternatives", options: [{ name: "v1", bases: "ATGGCT" }, { name: "2", bases: "TGG" }] });
  assert.equal(versionsFromText("v1: MKVLE", false), "Version v1 looks like amino acids, not DNA bases.");
  assert.equal(versionsFromText("v1: ATGNNK\nv2: ATG-GCT", false), "Version v2 has letters that aren’t DNA bases.");
  assert.equal(versionsFromText("v1: MK+L", true), "Version v1 has letters that aren’t amino acids.");
  assert.equal(versionsFromText("v1:", true), "Version v1 has no sequence.");
  assert.equal(versionsFromText("a|b: MKV", true), "Version names can’t include “|”.");
  assert.equal(versionsFromText(" \n", false), "Enter versions as name: DNA bases, one per line.");
});

test("the design is read from the feature's qualifier, as bio-parsers keeps it", () => {
  assert.deepEqual(designOf({ strandivo_variable: ["NNK"] }), { kind: "pattern", pattern: "NNK" });
  assert.deepEqual(designOf({ strandivo_variable: "any" }), { kind: "any" });
  assert.equal(designOf({ note: ["CDR1"] }), null);
  assert.equal(designOf(undefined), null);
});

const region = (start: number, end: number): Feature => ({ name: "CDR", type: "misc_feature", start, end, variable: { kind: "any" } });

test("regions go to the core as ranges that never wrap", () => {
  assert.deepEqual(variableRanges([region(10, 19), { name: "plain", start: 30, end: 40 }], 100), [[10, 20]]);
  assert.deepEqual(variableRanges([region(95, 4)], 100), [[95, 100], [0, 5]]);
});

test("bases inserted right next to a region belong to it", () => {
  const d = (kind: Difference["kind"], refPos: number, refBases = ""): Difference => ({ kind, refPos, refBases, readBases: "A", readPos: 0, quality: 40, confident: true });
  const r = [region(10, 19)];
  assert.equal(inVariable(d("insertion", 10), r, 100), true, "before its first base");
  assert.equal(inVariable(d("insertion", 20), r, 100), true, "after its last base");
  assert.equal(inVariable(d("insertion", 21), r, 100), false);
  assert.equal(inVariable(d("substitution", 9, "A"), r, 100), false);
  assert.equal(inVariable(d("deletion", 8, "AAA"), r, 100), true, "a deletion reaching into it");
  const split = splitVariable([d("substitution", 5, "A"), d("substitution", 12, "A")], r, 100);
  assert.deepEqual(split.differences.map(x => x.refPos), [5]);
  assert.deepEqual(split.variable.map(x => x.refPos), [12]);
});
