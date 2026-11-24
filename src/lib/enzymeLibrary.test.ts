// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkImport, formatEnzymeLibrary, formatEnzymeTable, newEnzymeStocks, parseEnzymeLibrary, parseEnzymeTable, unknownEnzymes, type LabEnzyme } from "./enzymeLibrary.ts";
import { cutDrawing, enzymeCut, enzymeName, enzymeRelatives, enzymeSite, enzymeSites, enzymeSuppliers, findCutSites, KNOWN_ENZYMES, MAX_CUT_DISTANCE, reactionCounts, rescanSites, scanSites, selectSites, type CutSite, type EnzymeFilter, type EnzymeOptions } from "./enzymes.ts";
import { cutSites } from "../doc/analysis.ts";
import { PCR_DNA } from "./methylation.ts";
import { REBASE_ENZYMES } from "./rebaseEnzymes.ts";
import { reverseComplement, type SeqData } from "./seqdata.ts";

const labOptions = (names: readonly string[] = [], enzymeFilter: EnzymeFilter = "all"): EnzymeOptions => ({ enzymeSource: "lab", enzymeFilter, labEnzymes: names, personalEnzymes: [] });
const commonOptions = (labEnzymes: readonly string[], enzymeFilter: EnzymeFilter): EnzymeOptions => ({ enzymeSource: "common", enzymeFilter, labEnzymes, personalEnzymes: [] });

const stock: LabEnzyme = { id: "enzyme-1", enzyme: "EcoRI", product: "NEB EcoRI-HF", location: "−20 °C, box A", notes: "New tube\nKeep in rack 2" };

test("stock exports preserve products, locations and notes when imported", () => {
  assert.deepEqual(parseEnzymeLibrary(formatEnzymeLibrary([stock])), [stock]);
  assert.deepEqual(parseEnzymeLibrary(formatEnzymeLibrary([])), []);
});

test("enzyme names: any enzyme REBASE lists as sold, as REBASE writes it", () => {
  assert.equal(enzymeName(" ecori "), "EcoRI");
  assert.equal(enzymeName("bsmbi"), "BsmBI");
  assert.equal(enzymeName("esp3i"), "Esp3I");
  assert.equal(enzymeName("ACC65I"), "Acc65I");
  assert.equal(enzymeName("dpni"), "DpnI");
  assert.equal(enzymeName("i-scei"), "I-SceI");
  assert.equal(enzymeName("EcoRI-HF"), null);
  assert.equal(enzymeName(""), null);
  // Isoschizomers no company sells are left out, so the list doesn't open on them.
  assert.equal(enzymeName("BspJ106I"), null);
  assert.ok(KNOWN_ENZYMES.includes("Acc65I") && KNOWN_ENZYMES.indexOf("EcoRI") < KNOWN_ENZYMES.indexOf("Acc65I"), "curated names come first");
  assert.equal(new Set(KNOWN_ENZYMES.map(n => n.toLowerCase())).size, KNOWN_ENZYMES.length);
});

test("cuts are marked with ^, with Ns out to a cut past the site, and the ends they leave", () => {
  const cut = (name: string) => {
    const c = enzymeCut(name);
    return c && `${c.notation} ${c.ends}`;
  };
  // Same site, other ends: the reason a lab's stock names the isoschizomer it has.
  assert.equal(cut("KpnI"), "GGTAC^C 3′ GTAC");
  assert.equal(cut("acc65i"), "G^GTACC 5′ GTAC");
  assert.equal(cut("EcoRI"), "G^AATTC 5′ AATT");
  assert.equal(cut("PvuII"), "CAG^CTG Blunt");
  assert.equal(cut("BglI"), "GCCNNNN^NGGC 3′ NNN");
  // Past the site (REBASE's GGTCTC(1/5) and so on): Ns out to the further cut, so for a 5′
  // overhang the Ns after the ^ are the overhang.
  assert.equal(cut("BsaI"), "GGTCTCN^NNNN 5′ NNNN");
  assert.equal(cut("BbsI"), "GAAGACNN^NNNN 5′ NNNN");
  assert.equal(cut("PaqCI"), "CACCTGCNNNN^NNNN 5′ NNNN");
  assert.equal(cut("BtsI"), "GCAGTGNN^ 3′ NN");
  assert.equal(cut("BsmI"), "GAATGCN^ 3′ CN");
  // More than five Ns are counted, as NEB writes them.
  assert.equal(cut("FokI"), "GGATG(N)9^NNNN 5′ NNNN");
  assert.equal(cut("MmeI"), "TCCRAC(N)20^ 3′ NN");
  assert.equal(cut("EcoP15I"), "CAGCAG(N)25^NN 5′ NN");
  assert.deepEqual(enzymeCut("BsaI") && { site: enzymeCut("BsaI")!.site, rebase: enzymeCut("BsaI")!.rebase }, { site: "GGTCTC", rebase: "GGTCTC(1/5)" });
  // A site that isn't a palindrome, cut inside it: REBASE counts back from its end
  // (CCGC(-3/-1)), a ^ reads at a glance and the ends give the bottom strand.
  assert.equal(cut("AciI"), "C^CGC 5′ CG");
  assert.equal(cut("GsaI"), "CCCAG^C 3′ CCAG");
  assert.equal(cut("I-SceI"), "TAGGGATAA^CAGGGTAAT 3′ ATAA");
  // Cut outside a palindromic core, on both strands alike.
  assert.equal(cut("TspRI"), "CASTGNN^ 3′ NNCASTGNN");
  // TeselaGen's list had A^ATT.
  assert.equal(cut("MluCI"), "^AATT 5′ AATT");
  assert.equal(cut("BcgI"), "(10/12)CGANNNNNNTGC(12/10) Cuts both sides");
  assert.equal(enzymeCut("EcoRI-HF"), null);
  assert.equal(enzymeSite("TspRI"), "CASTGNN");
  assert.equal(enzymeSite("BcgI"), "CGANNNNNNTGC");
  assert.deepEqual(enzymeSuppliers("BtsI"), ["New England Biolabs"]);
});

test("isoschizomers cut a site the same way, neoschizomers elsewhere", () => {
  assert.deepEqual(enzymeRelatives("Acc65I"), { isoschizomers: [], neoschizomers: ["KpnI"] });
  assert.ok(enzymeRelatives("BsaI").isoschizomers.includes("Eco31I"));
  assert.ok(enzymeRelatives("BsmBI").isoschizomers.includes("Esp3I"));
  assert.ok(enzymeRelatives("FokI").neoschizomers.includes("BtsCI"));
  // Ns put in front of TspRI's site for the search are compared like any other base.
  assert.deepEqual(enzymeRelatives("TspRI").isoschizomers, ["TscAI"]);
  assert.deepEqual(enzymeRelatives("NoSuchI"), { isoschizomers: [], neoschizomers: [] });
  for (const name of KNOWN_ENZYMES) {
    const r = enzymeRelatives(name);
    for (const other of r.isoschizomers) assert.ok(enzymeRelatives(other).isoschizomers.includes(name), `${other} is an isoschizomer of ${name}`);
    for (const other of r.neoschizomers) assert.ok(enzymeRelatives(other).neoschizomers.includes(name), `${other} is a neoschizomer of ${name}`);
  }
});

test("a cut is drawn on both strands, with one more base each side", () => {
  assert.deepEqual(cutDrawing("EcoRI"), { top: "NGAATTCN", bottom: "NCTTAAGN", site: [1, 7], cuts: [{ top: 2, bottom: 6 }] });
  assert.deepEqual(cutDrawing("KpnI")?.cuts, [{ top: 6, bottom: 2 }]);
  // Out to a cut past the site: BsaI's GGTCTCN^NNNN.
  assert.deepEqual(cutDrawing("BsaI"), { top: "NGGTCTCNNNNNN", bottom: "NCCAGAGNNNNNN", site: [1, 7], cuts: [{ top: 8, bottom: 12 }] });
  // TspRI's site is CASTGNN; the Ns searched for in front of it aren't.
  assert.deepEqual(cutDrawing("TspRI"), { top: "NNNCASTGNNN", bottom: "NNNGTSACNNN", site: [3, 10], cuts: [{ top: 10, bottom: 1 }] });
  // BcgI's (10/12)CGANNNNNNTGC(12/10): both cuts.
  assert.deepEqual(cutDrawing("BcgI")?.cuts, [{ top: 3, bottom: 1 }, { top: 37, bottom: 35 }]);
  assert.deepEqual(cutDrawing("BcgI")?.site, [13, 25]);
  assert.equal(cutDrawing("NoSuchI"), null);
});

test("one enzyme's sites are found whichever list it is in", () => {
  assert.deepEqual(enzymeSites("GAATTCAAAGAATTCGGTACC", false, "EcoRI").map(h => h.start), [0, 9]);
  assert.deepEqual(enzymeSites("GAATTCAAAGAATTCGGTACC", false, "Acc65I").map(h => [h.start, h.cut, h.bottomCut]), [[15, 16, 20]]);
  assert.deepEqual(enzymeSites("GAATTCAAAGAATTCGGTACC", false, "NoSuchI"), []);
});

test("every enzyme sold finds its own site and cuts near it", () => {
  // Each code as its first base, between flanks longer than any cut is from its site.
  const FIRST: Record<string, string> = { R: "A", Y: "C", S: "C", W: "A", K: "G", M: "A", B: "C", D: "A", H: "A", V: "A", N: "A" };
  const flank = "T".repeat(MAX_CUT_DISTANCE + 10);
  const names = REBASE_ENZYMES.trim().split("\n").map(line => line.split("\t")[0]);
  assert.ok(names.length > 500 && names.every(n => KNOWN_ENZYMES.includes(n)));
  for (const name of names) {
    const site = enzymeSite(name).replace(/[RYSWKMBDHVN]/g, c => FIRST[c]);
    const sequence = flank + site + flank;
    const hit = scanSites(sequence, false, [name]).find(h => h.enzyme === name && Math.min(h.start, h.end) <= flank.length && Math.max(h.start, h.end) >= flank.length + site.length - 1);
    assert.ok(hit, `${name} finds ${site}`);
    for (const cut of [hit.cut, hit.bottomCut]) {
      assert.ok(cut >= flank.length - MAX_CUT_DISTANCE && cut <= flank.length + site.length + MAX_CUT_DISTANCE, `${name} cuts within ${MAX_CUT_DISTANCE} bases of its site`);
    }
  }
});

test("a saved list keeps enzymes this version doesn't know, as written, instead of failing", () => {
  const entry = { ...stock, enzyme: " ecori ", product: " Thermo FastDigest EcoRI " };
  assert.deepEqual(parseEnzymeLibrary(formatEnzymeLibrary([entry])), [{ ...entry, enzyme: "EcoRI", product: "Thermo FastDigest EcoRI" }]);
  const future = parseEnzymeLibrary(formatEnzymeLibrary([stock, { ...stock, id: "enzyme-2", enzyme: " NewEnzI " }]));
  assert.deepEqual(future.map(e => e.enzyme), ["EcoRI", "NewEnzI"]);
  assert.deepEqual(unknownEnzymes(future), ["NewEnzI"]);
});

test("an import naming an unknown enzyme fails as a whole, naming it", () => {
  assert.doesNotThrow(() => checkImport([stock, { ...stock, enzyme: "Acc65I" }]));
  assert.throws(() => checkImport([stock, { ...stock, enzyme: "EcoRI-HF" }, { ...stock, enzyme: "EcoRI-HF" }]), /“EcoRI-HF”\. Correct the name/);
});

test("invalid files fail as a whole, including future versions, missing fields and repeated IDs", () => {
  assert.throws(() => parseEnzymeLibrary("{broken"));
  assert.throws(() => parseEnzymeLibrary('{"version":2,"entries":[]}'), /supported/);
  assert.throws(() => parseEnzymeLibrary('{"version":1,"entries":{}}'), /supported/);
  assert.throws(() => parseEnzymeLibrary('{"version":1,"entries":[null]}'), /invalid fields/);
  assert.throws(() => parseEnzymeLibrary(formatEnzymeLibrary([{ ...stock, enzyme: " " }])), /no enzyme name/);
  assert.throws(() => parseEnzymeLibrary(formatEnzymeLibrary([stock, stock])), /repeated ID/);
  assert.throws(() => parseEnzymeLibrary(formatEnzymeLibrary([{ ...stock, id: "" }])), /missing/);
  assert.throws(() => parseEnzymeLibrary(JSON.stringify({ version: 1, entries: [{ ...stock, notes: 3 }] })), /invalid fields/);
});

test("merging imports keeps different products, freezer locations and notes", () => {
  const product = { ...stock, product: "Other supplier EcoRI" };
  const location = { ...stock, location: "Freezer 3" };
  const notes = { ...stock, notes: "Spare tube" };
  const fresh = newEnzymeStocks([stock], [stock, product, product, location, notes]);
  assert.equal(fresh.length, 3);
  assert.deepEqual(fresh.map(e => [e.product, e.location, e.notes]), [product, location, notes].map(e => [e.product, e.location, e.notes]));
  assert.ok(fresh.every(e => !("id" in e)), "import assigns new IDs rather than colliding with existing stock");
});

test("spreadsheets: columns found by their headers, in any order", () => {
  const tsv = "Freezer\tEnzyme\tSupplier\tComments\n-20 box A\tecori\tNEB R3101\tnew\n\n-80\tAcc65I\t\t\n";
  assert.deepEqual(parseEnzymeTable(tsv), [
    { enzyme: "EcoRI", product: "NEB R3101", location: "-20 box A", notes: "new" },
    { enzyme: "Acc65I", product: "Acc65I", location: "-80", notes: "" }
  ]);
  // Without a header the columns are enzyme, product, location and notes.
  assert.deepEqual(parseEnzymeTable("BamHI\tNEB BamHI-HF\tbox B\n"), [{ enzyme: "BamHI", product: "NEB BamHI-HF", location: "box B", notes: "" }]);
});

test("spreadsheets: CSV with quotes, semicolons and a byte-order mark", () => {
  const csv = '﻿Enzyme,Product,Location,Notes\r\nXhoI,"Thermo, FastDigest","Freezer 2, box ""C""","two\nlines"\r\n';
  assert.deepEqual(parseEnzymeTable(csv), [{ enzyme: "XhoI", product: "Thermo, FastDigest", location: 'Freezer 2, box "C"', notes: "two\nlines" }]);
  assert.deepEqual(parseEnzymeTable("Enzyme;Product\nNotI;NEB\n"), [{ enzyme: "NotI", product: "NEB", location: "", notes: "" }]);
  assert.throws(() => parseEnzymeTable("Enzyme\tProduct\n\tNEB\n"), /Row 2 has no enzyme/);
  assert.deepEqual(parseEnzymeTable(""), []);
});

test("a tab-separated export reads back, even with tabs, quotes and new lines in a field", () => {
  const entries = [{ ...stock, notes: 'Say "new"\tthen\nuse' }, { ...stock, enzyme: "Acc65I", product: "Acc65I" }];
  assert.deepEqual(parseEnzymeTable(formatEnzymeTable(entries)), entries.map(({ id: _, ...e }) => e));
});

test("lab enzymes show every cut, once per enzyme even with several stock records", () => {
  const sequence = "TTTGAATTCTTTGAATTCTTTGAATTCTTTAAGCTTTTT";
  const lab = findCutSites(sequence, false, labOptions(["EcoRI", "EcoRI"]));
  assert.equal(lab.length, 3);
  assert.ok(lab.every(c => c.enzyme === "EcoRI" && c.cuts === 3));
  assert.equal(new Set(lab.map(c => c.id)).size, 3);
  assert.deepEqual(findCutSites(sequence, false, labOptions()), []);
  const unique = findCutSites(sequence, false, commonOptions(["EcoRI"], "unique6"));
  assert.ok(unique.some(c => c.enzyme === "HindIII"));
  assert.ok(!unique.some(c => c.enzyme === "EcoRI"), "existing cutter filters stay independent of lab stock");
});

test("lab sets limit cuts like the others: once, at most twice, or every site", () => {
  // EcoRI three times, BamHI twice, HindIII once.
  const sequence = "TTGAATTCTTGAATTCTTGAATTCTTGGATCCTTGGATCCTTAAGCTTTT";
  const lab = ["EcoRI", "BamHI", "HindIII"];
  const enzymes = (filter: EnzymeFilter) => [...new Set(findCutSites(sequence, false, labOptions(lab, filter)).map(c => c.enzyme))].sort();
  assert.deepEqual(enzymes("unique"), ["HindIII"]);
  assert.deepEqual(enzymes("unique2"), ["BamHI", "HindIII"]);
  assert.deepEqual(enzymes("all"), ["BamHI", "EcoRI", "HindIII"]);
});

test("a stocked isoschizomer outside the curated list is found with its own cut", () => {
  const sequence = "TTTTTGGTACCTTTTT";
  const kpn = findCutSites(sequence, false, commonOptions(["Acc65I"], "unique"));
  assert.deepEqual(kpn.map(c => c.enzyme), ["KpnI"], "the curated sets ignore stock outside the list");
  const acc = findCutSites(sequence, false, labOptions(["Acc65I"]));
  assert.deepEqual(acc.map(c => c.enzyme), ["Acc65I"]);
  // KpnI: GGTAC^C, a 3′ overhang; Acc65I: G^GTACC, a 5′ one.
  assert.equal(acc[0].cut, 6);
  assert.equal(kpn[0].cut, 10);
  // Esp3I is BsmBI under another name: the lab set shows the stocked name, not the curated one.
  const esp = findCutSites("TTTTCGTCTCTTTTTTTTTTTT", false, labOptions(["Esp3I"]));
  assert.deepEqual(esp.map(c => c.enzyme), ["Esp3I"]);
});

test("rescanning after an edit finds stocked enzymes too", () => {
  const before = "TTTTTGGTACCTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT";
  const after = before.slice(0, 60) + "GGTACC" + before.slice(60);
  const extra = ["Acc65I"];
  const hits = rescanSites({ sequence: before, circular: false, hits: scanSites(before, false, extra) }, after, false, extra);
  const sites = (h: ReturnType<typeof scanSites>) => selectSites(h, labOptions(extra)).map(c => c.id).sort();
  assert.deepEqual(sites(hits), sites(scanSites(after, false, extra)));
  assert.equal(sites(hits).length, 2);
});

test("lab filtering retains both strands and sites crossing a circular origin", () => {
  // EcoRI's GAATTC wraps across the origin; reverse BsaI recognises GAGACC.
  const sequence = "AATTCTTTGAGACCTTTG";
  const sites = findCutSites(sequence, true, labOptions(["EcoRI", "BsaI"]));
  assert.ok(sites.some(c => c.enzyme === "EcoRI" && c.start > c.end));
  assert.ok(sites.some(c => c.enzyme === "BsaI" && !c.forward));
});

// ---------- counts at a linear end: the map says what the digest does ----------

const asSeq = (sequence: string, circular = false): SeqData => ({ name: "line", description: "", circular, sequence, features: [], primers: [], sources: [] });
const digestCuts = (d: SeqData, enzyme: string) => reactionCounts(d, [enzyme], PCR_DNA).cuts.get(enzyme) ?? 0;
const drawn = (d: SeqData, enzyme: string, filter: EnzymeFilter = "all"): CutSite[] => findCutSites(d.sequence, d.circular, labOptions([enzyme], filter)).filter(c => c.enzyme === enzyme);
const at = (n: number) => "AT".repeat(n);
/** 100 bases of AT with a recognition planted at `start`. */
const plant = (motif: string, start: number) => at(50).slice(0, start) + motif + at(50).slice(start + motif.length);
const MOTIF = { AjnI: "CCAGG", MmeI: "TCCAAC", AjuI: "GAAATATATATTGG" };

test("the map counts the complete cuts the digest makes, and draws one that lies on the sequence", () => {
  // REBASE's cuts as boundaries from a site's first base: AjnI ^CCWGG is 0/5, MmeI TCCRAC(20/18)
  // 26/24 after its site, and AjuI (7/12)GAANNNNNNNTTGG(11/6) −7/−12 before its site and 25/20
  // after it. On a line of 100 bases a cut is complete only if both boundaries lie within
  // 1…99, so one at 0 or at 100 leaves no duplex to cut.
  const cases: [string, keyof typeof MOTIF, boolean, number, { cut: number; bottomCut: number } | null, number][] = [
    ["AjnI at 0", "AjnI", true, 0, { cut: 0, bottomCut: 5 }, 0],
    ["AjnI at 1", "AjnI", true, 1, { cut: 1, bottomCut: 6 }, 1],
    ["AjnI at 90", "AjnI", true, 90, { cut: 90, bottomCut: 95 }, 1],
    ["AjnI at 95", "AjnI", true, 95, { cut: 95, bottomCut: 100 }, 0],
    ["MmeI at 73", "MmeI", true, 73, { cut: 99, bottomCut: 97 }, 1],
    ["MmeI at 74", "MmeI", true, 74, { cut: 100, bottomCut: 98 }, 0],
    // The search drops it, as its cut is past the end, and no other cut of it is on the line.
    ["MmeI at 75", "MmeI", true, 75, null, 0],
    ["AjuI at 12, its cut before the site 5/0", "AjuI", true, 12, { cut: 37, bottomCut: 32 }, 1],
    ["AjuI at 13, both pairs complete", "AjuI", true, 13, { cut: 38, bottomCut: 33 }, 2],
    ["AjuI at 74, both pairs complete", "AjuI", true, 74, { cut: 99, bottomCut: 94 }, 2],
    // Its cut after the site is 100/95, the end itself: only the cut before it, 68/63, is one.
    ["AjuI at 75", "AjuI", true, 75, { cut: 68, bottomCut: 63 }, 1],
    // The search drops it, as the cut after the site is 101/96, and the cut before it is 69/64.
    ["AjuI at 76", "AjuI", true, 76, { cut: 69, bottomCut: 64 }, 1],
    ["AjuI on the other strand at 5", "AjuI", false, 5, { cut: 31, bottomCut: 26 }, 1],
    ["AjuI on the other strand at 11", "AjuI", false, 11, { cut: 37, bottomCut: 32 }, 1],
    ["AjuI on the other strand at 12", "AjuI", false, 12, { cut: 6, bottomCut: 1 }, 2],
    ["AjuI on the other strand at 70", "AjuI", false, 70, { cut: 64, bottomCut: 59 }, 2]
  ];
  for (const [label, enzyme, forward, start, marker, cuts] of cases) {
    const d = asSeq(plant(forward ? MOTIF[enzyme] : reverseComplement(MOTIF[enzyme]), start));
    const found = drawn(d, enzyme);
    assert.equal(digestCuts(d, enzyme), cuts, `${label}: the digest`);
    if (!marker) {
      assert.deepEqual(found, [], label);
      continue;
    }
    assert.equal(found.length, 1, label);
    const [c] = found;
    assert.deepEqual([c.id, c.start, c.forward, c.cut, c.bottomCut, c.cuts, c.sites], [`${enzyme}@${start}`, start, forward, marker.cut, marker.bottomCut, cuts, 1], label);
    assert.equal(c.overhang, d.sequence.slice(Math.min(c.cut, c.bottomCut), Math.max(c.cut, c.bottomCut)), `${label}: the bases between its cuts`);
  }
});

test("BcgI near a linear end is drawn at the cut that is there, on either strand, and in a plasmid is two cuts", () => {
  const nearEnd = "AT".repeat(41) + "CGAAAAAAATGC";
  for (const [label, bases, cut, bottomCut] of [["forward", nearEnd, 72, 70], ["reverse", reverseComplement(nearEnd), 24, 22]] as const) {
    const d = asSeq(bases);
    assert.deepEqual(drawn(d, "BcgI").map(c => [c.cut, c.bottomCut, c.cuts, c.sites]), [[cut, bottomCut, 1, 1]], label);
    assert.equal(digestCuts(d, "BcgI"), 1, label);
  }
  // Whole in a plasmid, the one recognition is two cuts, which is what "dual" asks for.
  const plasmid = asSeq(at(50) + "CGAAAAAAATGC" + at(50), true);
  assert.deepEqual(drawn(plasmid, "BcgI").map(c => [c.cuts, c.sites]), [[2, 1]]);
  assert.equal(digestCuts(plasmid, "BcgI"), 2);
  assert.deepEqual(drawn(plasmid, "BcgI", "unique"), []);
  assert.equal(drawn(plasmid, "BcgI", "unique2").length, 1);
});

test("the unique filters count complete cuts, so a site cut at the very end is not one of them", () => {
  // BsaI GGTCTC(1/5) cuts 7/11 from its first base: the second site's bottom strand falls at the end.
  const near = asSeq(at(30) + "GGTCTC" + at(30) + "GGTCTC" + "AAAAA");
  assert.equal(near.sequence.length, 137);
  assert.deepEqual([reactionCounts(near, ["BsaI"], PCR_DNA).sites.get("BsaI"), digestCuts(near, "BsaI")], [2, 1]);
  for (const filter of ["unique6", "unique", "unique2", "all"] as const) {
    assert.deepEqual(drawn(near, "BsaI", filter).map(c => [c.id, c.cuts, c.sites]), [["BsaI@60", 1, 2], ["BsaI@126", 1, 2]], filter);
  }
  // Two sites and neither makes a cut: kept only where two cuts or more are asked for.
  const none = asSeq("ATATA" + "GAGACC" + at(50) + "GGTCTC" + "AAAAA");
  assert.deepEqual([reactionCounts(none, ["BsaI"], PCR_DNA).sites.get("BsaI"), digestCuts(none, "BsaI")], [2, 0]);
  for (const [filter, shown] of [["unique6", 0], ["unique", 0], ["unique2", 2], ["all", 2]] as const) assert.equal(drawn(none, "BsaI", filter).length, shown, filter);
  assert.deepEqual(drawn(none, "BsaI").map(c => [c.start, c.forward, c.cuts, c.sites]), [[5, false, 0, 2], [111, true, 0, 2]]);
  // A lone one stays, as a lone blocked site does, since its sites alone pass the filter.
  assert.deepEqual(drawn(asSeq(at(50) + "GGTCTC" + "AAAAA"), "BsaI", "unique").map(c => [c.cuts, c.sites]), [[0, 1]]);
});

test("for the common enzymes, on either strand and topology, a marker is the search's own hit", () => {
  const gb = readFileSync(new URL("../../testdata/e2e/pUC19-annotated.gb", import.meta.url), "utf8");
  const sequence = gb.split("ORIGIN")[1].replace(/[^acgtn]/gi, "").toUpperCase();
  const byKey = (a: { enzyme: string; start: number; forward: boolean }, b: typeof a) => `${a.enzyme}@${a.start}@${a.forward}`.localeCompare(`${b.enzyme}@${b.start}@${b.forward}`);
  for (const circular of [true, false]) {
    const hits = scanSites(sequence, circular, []);
    const markers = findCutSites(sequence, circular, commonOptions([], "all"));
    assert.ok(hits.some(h => !h.forward) && hits.some(h => h.forward));
    // Nothing is moved or left out, whatever its cuts: only the counts and ids are the marker's own.
    assert.deepEqual(markers.map(({ id, cuts, sites, ...hit }) => hit).sort(byKey), [...hits].sort(byKey));
  }
});

test("Unique 6+ cutters never lists an enzyme with a shorter site, however few sites it has", () => {
  // AluI cuts AGCT: with two sites it was listed at the second.
  const seq = at(20) + "AGCT" + at(20) + "AGCT" + at(20);
  assert.deepEqual(findCutSites(seq, false, labOptions(["AluI"], "unique6")), []);
  assert.equal(findCutSites(seq, false, labOptions(["AluI"], "unique2")).length, 2);
});

test("the cached list follows edits at the ends, and a change of topology, as a fresh search does", () => {
  const names = ["AjuI", "BcgI", "BsaI"];
  const o = labOptions(names);
  const fresh = (d: SeqData) => selectSites(scanSites(d.sequence, d.circular, names), o, d);
  const sameAsFresh = (d: SeqData) => {
    const cached = cutSites(d, o);
    assert.deepEqual(cached, fresh(d));
    return cached;
  };
  // AjuI at 76 of 100 is drawn at the cut before its site only, as the one after it is past the end.
  let d = asSeq(plant(MOTIF.AjuI, 76));
  assert.deepEqual(sameAsFresh(d).map(c => [c.id, c.cut, c.cuts]), [["AjuI@76", 69, 1]]);
  // Five more bases bring the cut after it onto the sequence: two cuts, drawn where it makes the second.
  d = asSeq(d.sequence + at(2) + "A");
  assert.deepEqual(sameAsFresh(d).map(c => [c.id, c.cut, c.cuts]), [["AjuI@76", 101, 2]]);
  // Bases taken from the start move the site and leave its count.
  d = asSeq(d.sequence.slice(10));
  assert.deepEqual(sameAsFresh(d).map(c => [c.id, c.cut, c.cuts]), [["AjuI@66", 91, 2]]);
  // A BsaI site whose cuts end at the last base is a site that doesn't cut.
  d = asSeq(d.sequence + "GGTCTC" + "AAAAA");
  assert.deepEqual(sameAsFresh(d).map(c => [c.id, c.cuts, c.sites]), [["AjuI@66", 2, 1], ["BsaI@95", 0, 1]]);
  // The same bases as a circle, which has no ends, and the circle edited beside its origin.
  const ring = asSeq(d.sequence, true);
  assert.deepEqual(sameAsFresh(ring).map(c => [c.id, c.cuts, c.sites]), [["AjuI@66", 2, 1], ["BsaI@95", 1, 1]]);
  const turned = asSeq(ring.sequence.slice(0, 5) + "G" + ring.sequence.slice(5), true);
  assert.deepEqual(sameAsFresh(turned).map(c => [c.id, c.cuts, c.sites]), [["AjuI@67", 2, 1], ["BsaI@96", 1, 1]]);
  assert.deepEqual(sameAsFresh(asSeq(turned.sequence)).map(c => [c.id, c.cuts, c.sites]), [["AjuI@67", 2, 1], ["BsaI@96", 0, 1]]);
});
