// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Pairs of primers that face each other. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { primerPairs, type PairInput } from "./primerPairs.ts";
import { MAX_PRODUCT, pcrProduct } from "./pcr.ts";
import { reverseComplement, type SeqPrimer } from "./seqdata.ts";

const puc19 = (): string => {
  const gb = readFileSync(new URL("../../testdata/e2e/pUC19-annotated.gb", import.meta.url), "utf8");
  return gb.split("ORIGIN")[1].replace(/[^acgtn]/gi, "").toUpperCase();
};

const seq = puc19();
const primer = (name: string, start: number, end: number, strand: 1 | -1): SeqPrimer => ({
  id: name,
  name,
  start,
  end,
  strand,
  bases: strand === 1 ? seq.slice(start, end + 1) : reverseComplement(seq.slice(start, end + 1)),
  notes: {},
  raw: {}
});
const input = (p: SeqPrimer, tm: number | null = 60): PairInput => ({ primer: p, tm });
const names = (ps: ReturnType<typeof primerPairs>) => ps.map(x => [x.forward.name, x.reverse.name, x.length]);

test("a forward and a reverse primer that face each other make a pair, shortest first", () => {
  const f1 = primer("F1", 100, 119, 1);
  const f2 = primer("F2", 500, 519, 1);
  const r1 = primer("R1", 700, 719, -1);
  const pairs = primerPairs([input(f1), input(f2), input(r1)], seq, true);
  assert.deepEqual(names(pairs), [
    ["F2", "R1", 220],
    ["F1", "R1", 620]
  ]);
});

test("two primers the same way round are no pair", () => {
  const pairs = primerPairs([input(primer("F1", 100, 119, 1)), input(primer("F2", 500, 519, 1))], seq, true);
  assert.deepEqual(pairs, []);
});

test("a product longer than the limit is left out, which is all that bounds a circle", () => {
  // Going round the plasmid, a reverse primer before the forward one still faces it.
  const f = primer("F", 2000, 2019, 1);
  const r = primer("R", 100, 119, -1);
  assert.deepEqual(names(primerPairs([input(f), input(r)], seq, true)), [["F", "R", 806]]);
  assert.deepEqual(primerPairs([input(f), input(r)], seq, true, 500), []);
  // On a linear sequence they don't face each other at all.
  assert.deepEqual(primerPairs([input(f), input(r)], seq, false), []);
});

test("the span check never drops a pair that makes a product", () => {
  // Long enough that pairs run past MAX_PRODUCT, which is what the check is there for.
  const long = seq.repeat(6);
  const at = (start: number, strand: 1 | -1, length = 20): SeqPrimer => ({
    id: `${strand}:${start}`,
    name: `${strand === 1 ? "F" : "R"}${start}`,
    start,
    end: start + length - 1,
    strand,
    bases: strand === 1 ? long.slice(start, start + length) : reverseComplement(long.slice(start, start + length)),
    notes: {},
    raw: {}
  });
  // A primer whose site spans a deletion: 40 bases over 120 of template, so its product
  // comes out 80 shorter than the span between the two sites. Allowing for its whole site
  // is what keeps such a pair, and what a slack of the primers' own lengths would miss.
  const deleting = (start: number, del: number, strand: 1 | -1): SeqPrimer => {
    const top = long.slice(start, start + 20) + long.slice(start + 20 + del, start + 40 + del);
    return { id: `del:${strand}:${start}`, name: `D${start}`, start, end: start + 40 + del - 1, strand, bases: strand === 1 ? top : reverseComplement(top), notes: {}, raw: {} };
  };
  const spread = [0, 400, 5_000, 9_000, 14_800, 15_200];
  const primers = [
    ...spread.map(s => at(s, 1)),
    ...spread.map(s => at(s + 100, -1)),
    at(long.length - 60, 1),
    at(long.length - 30, -1),
    deleting(300, 80, 1),
    deleting(14_950, 80, -1)
  ];
  // The pair the slack exists for: 15,070 bases of template, an 80-base deletion, and so a
  // product just inside the cap.
  const near = primerPairs([input(at(0, 1)), input(deleting(14_950, 80, -1))], long, true);
  assert.deepEqual(near.map(p => p.length), [14_990]);
  for (const circular of [true, false]) {
    const got = primerPairs(primers.map(p => input(p)), long, circular);
    // What the list would be if every product were built, which is what the check stands in for.
    const all = [];
    for (const f of primers.filter(p => p.strand === 1)) {
      for (const r of primers.filter(p => p.strand === -1)) {
        const product = pcrProduct(long, circular, f, r);
        if (product && product.length <= MAX_PRODUCT) all.push([f.name, r.name, product.length]);
      }
    }
    assert.deepEqual(
      got.map(p => [p.forward.name, p.reverse.name, p.length]).sort(),
      all.sort(),
      `circular: ${circular}`
    );
    assert.ok(all.length, "the fixture should make some products");
  }
});

test("the Tms are reported as they came, and how far apart they are", () => {
  const f = primer("F", 100, 119, 1);
  const r = primer("R", 700, 719, -1);
  const [pair] = primerPairs([input(f, 64.2), input(r, 57.1)], seq, true);
  assert.equal(pair.tmForward, 64.2);
  assert.equal(pair.tmReverse, 57.1);
  assert.equal(pair.tmApart!.toFixed(1), "7.1");
  // A primer whose Tm can't be worked out leaves the difference unknown.
  assert.equal(primerPairs([input(f, null), input(r, 57.1)], seq, true)[0].tmApart, null);
});
