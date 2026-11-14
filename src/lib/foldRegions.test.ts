// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Turning features inside a CDS into its protein regions. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseSequenceFile } from "../doc/fileio.ts";
import { fromParsed } from "../doc/convert.ts";
import { DocStore } from "../doc/store.ts";
import { foldFeatures, foldOffered, foldRows, foldTargets, kindFromName, type FoldRow } from "./foldRegions.ts";
import { proteinRegionFeatures, REGIONS_QUALIFIER, regionsOf, withRegions, type ProteinRegion } from "./regions.ts";
import { VARIABLE_QUALIFIER } from "./variable.ts";
import { reverseComplement, type Range, type SeqData, type SeqFeature } from "./seqdata.ts";

const root = new URL("../../", import.meta.url);
const load = async (path: string) => fromParsed((await parseSequenceFile(new Uint8Array(readFileSync(new URL(path, root))), path)).sequences[0]).data;

/** 21 residues and a stop, each codon a different amino acid. */
const CODING = "ATGGCTTGTGATGAATTTGGTCATATTAAACTTATGAATCCTCAACGTTCTACTGTTTGGTATTAA";
const BEFORE = 10;

/** A sequence holding one CDS (id "cds", 10..75), and these features. */
function doc(features: SeqFeature[], opts: { strand?: 1 | -1; regions?: ProteinRegion[]; cds?: Partial<SeqFeature> } = {}): SeqData {
  const coding = opts.strand === -1 ? reverseComplement(CODING) : CODING;
  const cds: SeqFeature = { id: "cds", name: "Binder", type: "CDS", start: BEFORE, end: BEFORE + coding.length - 1, strand: opts.strand ?? 1, notes: withRegions({}, opts.regions ?? []), raw: {}, ...opts.cds };
  return { name: "t", description: "", circular: false, sequence: "C".repeat(BEFORE) + coding + "C".repeat(10), features: [cds, ...features], primers: [], sources: [] };
}

/** The bases of residues `a`–`b` of the CDS, on whichever strand it runs. */
function bases(a: number, b: number, strand: 1 | -1 = 1): Range {
  if (strand === 1) return { start: BEFORE + (a - 1) * 3, end: BEFORE + b * 3 - 1 };
  const last = BEFORE + CODING.length - 1;
  return { start: last - b * 3 + 1, end: last - (a - 1) * 3 };
}

let made = 0;
function feature(name: string, type: string, at: Range, more: Partial<SeqFeature> = {}): SeqFeature {
  return { id: `f${++made}`, name, type, ...at, strand: 1, notes: {}, raw: {}, ...more };
}

const cdsOf = (d: SeqData) => d.features.find(f => f.id === "cds")!;
const rows = (d: SeqData) => foldRows(d, cdsOf(d));
const named = (d: SeqData) => rows(d).map(r => r.feature.name);
const row = (d: SeqData, name: string) => rows(d).find(r => r.feature.name === name)!;
/** Folds every listed feature that can be, with the kinds suggested. */
function foldAll(d: SeqData, pick = (r: FoldRow) => r.tickable) {
  let n = 0;
  return foldFeatures(d, "cds", new Map(rows(d).filter(pick).map(r => [r.feature.id, r.region.kind])), { makeId: () => `r${++n}` });
}

test("a library's frameworks and CDRs become the regions the curated file has for them", async () => {
  const library = await load("testdata/library/library-parent.gb");
  const curated = regionsOf((await load("testdata/library/protein-regions.gb")).features.find(f => f.name === "Nanobody")!);
  // The CDS the curated file adds, over the nanobody's frameworks and CDRs.
  const nanobody: SeqFeature = { id: "cds", name: "Nanobody", type: "CDS", start: 2096, end: 2449, strand: 1, notes: {}, raw: {} };
  const d = { ...library, features: [...library.features, nanobody] };
  const listed = rows(d);
  // Frameworks are annotated as CDSs without a direction, and CDR3 as a variation.
  assert.deepEqual(listed.map(r => [r.feature.name, r.feature.type, r.start, r.end, r.region.kind]), [
    ["FR1", "CDS", 1, 25, "Framework"],
    ["cdr1", "CDS", 26, 35, "CDR"],
    ["FR2", "CDS", 36, 49, "Framework"],
    ["cdr2", "CDS", 50, 59, "CDR"],
    ["FR3", "CDS", 60, 96, "Framework"],
    ["cdr3", "variation", 97, 107, "CDR"],
    ["FR4", "CDS", 108, 118, "Framework"]
  ]);
  assert.ok(listed.every(r => r.ticked && !r.flags.length && !r.lost.length), "ApE's colours and directions are nothing lost");
  assert.equal(foldOffered(listed), 7);
  const folded = foldAll(d)!.data;
  const regions = regionsOf(folded.features.find(f => f.name === "Nanobody")!);
  const want = curated.filter(r => r.name !== "Variable domain").map(r => [r.name.toUpperCase(), r.kind, r.start, r.end]);
  assert.deepEqual(regions.map(r => [r.name.toUpperCase(), r.kind, r.start, r.end]), want);
  assert.equal(new Set(regions.map(r => r.color)).size, 7, "each gets a colour of its own");
  assert.deepEqual(folded.features.length, d.features.length - 7);
  assert.ok(!folded.features.some(f => ["FR1", "cdr1", "cdr3", "FR4"].includes(f.name)));
  // The rest of the file is untouched.
  assert.deepEqual(folded.features.filter(f => f.name !== "Nanobody"), d.features.filter(f => !listed.some(r => r.feature === f) && f.name !== "Nanobody"));
});

test("only parts of a protein are listed, not DNA marked inside it", () => {
  const at = bases(3, 6);
  const d = doc([
    ...["promoter", "primer_bind", "protein_bind", "gene", "mRNA", "exon", "intron", "RBS", "rep_origin", "misc_binding", "repeat_region", "misc_difference"].map(t => feature(`a ${t}`, t, at)),
    ...["MCS", "Multiple cloning site", "loxP", "lox2272", "FRT", "attB1", "lac operator", "T7 promoter", "f1 ori", "polyA signal", "Kozak", "primer site"].map(n => feature(n, "misc_feature", at)),
    feature("Hinge", "misc_feature", at),
    feature("K97A", "variation", at),
    feature("Leader", "sig_peptide", at),
    feature("Transit", "transit_peptide", at),
    feature("Mature", "mat_peptide", at),
    feature("Pro", "propeptide", at),
    feature("Spacer", "Linker", at),
    feature("Epitope", "epitope", at),
    feature("Loop", "Region", at)
  ]);
  assert.deepEqual(named(d).sort(), ["Epitope", "Hinge", "K97A", "Leader", "Loop", "Mature", "Pro", "Spacer", "Transit"]);
});

test("every base must be in the protein: not past its ends, in an intron or only its stop", () => {
  const d = doc([
    feature("Across the start", "misc_feature", { start: BEFORE - 3, end: BEFORE + 5 }),
    feature("Across the end", "misc_feature", { start: BEFORE + 60, end: BEFORE + 70 }),
    feature("Stop", "misc_feature", bases(22, 22)),
    feature("Tag and stop", "misc_feature", bases(19, 22)),
    feature("First", "misc_feature", bases(1, 1))
  ]);
  assert.deepEqual(rows(d).map(r => [r.feature.name, r.start, r.end, r.flags.join()]), [["First", 1, 1, ""], ["Tag and stop", 19, 21, ""]]);
  // A CDS whose reading starts at its second base has no residue in its first.
  const partial = doc([feature("Before the frame", "misc_feature", { start: BEFORE - 1, end: BEFORE - 1 }), feature("First whole codon", "misc_feature", bases(1, 1))], { cds: { start: BEFORE - 1, notes: { codon_start: ["2"] } } });
  assert.deepEqual(named(partial), ["First whole codon"]);

  // Spliced: 7 codons, an intron, then the rest.
  const intron = "GTAAGCCCAG";
  const sequence = "C".repeat(BEFORE) + CODING.slice(0, 21) + intron + CODING.slice(21) + "C".repeat(10);
  const exon2 = BEFORE + 21 + intron.length;
  const cds: SeqFeature = { id: "cds", name: "Spliced", type: "CDS", start: BEFORE, end: exon2 + 44, strand: 1, locations: [{ start: BEFORE, end: BEFORE + 20 }, { start: exon2, end: exon2 + 44 }], notes: {}, raw: {} };
  const spliced: SeqData = {
    ...doc([]),
    sequence,
    features: [
      cds,
      feature("In the intron", "misc_feature", { start: BEFORE + 22, end: BEFORE + 27 }),
      feature("Over the intron", "misc_feature", { start: BEFORE + 18, end: exon2 + 2 }),
      feature("Exon by exon", "misc_feature", { start: BEFORE + 18, end: exon2 + 2 }, { locations: [{ start: BEFORE + 18, end: BEFORE + 20 }, { start: exon2, end: exon2 + 2 }] })
    ]
  };
  assert.deepEqual(rows(spliced).map(r => [r.feature.name, r.start, r.end, r.flags.join()]), [["Exon by exon", 7, 8, ""]]);
});

test("rows are flagged for part codons, the other strand and pieces, and ticked to suit", () => {
  const d = doc([
    // From the second base of residue 3 to the first of residue 5: residues 3–5.
    feature("Ragged", "misc_feature", { start: bases(3, 3).start + 1, end: bases(5, 5).start }),
    feature("Backwards", "misc_feature", bases(7, 8), { strand: -1 }),
    feature("No direction", "misc_feature", bases(9, 10), { strand: 0 }),
    feature("Benchling's", "misc_feature", bases(11, 12), { notes: { benchling_strand: ["none"] } }),
    feature("Two pieces", "misc_feature", bases(14, 18), { locations: [bases(14, 14), bases(18, 18)] })
  ]);
  const flags = Object.fromEntries(rows(d).map(r => [r.feature.name, [r.start, r.end, r.flags.join(), r.ticked, r.tickable]]));
  assert.deepEqual(flags, {
    Ragged: [3, 5, "partial-codon", true, true],
    Backwards: [7, 8, "opposite-strand", false, true],
    "No direction": [9, 10, "", true, true],
    "Benchling's": [11, 12, "", true, true],
    "Two pieces": [14, 18, "pieces", false, false]
  });
  assert.equal(foldOffered(rows(d)), 3);
  // On a reverse CDS, a feature drawn on the reverse strand is on its strand.
  const reverse = doc([feature("Same way", "misc_feature", bases(2, 4, -1), { strand: -1 }), feature("Other way", "misc_feature", bases(6, 6, -1))], { strand: -1 });
  assert.deepEqual(rows(reverse).map(r => [r.feature.name, r.start, r.end, r.flags.join()]), [["Same way", 2, 4, ""], ["Other way", 6, 6, "opposite-strand"]]);
  // Pieces can't be one region, so the right-click doesn't offer it.
  assert.deepEqual(foldTargets(d, d.features.find(f => f.name === "Two pieces")!), []);
  assert.deepEqual(foldTargets(d, d.features.find(f => f.name === "Backwards")!).map(t => t.cds.id), ["cds"]);
});

test("a CDS inside is listed when it reads on in the same frame, and brings its regions", () => {
  const inFrame = feature("EGFP", "CDS", bases(4, 15), { notes: withRegions({}, [{ name: "Chromophore", kind: "Motif", start: 2, end: 3, accession: "", sourceStart: 2, sourceEnd: 3, predicted: false, id: "chromo" }, { name: "Barrel", kind: "Domain", start: 1, end: 10, accession: "P42212", sourceStart: 20, sourceEnd: 29, predicted: false, id: "barrel" }]) });
  const d = doc([
    inFrame,
    feature("Shifted", "CDS", { start: bases(4, 4).start + 1, end: bases(10, 10).end + 1 }),
    feature("Antisense", "CDS", bases(4, 10), { strand: -1 }),
    feature("Whole", "CDS", bases(1, 22))
  ]);
  assert.deepEqual(named(d), ["EGFP"]);
  assert.equal(row(d, "EGFP").region.kind, "Domain", "a protein fused in is a domain unless its name says more");
  const folded = foldAll(d)!.data;
  const regions = regionsOf(cdsOf(folded));
  assert.deepEqual(regions.map(r => [r.name, r.start, r.end, r.sourceStart, r.parentId]), [
    ["Barrel", 4, 13, 20, "r1"],
    ["EGFP", 4, 15, 4, undefined],
    ["Chromophore", 5, 6, 5, "r1"]
  ]);
  assert.ok(!folded.features.some(f => f.name === "EGFP"));
});

test("kinds come from what a region wrote, then the type, then the name", () => {
  const at = bases(2, 4);
  const d = doc([
    feature("pelB", "sig_peptide", at),
    feature("nsp1", "mat_peptide", at),
    feature("Pro", "propeptide", at),
    feature("Transit", "transit_peptide", at),
    feature("Spacer", "tag", at),
    feature("CDR3", "misc_feature", at),
    feature("Loop", "misc_feature", at),
    feature("Signal", "misc_feature", at, { notes: { note: ["Linker"] } })
  ]);
  assert.deepEqual(Object.fromEntries(rows(d).map(r => [r.feature.name, r.region.kind])), {
    pelB: "Signal peptide",
    nsp1: "Chain",
    Pro: "Propeptide",
    Transit: "Transit peptide",
    Spacer: "Tag",
    CDR3: "CDR",
    Loop: "Region",
    Signal: "Linker"
  });
  assert.equal(row(d, "Signal").region.note, undefined, "the kind it wrote isn't kept as a note");
});

test("names suggest the kinds labs use, without matching inside other words", () => {
  const kinds: Record<string, string | null> = {
    "CDR-H3": "CDR", HCDR2: "CDR", cdr1: "CDR", "VH-CDR1": "CDR",
    FR1: "Framework", FWR2: "Framework", "Framework 3": "Framework", "FR-H1": "Framework", FRT: null,
    VHH: "Variable domain", VH: "Variable domain", VL: "Variable domain", "anti-GFP nanobody": "Variable domain",
    CH1: "Constant domain", Fc: "Constant domain", CL: "Constant domain",
    "(G4S)3": "Linker", "GS linker": "Linker", GGGGS: "Linker",
    "TEV site": "Cleavage site", "HRV 3C": "Cleavage site", "Thrombin site": "Cleavage site", "Factor Xa": "Cleavage site",
    "6xHis": "Tag", His6: "Tag", "8xHis": "Tag", FLAG: "Tag", "3xFLAG": "Tag", HA: "Tag", Myc: "Tag", "c-Myc": "Tag", V5: "Tag", "Strep-Tag II": "Tag", AviTag: "Tag", SpyTag: "Tag",
    P2A: "Peptide", T2A: "Peptide",
    TM1: "Transmembrane", TMD: "Transmembrane", "Transmembrane helix": "Transmembrane",
    "SV40 NLS": "Motif", NES: "Motif", KDEL: "Motif",
    "pelB leader": "Signal peptide", "Signal peptide": "Signal peptide", SP: "Signal peptide", "IgK leader": "Signal peptide",
    "Kinase domain": "Domain", GST: "Domain",
    Histone: null, "This loop": null, Hinge: null, Spacer: null
  };
  for (const [name, kind] of Object.entries(kinds)) assert.equal(kindFromName(name), kind, name);
  // Every protein part the catalog finds gets a kind of its own.
  const catalog = readFileSync(new URL("crates/seqcore/data/parts.tsv", root), "utf8").split("\n").filter(l => l && !l.startsWith("#")).map(l => l.split("\t"));
  for (const [, name] of catalog.filter(c => c[2] === "misc_feature")) assert.ok(kindFromName(name), name);
});

test("an exported copy turns back into the regions it was made from", () => {
  const regions: ProteinRegion[] = [
    { id: "sp", name: "Signal", kind: "Signal peptide", start: 1, end: 2, accession: "", sourceStart: 1, sourceEnd: 2, predicted: false, color: "#d57479" },
    { id: "tm", name: "TM1", kind: "Transmembrane", start: 3, end: 5, accession: "Q9UKG4", sourceStart: 13, sourceEnd: 15, predicted: true, color: "#4f8fba", note: "First helix\nchecked by AlphaFold" },
    { id: "vhh", name: "VHH", kind: "Variable domain", start: 6, end: 18, accession: "", sourceStart: 6, sourceEnd: 18, predicted: false, color: "#58a68c" },
    { id: "cdr", name: "CDR1", kind: "My CDR", start: 8, end: 10, accession: "", sourceStart: 8, sourceEnd: 10, predicted: false, color: "#d99049", parentId: "vhh" }
  ];
  const original = doc([], { regions });
  const exported = proteinRegionFeatures(cdsOf(original), original.sequence.length);
  const describe = (r: ProteinRegion) => [r.name, r.kind, r.start, r.end, r.accession, r.sourceStart, r.sourceEnd, r.predicted, r.color, r.note, !!r.parentId];
  // Through software that keeps the features but not Strandivo's own qualifier.
  const { [REGIONS_QUALIFIER]: _gone, ...plain } = cdsOf(original).notes;
  const elsewhere = { ...original, features: [{ ...cdsOf(original), notes: plain }, ...exported] };
  assert.ok(rows(elsewhere).every(r => r.ticked && !r.lost.length));
  const back = regionsOf(cdsOf(foldAll(elsewhere)!.data));
  assert.deepEqual(back.map(describe), regionsOf(cdsOf(original)).map(describe));
  // The copy itself also keeps them on its CDS: each feature is already a region, so only
  // the feature goes, and nothing starts ticked.
  const copy = { ...original, features: [...original.features, ...exported] };
  assert.ok(rows(copy).every(r => r.flags.includes("duplicate") && !r.ticked));
  assert.equal(foldOffered(rows(copy)), 0);
  const tidied = foldAll(copy)!.data;
  assert.deepEqual(tidied.features.map(f => f.id), ["cds"]);
  assert.deepEqual(regionsOf(cdsOf(tidied)), regionsOf(cdsOf(original)));
});

test("a feature's colour, note and library design carry over; other qualifiers are named as lost", () => {
  const at = bases(2, 4);
  const d = doc([
    feature("Own colour", "misc_feature", at, { color: "#aa3377" }),
    feature("CDS colour", "misc_feature", bases(5, 6), { color: "#E8A83E" }),
    feature("White", "misc_feature", bases(7, 8), { color: "#ffffff" }),
    feature("Designed", "misc_feature", bases(9, 11), { notes: { [VARIABLE_QUALIFIER]: ["NNK"], note: ["Randomised", " second line "], gene: ["vhh"], product: ["binder"], ApEinfo_fwdcolor: ["#c6c9d1"], label: ["Designed"], translation: ["XXX"] } })
  ]);
  const fills = new Map([["cds", { fill: "#E8A83E" }], ...d.features.filter(f => f.id !== "cds").map(f => [f.id, { fill: f.color === "#ffffff" ? "#A3A9B4" : f.color ?? "#A3A9B4" }] as const)]);
  const listed = foldRows(d, cdsOf(d), fills);
  const by = (name: string) => listed.find(r => r.feature.name === name)!;
  assert.equal(by("Own colour").region.color, "#aa3377");
  assert.equal(by("CDS colour").region.color, undefined, "a stripe in the CDS's own colour wouldn't show");
  assert.equal(by("White").region.color, undefined, "the app doesn't draw white, so neither does the region");
  assert.deepEqual(by("Designed").region.variable, { kind: "pattern", pattern: "NNK" });
  assert.equal(by("Designed").region.note, "Randomised\nsecond line");
  assert.deepEqual(by("Designed").lost, ["gene", "product"]);
  // Without colours, regions get the palette's, none the same as another.
  const folded = regionsOf(cdsOf(foldFeatures(d, "cds", new Map(listed.map(r => [r.feature.id, r.region.kind])), { fills })!.data));
  assert.equal(folded.find(r => r.name === "Own colour")!.color, "#aa3377");
  assert.equal(new Set(folded.map(r => r.color)).size, 4);

  // A CDS that varies as a whole can't have a region that varies.
  const whole = doc([feature("Designed", "misc_feature", at, { notes: { [VARIABLE_QUALIFIER]: ["NNK"] } })], { cds: { notes: { [VARIABLE_QUALIFIER]: ["any"] } } });
  assert.deepEqual([row(whole, "Designed").region.variable, row(whole, "Designed").lost], [undefined, ["library design"]]);
  // Of two designs that overlap, the first keeps its own.
  const two = doc([feature("A", "misc_feature", bases(2, 6), { notes: { [VARIABLE_QUALIFIER]: ["NNK"] } }), feature("B", "misc_feature", bases(5, 9), { notes: { [VARIABLE_QUALIFIER]: ["any"] } })]);
  assert.deepEqual(regionsOf(cdsOf(foldAll(two)!.data)).map(r => [r.name, r.variable?.kind]), [["A", "pattern"], ["B", undefined]]);
});

test("a region goes under the smallest region that holds it; the same extent or an overlap stays apart", () => {
  const whole: ProteinRegion = { id: "whole", name: "Whole", kind: "Domain", start: 1, end: 21, accession: "", sourceStart: 1, sourceEnd: 21, predicted: false };
  const d = doc([
    feature("VHH", "misc_feature", bases(1, 15)),
    feature("Twin", "misc_feature", bases(1, 15)),
    feature("CDR1", "misc_feature", bases(3, 5)),
    feature("Loop", "misc_feature", bases(3, 4)),
    feature("Across", "misc_feature", bases(14, 18))
  ], { regions: [whole] });
  const folded = regionsOf(cdsOf(foldAll(d)!.data));
  const parent = (name: string) => folded.find(r => r.id === folded.find(x => x.name === name)!.parentId)?.name;
  assert.equal(parent("VHH"), "Whole");
  assert.equal(parent("Twin"), "Whole", "the same extent stays apart");
  assert.ok(["VHH", "Twin"].includes(parent("CDR1")!));
  assert.equal(parent("Loop"), "CDR1");
  assert.equal(parent("Across"), "Whole", "an overlap stays apart");
  assert.deepEqual(folded.find(r => r.id === "whole"), whole, "a region already there is left as it was");
});

test("only the chosen features change, as one undo step", () => {
  const d = doc([feature("A", "misc_feature", bases(2, 4)), feature("B", "misc_feature", bases(6, 8)), feature("Away", "misc_feature", { start: 1, end: 5 })]);
  const a = d.features.find(f => f.name === "A")!;
  const result = foldFeatures(d, "cds", new Map([[a.id, "Linker"]]), { makeId: () => "new" })!;
  assert.deepEqual(result.data.features.map(f => f.name), ["Binder", "B", "Away"]);
  assert.deepEqual(regionsOf(cdsOf(result.data)).map(r => [r.id, r.name, r.kind]), [["new", "A", "Linker"]]);
  assert.deepEqual([...result.regionIds], [[a.id, "new"]]);
  assert.equal(foldFeatures(d, "cds", new Map()), null);
  const store = new DocStore(d);
  store.apply(result.data, "Turn features into regions");
  assert.equal(store.data, result.data);
  store.undo();
  assert.equal(store.data, d);
});

test("a feature in two proteins can go to either", () => {
  const d = doc([
    feature("Inner", "CDS", bases(4, 12)),
    feature("Tag", "misc_feature", bases(5, 7))
  ]);
  const tag = d.features.find(f => f.name === "Tag")!;
  assert.deepEqual(foldTargets(d, tag).map(t => [t.cds.name, t.row.start, t.row.end]), [["Binder", 5, 7], ["Inner", 2, 4]]);
  // The inner CDS is itself a part of the outer protein.
  assert.deepEqual(named(d), ["Inner", "Tag"]);
  assert.deepEqual(foldRows(d, d.features.find(f => f.name === "Inner")!).map(r => r.feature.name), ["Tag"]);
});
