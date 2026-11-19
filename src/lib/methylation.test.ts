// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { cutCounts, reactionEnzymes, rescanSites, scanSites, selectSites, siteCounts, type EnzymeOptions } from "./enzymes.ts";
import { digestSequence, fragmentSize } from "./gel.ts";
import type { SeqData } from "./seqdata.ts";
import { canOverlap, cutCountText, enzymeMethylation, hostMethylation, methylationSummary, methylationKey, methylationNote, PCR_DNA, siteMethylation, type DnaMethylation, type SiteMethylation } from "./methylation.ts";
import { findStrain, strainKey } from "./strains.ts";

const ASSUMED = hostMethylation("");

/** What methylation does to each site of one enzyme, in order along the sequence. */
function sites(sequence: string, enzyme: string, dna: DnaMethylation = ASSUMED, circular = false): (SiteMethylation | null)[] {
  return scanSites(sequence, circular, [enzyme])
    .filter(h => h.enzyme === enzyme)
    .sort((a, b) => a.start - b.start)
    .map(h => siteMethylation(sequence, circular, h, dna));
}
const blocked = (sequence: string, enzyme: string, dna?: DnaMethylation, circular?: boolean) => sites(sequence, enzyme, dna, circular).map(m => m?.blocked ?? false);

test("of two XbaI sites, only the one running on into GATC is blocked", () => {
  const seq = "TTTTTCTAGATCTTTTTTTTTTTCTAGATTTTT";
  assert.deepEqual(blocked(seq, "XbaI"), [true, false]);
  const [first, second] = sites(seq, "XbaI");
  assert.equal(second, null);
  assert.equal(methylationNote(first!, "XbaI"), "Won't cut: Dam methylation (GATC overlaps the site). Assumed dam⁺ strain.");
  // GATC before the site counts as well as after it (the other strand's A).
  assert.deepEqual(blocked("TTTTGATCTAGATTTT", "XbaI"), [true]);
});

test("a GATC across the origin of a circular sequence blocks the site it overlaps", () => {
  // The site ends the sequence and the GATC's last two bases start it.
  const ending = "TC" + "T".repeat(30) + "TCTAGA";
  assert.deepEqual(blocked(ending, "XbaI", ASSUMED, true), [true]);
  assert.deepEqual(blocked(ending, "XbaI", ASSUMED, false), [false]);
  // The site itself crosses the origin.
  const crossing = "AGATC" + "T".repeat(30) + "TCT";
  const hit = scanSites(crossing, true, ["XbaI"]).find(h => h.enzyme === "XbaI")!;
  assert.ok(hit.start > hit.end);
  assert.deepEqual(blocked(crossing, "XbaI", ASSUMED, true), [true]);
});

test("ClaI is blocked only when a GATC overlaps it", () => {
  assert.deepEqual(blocked("TTTATCGATCTTT", "ClaI"), [true]);
  assert.deepEqual(blocked("TTTGATCGATTTT", "ClaI"), [true]);
  assert.deepEqual(blocked("TTTGATCGATCTT", "ClaI"), [true]);
  assert.deepEqual(blocked("TTTATCGATTTTT", "ClaI"), [false]);
});

test("BamHI and BglII cut although their sites hold a GATC", () => {
  assert.deepEqual(sites("TTTGGATCCTTT", "BamHI"), [null]);
  assert.deepEqual(sites("TTTAGATCTTTT", "BglII"), [null]);
});

test("BspHI and BsaWI depend on the bases around them", () => {
  // GATC on one side: reports disagree, so it is said to vary but still cuts.
  const [one] = sites("TTTTCATGATCTT", "BspHI");
  assert.equal(one!.blocked, false);
  assert.equal(one!.effects[0].verdict, "disagree");
  assert.equal(methylationNote(one!, "BspHI"), "Reports disagree on whether Dam methylation blocks this site. Assumed dam⁺ strain.");
  // GATC on both sides: blocked.
  assert.deepEqual(blocked("TTGATCATGATCTT", "BspHI"), [true]);
  assert.deepEqual(sites("TTTTCATGATTTT", "BspHI"), [null]);
  // BsaWI's WCCGGW cuts with its A methylated, read from either strand.
  assert.deepEqual(sites("TTACCGGATCTT", "BsaWI"), [null]);
  assert.deepEqual(sites("TTGATCCGGTTT", "BsaWI"), [null]);
  assert.deepEqual(sites("TGATCCGGATCT", "BsaWI"), [null]);
});

test("BclI and MboI are blocked by the GATC in their own sites", () => {
  assert.deepEqual(blocked("TTTGATCATT", "BclI"), [true]);
  assert.deepEqual(blocked("TTTGATCTTT", "MboI"), [true]);
});

test("DpnII is blocked where Sau3AI cuts", () => {
  assert.deepEqual(blocked("TTTGATCTTT", "DpnII"), [true]);
  assert.deepEqual(sites("TTTGATCTTT", "Sau3AI"), [null]);
});

test("Dcm blocks StuI where a CCWGG overlaps it, unless the strain lacks Dcm", () => {
  const seq = "TTTAGGCCTGGTT";
  const [m] = sites(seq, "StuI");
  assert.equal(m!.blocked, true);
  assert.equal(methylationNote(m!, "StuI"), "Won't cut: Dcm methylation (CCWGG overlaps the site). Assumed dcm⁺ strain.");
  assert.deepEqual(sites(seq, "StuI", hostMethylation("BL21(DE3)")), [null]);
  assert.deepEqual(sites("TTTAGGCCTTTT", "StuI"), [null]);
});

test("a site on the reverse strand is read along its own strand", () => {
  // MboII's GAAGA, blocked with its last A methylated (GAAGATC). It cuts 8 bases past its site.
  const pad = "T".repeat(12);
  assert.deepEqual(blocked(pad + "GAAGATC" + pad, "MboII"), [true]);
  assert.deepEqual(blocked(pad + "GATCTTC" + pad, "MboII"), [true]);
  assert.deepEqual(blocked(pad + "GAAGATT" + pad, "MboII"), [false]);
});

test("DpnI cuts only Dam-methylated DNA and is never called blocked by methylation", () => {
  assert.deepEqual(sites("TTTGATCTTT", "DpnI"), [null]);
  const [pcr] = sites("TTTGATCTTT", "DpnI", PCR_DNA);
  assert.equal(pcr!.blocked, true);
  assert.equal(pcr!.effects[0].verdict, "needs");
  assert.equal(methylationNote(pcr!, "DpnI"), "Won't cut: DpnI needs Dam methylation, which a PCR product lacks.");
  const [jm] = sites("TTTGATCTTT", "DpnI", hostMethylation("JM110"));
  assert.equal(methylationNote(jm!, "DpnI"), "Won't cut: DpnI needs Dam methylation. JM110 is dam⁻.");
  const [unknown] = sites("TTTGATCTTT", "DpnI", hostMethylation("MyStrain"));
  assert.equal(unknown!.blocked, false);
  assert.equal(methylationNote(unknown!, "DpnI"), "Cuts only if the DNA has Dam methylation. “MyStrain” isn't a strain Strandivo knows.");
});

test("PCR products and dam⁻ dcm⁻ strains block nothing", () => {
  const seq = "TTTTTCTAGATCTTTTAGGCCTGGTT";
  for (const dna of [PCR_DNA, hostMethylation("JM110"), hostMethylation("scs110")]) {
    assert.deepEqual(sites(seq, "XbaI", dna), [null]);
    assert.deepEqual(sites(seq, "StuI", dna), [null]);
  }
});

test("a strain it doesn't know says what would happen, and predicts nothing", () => {
  const dna = hostMethylation("Mach1-T1 home-made");
  assert.deepEqual(dna, { dam: null, dcm: null, from: "unknown", name: "Mach1-T1 home-made" });
  const [m] = sites("TTTTTCTAGATCTTTT", "XbaI", dna);
  assert.equal(m!.blocked, false);
  assert.equal(methylationNote(m!, "XbaI"), "Won't cut if the DNA has Dam methylation (GATC overlaps the site). “Mach1-T1 home-made” isn't a strain Strandivo knows.");
});

test("a known strain is named in the note", () => {
  const [m] = sites("TTTTTCTAGATCTTTT", "XbaI", hostMethylation("dh5a"));
  assert.equal(methylationNote(m!, "XbaI"), "Won't cut: Dam methylation (GATC overlaps the site). DH5α is dam⁺.");
});

test("strains are found whatever their case, spacing and Greek letters", () => {
  for (const text of ["DH5α", "dh5 alpha", "E. coli DH5a", "DH5-Alpha"]) assert.equal(findStrain(text)?.name, "DH5α", text);
  for (const text of ["BL21(DE3)", "bl21 (de3)", "BL21 DE3"]) assert.equal(findStrain(text)?.name, "BL21(DE3)", text);
  assert.equal(findStrain("NEB 5-alpha")?.name, "NEB 5-alpha");
  assert.equal(findStrain("dam-/dcm-")?.name, "NEB dam−/dcm−");
  assert.equal(findStrain("Rosetta 2"), null);
  assert.equal(strainKey(" E. coli  TOP10 "), "top10");
  assert.deepEqual(hostMethylation("  "), { dam: true, dcm: true, from: "assumed", name: "" });
  assert.deepEqual(hostMethylation("bl21"), { dam: true, dcm: false, from: "strain", name: "BL21" });
  assert.notEqual(methylationKey(hostMethylation("")), methylationKey(hostMethylation("BL21")));
  assert.equal(methylationKey(undefined), "");
});

test("each enzyme's effects are summed up for its details", () => {
  const always = () => true;
  assert.deepEqual(enzymeMethylation("XbaI", always), { dam: "blocked", dcm: "not tested", cpg: "not tested" });
  assert.equal(enzymeMethylation("BspHI", always).dam, "varies");
  assert.equal(enzymeMethylation("BamHI", always).dam, "cuts");
  assert.equal(enzymeMethylation("BclI", always).dam, "blocked");
  assert.equal(enzymeMethylation("ApaI", always).dcm, "varies");
  assert.equal(enzymeMethylation("DpnI", always).dam, "needs");
  assert.equal(enzymeMethylation("EcoRI", m => m === "cpg").dam, "no overlap");
  assert.equal(enzymeMethylation("EcoRI", m => m === "cpg").cpg, "varies");
});

test("whether a methylase's site can reach an enzyme's, Ns aside", () => {
  assert.equal(canOverlap("dam", "GAATTC"), false);
  assert.equal(canOverlap("cpg", "GAATTC"), true);
  assert.equal(canOverlap("dam", "TCTAGA"), true);
  assert.equal(canOverlap("dam", "CAGNNNCTG"), false);
  assert.equal(canOverlap("dcm", "AGGCCT"), true);
  assert.equal(canOverlap("dcm", "GAATTC"), false);
});

test("counts and the strain's methylation in words", () => {
  assert.equal(cutCountText(1, 1), "cuts once");
  assert.equal(cutCountText(3, 3), "cuts 3 times");
  assert.equal(cutCountText(2, 1), "2 sites · 1 predicted cut");
  assert.equal(cutCountText(1, 0), "1 site · 0 predicted cuts");
  assert.equal(methylationSummary(hostMethylation("")), "Methylation: Dam⁺ Dcm⁺, assumed until a strain is given.");
  assert.equal(methylationSummary(hostMethylation("BL21(DE3)")), "Methylation: Dam⁺ Dcm⁻.");
  assert.equal(methylationSummary(hostMethylation("my strain")), "Methylation unknown: “my strain” isn't a strain Strandivo knows, so no site is predicted blocked.");
});

const plasmid = (sequence: string): SeqData => ({ name: "p", sequence, circular: true, features: [], primers: [], sources: [], description: "" });
const xbaOnly = (methylation?: DnaMethylation): EnzymeOptions => ({ enzymeSource: "personal", enzymeFilter: "unique", labEnzymes: [], personalEnzymes: ["XbaI"], methylation });
const filler = (n: number) => "ACGT".repeat(n).replace(/GATC|CTAG/g, "AAAA");

test("a plasmid with two XbaI sites, one blocked, counts as cut once and runs as one linear band", () => {
  for (const [label, seq] of [
    ["inside", filler(50) + "TCTAGATC" + filler(50) + "TCTAGATT" + filler(50)],
    // The blocking GATC's last bases start the sequence; the site ends it.
    ["across the origin", "TC" + filler(60) + "TCTAGATT" + filler(60) + "TCTAGA"]
  ] as const) {
    const d = plasmid(seq);
    const hits = scanSites(seq, true, ["XbaI"]);
    const sites = selectSites(hits, xbaOnly(ASSUMED), d).filter(c => c.enzyme === "XbaI");
    assert.equal(sites.length, 2, label);
    assert.ok(sites.every(c => c.sites === 2 && c.cuts === 1), label);
    assert.equal(sites.filter(c => c.methylation?.blocked).length, 1, label);
    assert.equal(cutCountText(sites[0].sites, sites[0].cuts), "2 sites · 1 predicted cut");
    assert.deepEqual(digestSequence(d, ["XbaI"], ASSUMED).fragments.map(fragmentSize), [seq.length], label);
    // Without a strain to go by nothing is blocked, and a unique-cutter list leaves XbaI out.
    assert.deepEqual(selectSites(hits, xbaOnly(), d), [], label);
    assert.equal(digestSequence(d, ["XbaI"]).fragments.length, 2, label);
    assert.equal(cutCounts(seq, true, ["XbaI"], ASSUMED).get("XbaI"), 1, label);
    assert.deepEqual(siteCounts(hits, seq, true, ASSUMED).get("XbaI"), { sites: 2, cuts: 1 }, label);
  }
});

test("an edit that brings a GATC next to a site blocks it, as a full search finds", () => {
  const before = filler(40) + "TCTAGATT" + filler(40);
  const after = before.replace("TCTAGATT", "TCTAGATC");
  const o: EnzymeOptions = { ...xbaOnly(ASSUMED), enzymeFilter: "all" };
  const hits = rescanSites({ sequence: before, circular: true, hits: scanSites(before, true, ["XbaI"]) }, after, true, ["XbaI"]);
  const sites = selectSites(hits, o, { sequence: after, circular: true });
  assert.deepEqual(sites, selectSites(scanSites(after, true, ["XbaI"]), o, { sequence: after, circular: true }));
  assert.equal(sites.find(c => c.enzyme === "XbaI")?.methylation?.blocked, true);
});

test("a search by name finds an enzyme whose every site is blocked", () => {
  const cuts = new Map([["XbaI", 0], ["EcoRI", 1]]);
  const sites = new Map([["XbaI", 1], ["EcoRI", 1]]);
  assert.deepEqual(reactionEnzymes(cuts, ["XbaI", "EcoRI"], [], 3, "", sites), ["EcoRI"]);
  assert.deepEqual(reactionEnzymes(cuts, ["XbaI", "EcoRI"], [], 3, "xba", sites), ["XbaI"]);
  assert.deepEqual(reactionEnzymes(cuts, ["XbaI", "EcoRI"], [], 3, "xba"), []);
});

test("an enzyme methylation stops cutting stays under a unique-cutter filter only if its sites alone would", () => {
  const o: EnzymeOptions = { enzymeSource: "personal", enzymeFilter: "unique", labEnzymes: [], personalEnzymes: ["BclI"], methylation: ASSUMED };
  const one = filler(30) + "TGATCA" + filler(30);
  const three = filler(30) + "TGATCA" + filler(30) + "TGATCA" + filler(30) + "TGATCA" + filler(30);
  const shown = (seq: string) => selectSites(scanSites(seq, true, ["BclI"]), o, { sequence: seq, circular: true }).filter(c => c.enzyme === "BclI");
  assert.deepEqual(shown(one).map(c => [c.sites, c.cuts, c.methylation?.blocked]), [[1, 0, true]]);
  assert.deepEqual(shown(three), []);
  assert.equal(selectSites(scanSites(three, true, ["BclI"]), { ...o, enzymeFilter: "all" }, { sequence: three, circular: true }).filter(c => c.enzyme === "BclI").length, 3);
});
