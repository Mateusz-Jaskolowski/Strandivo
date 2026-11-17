// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { edgeNear, moveRegionEdge, regionEdge } from "./regionEdges.ts";
import { proteinLength, regionsOf, withRegions, type ProteinRegion } from "./regions.ts";
import { reverseComplement, type SeqFeature, type Strand } from "./seqdata.ts";

/** 21 codons and a stop, so the protein is 21 residues long. */
const CODING = "ATGGCTTGTGATGAATTTGGTCATATTAAACTTATGAATCCTCAACGTTCTACTGTTTGGTATTAA";
const BEFORE = 10;

const region = (name: string, start: number, end: number, more: Partial<ProteinRegion> = {}): ProteinRegion => ({ name, kind: "Region", start, end, accession: "", sourceStart: start, sourceEnd: end, predicted: false, ...more });

function cds(regions: ProteinRegion[], strand: Strand = 1): { f: SeqFeature; sequence: string } {
  const coding = strand === -1 ? reverseComplement(CODING) : CODING;
  const sequence = "C".repeat(BEFORE) + coding + "C".repeat(10);
  const f: SeqFeature = { id: "cds", name: "gene", type: "CDS", start: BEFORE, end: BEFORE + coding.length - 1, strand, notes: withRegions({}, regions), raw: {} };
  return { f, sequence };
}

const spans = (f: SeqFeature) => regionsOf(f).map(r => `${r.name} ${r.start}–${r.end}`);
const indexOf = (f: SeqFeature, name: string) => regionsOf(f).findIndex(r => r.name === name);

test("a protein's length leaves out its stop codon", () => {
  assert.equal(proteinLength(cds([]).f, cds([]).sequence), 21);
});

test("dragging a region's end moves it a codon at a time and leaves the others", () => {
  const { f, sequence } = cds([region("TM1", 3, 5), region("TM2", 10, 12)]);
  const edge = regionEdge(f, sequence, 0, "end")!;
  assert.deepEqual([edge.at, edge.starts, edge.ends, edge.min, edge.max], [5, [], [0], 3, 21]);
  assert.deepEqual(spans(moveRegionEdge(f, edge, 7)), ["TM1 3–7", "TM2 10–12"]);
  // A region keeps a residue, however far it is dragged.
  assert.deepEqual(spans(moveRegionEdge(f, edge, 0)), ["TM1 3–3", "TM2 10–12"]);
});

test("the edge where two regions meet moves both, from either side", () => {
  const { f, sequence } = cds([region("FR1", 1, 5), region("CDR1", 6, 8), region("FR2", 9, 12)]);
  const fromFr1 = regionEdge(f, sequence, indexOf(f, "FR1"), "end")!;
  const fromCdr1 = regionEdge(f, sequence, indexOf(f, "CDR1"), "start")!;
  assert.deepEqual([fromCdr1.at, fromCdr1.starts, fromCdr1.ends], [fromFr1.at, fromFr1.starts, fromFr1.ends]);
  assert.deepEqual(spans(moveRegionEdge(f, fromFr1, 6)), ["FR1 1–6", "CDR1 7–8", "FR2 9–12"]);
  assert.deepEqual(spans(moveRegionEdge(f, fromFr1, 3)), ["FR1 1–3", "CDR1 4–8", "FR2 9–12"]);
  // CDR1 keeps a residue, so the edge stops before FR2.
  assert.deepEqual(spans(moveRegionEdge(f, fromFr1, 11)), ["FR1 1–7", "CDR1 8–8", "FR2 9–12"]);
});

test("with ⌥ a region's end moves alone, which parts two regions that met", () => {
  const { f, sequence } = cds([region("FR1", 1, 5), region("CDR1", 6, 8), region("FR2", 9, 12)]);
  const edge = regionEdge(f, sequence, indexOf(f, "FR1"), "end")!;
  const { alone } = edge;
  // The same regions, so a drag can switch between the two.
  assert.equal(alone.regions, edge.regions);
  assert.deepEqual([alone.at, alone.starts, alone.ends, alone.min, alone.max], [5, [], [indexOf(f, "FR1")], 1, 21]);
  assert.deepEqual(spans(moveRegionEdge(f, alone, 3)), ["FR1 1–3", "CDR1 6–8", "FR2 9–12"]);
  assert.deepEqual(spans(moveRegionEdge(f, alone, 7)), ["FR1 1–7", "CDR1 6–8", "FR2 9–12"]);
  // From CDR1's side, only CDR1 moves.
  const cdr1 = regionEdge(f, sequence, indexOf(f, "CDR1"), "start")!.alone;
  assert.deepEqual(spans(moveRegionEdge(f, cdr1, 6)), ["FR1 1–5", "CDR1 7–8", "FR2 9–12"]);
});

test("an edge put back where it was leaves the CDS as it was", () => {
  const { f, sequence } = cds([region("TM1", 3, 5, { kind: "Transmembrane", accession: "Q9UKG4", sourceStart: 103, sourceEnd: 105 })]);
  const edge = regionEdge(f, sequence, 0, "end")!;
  assert.equal(moveRegionEdge(f, edge, 5), f);
  assert.equal(moveRegionEdge(f, edge.alone, 5), f);
});

test("a child stays inside its parent without moving it, even where they share an end", () => {
  const { f, sequence } = cds([
    region("VH", 1, 20, { id: "vh" }),
    region("FR1", 1, 4, { id: "fr1", parentId: "vh" }),
    region("CDR1", 5, 8, { id: "cdr1", parentId: "vh" })
  ]);
  // FR1 and VH start together, but only FR1 moves, up to CDR1, which keeps a residue.
  const start = regionEdge(f, sequence, indexOf(f, "FR1"), "start")!;
  assert.deepEqual(start.starts.map(i => start.regions[i].name), ["FR1"]);
  assert.deepEqual([start.min, start.max], [0, 3]);
  assert.deepEqual(spans(moveRegionEdge(f, start, 2)), ["VH 1–20", "FR1 3–4", "CDR1 5–8"]);
  // Where FR1 meets CDR1, both move, and VH doesn't.
  const meeting = regionEdge(f, sequence, indexOf(f, "FR1"), "end")!;
  assert.deepEqual([...meeting.ends, ...meeting.starts].map(i => meeting.regions[i].name), ["FR1", "CDR1"]);
  // CDR1 can't leave VH.
  const cdr1 = regionEdge(f, sequence, indexOf(f, "CDR1"), "end")!;
  assert.equal(cdr1.max, 20);
  const atVhEnd = moveRegionEdge(f, cdr1, 25);
  assert.deepEqual(spans(atVhEnd), ["FR1 1–4", "VH 1–20", "CDR1 5–20"]);
  // Pulled up to VH's end, CDR1 can still be pulled back alone.
  const back = regionEdge(atVhEnd, sequence, indexOf(atVhEnd, "CDR1"), "end")!;
  assert.deepEqual(back.ends.map(i => back.regions[i].name), ["CDR1"]);
  assert.deepEqual(spans(moveRegionEdge(atVhEnd, back, 10)), ["FR1 1–4", "VH 1–20", "CDR1 5–10"]);
  // VH can't leave out CDR1, and grows past it alone.
  const vh = regionEdge(atVhEnd, sequence, indexOf(atVhEnd, "VH"), "end")!;
  assert.deepEqual([vh.min, vh.max], [20, 21]);
  assert.deepEqual(spans(moveRegionEdge(atVhEnd, vh, 21)), ["FR1 1–4", "VH 1–21", "CDR1 5–20"]);
  assert.deepEqual(spans(moveRegionEdge(f, regionEdge(f, sequence, indexOf(f, "VH"), "end")!, 2)), ["FR1 1–4", "VH 1–8", "CDR1 5–8"]);
});

test("regions on the same level that only overlap don't move together", () => {
  // A domain and a disordered stretch at its end, as an entry may list them.
  const { f, sequence } = cds([region("Domain", 1, 10), region("Disordered", 6, 10)]);
  assert.deepEqual(spans(moveRegionEdge(f, regionEdge(f, sequence, indexOf(f, "Domain"), "end")!, 8)), ["Domain 1–8", "Disordered 6–10"]);
});

test("a region doesn't move one it meets under another parent", () => {
  const { f, sequence } = cds([
    region("VH", 1, 10, { id: "vh" }),
    region("FR4", 7, 10, { id: "fr4", parentId: "vh" }),
    region("Linker", 11, 14)
  ]);
  const edge = regionEdge(f, sequence, indexOf(f, "FR4"), "end")!;
  assert.deepEqual([edge.starts, edge.max], [[], 10]);
  assert.deepEqual(spans(moveRegionEdge(f, edge, 8)), ["VH 1–10", "FR4 7–8", "Linker 11–14"]);
});

test("the protein's ends stop it", () => {
  const { f, sequence } = cds([region("TM1", 3, 5), region("TM2", 10, 12)]);
  assert.deepEqual(spans(moveRegionEdge(f, regionEdge(f, sequence, 1, "end")!, 40)), ["TM1 3–5", "TM2 10–21"]);
  assert.deepEqual(spans(moveRegionEdge(f, regionEdge(f, sequence, 0, "start")!, -3)), ["TM1 1–5", "TM2 10–12"]);
});

test("a region from an entry keeps the entry's numbers in step, and the next import keeps the change", () => {
  const { f, sequence } = cds([region("TM1", 3, 5, { kind: "Transmembrane", accession: "Q9UKG4", sourceStart: 103, sourceEnd: 105 }), region("Mine", 10, 12)]);
  const tm = regionsOf(moveRegionEdge(f, regionEdge(f, sequence, 0, "end")!, 7))[0];
  assert.deepEqual([tm.start, tm.end, tm.sourceStart, tm.sourceEnd, tm.edited, tm.sourceKey], [3, 7, 103, 107, true, "Transmembrane:103-105"]);
  const mine = regionsOf(moveRegionEdge(f, regionEdge(f, sequence, 1, "start")!, 7))[1];
  assert.deepEqual([mine.start, mine.end, mine.sourceStart, mine.sourceEnd, mine.edited], [8, 12, 8, 12, undefined]);
});

test("the end that didn't move keeps its exact bases between codons", () => {
  // Bases 8–14 of the coding sequence round to residues 3–5.
  const { f, sequence } = cds([region("TM1", 3, 5, { codingBases: { start: 8, end: 14 } })]);
  assert.deepEqual(regionsOf(f)[0].codingBases, { start: 8, end: 14 });
  const longer = regionsOf(moveRegionEdge(f, regionEdge(f, sequence, 0, "end")!, 7))[0];
  assert.deepEqual([longer.start, longer.end, longer.codingBases], [3, 7, { start: 8, end: 21 }]);
  const earlier = regionsOf(moveRegionEdge(f, regionEdge(f, sequence, 0, "start")!, 1))[0];
  assert.deepEqual([earlier.start, earlier.end, earlier.codingBases], [2, 5, { start: 4, end: 14 }]);
});

test("a region without an id gets one, so it can be found again once regions are reordered", () => {
  const { f, sequence } = cds([region("A", 3, 5), region("B", 4, 9)]);
  const edge = regionEdge(f, sequence, 1, "start")!;
  const id = edge.regions[1].id!;
  assert.ok(id);
  const moved = moveRegionEdge(f, edge, 1);
  assert.deepEqual(spans(moved), ["B 2–9", "A 3–5"]);
  assert.equal(regionsOf(moved)[0].id, id);
});

test("the pointer finds the nearest edge between codons, along the CDS's own bases", () => {
  const forward = cds([]);
  const n = forward.sequence.length;
  const near = (f: SeqFeature, b: number) => edgeNear(f, n, false, b);
  assert.deepEqual([BEFORE, BEFORE + 3, BEFORE + 4, BEFORE + 5, 2, n].map(b => near(forward.f, b)), [0, 1, 1, 2, 0, 22]);
  // Turned round, the first residue is on the right.
  const reverse = cds([], -1);
  const end = BEFORE + CODING.length;
  assert.deepEqual([end, end - 3, BEFORE, 2].map(b => near(reverse.f, b)), [0, 1, 22, 22]);
  // Across an intron, both of its edges are the same edge between residues.
  const split: SeqFeature = { id: "cds", name: "g", type: "CDS", start: 0, end: 21, strand: 1, locations: [{ start: 0, end: 8 }, { start: 13, end: 21 }], notes: {}, raw: {} };
  assert.deepEqual([9, 11, 13, 14, 15].map(b => edgeNear(split, 30, false, b)), [3, 3, 3, 3, 4]);
});
