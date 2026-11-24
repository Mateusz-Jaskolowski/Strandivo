// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Primer library, PCR products and primer design. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { COMMON_SEQUENCING_PRIMERS, formatPrimerList, libraryHits, newEntries, parsePrimerList, type LibraryPrimer } from "./library.ts";
import { allProducts, pcrProduct, productDocument, type PlacedPrimer } from "./pcr.ts";
import { DEFAULT_DESIGN, designPairs, joinTail } from "./design.ts";
import { codingPositions } from "./genetics.ts";
import { gcContent, meltingTemp } from "./primers.ts";
import { basesIn, reverseComplement, type Range, type SeqData, type SeqFeature } from "./seqdata.ts";

const puc19 = (): string => {
  const gb = readFileSync(new URL("../../testdata/e2e/pUC19-annotated.gb", import.meta.url), "utf8");
  return gb.split("ORIGIN")[1].replace(/[^acgtn]/gi, "").toUpperCase();
};
const asLibrary = (entries: { name: string; bases: string; notes: string }[]): LibraryPrimer[] => entries.map((e, i) => ({ ...e, id: `l${i}` }));

test("primer lists: tab, comma and FASTA, with or without a header", () => {
  const tsv = parsePrimerList("Name\tSequence\tNotes\nM13 fwd\tGTAAAACGACGGCCAGT\tuniversal\nbad line\n");
  assert.deepEqual(tsv.entries, [{ name: "M13 fwd", bases: "GTAAAACGACGGCCAGT", notes: "universal" }]);
  assert.deepEqual(tsv.skipped.map(s => s.line), [3]);
  const csv = parsePrimerList('"M13, rev",caggaaacagctatgac\nT7,TAATACGACTCACTATAGGG,"from the core, 2024"');
  assert.deepEqual(csv.entries.map(e => [e.name, e.bases, e.notes]), [
    ["M13, rev", "CAGGAAACAGCTATGAC", ""],
    ["T7", "TAATACGACTCACTATAGGG", "from the core, 2024"]
  ]);
  // Sequence first, name second.
  assert.equal(parsePrimerList("GTAAAACGACGGCCAGT,M13 fwd").entries[0].name, "M13 fwd");
  const fasta = parsePrimerList(">SP6\nGATTTAGGTG\nACACTATAG\n>empty\n");
  assert.deepEqual(fasta.entries, [{ name: "SP6", bases: "GATTTAGGTGACACTATAG", notes: "" }]);
  // Our own export reads back unchanged, colours included.
  assert.deepEqual(parsePrimerList(formatPrimerList(COMMON_SEQUENCING_PRIMERS)).entries, COMMON_SEQUENCING_PRIMERS);
  const coloured = [{ name: "T7", bases: "TAATACGACTCACTATAGGG", notes: "", color: "#6CC2B0" }, { name: "SP6", bases: "GATTTAGGTGACACTATAG", notes: "core" }];
  assert.deepEqual(parsePrimerList(formatPrimerList(coloured)).entries, coloured);
});

test("importing skips primers already in the library", () => {
  const have = [{ name: "M13 fwd", bases: "GTAAAACGACGGCCAGT", notes: "" }];
  const incoming = [
    { name: "m13 FWD ", bases: "gtaaaacgacggccagt", notes: "x" },
    { name: "M13 fwd", bases: "GTAAAACGACGGCCAG", notes: "" },
    { name: "T7", bases: "TAATACGACTCACTATAGGG", notes: "" },
    { name: "T7", bases: "TAATACGACTCACTATAGGG", notes: "" }
  ];
  assert.deepEqual(newEntries(have, incoming).map(e => e.bases), ["GTAAAACGACGGCCAG", "TAATACGACTCACTATAGGG"]);
});

test("library primers that bind pUC19", () => {
  const hits = libraryHits(asLibrary(COMMON_SEQUENCING_PRIMERS), puc19(), true);
  const names = hits.map(h => h.primer.name);
  assert.ok(names.includes("M13 fwd (-21)") && names.includes("M13 rev"), names.join(", "));
  assert.ok(!names.includes("CMV fwd") && !names.includes("EGFP-C"));
  const fwd = hits.find(h => h.primer.name === "M13 fwd (-21)")!;
  assert.equal(fwd.sites[0].strand, 1);
  assert.equal(fwd.tm?.toFixed(1), "54.7");
});

test("PCR product between M13 primers on pUC19", () => {
  const seq = puc19();
  const products = allProducts(seq, true, { name: "M13 fwd", bases: "GTAAAACGACGGCCAGT" }, { name: "M13 rev", bases: "CAGGAAACAGCTATGAC" });
  assert.equal(products.length, 1);
  const p = products[0];
  assert.ok(p.sequence.startsWith("GTAAAACGACGGCCAGT"));
  assert.ok(p.sequence.endsWith(reverseComplement("CAGGAAACAGCTATGAC")));
  assert.equal(p.sequence, basesIn(seq, p.span));
  assert.ok(p.length > 80 && p.length < 200, `${p.length} bp`);
});

test("products across the origin, with 5′ tails", () => {
  const seq = puc19();
  const n = seq.length;
  // Forward primer at 2600…2619, reverse primer ending at 100: the product crosses the origin.
  const f: PlacedPrimer = { name: "F", bases: "gcgcCATATG".toUpperCase() + seq.slice(2600, 2620), start: 2600, end: 2619, strand: 1 };
  const r: PlacedPrimer = { name: "R", bases: "GGGG" + reverseComplement(seq.slice(81, 101)), start: 81, end: 100, strand: -1 };
  const p = pcrProduct(seq, true, f, r)!;
  assert.equal(p.length, 10 + (n - 2600) + 101 + 4);
  assert.equal(p.sequence, "GCGCCATATG" + seq.slice(2600) + seq.slice(0, 101) + "CCCC");
  // On a linear template the same primers point away from each other.
  assert.equal(pcrProduct(seq, false, f, r), null);
  // Two forward primers make nothing.
  assert.equal(pcrProduct(seq, true, f, { ...r, strand: 1 }), null);
});

test("a primer binding twice gives side products", () => {
  const unit = "ACGTTGCATGCCTAGGATCCAGTTACGGATCAGTCCATGA";
  const filler = "TTGACCGTAAGCTTGCAGGCATGCAAGCTTGGCACTGGCCGTCGTTTTACAACGTCGTGACTGGG";
  const seq = unit + filler + unit + filler;
  const products = allProducts(seq, false, { name: "F", bases: unit.slice(0, 20) }, { name: "R", bases: reverseComplement(unit.slice(20)) });
  assert.ok(products.length >= 2, `${products.length} products`);
  assert.equal(products[0].length, unit.length);
});

test("the product becomes a document with the features inside it", () => {
  const seq = puc19();
  const feat = (id: string, start: number, end: number): SeqFeature => ({ id, name: id, type: "misc_feature", start, end, strand: 1, notes: {}, raw: {} });
  const d: SeqData = { name: "pUC19", description: "", circular: true, sequence: seq, features: [feat("inside", 2650, 20), feat("across", 50, 300), feat("outside", 1000, 1100)], primers: [], sources: [] };
  const f: PlacedPrimer = { name: "F", bases: "AAAA" + seq.slice(2600, 2620), start: 2600, end: 2619, strand: 1 };
  const r: PlacedPrimer = { name: "R", bases: reverseComplement(seq.slice(81, 101)), start: 81, end: 100, strand: -1 };
  const p = pcrProduct(seq, true, f, r)!;
  const doc = productDocument(d, p);
  assert.equal(doc.sequence, p.sequence);
  assert.equal(doc.circular, false);
  const byId = Object.fromEntries(doc.features.map(x => [x.id, x]));
  assert.equal(byId.outside, undefined);
  assert.equal(basesIn(doc.sequence, byId.inside), basesIn(seq, { start: 2650, end: 20 }));
  // A feature that runs past the product's end is cut where the product ends.
  assert.equal(byId.across.end, doc.sequence.length - 1);
});

test("designed pairs: matched Tms, and restriction sites that reuse template bases", () => {
  const seq = puc19();
  const pairs = designPairs(seq, true, 1625, 2485);
  assert.ok(pairs.length >= 3);
  const best = pairs[0];
  assert.ok(Math.abs(best.forward.tm - best.reverse.tm) < 3, `${best.forward.tm} / ${best.reverse.tm}`);
  assert.equal(best.forward.start, 1625);
  assert.equal(best.reverse.end, 2485);
  assert.equal(best.forward.bases, seq.slice(1625, best.forward.end + 1));
  assert.ok(pairs.every((p, i) => i === 0 || p.score >= pairs[i - 1].score));
  // NdeI (CATATG) before a start codon only needs CAT added.
  assert.equal(joinTail("GCGCCATATG", "ATGAGTATTCAACATTTCCG"), "GCGCCAT");
  assert.equal(joinTail("GCGCCTCGAG", "TTACCAATGCTTAATCAG"), "GCGCCTCGAG");
  const tailed = designPairs(seq, true, 1625, 2485, { tmMin: 58, tmMax: 62, minLength: 18, maxLength: 30, forwardTail: "GCGCGAATTC", reverseTail: "GCGCAAGCTT" })[0];
  assert.ok(tailed.forward.bases.startsWith("gcgcgaattc"));
  assert.equal(meltingTemp(tailed.forward.bases.slice(10)), tailed.forward.tm);
  // AmpR runs right to left, so its start codon is under the reverse primer: NdeI goes there.
  const ampR = designPairs(seq, true, 1625, 2485, { ...DEFAULT_DESIGN, forwardTail: "GCGCCTCGAG", reverseTail: "GCGCCATATG" })[0];
  assert.ok(ampR.reverse.bases.startsWith("gcgccatATGAGTATT"), ampR.reverse.bases);
  assert.equal(pcrProduct(seq, true, { name: "R", ...ampR.forward, bases: ampR.forward.bases.toUpperCase() }, { name: "F", ...ampR.reverse, bases: ampR.reverse.bases.toUpperCase() })!.length, 861 + 10 + 7);
  // Tail bases that happen to match the template make the same product, not a second one.
  assert.equal(allProducts(seq, true, { name: "R", bases: ampR.forward.bases.toUpperCase() }, { name: "F", bases: ampR.reverse.bases.toUpperCase() }).length, 1);
});

test("a PCR product carries the primers' changes, not the template's bases", () => {
  const seq = puc19();
  const doc: SeqData = { name: "pUC19", description: "", circular: true, sequence: seq, features: [], primers: [], sources: [] };
  const site = seq.slice(1000, 1033);
  const changed = site.slice(0, 15) + (site[15] === "A" ? "C" : "A") + site.slice(16);
  const rev = seq.slice(1200, 1222);
  const reverse: PlacedPrimer = { name: "R", bases: reverseComplement(rev), start: 1200, end: 1221, strand: -1 };
  const expect = (fwdBases: string, inner: string) => {
    const forward: PlacedPrimer = { name: "F", bases: fwdBases, start: 1000, end: 1032, strand: 1 };
    const p = pcrProduct(seq, true, forward, reverse)!;
    assert.equal(p.sequence, inner);
    assert.equal(productDocument(doc, p).sequence, inner);
  };
  // A substitution.
  expect(changed, changed + seq.slice(1033, 1222));
  // Three bases inserted, with a tail.
  expect("GGATCC" + site.slice(0, 15) + "TAG" + site.slice(15), "GGATCC" + site.slice(0, 15) + "TAG" + site.slice(15) + seq.slice(1033, 1222));
  // On the reverse primer: a change near its 5′ end, at the right of its site.
  const revChanged = rev.slice(0, 18) + (rev[18] === "A" ? "C" : "A") + rev.slice(19);
  const r2: PlacedPrimer = { ...reverse, bases: reverseComplement(revChanged) };
  const p2 = pcrProduct(seq, true, { name: "F", bases: site, start: 1000, end: 1032, strand: 1 }, r2)!;
  assert.equal(p2.sequence, seq.slice(1000, 1200) + revChanged);
});

test("a template base left ambiguous under a primer is the primer's base in the product", () => {
  const seq = puc19();
  const doc: SeqData = { name: "pUC19", description: "", circular: true, sequence: seq, features: [], primers: [], sources: [] };
  const forward: PlacedPrimer = { name: "F", bases: seq.slice(1000, 1030), start: 1000, end: 1029, strand: 1 };
  const reverse: PlacedPrimer = { name: "R", bases: reverseComplement(seq.slice(1200, 1230)), start: 1200, end: 1229, strand: -1 };
  const clean = pcrProduct(seq, true, forward, reverse)!;
  assert.equal(clean.length, 230);
  const put = (at: number, base: string) => seq.slice(0, at) + base + seq.slice(at + 1);
  // One N under each primer, near its 5′ end and further in; a code that fits the base too.
  const fits: Record<string, string> = { A: "R", C: "Y", G: "S", T: "W" };
  for (const at of [1010, 1012, 1029, 1200, 1215, 1217, 1229]) {
    for (const code of ["N", fits[seq[at]]]) {
      const template = put(at, code);
      const p = pcrProduct(template, true, forward, reverse)!;
      assert.equal(p.sequence, clean.sequence, `${code} at ${at}`);
      assert.ok(!p.sequence.includes(code), `${code} at ${at}`);
      assert.equal(gcContent(p.sequence), gcContent(clean.sequence));
      // Opened as a new file it is the same product.
      assert.equal(productDocument({ ...doc, sequence: template }, p).sequence, clean.sequence, `${code} at ${at}`);
    }
  }
  // The primer's bases are written as they are in the product, whatever their case.
  const lower: PlacedPrimer = { ...forward, bases: forward.bases.toLowerCase() };
  assert.equal(pcrProduct(put(1010, "N"), true, lower, reverse)!.sequence, clean.sequence);
  // On a template that is not circular too.
  const linear = pcrProduct(put(1010, "N"), false, forward, reverse)!;
  assert.equal(linear.sequence, clean.sequence);
  // Next to a base the primer inserts, the insertion and the primer's base go in together.
  const site = seq.slice(1000, 1033);
  const inserting: PlacedPrimer = { name: "F", bases: "GGATCC" + site.slice(0, 15) + "TAG" + site.slice(15), start: 1000, end: 1032, strand: 1 };
  const expected = "GGATCC" + site.slice(0, 15) + "TAG" + site.slice(15) + seq.slice(1033, 1230);
  assert.equal(pcrProduct(seq, true, inserting, reverse)!.sequence, expected);
  for (const at of [1014, 1015]) assert.equal(pcrProduct(put(at, "N"), true, inserting, reverse)!.sequence, expected, `N at ${at}`);
});

test("an ambiguous base in a primer leaves the product as it is", () => {
  const seq = puc19();
  const doc: SeqData = { name: "pUC19", description: "", circular: true, sequence: seq, features: [], primers: [], sources: [] };
  const forward: PlacedPrimer = { name: "F", bases: seq.slice(1000, 1030), start: 1000, end: 1029, strand: 1 };
  const reverse: PlacedPrimer = { name: "R", bases: reverseComplement(seq.slice(1200, 1230)), start: 1200, end: 1229, strand: -1 };
  const clean = pcrProduct(seq, true, forward, reverse)!;
  const put = (s: string, at: number, base: string) => s.slice(0, at) + base + s.slice(at + 1);
  // An N in the primer over a definite template base: the template's base stays.
  const nForward: PlacedPrimer = { ...forward, bases: put(forward.bases, 14, "N") };
  assert.equal(pcrProduct(seq, true, nForward, reverse)!.sequence, clean.sequence);
  const nReverse: PlacedPrimer = { ...reverse, bases: put(reverse.bases, 14, "N") };
  assert.equal(pcrProduct(seq, true, forward, nReverse)!.sequence, clean.sequence);
  assert.equal(productDocument(doc, pcrProduct(seq, true, nForward, nReverse)!).sequence, clean.sequence);
  // An N in the primer over an N in the template: nothing definite to write, the N stays.
  const t = put(put(seq, 1014, "N"), 1215, "N");
  const both = pcrProduct(t, true, nForward, nReverse)!;
  assert.equal(both.sequence, put(put(clean.sequence, 14, "N"), 215, "N"));
  assert.equal(productDocument({ ...doc, sequence: t }, both).sequence, both.sequence);
});

test("two primers that write the same insertion add it only once", () => {
  const seq = "TGTTACCGTCTCGATCAGGTCGTTGAATAGCCTATCCGTTACTGTTTTGATGAACCATGTGATCTTGGTTTAGCGGTACAA";
  const template: SeqData = { name: "template", description: "", circular: false, sequence: seq, features: [], primers: [], sources: [] };
  // A can be aligned on either side of the A already present. C has one placement.
  for (const base of ["A", "C"]) {
    const edited = seq.slice(0, 17) + base + seq.slice(17);
    const f = { name: "F", start: 0, end: 32, strand: 1 as const, bases: edited.slice(0, 34) };
    const r = { name: "R", start: 2, end: seq.length - 1, strand: -1 as const, bases: reverseComplement(edited.slice(2)) };
    const product = pcrProduct(seq, false, f, r)!;
    assert.equal(product.length, seq.length + 1);
    assert.equal(product.sequence, edited);
    assert.equal(productDocument(template, product).sequence, edited);
  }
});

test("design avoids a primer that binds twice, and reports one when it can't", () => {
  // A deterministic sequence with a 24 bp stretch repeated: a primer of up to 24 bases
  // starting at the second copy binds both, a longer one reaches unique bases.
  let a = 7;
  const base = () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return "ACGT"[(a >>> 16) % 4];
  };
  const run = (n: number) => Array.from({ length: n }, base).join("");
  const repeat = run(24);
  const seq = run(200) + repeat + run(200) + repeat + run(200);
  const at = 200 + 24 + 200;
  const pairs = designPairs(seq, false, at, at + 150, { ...DEFAULT_DESIGN, tmMin: 50, tmMax: 70, minLength: 18, maxLength: 30 });
  assert.ok(pairs.length > 0);
  assert.equal(pairs[0].forward.sites, 1);
  assert.ok(pairs[0].forward.bases.length > repeat.length, pairs[0].forward.bases);
  // Only lengths inside the repeat are allowed: the pair is still offered, saying it binds twice.
  const stuck = designPairs(seq, false, at, at + 150, { ...DEFAULT_DESIGN, tmMin: 50, tmMax: 70, minLength: 18, maxLength: 24 });
  assert.equal(stuck[0].forward.sites, 2);
  assert.equal(stuck[0].reverse.sites, 1);
});

test("moving the ends outward finds a better-balanced stretch", () => {
  const seq = puc19();
  // Pinned to this region, the forward primer sits on a GC-rich stretch and runs hot.
  const fixed = designPairs(seq, true, 74, 374)[0];
  assert.equal(fixed.forward.start, 74);
  assert.equal(fixed.forward.moved, 0);
  assert.ok(gcContent(fixed.forward.bases) > 65, `${gcContent(fixed.forward.bases)}`);
  assert.ok(fixed.forward.tm > 64, `${fixed.forward.tm}`);
  const moved = designPairs(seq, true, 74, 374, { ...DEFAULT_DESIGN, moveEnds: 25 })[0];
  assert.ok(moved.forward.moved > 0 && moved.forward.moved <= 25, `${moved.forward.moved}`);
  assert.ok(moved.score < fixed.score, `${moved.score} vs ${fixed.score}`);
  assert.ok(gcContent(moved.forward.bases) < 60, `${gcContent(moved.forward.bases)}`);
  assert.ok(Math.abs(moved.forward.tm - 60) < 1, `${moved.forward.tm}`);
  // Ends only move outward, so the region asked for is still amplified whole, and each
  // binding part is the template where it says it is.
  assert.equal(moved.forward.start, 74 - moved.forward.moved);
  assert.equal(moved.reverse.end, 374 + moved.reverse.moved);
  assert.equal(moved.forward.bases, seq.slice(moved.forward.start, moved.forward.end + 1));
  assert.equal(moved.reverse.bases, reverseComplement(seq.slice(moved.reverse.start, moved.reverse.end + 1)));
  // An end that gets a site stays on the region's edge, or the site would land away from it.
  const tailed = designPairs(seq, true, 74, 374, { ...DEFAULT_DESIGN, moveEnds: 25, forwardTail: "GCGCGAATTC" })[0];
  assert.equal(tailed.forward.moved, 0);
  assert.equal(tailed.forward.start, 74);
  // All else equal the pair nearest the region wins: where every stretch is the same one,
  // a moved primer is the same primer, so neither end leaves the region's edges.
  const flat = "A".repeat(200);
  const tie = designPairs(flat, false, 80, 140, { ...DEFAULT_DESIGN, tmMin: 20, tmMax: 70, moveEnds: 10 })[0];
  assert.equal(tie.forward.moved, 0);
  assert.equal(tie.reverse.moved, 0);
  assert.equal(tie.forward.start, 80);
  assert.equal(tie.reverse.end, 140);
});

test("design with the ends pinned is what it has always been", () => {
  const seq = puc19();
  const pinned = designPairs(seq, true, 74, 374, { tmMin: 58, tmMax: 62, minLength: 18, maxLength: 30 });
  assert.deepEqual(designPairs(seq, true, 74, 374, { ...DEFAULT_DESIGN, moveEnds: 0 }), pinned);
  assert.ok(pinned.length > 1);
  assert.ok(pinned.every(p => p.forward.start === 74 && p.forward.moved === 0 && p.reverse.end === 374 && p.reverse.moved === 0));
});

test("a moved end wraps across the origin of a circular sequence", () => {
  const seq = puc19();
  const n = seq.length;
  const bases = (start: number, end: number) => (start <= end ? seq.slice(start, end + 1) : seq.slice(start) + seq.slice(0, end + 1));
  // A region starting at the origin: the forward primer moves back over it.
  const f = designPairs(seq, true, 0, 400, { ...DEFAULT_DESIGN, moveEnds: 30 })[0].forward;
  assert.ok(f.moved > 0, `${f.moved}`);
  assert.ok(f.start > f.end, `${f.start}–${f.end}`);
  assert.equal(f.start, n - f.moved);
  assert.equal(f.bases, bases(f.start, f.end));
  // A region ending at the last base: the reverse primer moves forward over it.
  const r = designPairs(seq, true, 2200, n - 1, { ...DEFAULT_DESIGN, moveEnds: 30 })[0].reverse;
  assert.ok(r.moved > 0, `${r.moved}`);
  assert.ok(r.start > r.end, `${r.start}–${r.end}`);
  assert.equal(r.end, r.moved - 1);
  assert.equal(r.bases, reverseComplement(bases(r.start, r.end)));
});

test("on a linear sequence a moved end stops at the sequence's own end", () => {
  const lin = puc19().slice(60, 460);
  const n = lin.length;
  // Hard against both ends there is nowhere to move to: the pair with the ends pinned.
  const edge = designPairs(lin, false, 0, n - 1, { ...DEFAULT_DESIGN, moveEnds: 30 })[0];
  assert.deepEqual(edge, designPairs(lin, false, 0, n - 1)[0]);
  assert.equal(edge.forward.moved, 0);
  assert.equal(edge.reverse.moved, 0);
  // Five bases in, the forward primer can move five and no further.
  const near = designPairs(lin, false, 5, 300, { ...DEFAULT_DESIGN, moveEnds: 30 })[0];
  assert.ok(near.forward.moved <= 5, `${near.forward.moved}`);
  assert.equal(near.forward.start, 5 - near.forward.moved);
  assert.ok(near.forward.start >= 0 && near.forward.end < n);
  // Nothing wraps: a linear primer never crosses from one end to the other.
  const far = designPairs(lin, false, 20, n - 6, { ...DEFAULT_DESIGN, moveEnds: 30 })[0];
  assert.ok(far.reverse.moved <= 5, `${far.reverse.moved}`);
  assert.ok(far.forward.start < far.forward.end && far.reverse.start < far.reverse.end);
  assert.ok(far.reverse.end <= n - 1);
  assert.equal(far.forward.bases, lin.slice(far.forward.start, far.forward.end + 1));
});

// ---------- a CDS in a PCR product: its codons and its translation ----------
//
// A product that starts inside a CDS leaves it beginning mid-codon, so it has to say where
// its first whole codon is. What it must read is worked out here from the template's CDS
// parts alone, not with the code that reads a CDS, so that code is what these tests check.
// The bases are made up: coordinates and frames need no real sequence.

/** Made-up bases, the same on every run. */
function synthetic(length: number, seed: number): string {
  let x = seed;
  let s = "";
  while (s.length < length) {
    x = (x * 1103515245 + 12345) % 2147483648;
    s += "ACGT"[(x >> 16) & 3];
  }
  return s;
}

const T = 300;
const around = (p: number) => ((p % T) + T) % T;

interface Gene {
  label: string;
  circular: boolean;
  /** The CDS's parts as a file lists them, along the sequence; one may cross a circle's origin. */
  parts: Range[];
  strand: 1 | -1;
  codonStart?: string[];
}

const GENES: Gene[] = [
  { label: "forward", circular: false, parts: [{ start: 100, end: 198 }], strand: 1 },
  { label: "reverse", circular: false, parts: [{ start: 100, end: 198 }], strand: -1 },
  { label: "reverse in two parts", circular: false, parts: [{ start: 100, end: 130 }, { start: 160, end: 198 }], strand: -1 },
  { label: "forward from its third base", circular: false, parts: [{ start: 100, end: 198 }], strand: 1, codonStart: ["3"] },
  { label: "forward on a circle", circular: true, parts: [{ start: 100, end: 198 }], strand: 1 },
  { label: "reverse on a circle", circular: true, parts: [{ start: 100, end: 198 }], strand: -1 },
  { label: "forward across the origin", circular: true, parts: [{ start: 280, end: 78 }], strand: 1 },
  { label: "reverse across the origin", circular: true, parts: [{ start: 280, end: 78 }], strand: -1, codonStart: ["2"] }
];

const along = (g: Gene) => g.parts.flatMap(r => Array.from({ length: around(r.end - r.start) + 1 }, (_, i) => around(r.start + i)));
const reading = (g: Gene) => (g.strand === 1 ? along(g) : along(g).reverse());
const isIn = (w: Range) => (p: number) => (w.start <= w.end ? p >= w.start && p <= w.end : p >= w.start || p <= w.end);

const geneDoc = (g: Gene, sequence: string): SeqData => ({
  name: "template",
  description: "",
  circular: g.circular,
  sequence,
  features: [{
    id: "g",
    name: "g",
    type: "CDS",
    strand: g.strand,
    start: g.parts[0].start,
    end: g.parts[g.parts.length - 1].end,
    ...(g.parts.length > 1 ? { locations: g.parts } : {}),
    notes: { product: ["a made-up protein"], translation: ["MAAA"], ...(g.codonStart ? { codon_start: g.codonStart } : {}) },
    raw: {}
  }],
  primers: [],
  sources: []
});

/** The codons the gene reads as the template positions of their bases: whole ones from its /codon_start, and only those wholly inside `w`. */
function codonsWithin(g: Gene, w: Range): number[][] {
  const read = reading(g).slice(g.codonStart ? Number(g.codonStart[0]) - 1 : 0);
  const out: number[][] = [];
  for (let i = 0; i + 2 < read.length; i += 3) if (read.slice(i, i + 3).every(isIn(w))) out.push(read.slice(i, i + 3));
  return out;
}

/** The stretch that takes `lead` bases off the start of the gene's reading and `trail` off its end, with room to spare where nothing is cut. */
function windowAround(g: Gene, lead: number, trail: number): Range {
  const read = reading(g);
  const first = read[lead];
  const last = read[read.length - 1 - trail];
  return g.strand === 1
    ? { start: lead ? first : around(first - 12), end: trail ? last : around(last + 12) }
    : { start: trail ? last : around(last - 12), end: lead ? first : around(first + 12) };
}

/** A primer that pairs with the template on `start`…`end` (across the origin if `start` is past `end`), changing the top strand's base at `change.at` if asked. */
function primerOn(seq: string, start: number, end: number, strand: 1 | -1, change?: { at: number; base: string }): PlacedPrimer {
  const top = (start <= end ? seq.slice(start, end + 1) : seq.slice(start) + seq.slice(0, end + 1)).split("");
  if (change) top[(change.at - start + seq.length) % seq.length] = change.base;
  const bases = top.join("");
  return { name: strand === 1 ? "F" : "R", bases: strand === 1 ? bases : reverseComplement(bases), start, end, strand };
}

/** The product of two primers at the ends of `w`, as a document. */
function productOver(d: SeqData, w: Range): SeqData {
  const p = pcrProduct(d.sequence, d.circular, primerOn(d.sequence, w.start, around(w.start + 19), 1), primerOn(d.sequence, around(w.end - 19), w.end, -1));
  assert.ok(p, "the primers make a product");
  assert.deepEqual(p.span, w);
  return productDocument(d, p);
}

test("a PCR product that starts inside a CDS reads the codons the CDS had", () => {
  const seq = synthetic(T, 5);
  for (const g of GENES) {
    const template = geneDoc(g, seq);
    const all = codonsWithin(g, { start: 0, end: T - 1 });
    for (const lead of [0, 1, 2, 3, 4, 5, ...(g.parts.length > 1 ? [39, 40, 41, 42] : [])]) {
      for (const trail of [0, 1, 2, 4]) {
        const w = windowAround(g, lead, trail);
        const context = `${g.label}, ${lead} bases off its start and ${trail} off its end`;
        const product = productOver(template, w);
        const cds = product.features.find(f => f.id === "g");
        assert.ok(cds, `${context}: the CDS is kept`);
        assert.equal(product.sequence, basesIn(seq, w), `${context}: the bases`);
        const positions = codingPositions(cds, product.sequence.length).map(q => around(w.start + q));
        const codons: number[][] = [];
        for (let i = 0; i + 2 < positions.length; i += 3) codons.push(positions.slice(i, i + 3));
        const want = codonsWithin(g, w);
        assert.deepEqual(codons, want, `${context}: the codons it reads`);
        // The translation stays only while every whole codon is still there.
        assert.equal(cds.notes.translation !== undefined, want.length === all.length, `${context}: its translation`);
      }
    }
  }
});

test("a PCR product drops the translation of a CDS whose bases its primers change", () => {
  const seq = synthetic(T, 5);
  const gene = GENES[0];
  const template = geneDoc(gene, seq);
  const translation = (d: SeqData) => d.features.find(f => f.id === "g")!.notes.translation;
  const site = seq.slice(88, 121);
  const forward = (bases: string): PlacedPrimer => ({ name: "F", bases, start: 88, end: 120, strand: 1 });
  const reverse = primerOn(seq, 211, 230, -1);
  const other = (b: string) => (b === "A" ? "C" : "A");
  const product = (f: PlacedPrimer, r = reverse) => {
    const p = pcrProduct(seq, false, f, r);
    assert.ok(p, "the primers make a product");
    return { p, doc: productDocument(template, p) };
  };
  // The whole CDS, with a tail: the translation stays.
  const plain = product(forward(`GGATCC${site}`));
  assert.equal(plain.doc.sequence, `GGATCC${seq.slice(88, 231)}`);
  assert.deepEqual(translation(plain.doc), ["MAAA"]);
  // A base changed inside the CDS, one inserted, three skipped.
  const changed = site.slice(0, 15) + other(site[15]) + site.slice(16);
  const substituted = product(forward(changed));
  assert.equal(substituted.doc.sequence, changed + seq.slice(121, 231));
  assert.equal(translation(substituted.doc), undefined, "a substitution");
  const inserted = product(forward(`GGATCC${site.slice(0, 15)}TAG${site.slice(15)}`));
  assert.equal(inserted.doc.sequence, `GGATCC${site.slice(0, 15)}TAG${site.slice(15)}${seq.slice(121, 231)}`);
  assert.equal(translation(inserted.doc), undefined, "an insertion");
  const skipped = product(forward(site.slice(0, 15) + site.slice(18)));
  assert.equal(skipped.doc.sequence, site.slice(0, 15) + seq.slice(106, 231));
  assert.equal(translation(skipped.doc), undefined, "a skipped stretch");
  // The same on the reverse primer's side, inside the CDS.
  const reverseChanged = primerOn(seq, 191, 210, -1, { at: 195, base: other(seq[195]) });
  const fromReverse = product(primerOn(seq, 88, 120, 1), reverseChanged);
  assert.equal(translation(fromReverse.doc), undefined, "a change on the reverse primer");
  // A change outside the CDS leaves it alone.
  const outside = product(forward(site.slice(0, 5) + other(site[5]) + site.slice(6)));
  assert.equal(outside.doc.sequence[5], other(site[5]));
  assert.deepEqual(translation(outside.doc), ["MAAA"], "a change before the CDS");
});

test("primers that can't make one product make none", () => {
  const seq = synthetic(300, 9);
  const f = primerOn(seq, 40, 69, 1);
  const r = primerOn(seq, 100, 129, -1);
  assert.equal(pcrProduct(seq, false, f, r)?.length, 90);
  // A site off the sequence or not a whole position is no site, on either primer.
  for (const circular of [false, true]) {
    for (const bad of [{ start: -1 }, { end: 300 }, { start: Number.NaN }, { end: 2.5 }]) {
      assert.equal(pcrProduct(seq, circular, { ...f, ...bad }, r), null, `forward ${JSON.stringify(bad)}`);
      assert.equal(pcrProduct(seq, circular, f, { ...r, ...bad }), null, `reverse ${JSON.stringify(bad)}`);
    }
  }
  // A site that runs past the end of the sequence is only a site on a circle.
  const wrapped = primerOn(seq, 280, 10, 1);
  assert.equal(pcrProduct(seq, true, wrapped, primerOn(seq, 100, 119, -1))?.length, 140);
  assert.equal(pcrProduct(seq, false, wrapped, primerOn(seq, 100, 119, -1)), null);
  const wrappedReverse = primerOn(seq, 280, 10, -1);
  assert.equal(pcrProduct(seq, true, primerOn(seq, 200, 219, 1), wrappedReverse)?.length, 111);
  assert.equal(pcrProduct(seq, false, primerOn(seq, 200, 219, 1), wrappedReverse), null);
  // The reverse primer's site must end after the forward primer's, on a circle or not.
  for (const circular of [false, true]) assert.equal(pcrProduct(seq, circular, f, primerOn(seq, 45, 60, -1)), null, "a site that ends inside the other");
  // Behind the forward primer there is no product on a line; round a circle there is.
  assert.equal(pcrProduct(seq, false, primerOn(seq, 100, 129, 1), primerOn(seq, 20, 49, -1)), null);
  assert.equal(pcrProduct(seq, true, primerOn(seq, 100, 129, 1), primerOn(seq, 20, 49, -1))?.length, 250);
});

test("primers that disagree about a base make no product, and ones that agree write it once", () => {
  const seq = synthetic(300, 9);
  const [x, y] = [..."ACGT"].filter(b => b !== seq[55]);
  // Two different bases at one place.
  assert.equal(pcrProduct(seq, false, primerOn(seq, 40, 69, 1, { at: 55, base: x }), primerOn(seq, 50, 79, -1, { at: 55, base: y })), null);
  // The same two sites, each changing a base the other leaves as it is.
  const [u] = [..."ACGT"].filter(b => b !== seq[50]);
  const [v] = [..."ACGT"].filter(b => b !== seq[60]);
  assert.equal(pcrProduct(seq, false, primerOn(seq, 40, 69, 1, { at: 50, base: u }), primerOn(seq, 40, 69, -1, { at: 60, base: v })), null);
  // The same base, put by both primers: it is in the product once.
  const agreed = pcrProduct(seq, false, primerOn(seq, 40, 69, 1, { at: 55, base: x }), primerOn(seq, 50, 79, -1, { at: 55, base: x }));
  assert.ok(agreed);
  assert.equal(agreed.sequence, seq.slice(40, 55) + x + seq.slice(56, 80));
});
