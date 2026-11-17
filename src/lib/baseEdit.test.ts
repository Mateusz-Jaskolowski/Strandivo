// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What the edit card says an edit to bases will do, and the side new bases at an edge go
// to. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { applyEdit, deletionNote, describeEdit, shiftedFrames, type PendingEdit } from "./baseEdit.ts";
import { regionsOf, withRegions, type ProteinRegion } from "./regions.ts";
import { insertBases, replaceRange, reverseComplement, type EdgeSide, type Range, type SeqData, type SeqFeature, type Strand } from "./seqdata.ts";

const region = (name: string, start: number, end: number): ProteinRegion => ({ name, kind: "Domain", start, end, accession: "", sourceStart: start, sourceEnd: end, predicted: false });

// M A C D E F G H I K L M N P Q R S T V W Y *, from base 10.
const CODING = "ATGGCTTGTGATGAATTTGGTCATATTAAACTTATGAATCCTCAACGTTCTACTGTTTGGTATTAA";
const AT = 10;

function doc(strand: Strand = 1, regions = [region("TM1", 3, 5), region("TM2", 10, 12)]): SeqData {
  const coding = strand === -1 ? reverseComplement(CODING) : CODING;
  return {
    name: "t",
    description: "",
    circular: true,
    sequence: "C".repeat(AT) + coding + "C".repeat(10),
    features: [{ id: "cds", name: "gene", type: "CDS", start: AT, end: AT + coding.length - 1, strand, notes: withRegions({}, regions), raw: {} }],
    primers: [{ id: "p", name: "fwd", start: 0, end: 9, strand: 1, bases: "CCCCCCCCCC", notes: {}, raw: {} }],
    sources: []
  };
}

/** Bases of residues `from`–`to` of the forward CDS, and the boundary before residue `k`. */
const residues = (from: number, to: number): Range => ({ start: AT + (from - 1) * 3, end: AT + to * 3 - 1 });
const before = (k: number) => AT + (k - 1) * 3;

const replace = (range: Range, bases: string, side: EdgeSide = "neither"): PendingEdit => ({ range, at: 0, bases, side });
const insert = (at: number, bases: string, side: EdgeSide = "neither"): PendingEdit => ({ range: null, at, bases, side });
const remove = (range: Range): PendingEdit => ({ range, at: 0, bases: "", side: "neither" });
const notes = (d: SeqData, e: PendingEdit) => describeEdit(d, e, false).notes.map(n => (n.warn ? `⚠ ${n.text}` : n.text));
const regionResidues = (d: SeqData) => regionsOf(d.features[0]).map(r => `${r.name} ${r.start}–${r.end}`);

test("as many bases as were selected is green and moves nothing", () => {
  const r = describeEdit(doc(), replace(residues(3, 3), "GCT"), true);
  assert.equal(r.verb, "Replace");
  assert.equal(r.tone, "ok");
  assert.equal(r.status, "✓ 3 bases for 3 · same length");
  assert.deepEqual(r.effects, [{ name: "gene", change: "C3A" }]);
  assert.deepEqual([r.notes, r.sides], [[], { before: [], after: [] }]);
  assert.deepEqual(describeEdit(doc(), replace(residues(2, 5), "GCTTTTGATTTT"), false).effects, [{ name: "gene", change: "C3F, E5F" }]);
  assert.deepEqual(describeEdit(doc(), replace(residues(2, 5), "TTTTTTTTTTTT"), false).effects, [{ name: "gene", change: "4 residues change" }]);
  assert.deepEqual(describeEdit(doc(), replace(residues(3, 3), "TAA"), false).effects, [{ name: "gene", change: "C3*" }]);
});

test("another codon for the same amino acid is silent, and the same bases change nothing", () => {
  assert.deepEqual(describeEdit(doc(), replace(residues(2, 2), "GCC"), true).effects, [{ name: "gene", change: "silent (A2)" }]);
  assert.deepEqual(describeEdit(doc(), replace(residues(2, 2), "gct"), true).effects, []);
  // Outside any CDS there is no protein to change.
  assert.deepEqual(describeEdit(doc(), replace({ start: 2, end: 4 }, "GGG"), true).effects, []);
});

test("fewer bases while typing count up, and still say what Enter would do", () => {
  const r = describeEdit(doc(), replace(residues(3, 3), "G"), true);
  assert.equal(r.tone, "warn");
  assert.equal(r.status, "⚠ 1 of 3 bases · shifts gene's frame");
  assert.deepEqual(r.effects, [{ name: "gene", change: "C3fs" }]);
  const inFrame = describeEdit(doc(), replace(residues(3, 4), "GCT"), true);
  assert.equal(inFrame.tone, "plain");
  assert.equal(inFrame.status, "3 of 6 bases · removes 1 residue");
  assert.equal(describeEdit(doc(), replace({ start: 2, end: 4 }, "G"), true).status, "1 of 3 bases");
  // Pasted, they are the replacement, not a count towards it.
  const pasted = describeEdit(doc(), replace(residues(3, 3), "G"), false);
  assert.equal(pasted.tone, "warn");
  assert.equal(pasted.status, "⚠ 1 base for 3 · shifts gene's frame");
  assert.deepEqual(pasted.effects, [{ name: "gene", change: "C3fs" }]);
});

test("more bases name the frameshift, or the residues added in frame", () => {
  const shift = describeEdit(doc(), replace(residues(3, 3), "GCTG"), true);
  assert.equal(shift.tone, "warn");
  assert.equal(shift.status, "⚠ 4 bases for 3 · shifts gene's frame");
  assert.deepEqual(shift.effects, [{ name: "gene", change: "C3fs" }]);
  const inFrame = describeEdit(doc(), replace(residues(3, 3), "GCTGCT"), true);
  assert.equal(inFrame.status, "6 bases for 3 · adds 1 residue");
  assert.deepEqual(inFrame.effects, [{ name: "gene", change: "C3delinsAA" }]);
  const shorter = describeEdit(doc(), replace(residues(3, 4), "GCT"), false);
  assert.equal(shorter.status, "3 bases for 6 · removes 1 residue");
  assert.deepEqual(shorter.effects, [{ name: "gene", change: "C3_D4delinsA" }]);
  assert.equal(describeEdit(doc(), replace({ start: 2, end: 4 }, "GG"), false).status, "2 bases for 3");
});

test("a CDS on the bottom strand is read on it", () => {
  const d = doc(-1);
  // Its first codon, ATG, is CAT at its top-strand end; CAG reads CTG, leucine.
  const first = { start: d.features[0].end - 2, end: d.features[0].end };
  assert.deepEqual(describeEdit(d, replace(first, "CAG"), true).effects, [{ name: "gene", change: "M1L" }]);
});

test("a replacement of another length says what takes the new bases, what they fall outside and what goes", () => {
  // Inside TM1 (residues 3–5) and the CDS, whose protein change already speaks for it.
  assert.deepEqual(notes(doc(), replace(residues(4, 4), "GCTGCT")), ["TM1 takes the new bases"]);
  assert.deepEqual(notes(doc(), replace(residues(3, 5), "GCT")), ["TM1 takes the new bases"]);
  // TM1's last residue and the one after it: TM1 keeps only its bases outside, unless chosen.
  const across = replace(residues(5, 6), "GCT");
  assert.deepEqual(describeEdit(doc(), across, false).sides, { before: ["TM1"], after: [] });
  assert.deepEqual(notes(doc(), across), ["⚠ Residue 5 will be in no region"]);
  assert.deepEqual(notes(doc(), { ...across, side: "before" }), ["TM1 grows to 3–5"]);
  assert.deepEqual(regionResidues(applyEdit(doc(), { ...across, side: "before" }).data), ["TM1 3–5", "TM2 9–11"]);
  // All of TM1 and more: it goes.
  assert.deepEqual(notes(doc(), replace(residues(2, 6), "GCT")), ["⚠ Removes TM1"]);
  // Across the primer's 3′ end and the CDS's start: only the CDS may take them.
  const edges = describeEdit(doc(), replace({ start: 8, end: 12 }, "GG"), false);
  assert.deepEqual(edges.sides, { before: [], after: ["gene"] });
  assert.deepEqual(edges.notes, [{ text: "New bases fall outside gene and fwd", warn: true }]);
});

test("bases typed at the cursor are an insertion, asked about at an edge", () => {
  // Inside TM1, between residues 3 and 4.
  const inside = describeEdit(doc(), insert(before(4), "GCT"), true);
  assert.equal(inside.verb, "Insert");
  assert.equal(inside.status, "3 bases · adds 1 residue");
  assert.deepEqual(inside.effects, [{ name: "gene", change: "C3_D4insA" }]);
  assert.deepEqual([inside.notes.map(n => n.text), inside.sides], [["TM1 takes the new bases"], { before: [], after: [] }]);
  assert.equal(describeEdit(doc(), insert(before(4), "GC"), true).status, "⚠ 2 bases · shifts gene's frame");
  assert.deepEqual(describeEdit(doc(), insert(before(4), "GC"), true).effects, [{ name: "gene", change: "D4fs" }]);
  // Right after TM1, before residue 6, which no region holds.
  const end = insert(before(6), "GCT");
  assert.deepEqual(describeEdit(doc(), end, true).sides, { before: ["TM1"], after: [] });
  assert.deepEqual(notes(doc(), end), ["⚠ Residue 6 will be in no region"]);
  assert.deepEqual(notes(doc(), { ...end, side: "before" }), ["TM1 grows to 3–6"]);
  // Outside the CDS, in the primer's site: no protein, and the primer holds them as before.
  const outside = describeEdit(doc(), insert(3, "GGG"), true);
  assert.deepEqual([outside.status, outside.effects, outside.notes.map(n => n.text)], ["3 bases", [], ["fwd takes the new bases"]]);
  // Right before the CDS: it may take them, and the name doesn't spell out the protein.
  const start = describeEdit(doc(), insert(AT, "GCT", "after"), true);
  assert.deepEqual(start.sides, { before: [], after: ["gene"] });
  assert.deepEqual(start.effects, [{ name: "gene", change: "adds 1 residue" }]);
  assert.equal(describeEdit(doc(), insert(AT, "GCT"), true).status, "3 bases");
  assert.equal(describeEdit(doc(), insert(5, ""), true).status, "No bases yet");
});

test("deleted bases name the protein change and what loses bases or goes", () => {
  const codon = describeEdit(doc(), remove(residues(4, 4)), false);
  assert.deepEqual([codon.verb, codon.status, codon.effects], ["Delete", "3 bases · removes 1 residue", [{ name: "gene", change: "D4del" }]]);
  assert.deepEqual(codon.notes, [{ text: "Shortens TM1", warn: false }]);
  assert.deepEqual(codon.sides, { before: [], after: [] });
  assert.equal(describeEdit(doc(), remove({ start: before(4), end: before(4) + 1 }), false).status, "⚠ 2 bases · shifts gene's frame");
  assert.deepEqual(notes(doc(), remove(residues(2, 6))), ["⚠ Removes TM1"]);
  assert.deepEqual(shiftedFrames(doc(), remove({ start: before(4), end: before(4) })), ["gene"]);
  assert.deepEqual(shiftedFrames(doc(), remove(residues(4, 4))), []);
  assert.equal(deletionNote(doc(), { start: before(4), end: before(4) + 1 }), "Deleting 2 bases shifted gene's frame.");
  assert.equal(deletionNote(doc(), residues(4, 4)), null);
  assert.equal(deletionNote(doc(), { start: 0, end: 3 }), null);
});

test("new bases between two regions go to the side chosen, or to neither", () => {
  const d = doc(1, [region("A", 1, 4), region("B", 5, 8)]);
  const at = insert(before(5), "GCT");
  assert.deepEqual(describeEdit(d, at, true).sides, { before: ["A"], after: ["B"] });
  assert.deepEqual(regionResidues(applyEdit(d, at).data), ["A 1–4", "B 6–9"]);
  assert.deepEqual(regionResidues(applyEdit(d, { ...at, side: "before" }).data), ["A 1–5", "B 6–9"]);
  assert.deepEqual(regionResidues(applyEdit(d, { ...at, side: "after" }).data), ["A 1–4", "B 5–9"]);
  assert.deepEqual(notes(d, at), ["⚠ Residue 5 will be in no region"]);
  assert.deepEqual(notes(d, { ...at, side: "after" }), ["B grows to 5–9"]);
  // Replacing residues 4–5 with three codons: across the edge.
  const across = replace(residues(4, 5), "GCTGCTGCT");
  assert.deepEqual(describeEdit(d, across, true).sides, { before: ["A"], after: ["B"] });
  assert.deepEqual(regionResidues(applyEdit(d, across).data), ["A 1–3", "B 7–9"]);
  assert.deepEqual(regionResidues(applyEdit(d, { ...across, side: "before" }).data), ["A 1–6", "B 7–9"]);
  assert.deepEqual(regionResidues(applyEdit(d, { ...across, side: "after" }).data), ["A 1–3", "B 4–9"]);
});

test("features at an edge take new bases when chosen, primers never, also across the origin", () => {
  const feature = (id: string, start: number, end: number): SeqFeature => ({ id, name: id, type: "misc_feature", start, end, strand: 1, notes: {}, raw: {} });
  const d: SeqData = {
    name: "t",
    description: "",
    circular: true,
    sequence: "A".repeat(60),
    features: [feature("left", 20, 29), feature("right", 30, 39), feature("last", 55, 59), feature("first", 0, 4)],
    primers: [{ id: "p", name: "p", start: 20, end: 29, strand: 1, bases: "A".repeat(10), notes: {}, raw: {} }],
    sources: []
  };
  const spans = (x: SeqData) => Object.fromEntries([...x.features.map(f => [f.id, [f.start, f.end]]), ["primer", [x.primers[0].start, x.primers[0].end]]]);
  assert.deepEqual(spans(insertBases(d, 30, "GG")), { left: [20, 29], right: [32, 41], last: [57, 61], first: [0, 4], primer: [20, 29] });
  assert.deepEqual(spans(insertBases(d, 30, "GG", "before")), { left: [20, 31], right: [32, 41], last: [57, 61], first: [0, 4], primer: [20, 29] });
  assert.deepEqual(spans(insertBases(d, 30, "GG", "after")), { left: [20, 29], right: [30, 41], last: [57, 61], first: [0, 4], primer: [20, 29] });
  // At the origin of a circle, what ends the sequence is before the new bases and what starts it after them.
  assert.deepEqual(spans(insertBases(d, 0, "GG", "before")).last, [57, 1]);
  assert.deepEqual(spans(insertBases(d, 60, "GG", "after")).first, [60, 4]);
  assert.deepEqual(spans(insertBases({ ...d, circular: false }, 0, "GG", "before")).last, [57, 61]);
  // Replacing 28–31 across the edge with two bases.
  assert.deepEqual(spans(replaceRange(d, { start: 28, end: 31 }, "GG").data), { left: [20, 27], right: [30, 37], last: [53, 57], first: [0, 4], primer: [20, 27] });
  assert.deepEqual(spans(replaceRange(d, { start: 28, end: 31 }, "GG", "before").data), { left: [20, 29], right: [30, 37], last: [53, 57], first: [0, 4], primer: [20, 27] });
  assert.deepEqual(spans(replaceRange(d, { start: 28, end: 31 }, "GG", "after").data), { left: [20, 27], right: [28, 37], last: [53, 57], first: [0, 4], primer: [20, 27] });
});
