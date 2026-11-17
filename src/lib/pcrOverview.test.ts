// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMMON_ENZYMES, findCutSites, scanSites, type EnzymeOptions, type SiteHit } from "./enzymes.ts";
import { digestSequence, fragmentSize } from "./gel.ts";
import { gcPercent } from "./labinfo.ts";
import { pcrProduct } from "./pcr.ts";
import {
  CHECK_FLANKS,
  digestName,
  HIGH_GC,
  MAX_LABEL_LANES,
  pickDigest,
  pickSite,
  productAdvice,
  productDigestSizes,
  productLabels,
  productOverview,
  suggestedDigests,
  tailSiteFlanks
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
  assert.equal(tailSiteFlanks(product.length, data.tailSites).length, 2);
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

test("a circular template's crossing-origin site is not invented across the linear product ends", () => {
  const template = "AATTC" + "ACGT".repeat(20) + "G";
  const f = { name: "F", start: 0, end: 19, strand: 1 as const, bases: template.slice(0, 20) };
  const r = { name: "R", start: template.length - 20, end: template.length - 1, strand: -1 as const, bases: reverseComplement(template.slice(-20)) };
  const product = pcrProduct(template, true, f, r)!;
  const data = productOverview(product, template, true, opts);
  assert.equal(data.templateCounts.get("EcoRI"), 1);
  assert.equal(data.hits.filter(s => s.enzyme === "EcoRI").length, 0);
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
  assert.equal(lanes, MAX_LABEL_LANES);
  assert.equal(crowds.length, 2);
  // Every site is either named or counted, once.
  assert.deepEqual(
    [...labels.map(p => p.site.id), ...crowds.flatMap(c => c.sites.map(m => m.site.id))].sort(),
    sites.map(s => s.id).sort()
  );
  for (const crowd of crowds) {
    const xs = crowd.sites.map(m => m.anchor);
    assert.ok(crowd.anchor >= Math.min(...xs) && crowd.anchor <= Math.max(...xs));
    assert.ok(crowd.sites.every(m => m.site.enzyme === crowd.sites[0].site.enzyme));
  }
  assert.ok(crowds[0].anchor < crowds[1].anchor);
  // Few enough sites still get every name, with no chip.
  const roomy = productLabels(sites.slice(0, 3), seq.length, 700, [60, 60, 60]);
  assert.equal(roomy.crowds.length, 0);
  assert.equal(roomy.labels.length, 3);
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
