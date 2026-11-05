// Primer library, PCR products and primer design. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { COMMON_SEQUENCING_PRIMERS, formatPrimerList, libraryHits, newEntries, parsePrimerList, type LibraryPrimer } from "./library.ts";
import { allProducts, pcrProduct, productDocument, type PlacedPrimer } from "./pcr.ts";
import { DEFAULT_DESIGN, designPairs, joinTail } from "./design.ts";
import { meltingTemp } from "./primers.ts";
import { basesIn, reverseComplement, type SeqData, type SeqFeature } from "./seqdata.ts";

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
