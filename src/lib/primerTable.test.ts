// Sorting the Primers tab's table and the text for ordering. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_SORT, matchesFilter, nextSort, orderText, parseSort, primerListText, primerNote, shortTail, sortRows, type PrimerRow } from "./primerTable.ts";
import type { SeqPrimer } from "./seqdata.ts";

const row = (name: string, start: number, strand: 1 | -1, over: Partial<PrimerRow> = {}): PrimerRow => ({
  primer: { id: name, name, start, end: start + 19, strand, bases: "ACGT", notes: {}, raw: {} } as SeqPrimer,
  length: 20,
  tm: 60,
  gc: 50,
  warnings: 0,
  ...over
});
const order = (rows: PrimerRow[]) => rows.map(r => r.primer.name);

test("by default rows follow the binding position", () => {
  const rows = [row("b", 500, 1), row("a", 100, -1), row("c", 300, 1)];
  assert.deepEqual(order(sortRows(rows, DEFAULT_SORT)), ["a", "c", "b"]);
});

test("names sort with numbers in order and case ignored", () => {
  const rows = [row("Primer 10", 0, 1), row("primer 4", 10, 1), row("Primer 2", 20, 1)];
  assert.deepEqual(order(sortRows(rows, { key: "name", descending: false })), ["Primer 2", "primer 4", "Primer 10"]);
  assert.deepEqual(order(sortRows(rows, { key: "name", descending: true })), ["Primer 10", "primer 4", "Primer 2"]);
});

test("forward primers come first, each by position", () => {
  const rows = [row("r1", 50, -1), row("f2", 90, 1), row("f1", 10, 1)];
  assert.deepEqual(order(sortRows(rows, { key: "direction", descending: false })), ["f1", "f2", "r1"]);
});

test("a primer without a Tm goes last either way", () => {
  const rows = [row("none", 0, 1, { tm: null }), row("low", 10, 1, { tm: 40 }), row("high", 20, 1, { tm: 70 })];
  assert.deepEqual(order(sortRows(rows, { key: "tm", descending: false })), ["low", "high", "none"]);
  assert.deepEqual(order(sortRows(rows, { key: "tm", descending: true })), ["high", "low", "none"]);
});

test("primers with warnings come first under Checks", () => {
  const rows = [row("ok", 0, 1), row("warn", 10, 1, { warnings: 1 })];
  assert.deepEqual(order(sortRows(rows, { key: "checks", descending: false })), ["warn", "ok"]);
});

test("clicking the same column turns it round, another starts ascending", () => {
  assert.deepEqual(nextSort({ key: "tm", descending: false }, "tm"), { key: "tm", descending: true });
  assert.deepEqual(nextSort({ key: "tm", descending: true }, "gc"), { key: "gc", descending: false });
});

test("ordering text: tab-separated or FASTA", () => {
  const ps = [{ name: "F", bases: "acgt AC" }, { name: "R", bases: "GGCC" }];
  assert.equal(orderText(ps, "tsv"), "F\tacgtAC\nR\tGGCC");
  assert.equal(orderText(ps, "fasta"), ">F\nacgtAC\n>R\nGGCC");
});

test("a primer's note comes from its /note qualifier, however the file wrote it", () => {
  assert.equal(primerNote({ notes: {} }), "");
  assert.equal(primerNote({ notes: { note: ["Sequencing\n  primer"] } }), "Sequencing primer");
  assert.equal(primerNote({ notes: { note: "Plain string" } }), "Plain string");
  assert.equal(primerNote({ notes: { note: ["First", "", "Second"] } }), "First; Second");
});

test("the filter matches a name, a note or the bases, every word", () => {
  const p = { name: "pET-seq-F", bases: "GTAAAACGACGGCCAGT", notes: { note: ["Ordered for the Kan library"] } };
  assert.ok(matchesFilter(p, ""));
  assert.ok(matchesFilter(p, "pet"));
  assert.ok(matchesFilter(p, "kan library"));
  assert.ok(!matchesFilter(p, "kan amp"));
  // Bases, which are matched from three letters up so one base doesn't match everything.
  assert.ok(matchesFilter(p, "ggccagt"));
  assert.ok(matchesFilter(p, "seq ggcc"));
  assert.ok(!matchesFilter(p, "gt"));
  assert.ok(!matchesFilter(p, "ggggg"));
  assert.ok(!matchesFilter({ ...p, notes: {} }, "kan"));
});

test("a remembered sort is used only if it names a column of the table", () => {
  assert.deepEqual(parseSort({ key: "tm", descending: true }), { key: "tm", descending: true });
  assert.deepEqual(parseSort({ key: "tm" }), { key: "tm", descending: false });
  assert.deepEqual(parseSort({ key: "colour", descending: true }), DEFAULT_SORT);
  for (const bad of [null, undefined, "tm", 7, {}]) assert.deepEqual(parseSort(bad), DEFAULT_SORT);
});

test("the exported list is a tab-separated table with a header", () => {
  const rows = [
    { primer: { name: "pET-seq-F", bases: "gcgc ACGTACGT", strand: 1 as const, start: 99, end: 110, notes: { note: ["Ordered\tMay\n2026"] } }, tm: 61.25 },
    { primer: { name: "pET-seq-R", bases: "TTTTCCCC", strand: -1 as const, start: 400, end: 407, notes: {} }, tm: null }
  ];
  assert.deepEqual(primerListText(rows).split("\n"), [
    "Name\tSequence\tDirection\tBinds\tTm (°C)\tNotes",
    "pET-seq-F\tGCGCACGTACGT\tForward\t100-111\t61.3\tOrdered May 2026",
    "pET-seq-R\tTTTTCCCC\tReverse\t401-408\t\t"
  ]);
  assert.equal(primerListText([]).split("\n").length, 1);
});

test("long tails are shortened around an ellipsis", () => {
  assert.equal(shortTail("GAATTC"), "GAATTC");
  assert.equal(shortTail("A".repeat(15)), "A".repeat(15));
  assert.equal(shortTail("ACGTACGTACGTACGTAAAA"), "ACGTAC…GTAAAA");
});
