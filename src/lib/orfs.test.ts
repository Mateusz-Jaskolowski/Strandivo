// ORF finding. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ALTERNATIVE_STARTS, findOrfs, frameLabel } from "./orfs.ts";
import { reverseComplement } from "./seqdata.ts";

const gene = (codons: number, start = "ATG") => start + "GCT".repeat(codons) + "TAA";
const opts = (minCodons: number, starts = ["ATG"]) => ({ minCodons, starts });

test("orfs: one on the top strand, with the stop codon included", () => {
  const seq = "CC" + gene(10) + "CCCC";
  const orfs = findOrfs(seq, false, opts(5)).filter(o => o.strand === 1);
  assert.equal(orfs.length, 1);
  assert.deepEqual({ ...orfs[0] }, { id: "1:2", start: 2, end: 2 + 3 * 12 - 1, strand: 1, frame: 2, codons: 11 });
  assert.equal(frameLabel(orfs[0]), "+3");
});

test("orfs: on the bottom strand, positions on the top strand", () => {
  const g = gene(10);
  const seq = "CCC" + reverseComplement(g) + "GG";
  const orfs = findOrfs(seq, false, opts(5)).filter(o => o.strand === -1);
  assert.equal(orfs.length, 1);
  assert.equal(orfs[0].start, 3);
  assert.equal(orfs[0].end, 3 + g.length - 1);
  assert.equal(reverseComplement(seq.slice(orfs[0].start, orfs[0].end + 1)), g);
});

test("orfs: shorter than the minimum are left out", () => {
  const seq = "C" + gene(10) + "C";
  assert.equal(findOrfs(seq, false, opts(11)).filter(o => o.strand === 1).length, 1);
  assert.equal(findOrfs(seq, false, opts(12)).filter(o => o.strand === 1).length, 0);
});

test("orfs: a later start in the same frame is part of the first ORF", () => {
  const seq = "ATG" + "GCT".repeat(5) + "ATG" + "GCT".repeat(5) + "TAA";
  const orfs = findOrfs(seq, false, opts(3)).filter(o => o.strand === 1);
  assert.deepEqual(orfs.map(o => o.start), [0]);
});

test("orfs: GTG and TTG count only when asked", () => {
  const seq = "C" + gene(10, "GTG") + "C";
  assert.equal(findOrfs(seq, false, opts(5)).filter(o => o.strand === 1).length, 0);
  assert.equal(findOrfs(seq, false, opts(5, ALTERNATIVE_STARTS)).filter(o => o.strand === 1).length, 1);
});

test("orfs: none without a stop before the end of a linear sequence", () => {
  assert.equal(findOrfs("ATG" + "GCT".repeat(20), false, opts(5)).filter(o => o.strand === 1).length, 0);
  assert.deepEqual(findOrfs("", true), []);
  assert.deepEqual(findOrfs("ATG", false), []);
});

test("orfs: across the origin of a circular sequence", () => {
  // A stop well before, then the gene split round the origin.
  const g = gene(20);
  const filler = "TAACCCCCCCCC";
  const whole = filler + g;
  const cut = filler.length + 30;
  const seq = whole.slice(cut) + whole.slice(0, cut);
  const orfs = findOrfs(seq, true, opts(10)).filter(o => o.strand === 1);
  assert.equal(orfs.length, 1);
  const o = orfs[0];
  assert.ok(o.start > o.end, "crosses the origin");
  assert.equal(seq.slice(o.start) + seq.slice(0, o.end + 1), g);
  // The same sequence read linearly has no complete ORF there.
  assert.equal(findOrfs(seq, false, opts(10)).filter(x => x.strand === 1 && x.codons === 20).length, 0);
  // And on the other strand.
  const rc = reverseComplement(seq);
  const back = findOrfs(rc, true, opts(10)).filter(x => x.strand === -1);
  assert.equal(back.length, 1);
  assert.equal(reverseComplement(rc.slice(back[0].start) + rc.slice(0, back[0].end + 1)), g);
});

test("orfs: a circular frame without stops gives none", () => {
  assert.deepEqual(findOrfs("ATGGCTGCTGCT", true, opts(1)).filter(o => o.strand === 1), []);
});

test("orfs: pUC19's bla gene is found where its CDS is", () => {
  const gb = readFileSync(new URL("../../testdata/e2e/pUC19-annotated.gb", import.meta.url), "utf8");
  const seq = gb.split("ORIGIN")[1].replace(/[^acgtn]/gi, "").toUpperCase();
  assert.match(gb, /CDS\s+complement\(1626\.\.2486\)\s+\/label="AmpR"/);
  const hit = findOrfs(seq, true).find(o => o.strand === -1 && o.start === 1625);
  assert.ok(hit, "an ORF where AmpR is");
  assert.equal(hit.end, 2485);
  assert.equal(hit.codons, 286);
});

test("in amber suppressor strains TAG doesn't end an ORF", () => {
  // ATG and 6 codons, TAG, 3 codons, TAA: 7 amino acids, or 11 reading TAG as Q.
  const seq = "CC" + "ATG" + "GCT".repeat(6) + "TAG" + "GCT".repeat(3) + "TAA" + "CC";
  const top = (amberAsQ: boolean) => findOrfs(seq, false, { minCodons: 5, starts: ["ATG"], amberAsQ }).filter(o => o.strand === 1);
  assert.deepEqual(top(false).map(o => o.codons), [7]);
  assert.deepEqual(top(true).map(o => o.codons), [11]);
});
