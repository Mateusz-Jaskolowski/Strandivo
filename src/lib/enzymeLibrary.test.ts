// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkImport, formatEnzymeLibrary, formatEnzymeTable, newEnzymeStocks, parseEnzymeLibrary, parseEnzymeTable, unknownEnzymes, type LabEnzyme } from "./enzymeLibrary.ts";
import { enzymeCut, enzymeName, enzymeSite, enzymeSuppliers, findCutSites, KNOWN_ENZYMES, MAX_CUT_DISTANCE, rescanSites, scanSites, selectSites, type EnzymeFilter, type EnzymeOptions } from "./enzymes.ts";
import { REBASE_ENZYMES } from "./rebaseEnzymes.ts";

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
