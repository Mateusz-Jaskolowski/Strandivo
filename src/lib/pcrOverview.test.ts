// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COMMON_ENZYMES, findCutSites, scanSites, type EnzymeOptions, type SiteHit } from "./enzymes.ts";
import { digestSequence, fragmentSize } from "./gel.ts";
import { pcrProduct } from "./pcr.ts";
import { CHECK_FLANKS, productAdvice, productDigestSizes, productLabels, productOverview, suggestedDigests, tailSiteFlanks } from "./pcrOverview.ts";
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
  assert.deepEqual(productAdvice("q5", "plasmid", 20000, false), []);
  assert.match(productAdvice("q5", "complex", 10001, false)[0], /10,000 bp/);
  assert.match(productAdvice("q5", "colony", 10001, false)[0], /10,000 bp/);
  assert.match(productAdvice("q5", "plasmid", 100, true)[0], /Q5 High GC Enhancer with Q5 Reaction Buffer/);
  assert.match(productAdvice("unread", "plasmid", 100, true)[0], /no enhancer guidance/);
  assert.equal(CHECK_FLANKS, 6);
  assert.equal(tailSiteFlanks(100, [{ ...hit("X", 20), start: 6, end: 12 }]).length, 0);
});

test("product label lanes stay inside their bounds without overlapping peers", () => {
  const sites = findCutSites("GAATTC".repeat(10), false, { ...opts, enzymeFilter: "all" }).filter(s => s.enzyme === "EcoRI");
  for (const width of [260, 700]) {
    const placed = productLabels(
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
