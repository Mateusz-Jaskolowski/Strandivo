// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMMON_ENZYMES, cutsBothSides, findCutSites, scanSites, type EnzymeOptions, type SiteHit } from "./enzymes.ts";
import { digestSequence, fragmentSize } from "./gel.ts";
import { gcPercent } from "./labinfo.ts";
import { pcrProduct } from "./pcr.ts";
import {
  CHECK_FLANKS,
  DISTINCT_DIGEST,
  digestName,
  HIGH_GC,
  MAX_LABEL_LANES,
  pickDigest,
  pickSite,
  productAdvice,
  productDigestSizes,
  productLabels,
  productOverview,
  SMALLEST_BAND,
  suggestedDigests,
  tailSiteFlanks,
  templateDigestSizes
} from "./pcrOverview.ts";
import { PCR_GUIDANCE } from "./pcrGuidance.ts";
import { reverseComplement, type SeqData } from "./seqdata.ts";
const opts: EnzymeOptions = { enzymeSource: "common", enzymeFilter: "unique6", labEnzymes: [], personalEnzymes: [] };
const doc = (sequence: string): SeqData => ({ name: "PCR", sequence, circular: false, features: [], primers: [], sources: [], description: "" });
const hit = (enzyme: string, cut: number, bottomCut = cut): SiteHit => ({ enzyme, cut, bottomCut, site: "AAAAAA", start: cut - 3, end: cut + 2, forward: true, overhang: "" });

test("final-product sites include both tails and differ from the template's counts", () => {
  const template = "ACGT".repeat(20);
  const f = { name: "F", start: 4, end: 23, strand: 1 as const, bases: "AAAAGAATTC" + template.slice(4, 24) };
  const r = { name: "R", start: 52, end: 71, strand: -1 as const, bases: "AAAAGGATCC" + reverseComplement(template.slice(52, 72)) };
  const product = pcrProduct(template, false, f, r)!;
  const data = productOverview(product, template, false, opts);
  const eco = data.sites.find(s => s.enzyme === "EcoRI")!;
  assert.equal(eco.start, 4);
  assert.equal(data.templateCounts.get("EcoRI") ?? 0, 0);
  assert.deepEqual(data.tails, { left: 10, right: 10 });
  assert.deepEqual(data.tailSites.map(s => s.enzyme).sort(), ["BamHI", "EcoRI"]);
  // 88 bp: EcoRI starts 4 bases in and BamHI ends 4 from the other end, each 78 from the far one.
  assert.equal(product.length, 88);
  assert.deepEqual(
    tailSiteFlanks(product.length, data.tailSites).map(x => [x.site.enzyme, x.left, x.right]),
    [["EcoRI", 4, 78], ["BamHI", 78, 4]]
  );
  const lab = productOverview(product, template, false, { ...opts, enzymeSource: "lab", labEnzymes: ["EcoRI"] });
  assert.deepEqual(
    lab.sites.map(s => s.enzyme),
    ["EcoRI"]
  );
  assert.deepEqual(
    lab.tailSites.map(s => s.enzyme),
    ["EcoRI"]
  );
  assert.ok(lab.digests.every(d => d.enzymes.every(e => e === "EcoRI")));
});

/** A linear 80 bp template, a forward primer from `fs` and a reverse one from `rs`, each 20 bases paired, with these tails. */
const tailed = (forwardTail: string, reverseTail: string, template = "ACGT".repeat(20), fs = 4, rs = 52) => {
  const f = { name: "F", start: fs, end: fs + 19, strand: 1 as const, bases: forwardTail + template.slice(fs, fs + 20) };
  const r = { name: "R", start: rs, end: rs + 19, strand: -1 as const, bases: reverseTail + reverseComplement(template.slice(rs, rs + 20)) };
  const product = pcrProduct(template, false, f, r)!;
  return { product, template, data: productOverview(product, template, false, opts) };
};
const flanksOf = (x: ReturnType<typeof tailed>) => tailSiteFlanks(x.product.length, x.data.tailSites).map(f => [f.site.enzyme, f.left, f.right]);

test("a site with 5 bases beyond it in a tail is listed, one with 6 is not, on either end", () => {
  // EcoRI after n bases in the left tail, BamHI before m bases in the right one.
  const case_ = (n: number, m: number) => flanksOf(tailed("A".repeat(n) + "GAATTC", "A".repeat(m) + "GGATCC"));
  assert.deepEqual(case_(5, 5), [["EcoRI", 5, 79], ["BamHI", 79, 5]]);
  assert.deepEqual(case_(5, 6), [["EcoRI", 5, 80]]);
  assert.deepEqual(case_(6, 5), [["BamHI", 80, 5]]);
  assert.deepEqual(case_(6, 6), []);
  assert.equal(CHECK_FLANKS, 6);
  // The same asked of the sites themselves: the smaller side counts, from either end.
  const at = (start: number, end: number) => [{ ...hit("X", start + 1), start, end }];
  assert.deepEqual(tailSiteFlanks(100, at(5, 10)).map(f => [f.left, f.right]), [[5, 89]]);
  assert.deepEqual(tailSiteFlanks(100, at(6, 11)), []);
  assert.deepEqual(tailSiteFlanks(100, at(80, 94)).map(f => [f.left, f.right]), [[80, 5]]);
  assert.deepEqual(tailSiteFlanks(100, at(80, 93)), []);
});

test("a site made across a tail's edge is a tail site and is listed", () => {
  // The tail TTAAGAATT ends in GAATT, and the template's next base is C: GAATTC, 4–9, half in each.
  const x = tailed("TTAAGAATT", "", "ACGT".repeat(20), 1, 52);
  assert.equal(x.template[1], "C");
  assert.deepEqual(x.data.tails, { left: 9, right: 0 });
  assert.equal(x.product.sequence.slice(4, 10), "GAATTC");
  assert.deepEqual(x.data.tailSites.map(s => [s.enzyme, s.start, s.end]), [["EcoRI", 4, 9]]);
  assert.deepEqual(flanksOf(x), [["EcoRI", 4, 70]]);
  // The same site wholly in the template is not one the tails made.
  const inside = tailed("AAAA", "", "ACGT".repeat(5) + "GAATTC" + "ACGT".repeat(14), 4, 52);
  assert.deepEqual(inside.data.sites.map(s => s.enzyme), ["EcoRI"]);
  assert.deepEqual(inside.data.tailSites, []);
});

test("the tails' sites are looked for under every filter, not the one chosen for the strip", () => {
  // EcoRI is in the left tail and also inside the template, so it cuts twice and a unique filter hides it.
  const template = "ACGT".repeat(10) + "GAATTC" + "ACGT".repeat(10) + "ACGTAC";
  const x = tailed("AAAAGAATTC", "AAAAGGATCC", template, 4, 40);
  assert.equal(x.data.hits.filter(h => h.enzyme === "EcoRI").length, 2);
  assert.deepEqual(x.data.sites.map(s => s.enzyme), ["BamHI"]);
  assert.deepEqual(x.data.tailSites.map(s => [s.enzyme, s.start]), [["EcoRI", 4], ["BsiWI", 61], ["BamHI", 66]]);
  for (const enzymeFilter of ["unique6", "unique", "unique2", "all"] as const) {
    const again = productOverview(x.product, template, false, { ...opts, enzymeFilter });
    assert.deepEqual(again.tailSites, x.data.tailSites, enzymeFilter);
  }
  // The list chosen still counts: a Lab list with only BamHI has no EcoRI to name.
  const lab = productOverview(x.product, template, false, { ...opts, enzymeSource: "lab", labEnzymes: ["BamHI"] });
  assert.deepEqual(lab.tailSites.map(s => s.enzyme), ["BamHI"]);
  assert.deepEqual(flanksOf(x), [["EcoRI", 4, 66], ["BamHI", 66, 4]]);
});

test("a circular template's crossing-origin site is not invented across the linear product ends", () => {
  const template = "AATTC" + "ACGT".repeat(20) + "G";
  const f = { name: "F", start: 0, end: 19, strand: 1 as const, bases: template.slice(0, 20) };
  const r = { name: "R", start: template.length - 20, end: template.length - 1, strand: -1 as const, bases: reverseComplement(template.slice(-20)) };
  const product = pcrProduct(template, true, f, r)!;
  const data = productOverview(product, template, true, opts);
  assert.equal(data.templateCounts.get("EcoRI"), 1);
  assert.equal(data.hits.filter(s => s.enzyme === "EcoRI").length, 0);
});

test("a product across a circular template's origin has positions of its own, and tails at both ends", () => {
  // 80 bp circle: the forward primer starts at 71 and runs over the origin, the reverse one ends at 50.
  const template = "ACGT".repeat(20);
  const f = { name: "F", start: 70, end: 9, strand: 1 as const, bases: "AAAAGAATTC" + template.slice(70) + template.slice(0, 10) };
  const r = { name: "R", start: 30, end: 49, strand: -1 as const, bases: "AAAAGGATCC" + reverseComplement(template.slice(30, 50)) };
  const product = pcrProduct(template, true, f, r)!;
  assert.equal(product.length, 80);
  assert.deepEqual(product.span, { start: 70, end: 49 });
  const data = productOverview(product, template, true, opts);
  assert.deepEqual(data.tails, { left: 10, right: 10 });
  // Positions are the product's, not the plasmid's: EcoRI in the left tail, BamHI in the right one.
  assert.deepEqual(
    data.sites.map(s => [s.enzyme, s.start, s.end]),
    [["EcoRI", 4, 9], ["BamHI", 70, 75]]
  );
  assert.equal(data.templateCounts.get("EcoRI") ?? 0, 0);
  assert.equal(data.templateCounts.get("BamHI") ?? 0, 0);
  // Each site's bases beyond it, to the nearer end: 4 either way, and 70 or 4 to the far one.
  assert.deepEqual(
    tailSiteFlanks(product.length, data.tailSites).map(x => [x.site.enzyme, x.left, x.right]),
    [["EcoRI", 4, 70], ["BamHI", 70, 4]]
  );
  // The repeat also makes BsiWI sites at the tails' edges: tail sites, but 9 bases from an end is more than the 6 asked, so not listed above.
  assert.deepEqual(data.tailSites.map(s => [s.enzyme, s.start, s.end]), [["EcoRI", 4, 9], ["BsiWI", 9, 14], ["BsiWI", 65, 70], ["BamHI", 70, 75]]);
  // The circle has a BsiWI every 4 bases, 20 round the origin; the linear product 15, as none is made across its ends.
  assert.equal(data.templateCounts.get("BsiWI"), 20);
  assert.equal(data.hits.filter(h => h.enzyme === "BsiWI").length, 15);
  // Both tails' cuts cut the 80 bases into pieces that add up.
  const both = data.hits.filter(h => h.enzyme === "EcoRI" || h.enzyme === "BamHI");
  assert.deepEqual(productDigestSizes(product.length, both), [66, 9, 5]);
});

test("digest sizes match the existing digest's top-strand lengths, including Type IIS and 3′ cuts", () => {
  const seq = "ACGT".repeat(20) + "GAATTCCCGAGCTCGGTCTCAAAAAACCCCCCCCCCC" + "ACGT".repeat(35);
  for (const enzymes of [["EcoRI"], ["SacI"], ["BsaI"], ["EcoRI", "SacI"], ["BsaI", "SacI"]]) {
    const hits = scanSites(seq, false, enzymes).filter(h => enzymes.includes(h.enzyme));
    const sizes = productDigestSizes(seq.length, hits);
    assert.deepEqual(sizes, digestSequence(doc(seq), enzymes).fragments.map(fragmentSize), enzymes.join());
    assert.equal(
      sizes!.reduce((a, b) => a + b, 0),
      seq.length
    );
  }
  assert.equal(productDigestSizes(100, [hit("BsaI", 98, 102)]), null);
  assert.equal(productDigestSizes(100, [hit("A", 30, 35), hit("B", 33, 38)]), null);
});

test("suggestions prefer one internal cutter, use pairs to rescue equal bands and respect membership", () => {
  assert.deepEqual(suggestedDigests(900, [hit("A", 600), hit("B", 450)], ["A", "B"])[0].enzymes, ["A"]);
  const pair = suggestedDigests(1000, [hit("A", 500), hit("B", 300), hit("B", 650)], ["A", "B"])[0];
  assert.deepEqual(pair.enzymes, ["A", "B"]);
  assert.deepEqual(pair.sizes, [350, 300, 200, 150]);
  assert.deepEqual(suggestedDigests(1000, [hit("A", 500)], []), []);
  // The approved pUC19 example, checked against the actual digest engine.
  const gb = readFileSync(new URL("../../testdata/e2e/pUC19-annotated.gb", import.meta.url), "utf8");
  const template = gb
    .split("ORIGIN")[1]
    .replace(/[^acgtn]/gi, "")
    .toUpperCase();
  const seq = "AAAACTCGAG" + template.slice(1625, 2486) + reverseComplement("ACATATG");
  const best = suggestedDigests(seq.length, scanSites(seq, false), COMMON_ENZYMES)[0];
  assert.deepEqual(best.enzymes, ["ScaI"]);
  assert.deepEqual(best.sizes, [564, 314]);
});

test("the suggestion's limits hold on both sides: 3 sites, 2–4 fragments and a score of 0.1", () => {
  const offered = (length: number, hits: SiteHit[], members: string[]) => suggestedDigests(length, hits, members).map(digestName);
  // At most 3 sites of an enzyme: three are offered, and four are not, even when two of them cut
  // in one place, so that the fragments (4) would be within the limit and only the sites are over.
  assert.deepEqual(offered(2000, [hit("A", 500), hit("A", 1000), hit("A", 1500)], ["A"]), ["A"]);
  assert.deepEqual(offered(2000, [hit("A", 500), hit("A", 1000), hit("A", 1000), hit("A", 1500)], ["A"]), []);
  // At least 2 fragments: one complete cut makes them, a cut at an end of the product makes none.
  assert.deepEqual(offered(2000, [hit("A", 700)], ["A"]), ["A"]);
  assert.deepEqual(offered(2000, [hit("A", 0)], ["A"]), []);
  assert.deepEqual(offered(2000, [hit("A", 2000)], ["A"]), []);
  // At most 4: a pair making 4 (400, 600, 200, 800) is offered, first as its fragments are far apart;
  // a pair making 5 is dropped, while each enzyme alone is still offered.
  assert.deepEqual(offered(2000, [hit("A", 1000), hit("B", 400), hit("B", 1200)], ["A", "B"]), ["A + B", "A", "B"]);
  assert.deepEqual(offered(2000, [hit("A", 1000), hit("A", 1500), hit("B", 400), hit("B", 1200)], ["A", "B"]), ["A", "B"]);
  // Far enough apart is a score of 0.1: the smallest fragment a tenth of the product, or each a tenth smaller than the one above.
  assert.equal(DISTINCT_DIGEST, 0.1);
  const score = (length: number, ...cuts: number[]) => suggestedDigests(length, cuts.map(c => hit("A", c)), ["A"])[0].score;
  assert.ok(score(2000, 1801) < DISTINCT_DIGEST, "199 of 2,000");
  assert.ok(score(2000, 1800) >= DISTINCT_DIGEST, "200 of 2,000");
  assert.ok(score(2000, 1799) >= DISTINCT_DIGEST, "201 of 2,000");
  assert.ok(score(3000, 1100, 2100) < DISTINCT_DIGEST, "1,100, 1,000 and 900: the first a ninth bigger than the next");
  assert.ok(score(3000, 1112, 2112) >= DISTINCT_DIGEST, "1,112, 1,000 and 888");
  // And a single enzyme under the bar leaves the pairs to be tried; over it, they are not.
  assert.equal(offered(2000, [hit("A", 1801), hit("B", 1000)], ["A", "B"]).includes("A + B"), true);
  assert.equal(offered(2000, [hit("A", 1800), hit("B", 1000)], ["A", "B"]).includes("A + B"), false);
});

test("an enzyme that cuts on both sides of its site is never suggested, as only its cut after the site is found", () => {
  assert.equal(cutsBothSides("BcgI"), true);
  assert.equal(cutsBothSides("EcoRI"), false);
  assert.equal(cutsBothSides("NoSuchI"), false);
  // One BcgI site (CGANNNNNNTGC) in 612 bp: REBASE's cuts make 290 + 34 + 288, the scan alone 324 + 288.
  const bcgI = "CGA" + "AAAAAA" + "TGC";
  const seq = "AT".repeat(150) + bcgI + "AT".repeat(150);
  assert.equal(seq.length, 612);
  const hits = scanSites(seq, false, ["BcgI"]).filter(h => h.enzyme === "BcgI");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].cut, 324);
  assert.deepEqual(suggestedDigests(seq.length, hits, ["BcgI"]), []);
  // In a Lab list with an ordinary enzyme beside it, only the ordinary one is offered, alone or in a pair.
  const mixed = "AT".repeat(100) + "GAATTC" + "AT".repeat(100) + bcgI + "AT".repeat(100);
  const found = scanSites(mixed, false, ["BcgI", "EcoRI"]).filter(h => h.enzyme === "BcgI" || h.enzyme === "EcoRI");
  assert.deepEqual(new Set(found.map(h => h.enzyme)), new Set(["BcgI", "EcoRI"]));
  const offered = suggestedDigests(mixed.length, found, ["BcgI", "EcoRI"]);
  assert.deepEqual(offered.map(digestName), ["EcoRI"]);
  // The overview offers the same through its own list.
  const product = pcrProduct(seq, false, { name: "F", start: 0, end: 19, strand: 1, bases: seq.slice(0, 20) }, { name: "R", start: 592, end: 611, strand: -1, bases: reverseComplement(seq.slice(592)) })!;
  const overview = productOverview(product, seq, false, { ...opts, enzymeSource: "lab", enzymeFilter: "all", labEnzymes: ["BcgI"] });
  assert.equal(overview.sites.length, 1);
  assert.deepEqual(overview.digests, []);
});

test("a lab list's names are matched as the drawn sites match them, whatever their case", () => {
  const seq = "AT".repeat(150) + "GAATTC" + "AT".repeat(100);
  const hits = scanSites(seq, false, ["EcoRI"]).filter(h => h.enzyme === "EcoRI");
  assert.equal(hits.length, 1);
  assert.deepEqual(suggestedDigests(seq.length, hits, ["EcoRI"]).map(digestName), ["EcoRI"]);
  assert.deepEqual(suggestedDigests(seq.length, hits, ["ecori"]).map(digestName), ["EcoRI"]);
  assert.deepEqual(suggestedDigests(seq.length, hits, ["ECORI"]).map(digestName), ["EcoRI"]);
  // Through the overview, the list typed or imported in lower case draws the site and suggests its digest.
  const product = pcrProduct(seq, false, { name: "F", start: 0, end: 19, strand: 1, bases: seq.slice(0, 20) }, { name: "R", start: seq.length - 20, end: seq.length - 1, strand: -1, bases: reverseComplement(seq.slice(-20)) })!;
  const overview = productOverview(product, seq, false, { ...opts, enzymeSource: "lab", enzymeFilter: "all", labEnzymes: ["ecori"] });
  assert.deepEqual(overview.sites.map(s => s.enzyme), ["EcoRI"]);
  assert.deepEqual(overview.digests.map(digestName), ["EcoRI"]);
});

test("the template's counts are kept for one template, but follow the list when it changes between calls", () => {
  // BcgI and PaqCI are in no common list, so each is counted only when a list names it. The cache
  // is keyed by the extra enzymes the list brings, and one template is asked again for each list.
  const seq = "AT".repeat(100) + "CGA" + "AAAAAA" + "TGC" + "AT".repeat(100) + "CACCTGC" + "AT".repeat(50) + "CACCTGC" + "AT".repeat(100);
  const product = pcrProduct(seq, false, { name: "F", start: 0, end: 19, strand: 1, bases: seq.slice(0, 20) }, { name: "R", start: seq.length - 20, end: seq.length - 1, strand: -1, bases: reverseComplement(seq.slice(-20)) })!;
  const counts = (labEnzymes: string[], enzymeSource: "lab" | "common" = "lab") => {
    const { templateCounts } = productOverview(product, seq, false, { ...opts, enzymeSource, labEnzymes });
    return [templateCounts.get("BcgI") ?? 0, templateCounts.get("PaqCI") ?? 0];
  };
  assert.deepEqual(counts(["BcgI"]), [1, 0]);
  assert.deepEqual(counts(["PaqCI"]), [0, 2]);
  assert.deepEqual(counts(["BcgI", "PaqCI"]), [1, 2]);
  assert.deepEqual(counts([], "common"), [0, 0]);
  // And back to the first, which was replaced in the cache and is counted again.
  assert.deepEqual(counts(["BcgI"]), [1, 0]);
  // The same list asked again is the same answer.
  assert.deepEqual(counts(["BcgI"]), [1, 0]);
});

test("no digest of fragments too small for a gel is called far enough apart, but pairs are still tried", () => {
  // Read from the ladders, so a ladder with a smaller band moves it.
  assert.equal(SMALLEST_BAND, 100);
  const gb = readFileSync(new URL("../../testdata/e2e/pUC19-annotated.gb", import.meta.url), "utf8");
  const template = gb
    .split("ORIGIN")[1]
    .replace(/[^acgtn]/gi, "")
    .toUpperCase();
  // M13 forward and reverse on pUC19: 103 bp across the multiple cloning site.
  const f = { name: "M13 fwd", start: 378, end: 394, strand: 1 as const, bases: "GTAAAACGACGGCCAGT" };
  const r = { name: "M13 rev", start: 464, end: 480, strand: -1 as const, bases: "CAGGAAACAGCTATGAC" };
  const product = pcrProduct(template, true, f, r)!;
  assert.equal(product.length, 103);
  const m13 = suggestedDigests(product.length, scanSites(product.sequence, false), COMMON_ENZYMES);
  // BamHI's 64 + 39 bp is still offered, as the best of what there is, but not as one to trust.
  assert.deepEqual(m13[0].enzymes, ["BamHI"]);
  assert.deepEqual(m13[0].sizes, [64, 39]);
  assert.ok(m13.length > 0 && m13.every(d => d.score < DISTINCT_DIGEST), JSON.stringify(m13.map(d => [digestName(d), d.score])));
  // A fragment of exactly the smallest band is one a ladder shows, so it counts.
  assert.ok(suggestedDigests(300, [hit("A", 100)], ["A"])[0].score >= DISTINCT_DIGEST);
  assert.ok(suggestedDigests(300, [hit("A", 99)], ["A"])[0].score < DISTINCT_DIGEST);
  // A 20 bp piece is far from the others in size, but with every single enzyme unreadable pairs are tried.
  const tried = suggestedDigests(200, [hit("A", 60), hit("B", 140)], ["A", "B"]);
  assert.deepEqual(tried.map(digestName), ["A", "B", "A + B"]);
  assert.ok(tried.every(d => d.score < DISTINCT_DIGEST));
  // A long product's fragments are all well above it, so they are judged as before: AmpR's ScaI.
  const ampR = "AAAACTCGAG" + template.slice(1625, 2486) + reverseComplement("ACATATG");
  const best = suggestedDigests(ampR.length, scanSites(ampR, false), COMMON_ENZYMES)[0];
  assert.deepEqual(best.enzymes, ["ScaI"]);
  assert.deepEqual(best.sizes, [564, 314]);
  assert.ok(best.score >= DISTINCT_DIGEST);
});

test("the source chart's exact ends and length limits are held, including mixed OneTaq ends", () => {
  assert.deepEqual(PCR_GUIDANCE.q5.maxLength, { simple: 20000, complex: 10000 });
  assert.deepEqual(PCR_GUIDANCE.phusion.maxLength, { simple: 20000, complex: 10000 });
  assert.equal(PCR_GUIDANCE.onetaq.maxLength.simple, 6000);
  assert.equal(PCR_GUIDANCE.taq.maxLength.complex, 5000);
  assert.equal(PCR_GUIDANCE.q5.ends, "Blunt");
  assert.equal(PCR_GUIDANCE.phusion.ends, "Blunt");
  assert.equal(PCR_GUIDANCE.onetaq.ends, "3′ A overhangs or blunt");
  assert.equal(PCR_GUIDANCE.taq.ends, "3′ A overhangs");
  assert.equal(PCR_GUIDANCE["q5u"], undefined);
  assert.equal(CHECK_FLANKS, 6);
  assert.equal(tailSiteFlanks(100, [{ ...hit("X", 20), start: 6, end: 12 }]).length, 0);
});

test("length warnings follow NEB's simple and complex templates, where a colony is E. coli", () => {
  assert.deepEqual(productAdvice("q5", "plasmid", 20000, 50), []);
  // A plasmid and a colony are simple, so only past 20 kb; genomic DNA or cDNA past 10 kb.
  assert.deepEqual(productAdvice("q5", "colony", 20000, 50), []);
  assert.deepEqual(productAdvice("q5", "complex", 10000, 50), []);
  assert.match(productAdvice("q5", "complex", 10001, 50)[0], /10,000 bp maximum for Q5 \(M0491\)/);
  assert.match(productAdvice("q5", "colony", 20001, 50)[0], /20,000 bp/);
  assert.match(productAdvice("taq", "plasmid", 5001, 50)[0], /5,000 bp maximum for Taq \(M0273\)/);
  // A polymerase whose chart row has not been read gets no length warning rather than a guess.
  assert.deepEqual(productAdvice("q5u", "plasmid", 50000, 50), []);
});

test("the GC warning is the whole product's, at NEB's 65%, and names an enhancer only where there is one", () => {
  assert.equal(HIGH_GC, 65);
  // The threshold is NEB's 65%, compared as counted: nothing below it warns, however it rounds.
  assert.deepEqual(productAdvice("q5", "plasmid", 1000, 64.4), []);
  assert.deepEqual(productAdvice("q5", "plasmid", 1000, 64.6), []);
  assert.deepEqual(productAdvice("q5", "plasmid", 1000, 64.99), []);
  const q5 = productAdvice("q5", "plasmid", 1000, 65);
  assert.equal(q5.length, 1);
  assert.match(q5[0], /^The product is 65\.0% GC, which can be hard to amplify\./);
  assert.match(q5[0], /Q5 High GC Enhancer/);
  // One decimal, as the header above the strip writes it.
  assert.match(productAdvice("q5", "plasmid", 1000, 65.04)[0], /^The product is 65\.0% GC/);
  assert.match(productAdvice("q5", "plasmid", 1000, 67.26)[0], /^The product is 67\.3% GC/);
  // Phusion has no enhancer in the chart, so the sentence stops at the fact.
  assert.equal(productAdvice("phusion", "plasmid", 1000, 70)[0], "The product is 70.0% GC, which can be hard to amplify.");
  // The GC sentence is about the product, so a polymerase with no row gets it too, without an enhancer.
  assert.equal(productAdvice("q5u", "plasmid", 1000, 70)[0], "The product is 70.0% GC, which can be hard to amplify.");
  assert.equal(productAdvice("q5u", "plasmid", 1000, 70).length, 1);
});

test("the overview's GC is the whole product's, not the highest stretch of it", () => {
  // 6,000 bp of A and T with a G/C block of 120 in the middle, which a window on the strip sees as all GC.
  let seed = 7;
  const at = (n: number) => Array.from({ length: n }, () => ((seed = (seed * 1103515245 + 12345) % 2147483648), (seed >> 16) & 1 ? "A" : "T")).join("");
  const template = at(2940) + "GC".repeat(60) + at(2940);
  assert.equal(template.length, 6000);
  const f = { name: "F", start: 0, end: 19, strand: 1 as const, bases: template.slice(0, 20) };
  const r = { name: "R", start: 5980, end: 5999, strand: -1 as const, bases: reverseComplement(template.slice(5980)) };
  const product = pcrProduct(template, false, f, r)!;
  assert.equal(product.length, 6000);
  const data = productOverview(product, template, false, opts);
  assert.equal(data.gcPercent, gcPercent(product.sequence));
  assert.ok(Math.abs(data.gcPercent - 2) < 1e-9, String(data.gcPercent));
  // The strip does see the block as all GC, and that is not what the warning is about.
  assert.equal(Math.max(...data.gc), 1);
  assert.deepEqual(productAdvice("q5", "plasmid", product.length, data.gcPercent), []);
  // Another product from the same template, over the block and 20 bases either side: 75% GC, which does warn.
  const inner = pcrProduct(template, false, { ...f, start: 2920, end: 2939, bases: template.slice(2920, 2940) }, { ...r, start: 3060, end: 3079, bases: reverseComplement(template.slice(3060, 3080)) })!;
  assert.equal(inner.length, 160);
  const innerData = productOverview(inner, template, false, opts);
  assert.equal(innerData.gcPercent, gcPercent(inner.sequence));
  assert.ok(Math.abs(innerData.gcPercent - 75) < 1e-9, String(innerData.gcPercent));
  assert.match(productAdvice("q5", "plasmid", inner.length, innerData.gcPercent)[0], /^The product is 75\.0% GC/);
});

test("the digest and site shown are kept while they are still offered", () => {
  const digests = suggestedDigests(1000, [hit("A", 600), hit("B", 450)], ["A", "B"]);
  assert.deepEqual(digests.map(digestName), ["A", "B"]);
  assert.equal(digestName(pickDigest(digests, "B")!), "B");
  // A choice that is no longer offered falls back to the best, and an empty list to nothing.
  assert.equal(digestName(pickDigest(digests, "C")!), "A");
  assert.equal(pickDigest([], "A"), null);
  const sites = findCutSites("GAATTCAAAAAAAAAAAAAAAAAAAAGGATCC", false, { ...opts, enzymeFilter: "all" });
  const eco = sites.find(s => s.enzyme === "EcoRI")!;
  const bam = sites.find(s => s.enzyme === "BamHI")!;
  assert.equal(pickSite(sites, bam.id, null), bam);
  // With nothing clicked, a site of the suggested digest comes first, else the leftmost.
  assert.equal(pickSite(sites, "", { enzymes: ["BamHI"], sizes: [], score: 0 }), bam);
  // The view keeps only a click, so each digest picked gets its own site until one is clicked, which then holds.
  assert.equal(pickSite(sites, "", { enzymes: ["EcoRI"], sizes: [], score: 0 }), eco);
  assert.equal(pickSite(sites, bam.id, { enzymes: ["EcoRI"], sizes: [], score: 0 }), bam);
  assert.equal(pickSite(sites, "gone", null), eco);
  assert.equal(pickSite([], "", null), null);
});

test("sites past the last lane are counted where they cut, one chip for each crowd", () => {
  // Two multiple cloning sites, ten enzymes deep each, at opposite ends of a long product.
  const seq = "GAATTC".repeat(10) + "T".repeat(500) + "GGATCC".repeat(10);
  const sites = findCutSites(seq, false, { ...opts, enzymeFilter: "all" }).filter(s => s.enzyme === "EcoRI" || s.enzyme === "BamHI");
  const { labels, crowds, lanes } = productLabels(
    sites,
    seq.length,
    700,
    sites.map(() => 60)
  );
  // Five lanes, written out: the constant moving must fail this, not follow it.
  assert.equal(MAX_LABEL_LANES, 5);
  assert.equal(lanes, 5);
  assert.equal(crowds.length, 2);
  // Every site is either named or counted, once.
  assert.deepEqual(
    [...labels.map(p => p.site.id), ...crowds.flatMap(c => c.sites.map(m => m.site.id))].sort(),
    sites.map(s => s.id).sort()
  );
  for (const crowd of crowds) {
    const xs = crowd.sites.map(m => m.anchor);
    assert.equal(crowd.anchor, xs.reduce((sum, x) => sum + x, 0) / xs.length);
    assert.ok(crowd.sites.every(m => m.site.enzyme === crowd.sites[0].site.enzyme));
  }
  assert.ok(crowds[0].anchor < crowds[1].anchor);
  // Few enough sites still get every name, with no chip.
  const roomy = productLabels(sites.slice(0, 3), seq.length, 700, [60, 60, 60]);
  assert.equal(roomy.crowds.length, 0);
  assert.equal(roomy.labels.length, 3);
});

test("the chip over a crowd sits at the mean of the anchors it counts, not at its first or last", () => {
  // Five sites cut together fill the five lanes; three more cut at 110, 120 and 131 of 1,000, so
  // they have no lane and are one crowd, as they are within 40 px of each other.
  const site = (enzyme: string, cut: number) => ({ id: `${enzyme}@${cut - 3}`, enzyme, site: "", start: cut - 3, end: cut + 2, cut, bottomCut: cut, forward: true, overhang: "", cuts: 1 });
  const named = [100, 101, 102, 103, 104].map((cut, i) => site(`N${i}`, cut));
  const crowded = [site("A", 110), site("B", 120), site("C", 131)];
  const { labels, crowds, lanes } = productLabels([...named, ...crowded], 1000, 1000, [...named, ...crowded].map(() => 60));
  assert.equal(lanes, 5);
  assert.deepEqual(labels.map(l => l.site.enzyme).sort(), ["N0", "N1", "N2", "N3", "N4"]);
  assert.equal(crowds.length, 1);
  assert.deepEqual(crowds[0].sites.map(m => m.anchor), [110, 120, 131]);
  assert.equal(crowds[0].anchor, (110 + 120 + 131) / 3);
  // A fourth, past 40 px from the others (and with a name wide enough to find no lane), is a crowd of its own.
  const wide = [...named, ...crowded, site("D", 200)];
  const far = productLabels(wide, 1000, 1000, wide.map(s => (s.enzyme === "D" ? 200 : 60)));
  assert.deepEqual(far.crowds.map(c => [c.sites.length, c.anchor]), [[3, (110 + 120 + 131) / 3], [1, 200]]);
});

test("product label lanes stay inside their bounds without overlapping peers", () => {
  const sites = findCutSites("GAATTC".repeat(10), false, { ...opts, enzymeFilter: "all" }).filter(s => s.enzyme === "EcoRI");
  for (const width of [260, 700]) {
    const { labels: placed } = productLabels(
      sites,
      60,
      width,
      sites.map(() => 60)
    );
    for (const p of placed) {
      assert.ok(p.left >= 0 && p.left + p.width <= width);
      for (const q of placed) if (p !== q && p.row === q.row) assert.ok(p.left + p.width < q.left || q.left + q.width < p.left);
    }
  }
});

test("the template's own digest is the lane that runs beside the product's", () => {
  const pad = "ACGT".repeat(25); // 100 bp holding no site of either enzyme
  const sequence = pad + "GAATTC" + pad + "GAATTC" + pad;
  const circular: SeqData = { ...doc(sequence), circular: true };
  const sizes = templateDigestSizes(circular, ["EcoRI"]);
  // Kept while the template and the enzymes are the same, as the dialog is drawn again on every change.
  assert.equal(templateDigestSizes(circular, ["EcoRI"]), sizes);
  assert.equal(sizes.length, 2);
  assert.equal(
    sizes.reduce((a, b) => a + b, 0),
    sequence.length
  );
  // Cut once, a plasmid is only opened up: one fragment, its whole length.
  assert.deepEqual(templateDigestSizes({ ...doc(pad + "GAATTC" + pad), circular: true }, ["EcoRI"]), [206]);
  // A site a primer's 5′ tail brought into the product is not in the template, so nothing cuts.
  assert.deepEqual(templateDigestSizes(circular, ["BamHI"]), []);
  // A linear template the enzymes leave whole comes back as itself, which the lane for it takes for uncut.
  assert.deepEqual(templateDigestSizes(doc(pad), ["EcoRI"]), [pad.length]);
});
