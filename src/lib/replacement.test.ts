// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What the replace card says a replacement will do. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { describeReplacement } from "./replacement.ts";
import { withRegions, type ProteinRegion } from "./regions.ts";
import { reverseComplement, type Range, type SeqData, type Strand } from "./seqdata.ts";

const region = (name: string, start: number, end: number): ProteinRegion => ({ name, kind: "Domain", start, end, accession: "", sourceStart: start, sourceEnd: end, predicted: false });

// M A C D E F G H I K L M N P Q R S T V W Y *, from base 10.
const CODING = "ATGGCTTGTGATGAATTTGGTCATATTAAACTTATGAATCCTCAACGTTCTACTGTTTGGTATTAA";
const AT = 10;

function doc(strand: Strand = 1): SeqData {
  const coding = strand === -1 ? reverseComplement(CODING) : CODING;
  return {
    name: "t",
    description: "",
    circular: true,
    sequence: "C".repeat(AT) + coding + "C".repeat(10),
    features: [{ id: "cds", name: "gene", type: "CDS", start: AT, end: AT + coding.length - 1, strand, notes: withRegions({}, [region("TM1", 3, 5), region("TM2", 10, 12)]), raw: {} }],
    primers: [{ id: "p", name: "fwd", start: 0, end: 9, strand: 1, bases: "CCCCCCCCCC", notes: {}, raw: {} }],
    sources: []
  };
}

/** Bases of residues `from`–`to` of the forward CDS. */
const residues = (from: number, to: number): Range => ({ start: AT + (from - 1) * 3, end: AT + to * 3 - 1 });

test("as many bases as were selected is green and moves nothing", () => {
  const r = describeReplacement(doc(), residues(3, 3), "GCT", true);
  assert.equal(r.kind, "ok");
  assert.equal(r.status, "✓ 3 bases for 3 · same length");
  assert.deepEqual(r.effects, [{ name: "gene", change: "C3A" }]);
  assert.deepEqual([r.holds, r.outside, r.removed], [[], [], []]);
  assert.deepEqual(describeReplacement(doc(), residues(2, 5), "GCTTTTGATTTT", false).effects, [{ name: "gene", change: "C3F, E5F" }]);
  assert.deepEqual(describeReplacement(doc(), residues(2, 5), "TTTTTTTTTTTT", false).effects, [{ name: "gene", change: "4 residues change" }]);
  assert.deepEqual(describeReplacement(doc(), residues(3, 3), "TAA", false).effects, [{ name: "gene", change: "C3*" }]);
});

test("another codon for the same amino acid is silent, and the same bases change nothing", () => {
  assert.deepEqual(describeReplacement(doc(), residues(2, 2), "GCC", true).effects, [{ name: "gene", change: "silent (A2)" }]);
  assert.deepEqual(describeReplacement(doc(), residues(2, 2), "gct", true).effects, []);
  // Outside any CDS there is no protein to change.
  assert.deepEqual(describeReplacement(doc(), { start: 2, end: 4 }, "GGG", true).effects, []);
});

test("fewer bases while typing count up without a protein change", () => {
  const r = describeReplacement(doc(), residues(3, 3), "G", true);
  assert.equal(r.kind, "plain");
  assert.equal(r.status, "1 of 3 bases");
  assert.deepEqual(r.effects, []);
  // The same pasted is what it is: a frameshift.
  const pasted = describeReplacement(doc(), residues(3, 3), "G", false);
  assert.equal(pasted.kind, "warn");
  assert.equal(pasted.status, "⚠ 1 base for 3 · shifts gene's frame");
  assert.deepEqual(pasted.effects, [{ name: "gene", change: "C3fs" }]);
});

test("more bases name the frameshift, or the residues added in frame", () => {
  const shift = describeReplacement(doc(), residues(3, 3), "GCTG", true);
  assert.equal(shift.kind, "warn");
  assert.equal(shift.status, "⚠ 4 bases for 3 · shifts gene's frame");
  assert.deepEqual(shift.effects, [{ name: "gene", change: "C3fs" }]);
  const inFrame = describeReplacement(doc(), residues(3, 3), "GCTGCT", true);
  assert.equal(inFrame.kind, "plain");
  assert.equal(inFrame.status, "6 bases for 3 · adds 1 residue");
  assert.deepEqual(inFrame.effects, [{ name: "gene", change: "C3delinsAA" }]);
  const shorter = describeReplacement(doc(), residues(3, 4), "GCT", false);
  assert.equal(shorter.status, "3 bases for 6 · removes 1 residue");
  assert.deepEqual(shorter.effects, [{ name: "gene", change: "C3_D4delinsA" }]);
  assert.equal(describeReplacement(doc(), { start: 2, end: 4 }, "GG", false).status, "2 bases for 3");
});

test("a CDS on the bottom strand is read on it", () => {
  const d = doc(-1);
  // Its first codon, ATG, is CAT at its top-strand end; CAG reads CTG, leucine.
  const first = { start: d.features[0].end - 2, end: d.features[0].end };
  assert.deepEqual(describeReplacement(d, first, "CAG", true).effects, [{ name: "gene", change: "M1L" }]);
});

test("another length says what holds the new bases, what they fall outside and what goes", () => {
  // Inside TM1 (residues 3–5) and the CDS.
  const inside = describeReplacement(doc(), residues(4, 4), "GCTGCT", true);
  assert.deepEqual([inside.holds, inside.outside, inside.removed], [["gene", "TM1"], [], []]);
  // TM1's last residue and the one after it: TM1 keeps only its bases outside.
  const across = describeReplacement(doc(), residues(5, 6), "GCT", false);
  assert.deepEqual([across.holds, across.outside, across.removed], [["gene"], ["TM1"], []]);
  // All of TM1 and more: it goes.
  const over = describeReplacement(doc(), residues(2, 6), "GCT", false);
  assert.deepEqual([over.holds, over.outside, over.removed], [["gene"], [], ["TM1"]]);
  // Exactly TM1: it holds the new bases.
  assert.deepEqual(describeReplacement(doc(), residues(3, 5), "GCT", false).holds, ["gene", "TM1"]);
  // Across the primer's 3′ end and the CDS's start.
  const edges = describeReplacement(doc(), { start: 8, end: 12 }, "GG", false);
  assert.deepEqual([edges.holds, edges.outside, edges.removed], [[], ["gene", "fwd"], []]);
});
