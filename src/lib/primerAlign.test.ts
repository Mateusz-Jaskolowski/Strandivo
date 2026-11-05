// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Laying a primer on its site. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { alignPrimer, basesMatch, hasChanges, primerPiece } from "./primerAlign.ts";
import { basesIn, reverseComplement } from "./seqdata.ts";

const template = "TTGACCGTAAGCTTGCAGGCATGCAAGCTTGGCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCG";
const kinds = (a: ReturnType<typeof alignPrimer>) => a.ops.map(o => o.kind[0]).join("");

test("a primer that matches its site has no changes", () => {
  const a = alignPrimer({ start: 10, end: 29, strand: 1, bases: template.slice(10, 30) }, template);
  assert.equal(kinds(a), "m".repeat(20));
  assert.equal(a.tail, "");
  assert.equal(a.paired, 20);
  assert.deepEqual(a.arms, [template.slice(10, 30)]);
  assert.equal(a.changeFrom3, null);
  assert.ok(!hasChanges(a));
  assert.deepEqual(a.ops.map(o => o.pos), Array.from({ length: 20 }, (_, k) => 10 + k));
});

test("bases beyond the site are the 5′ tail", () => {
  const a = alignPrimer({ start: 10, end: 29, strand: 1, bases: "GAATTC" + template.slice(10, 30) }, template);
  assert.equal(a.tail, "GAATTC");
  assert.equal(a.binding, template.slice(10, 30));
  assert.equal(kinds(a), "t".repeat(6) + "m".repeat(20));
  assert.ok(!hasChanges(a));
});

test("a substitution splits the primer into two arms", () => {
  const site = template.slice(10, 34);
  const bases = site.slice(0, 12) + "AAC" + site.slice(15);
  const a = alignPrimer({ start: 10, end: 33, strand: 1, bases }, template);
  assert.equal(a.substitutions, 3 - [...site.slice(12, 15)].filter((c, k) => c === "AAC"[k]).length);
  assert.equal(a.insertions + a.deletions, 0);
  assert.equal(a.paired, 24);
  assert.equal(a.arms[0], site.slice(15));
  assert.equal(a.changeFrom3, 9);
});

test("an insertion: extra primer bases between two arms", () => {
  const left = template.slice(10, 22);
  const right = template.slice(22, 34);
  const a = alignPrimer({ start: 10, end: 33, strand: 1, bases: left + "CACCAC" + right }, template);
  assert.equal(a.insertions, 6);
  assert.equal(a.substitutions + a.deletions, 0);
  assert.deepEqual(a.arms, [right, left]);
  assert.equal(a.tail, "");
  assert.equal(a.changeFrom3, 12);
});

test("a deletion: the primer skips template bases", () => {
  const a = alignPrimer({ start: 10, end: 39, strand: 1, bases: template.slice(10, 22) + template.slice(28, 40) }, template);
  assert.equal(a.deletions, 6);
  assert.equal(a.substitutions + a.insertions, 0);
  assert.deepEqual(a.ops.filter(o => o.kind === "deletion").map(o => o.pos), [22, 23, 24, 25, 26, 27]);
});

test("a reverse primer reads its site from the right", () => {
  const site = basesIn(template, { start: 40, end: 59 });
  const bases = "GGGG" + reverseComplement(site);
  const a = alignPrimer({ start: 40, end: 59, strand: -1, bases }, template);
  assert.equal(a.tail, "GGGG");
  assert.ok(!hasChanges(a));
  // Its 3′ end is the site's left end.
  assert.equal(a.ops.at(-1)!.pos, 40);
  assert.equal(a.ops[4].pos, 59);
  // A mismatch at the 3′ end.
  const off = bases.slice(0, -1) + (bases.at(-1) === "A" ? "C" : "A");
  const b = alignPrimer({ start: 40, end: 59, strand: -1, bases: off }, template);
  assert.equal(b.substitutions, 1);
  assert.equal(b.changeFrom3, 0);
  assert.deepEqual(b.arms, ["", bases.slice(4, -1)]);
});

test("a site across the origin of a circular sequence", () => {
  const n = template.length;
  const site = { start: n - 8, end: 11 };
  const bases = basesIn(template, site);
  const a = alignPrimer({ ...site, strand: 1, bases }, template);
  assert.ok(!hasChanges(a));
  assert.equal(a.ops[0].pos, n - 8);
  assert.equal(a.ops.at(-1)!.pos, 11);
  const r = alignPrimer({ ...site, strand: -1, bases: reverseComplement(bases) }, template);
  assert.ok(!hasChanges(r));
  assert.equal(r.ops.at(-1)!.pos, n - 8);
});

test("a site at the end of a linear sequence", () => {
  const n = template.length;
  const a = alignPrimer({ start: n - 20, end: n - 1, strand: 1, bases: "TTT" + template.slice(n - 20) }, template);
  assert.equal(a.tail, "TTT");
  assert.equal(a.paired, 20);
});

test("degenerate primer bases pair with what their code allows", () => {
  assert.ok(basesMatch("N", "G") && basesMatch("K", "T") && !basesMatch("K", "A"));
  const site = template.slice(10, 30);
  const a = alignPrimer({ start: 10, end: 29, strand: 1, bases: site.slice(0, 9) + "NNK" + site.slice(12) }, template);
  assert.equal(a.substitutions, basesMatch("K", site[11]) ? 0 : 1);
});

// Rows of 30 bases, as the Sequence tab lays them out.
const inRow = (r: number) => (pos: number) => (pos >= r * 30 && pos < r * 30 + 30 ? pos - r * 30 : -1);

test("a primer's piece in a row: box, tail and 3′ end", () => {
  const p = { start: 10, end: 25, strand: 1 as const, bases: "GAATTC" + template.slice(10, 26) };
  const piece = primerPiece(alignPrimer(p, template), p, template.length, false, inRow(0))!;
  assert.deepEqual(piece.box, [[10, 25]]);
  assert.deepEqual(piece.tail.map(t => t.col), [4, 5, 6, 7, 8, 9]);
  assert.equal(piece.tail.map(t => t.base).join(""), "GAATTC");
  assert.equal(piece.end3, 25);
  assert.deepEqual([piece.a, piece.b], [4, 25]);
  assert.ok(piece.raised);
});

test("a primer split over two rows", () => {
  const p = { start: 20, end: 39, strand: 1 as const, bases: template.slice(20, 40) };
  const al = alignPrimer(p, template);
  const first = primerPiece(al, p, template.length, false, inRow(0))!;
  const second = primerPiece(al, p, template.length, false, inRow(1))!;
  assert.deepEqual(first.box, [[20, 29]]);
  assert.equal(first.end3, null);
  assert.ok(!first.raised);
  assert.deepEqual(second.box, [[0, 9]]);
  assert.equal(second.end3, 9);
  assert.equal(primerPiece(al, p, template.length, false, inRow(2)), null);
});

test("changes in a piece: raised bases, inserted bases and skipped ones", () => {
  const sub = { start: 2, end: 25, strand: 1 as const, bases: template.slice(2, 12) + "AAA" + template.slice(15, 26) };
  const s = primerPiece(alignPrimer(sub, template), sub, template.length, false, inRow(0))!;
  assert.deepEqual(s.cells.filter(c => c.kind === "mismatch").map(c => c.col), [12, 13, 14].filter(c => template[c] !== "A"));
  // Inserted bases unlike their neighbours, so there is one place for them.
  const ins = { start: 2, end: 25, strand: 1 as const, bases: template.slice(2, 12) + "GAGGAG" + template.slice(12, 26) };
  const i = primerPiece(alignPrimer(ins, template), ins, template.length, false, inRow(0))!;
  assert.deepEqual(i.insertions, [{ at: 12, bases: "GAGGAG" }]);
  assert.deepEqual(i.box, [[2, 25]]);
  const del = { start: 2, end: 27, strand: 1 as const, bases: template.slice(2, 12) + template.slice(18, 28) };
  const d = primerPiece(alignPrimer(del, template), del, template.length, false, inRow(0))!;
  assert.deepEqual(d.deletions, [[12, 17]]);
  assert.deepEqual(d.box, [[2, 11], [18, 27]]);
  // On the other strand the inserted bases read left to right too, as the bottom strand does.
  const rev = { start: 2, end: 25, strand: -1 as const, bases: reverseComplement(template.slice(12, 26)) + "TCCTCC" + reverseComplement(template.slice(2, 12)) };
  const r = primerPiece(alignPrimer(rev, template), rev, template.length, false, inRow(0))!;
  assert.deepEqual(r.insertions, [{ at: 12, bases: "CCTCCT" }]);
  assert.equal(r.end3, 2);
});
