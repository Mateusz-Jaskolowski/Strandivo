// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Regions from one UniProt entry or several onto one CDS: a chimera's, as a sodium channel
// with another's loops is. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseSequenceFile, serialize } from "../doc/fileio.ts";
import { fromParsed, toParsed } from "../doc/convert.ts";
import { protein as translate } from "../doc/analysis.ts";
import { regionColor, regionsOf, withRegions, type ProteinRegion } from "./regions.ts";
import type { SeqData } from "./seqdata.ts";
import { alignProteins, parseEntry, placeFeatures, regionIdentity, type UniprotEntry } from "./uniprot.ts";
import { applyImport, importNotes, importRows, rememberedEntries, startsTicked, tickable, type ImportRow, type LookedUp } from "./uniprotImport.ts";

const load = (accession: string) => parseEntry(JSON.parse(readFileSync(new URL(`../../testdata/uniprot/${accession}.json`, import.meta.url), "utf8")))!;
// Mouse Nav1.7 and the cockroach channel NavPaS: homologues, about 40% alike.
const nav17 = load("Q62205");
const navpas = load("D0E0C2");

/** NavPaS's N-terminal cytoplasmic stretch (1–140) on Nav1.7 from its first helix (126) on. */
const chimera = navpas.sequence.slice(0, 140) + nav17.sequence.slice(125, 1757);

const lookUp = (cds: string, entry: UniprotEntry, within?: { start: number; end: number }): LookedUp => ({
  accession: entry.accession,
  reviewed: entry.reviewed,
  placed: placeFeatures(entry, alignProteins(cds, entry.sequence, within)!)
});
const row = (rows: ImportRow[], accession: string, name: string, start?: number) =>
  rows.find(r => r.accession === accession && r.placed.feature.name === name && (start === undefined || r.placed.feature.start === start))!;
const ticks = (rows: ImportRow[], previous: ProteinRegion[] = []) => new Set(rows.filter(r => startsTicked(r, previous)).map(r => r.id));

test("a chimera's parts each start ticked from the entry they came from", () => {
  const rows = importRows([], [lookUp(chimera, nav17), lookUp(chimera, navpas)]);
  const ticked = ticks(rows);
  // NavPaS's cytoplasmic N-terminus is all here, residue for residue.
  const nterm = row(rows, "D0E0C2", "Cytoplasmic", 1);
  assert.deepEqual([nterm.placed.region!.start, nterm.placed.region!.end, nterm.placed.placement], [1, 140, "whole"]);
  assert.equal(regionIdentity(nterm.placed.match), 1);
  assert.ok(ticked.has(nterm.id));
  // Nav1.7's own N-terminus isn't: what lines up of it is too unlike to start ticked.
  const own = row(rows, "Q62205", "Cytoplasmic", 1);
  assert.ok(!ticked.has(own.id));
  // Nav1.7's first helix follows it, at the CDS's own numbers, with NavPaS's as a weaker rival.
  const tm1 = row(rows, "Q62205", "TM1");
  assert.deepEqual([tm1.placed.region!.start, tm1.placed.region!.end, tm1.placed.region!.sourceStart, tm1.placed.region!.sourceEnd], [141, 160, 126, 145]);
  assert.ok(ticked.has(tm1.id));
  const theirs = row(rows, "D0E0C2", "TM1");
  assert.ok(theirs.placed.region && regionIdentity(theirs.placed.match) < 0.8);
  assert.ok(!ticked.has(theirs.id));
  assert.ok(tm1.rivals.some(x => x.accession === "D0E0C2" && x.name === "TM1" && !x.strong && !x.onCds));
  assert.ok(theirs.rivals.some(x => x.accession === "Q62205" && x.name === "TM1" && x.strong));
  // No two rows claiming the same residues both start ticked.
  for (const r of rows) if (ticked.has(r.id)) assert.ok(!r.rivals.some(x => x.strong), `${r.id} starts ticked beside a strong rival`);
  // Every row says where it is from.
  assert.ok(rows.every(r => r.id.startsWith(`${r.accession} `) && (!r.placed.region || r.placed.region.accession === r.accession)));
});

test("both entries' regions go on the one CDS, each with its own source", () => {
  const entries = [lookUp(chimera, nav17), lookUp(chimera, navpas)];
  const rows = importRows([], entries);
  const result = applyImport([], rows, ticks(rows), "#b7e6d7");
  assert.deepEqual(result.from, ["Q62205", "D0E0C2"]);
  assert.equal(result.added, ticks(rows).size);
  assert.equal(result.moved, 0);
  const tm1 = result.regions.find(r => r.name === "TM1")!;
  assert.deepEqual([tm1.accession, tm1.start, tm1.end, tm1.sourceStart, tm1.sourceEnd, tm1.sourceKey], ["Q62205", 141, 160, 126, 145, "Transmembrane:126-145"]);
  const nterm = result.regions.find(r => r.accession === "D0E0C2" && r.name === "Cytoplasmic")!;
  assert.deepEqual([nterm.start, nterm.end, nterm.sourceStart, nterm.sourceEnd, nterm.sourceKey], [1, 140, 1, 140, "Topological domain:1-140"]);
  assert.ok(result.regions.every(r => r.id && r.color));
  // Neither is the CDS's protein, so neither becomes its cross-reference; one there stays.
  assert.deepEqual(importNotes({ db_xref: ["GeneID:1"] }, result.regions, entries, result.from), { db_xref: ["GeneID:1"] });
});

test("two entries that both fit a stretch are left for the user to choose, and both can be added", () => {
  const cds = nav17.sequence.slice(100, 500);
  // A close homologue: every tenth residue changed.
  const close: UniprotEntry = { ...nav17, accession: "P99999", sequence: [...nav17.sequence].map((c, i) => (i % 10 === 5 ? (c === "W" ? "Y" : "W") : c)).join(""), features: [...nav17.features, { name: "Motif in TM1", kind: "Motif", start: 130, end: 137, predicted: false }] };
  const rows = importRows([], [lookUp(cds, nav17), lookUp(cds, close)]);
  const ticked = ticks(rows);
  const mine = row(rows, "Q62205", "TM1");
  const theirs = row(rows, "P99999", "TM1");
  assert.ok(mine.strong && theirs.strong);
  assert.deepEqual([mine.placed.region!.start, mine.placed.region!.end], [theirs.placed.region!.start, theirs.placed.region!.end]);
  assert.ok(!ticked.has(mine.id) && !ticked.has(theirs.id));
  assert.ok(mine.rivals.some(x => x.accession === "P99999" && x.strong));
  // A motif inside the helix is another kind of annotation, not a rival.
  const motif = row(rows, "P99999", "Motif in TM1");
  assert.deepEqual(motif.rivals, []);
  assert.ok(ticked.has(motif.id));
  // Ticking both adds both: overlapping annotations are the user's to keep.
  const result = applyImport([], rows, new Set([mine.id, theirs.id, motif.id]));
  assert.deepEqual(result.regions.map(r => `${r.accession} ${r.name}`), ["Q62205 TM1", "P99999 TM1", "P99999 Motif in TM1"]);
});

test("limiting an entry to the CDS residues the user knows keeps whole-CDS numbers and flags the cut", () => {
  // NavPaS limited to the first 120 residues: its N-terminal stretch (1–140) is cut by it.
  const limited = lookUp(chimera, navpas, { start: 1, end: 120 });
  const rows = importRows([], [lookUp(chimera, nav17), limited]);
  const nterm = row(rows, "D0E0C2", "Cytoplasmic", 1);
  assert.deepEqual([nterm.placed.placement, nterm.placed.pastLimit, nterm.placed.region!.start, nterm.placed.region!.end], ["clipped", true, 1, 120]);
  assert.ok(!startsTicked(nterm, []));
  assert.ok(tickable(nterm));
  // Its helices are past the limit, so they can't be placed and can't rival Nav1.7's.
  const theirs = row(rows, "D0E0C2", "TM1");
  assert.deepEqual([theirs.state, theirs.placed.pastLimit], ["absent", true]);
  assert.ok(row(rows, "Q62205", "TM1").rivals.every(x => x.accession !== "D0E0C2"));
  // Nav1.7 limited to start after the junction still numbers residues as the CDS does.
  const after = importRows([], [lookUp(chimera, nav17, { start: 141, end: chimera.length })]);
  assert.deepEqual([row(after, "Q62205", "TM1").placed.region!.start, row(after, "Q62205", "TM1").placed.region!.end], [141, 160]);
});

test("importing again keeps what is there, its ids and colours, and adds nothing twice", () => {
  const entries = [lookUp(chimera, nav17), lookUp(chimera, navpas)];
  const first = importRows([], entries);
  const manual: ProteinRegion = { id: "mine", name: "Pore loop I", kind: "Region", start: 300, end: 320, accession: "", sourceStart: 300, sourceEnd: 320, predicted: false, color: "#d57479" };
  const elsewhere: ProteinRegion = { id: "other", name: "Tag", kind: "Tag", start: 5, end: 12, accession: "P00001", sourceStart: 1, sourceEnd: 8, predicted: false, color: "#849b48" };
  const imported = applyImport([manual, elsewhere], first, ticks(first)).regions;
  // The user edits one imported helix locally (a moved end), and another moves on the CDS.
  const tm2 = imported.find(r => r.name === "TM2" && r.accession === "Q62205")!;
  const tm3 = imported.find(r => r.name === "TM3" && r.accession === "Q62205")!;
  const before = imported.map(r => (r === tm2 ? { ...r, end: r.end - 2, sourceEnd: r.sourceEnd - 2, edited: true } : r === tm3 ? { ...r, start: r.start + 1, sourceStart: r.sourceStart + 1 } : r));
  const again = importRows(before, entries);
  assert.equal(row(again, "Q62205", "TM1").state, "same");
  assert.equal(row(again, "Q62205", "TM2").state, "edited");
  assert.equal(row(again, "Q62205", "TM3").state, "moved");
  assert.ok(!tickable(row(again, "Q62205", "TM1")) && !tickable(row(again, "Q62205", "TM2")));
  // Nothing starts ticked: both entries were imported before, so what was left out stays out.
  assert.equal(ticks(again, before).size, 0);
  const unchanged = applyImport(before, again, ticks(again, before));
  assert.deepEqual([unchanged.added, unchanged.moved], [0, 0]);
  assert.deepEqual(new Set(unchanged.regions), new Set(before));
  // Ticking everything tickable adds the rest and moves TM3 back, keeping its id and colour.
  const all = new Set(again.filter(tickable).map(r => r.id));
  const result = applyImport(before, again, all);
  const moved = result.regions.find(r => r.id === tm3.id)!;
  assert.deepEqual([moved.start, moved.sourceStart, moved.color], [tm3.start, tm3.sourceStart, regionColor(tm3)]);
  assert.equal(result.moved, 1);
  assert.equal(result.regions.filter(r => r.accession === "Q62205" && r.name === "TM1").length, 1);
  assert.equal(result.regions.filter(r => r.accession === "Q62205" && r.name === "TM2").length, 1);
  assert.deepEqual(result.regions.find(r => r.id === tm2.id), before.find(r => r.id === tm2.id));
  assert.ok(result.regions.includes(before.find(r => r.id === "mine")!));
  assert.ok(result.regions.includes(before.find(r => r.id === "other")!));
  const keys = result.regions.filter(r => r.accession).map(r => `${r.accession} ${r.sourceKey}`);
  assert.equal(new Set(keys).size, keys.length);
});

test("a region whose numbers UniProt changed is found again by its name, not added twice", () => {
  const cds = nav17.sequence.slice(100, 500);
  const old: ProteinRegion = { id: "tm1", name: "TM1", kind: "Transmembrane", start: 26, end: 45, accession: "Q62205", sourceStart: 125, sourceEnd: 144, predicted: true, sourceKey: "Transmembrane:125-144", color: "#4f8fba" };
  const rows = importRows([old], [lookUp(cds, nav17)]);
  const tm1 = row(rows, "Q62205", "TM1");
  assert.equal(tm1.state, "moved");
  assert.equal(tm1.existing, old);
  const result = applyImport([old], rows, new Set([tm1.id]));
  assert.deepEqual(result.regions.filter(r => r.name === "TM1").map(r => [r.id, r.start, r.sourceStart, r.sourceKey, r.color]), [["tm1", 26, 126, "Transmembrane:126-145", "#4f8fba"]]);
});

test("a region of the CDS from elsewhere over the same residues holds back a new one", () => {
  const cds = nav17.sequence.slice(100, 500);
  const theirs: ProteinRegion = { id: "s1", name: "S1", kind: "Transmembrane", start: 27, end: 46, accession: "D0E0C2", sourceStart: 141, sourceEnd: 159, predicted: false };
  const rows = importRows([theirs], [lookUp(cds, nav17)]);
  const tm1 = row(rows, "Q62205", "TM1");
  assert.deepEqual(tm1.rivals, [{ accession: "D0E0C2", name: "S1", start: 27, end: 46, strong: true, onCds: true }]);
  assert.ok(!startsTicked(tm1, [theirs]));
  assert.ok(startsTicked(row(rows, "Q62205", "TM2"), [theirs]));
  // A loop the user marked holds no shorter region of its kind inside it back.
  const loop: ProteinRegion = { id: "loop", name: "Loop I", kind: "Topological domain", start: 20, end: 160, accession: "", sourceStart: 20, sourceEnd: 160, predicted: false };
  const inside = importRows([loop], [lookUp(cds, nav17)]).filter(r => r.placed.feature.kind === "Topological domain" && r.placed.region && r.placed.region.end - r.placed.region.start < 60);
  assert.ok(inside.length > 0);
  assert.ok(inside.every(r => r.rivals.length === 0));
});

test("an entry becomes the CDS's cross-reference only as the CDS's own protein", () => {
  const one = [{ accession: "Q62205", reviewed: true }];
  const tm: ProteinRegion = { name: "TM1", kind: "Transmembrane", start: 1, end: 20, accession: "Q62205", sourceStart: 126, sourceEnd: 145, predicted: true };
  // The one entry looked up, giving every imported region of a CDS that had no entry.
  assert.deepEqual(importNotes({ gene: ["Scn9a"] }, [tm], one, ["Q62205"]), { gene: ["Scn9a"], db_xref: ["UniProtKB/Swiss-Prot:Q62205"] });
  // Not when it gave nothing, nor beside another entry's regions, nor over another entry.
  assert.deepEqual(importNotes({}, [tm], one, []), {});
  assert.deepEqual(importNotes({}, [tm, { ...tm, accession: "D0E0C2" }], one, ["Q62205"]), {});
  assert.deepEqual(importNotes({ db_xref: ["UniProtKB/Swiss-Prot:D0E0C2"] }, [tm], one, ["Q62205"]), { db_xref: ["UniProtKB/Swiss-Prot:D0E0C2"] });
  // An entry already named is updated in place.
  assert.deepEqual(importNotes({ db_xref: ["UniProtKB/TrEMBL:Q62205"] }, [tm], one, ["Q62205"]), { db_xref: ["UniProtKB/Swiss-Prot:Q62205"] });
});

test("the entries a CDS used are remembered from its cross-references and its regions", () => {
  const regions: ProteinRegion[] = [
    { name: "N-terminus", kind: "Topological domain", start: 1, end: 140, accession: "D0E0C2", sourceStart: 1, sourceEnd: 140, predicted: false },
    { name: "Mine", kind: "Region", start: 150, end: 160, accession: "", sourceStart: 150, sourceEnd: 160, predicted: false },
    { name: "TM1", kind: "Transmembrane", start: 141, end: 160, accession: "Q62205", sourceStart: 126, sourceEnd: 145, predicted: true }
  ];
  assert.deepEqual(rememberedEntries({ notes: withRegions({ db_xref: ["GeneID:1", "UniProtKB/Swiss-Prot:Q62205"] }, regions) }), ["Q62205", "D0E0C2"]);
  assert.deepEqual(rememberedEntries({ notes: {} }), []);
});

// The chimera's protein as DNA: a codon per residue, enough to translate it back.
const CODONS: Record<string, string> = { A: "GCT", R: "CGT", N: "AAT", D: "GAT", C: "TGT", Q: "CAA", E: "GAA", G: "GGT", H: "CAT", I: "ATT", L: "CTG", K: "AAA", M: "ATG", F: "TTT", P: "CCG", S: "TCT", T: "ACC", W: "TGG", Y: "TAT", V: "GTT" };

test("imported regions keep their sources through saving, and are found again after", async () => {
  const dna = [...chimera].map(c => CODONS[c]).join("") + "TAA";
  const blank: SeqData = { name: "chimera", description: "", circular: false, sequence: dna, features: [{ id: "cds", name: "chimera CDS", type: "CDS", start: 0, end: dna.length - 1, strand: 1, notes: {}, raw: {} }], primers: [], sources: [] };
  assert.equal(translate(blank.features[0], dna).replace(/\*$/, ""), chimera);
  const entries = [lookUp(chimera, nav17), lookUp(chimera, navpas)];
  const rows = importRows([], entries);
  const result = applyImport([], rows, ticks(rows));
  const notes = withRegions(importNotes({}, result.regions, entries, result.from), result.regions);
  const d = { ...blank, features: [{ ...blank.features[0], notes }] };
  const text = serialize(toParsed({ data: d, extra: {}, wholeSources: [] }, d), "genbank");
  const back = fromParsed((await parseSequenceFile(new TextEncoder().encode(text), "chimera.gb")).sequences[0]).data;
  const cds = back.features.find(f => f.type === "CDS")!;
  const saved = regionsOf(cds);
  const fields = (r: ProteinRegion) => [r.id, r.name, r.accession, r.start, r.end, r.sourceStart, r.sourceEnd, r.sourceKey, r.color];
  assert.deepEqual(saved.map(fields), result.regions.map(fields));
  // Neither became the cross-reference, so they come in the order their regions do.
  assert.deepEqual(rememberedEntries(cds), ["D0E0C2", "Q62205"]);
  // Opened again, both entries find every region they gave, so another import adds none.
  const again = importRows(saved, entries);
  assert.ok(again.filter(r => ticks(rows).has(r.id)).every(r => r.state === "same"));
  assert.equal(applyImport(saved, again, ticks(again, saved)).added, 0);
});
