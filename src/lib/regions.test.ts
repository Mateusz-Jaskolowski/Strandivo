// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Regions of a protein inside a CDS: the qualifier and what edits do to them. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSequenceFile, serialize } from "../doc/fileio.ts";
import { fromParsed, toParsed } from "../doc/convert.ts";
import { protein } from "../doc/analysis.ts";
import { carryRegions, formatRegion, isClipped, layoutRegions, nextRegionColor, parseRegion, proteinRegionFeatures, proteinRegionTargets, regionColor, regionRange, regionSpans, regionsOf, regionOfFeatureId, regionTree, selectedProteinResidues, REGIONS_QUALIFIER, variableProteinFeatures, withRegions, type ProteinRegion } from "./regions.ts";
import { cloneVariants } from "./variants.ts";
import { splitVariable } from "./variable.ts";
import type { CloneDifference, CloneResult } from "./types.ts";
import { deleteRange, insertBases, replaceRange, reverseComplement, reverseComplementRange, setOrigin, type SeqData, type SeqFeature, type Strand } from "./seqdata.ts";

const region = (name: string, start: number, end: number): ProteinRegion => ({ name, kind: "Transmembrane", start, end, accession: "Q9UKG4", sourceStart: start, sourceEnd: end, predicted: true });

/** Codons that give distinct amino acids, so a region's bases can be recognised. */
const CODING = "ATGGCTTGTGATGAATTTGGTCATATTAAACTTATGAATCCTCAACGTTCTACTGTTTGGTATTAA";

function doc(opts: { strand?: Strand; before?: number; after?: number; regions?: ProteinRegion[]; locations?: { start: number; end: number }[] } = {}): SeqData {
  const before = "C".repeat(opts.before ?? 10);
  const after = "C".repeat(opts.after ?? 10);
  const coding = opts.strand === -1 ? reverseComplement(CODING) : CODING;
  const start = before.length;
  const f: SeqFeature = {
    id: "cds",
    name: "gene",
    type: "CDS",
    start,
    end: start + coding.length - 1,
    strand: opts.strand ?? 1,
    notes: withRegions({}, opts.regions ?? [region("TM1", 3, 5), region("TM2", 10, 12)]),
    raw: {}
  };
  return { name: "t", description: "", circular: true, sequence: before + coding + after, features: [f], primers: [], sources: [] };
}

const cds = (d: SeqData) => d.features.find(f => f.type === "CDS")!;
const residues = (d: SeqData) => regionsOf(cds(d)).map(r => [r.name, r.start, r.end]);
/** The amino acids a region covers, read from the bases as they now are. */
const translated = (d: SeqData, name: string) => {
  const f = cds(d);
  const r = regionsOf(f).find(x => x.name === name)!;
  return protein(f, d.sequence).slice(r.start - 1, r.end);
};

test("a region survives being written and read", () => {
  const r = region("TM1", 13, 33);
  assert.equal(formatRegion(r), "TM1|Transmembrane|13-33|Q9UKG4:13-33|predicted");
  assert.deepEqual(parseRegion(formatRegion(r)), r);
  assert.deepEqual(parseRegion(formatRegion({ ...r, start: 252, end: 272, predicted: false })), { ...r, start: 252, end: 272, predicted: false });
  assert.equal(formatRegion({ ...r, name: "a|b" }).split("|").length, 5);
  assert.equal(parseRegion("not a region"), null);
  assert.equal(parseRegion("TM1|Transmembrane|33-13|Q9UKG4:13-33"), null);
  assert.equal(parseRegion("TM1|Transmembrane|0-13|Q9UKG4:13-33"), null);
});

test("a region's bases are found on either strand", () => {
  const forward = doc();
  const r = regionsOf(cds(forward))[0];
  assert.deepEqual(regionSpans(cds(forward), r, forward.sequence.length), [{ start: 16, end: 24 }]);
  const reverse = doc({ strand: -1 });
  const l = CODING.length;
  const rr = regionsOf(cds(reverse))[0];
  assert.deepEqual(regionSpans(cds(reverse), rr, reverse.sequence.length), [{ start: 10 + l - 15, end: 10 + l - 7 }]);
  assert.equal(translated(reverse, "TM1"), translated(forward, "TM1"));
});

test("a region across an intron has a span in each exon, however the CDS runs", () => {
  const seq = "ATGGCTTGT" + "CCCC" + "GATGAATTT";
  const base: SeqFeature = { id: "cds", name: "g", type: "CDS", start: 0, end: 21, strand: 1, locations: [{ start: 0, end: 8 }, { start: 13, end: 21 }], notes: withRegions({}, [region("TM1", 3, 4)]), raw: {} };
  const r = regionsOf(base)[0];
  assert.deepEqual(regionSpans(base, r, seq.length), [{ start: 6, end: 8 }, { start: 13, end: 15 }]);
  assert.deepEqual(regionRange(base, r, seq.length), { start: 6, end: 15 });
  const back: SeqFeature = { ...base, strand: -1, notes: { ...base.notes } };
  assert.deepEqual(regionSpans(back, regionsOf(back)[0], seq.length), [{ start: 6, end: 8 }, { start: 13, end: 15 }]);
});

test("a region across the origin is one span", () => {
  const f: SeqFeature = { id: "cds", name: "g", type: "CDS", start: 90, end: 8, strand: 1, notes: withRegions({}, [region("TM1", 2, 5)]), raw: {} };
  const r = regionsOf(f)[0];
  assert.deepEqual(regionSpans(f, r, 100), [{ start: 93, end: 4 }]);
  assert.deepEqual(regionRange(f, r, 100), { start: 93, end: 4 });
});

test("edits outside the CDS and rearranging it change no numbers", () => {
  const d = doc();
  const want = residues(d);
  assert.deepEqual(residues(insertBases(d, 3, "GGG")), want);
  assert.deepEqual(residues(deleteRange(d, { start: 0, end: 4 })), want);
  assert.deepEqual(residues(setOrigin(d, 20)), want, "origin inside the CDS");
  assert.deepEqual(residues(reverseComplementRange(d, null)), want);
  assert.equal(translated(setOrigin(d, 20), "TM1"), translated(d, "TM1"));
  assert.equal(translated(reverseComplementRange(d, null), "TM2"), translated(d, "TM2"));
});

test("an in-frame indel moves what is downstream and leaves what is upstream", () => {
  const d = doc();
  assert.deepEqual(residues(insertBases(d, 10 + 21, "GCTGCT")), [["TM1", 3, 5], ["TM2", 12, 14]]);
  const cut = deleteRange(d, { start: 10 + 18, end: 10 + 20 });
  assert.deepEqual(residues(cut), [["TM1", 3, 5], ["TM2", 9, 11]]);
  assert.equal(translated(cut, "TM2"), translated(d, "TM2"));
});

test("an indel inside a region resizes it, and a region with nothing left goes", () => {
  const d = doc();
  assert.deepEqual(residues(insertBases(d, 10 + 9, "GCT")), [["TM1", 3, 6], ["TM2", 11, 13]], "grows");
  assert.deepEqual(residues(deleteRange(d, { start: 10 + 9, end: 10 + 11 })), [["TM1", 3, 4], ["TM2", 9, 11]], "shrinks");
  const gone = deleteRange(d, { start: 10 + 6, end: 10 + 14 });
  assert.deepEqual(residues(gone), [["TM2", 7, 9]]);
  const clipped = regionsOf(cds(deleteRange(d, { start: 10 + 9, end: 10 + 11 })))[0];
  assert.ok(isClipped(clipped), "shows as cut short");
});

test("cutting the start of a CDS renumbers its residues", () => {
  const d = doc();
  assert.deepEqual(residues(deleteRange(d, { start: 10, end: 15 })), [["TM1", 1, 3], ["TM2", 8, 10]]);
});

test("turning a CDS round keeps each region on its bases", () => {
  const d = doc();
  const n = d.sequence.length;
  const f = cds(d);
  const spans = (x: SeqFeature) => regionsOf(x).map(r => regionSpans(x, r, n));
  const turned = carryRegions<SeqFeature>(f, { ...f, strand: -1 }, n, n, p => p);
  assert.deepEqual(regionsOf(turned).map(r => [r.name, r.start, r.end]), [["TM2", 11, 13], ["TM1", 18, 20]]);
  assert.deepEqual(spans(turned).reverse(), spans(f));
  const back = carryRegions(turned, { ...turned, strand: 1 }, n, n, p => p);
  assert.deepEqual(regionsOf(back), regionsOf(f));
  assert.equal(carryRegions(f, { ...f, strand: 0 }, n, n, p => p).notes, f.notes, "no direction counts from the same end");
});

test("on a reverse strand, upstream is to the right", () => {
  const d = doc({ strand: -1 });
  const l = CODING.length;
  // The reverse CDS's start is at its right end: an insertion there moves everything.
  assert.deepEqual(residues(insertBases(d, 10 + l - 3, "GCT")), [["TM1", 4, 6], ["TM2", 11, 13]]);
  const inserted = insertBases(d, 11, "GCA");
  assert.deepEqual(residues(inserted), [["TM1", 3, 5], ["TM2", 10, 12]], "past the stop");
});

test("replacing bases one at a time, as typing over them does, moves nothing", () => {
  let d = doc();
  const want = residues(d);
  // Not the CDS's first or last base: overwriting those cuts any feature short by a base.
  for (let i = 1; i < CODING.length - 1; i++) {
    const at = 10 + i;
    d = replaceRange(d, { start: at, end: at }, d.sequence[at]).data;
    assert.deepEqual(residues(d), want, `after base ${i}`);
  }
  d = replaceRange(d, { start: 10 + 7, end: 10 + 11 }, "GCTGG").data;
  assert.deepEqual(residues(d), want, "after five bases at once");
});

test("a frameshift and its repair leave regions where they were", () => {
  const d = doc();
  const shifted = insertBases(d, 10 + 3, "G");
  assert.deepEqual(residues(shifted), residues(d));
  assert.deepEqual(residues(deleteRange(shifted, { start: 10 + 3, end: 10 + 3 })), residues(d));
});

test("regions and the rest of a feature's qualifiers survive saving", async () => {
  const d = doc({ regions: [region("TM1", 3, 5), { ...region("Cytoplasmic", 6, 9), kind: "Topological domain", predicted: false }, region("TM2", 10, 12)] });
  d.features[0].notes = { ...d.features[0].notes, db_xref: ["UniProtKB/Swiss-Prot:Q9UKG4"] };
  const text = serialize(toParsed({ data: d, extra: {}, wholeSources: [] }, d), "genbank");
  const parsed = await parseSequenceFile(new TextEncoder().encode(text), "t.gb");
  const back = fromParsed(parsed.sequences[0]).data;
  const f = back.features.find(x => x.type === "CDS")!;
  assert.deepEqual(regionsOf(f).map(r => [r.name, r.kind, r.start, r.end, r.predicted]), [["TM1", "Transmembrane", 3, 5, true], ["Cytoplasmic", "Topological domain", 6, 9, false], ["TM2", "Transmembrane", 10, 12, true]]);
  assert.equal(new Set(Object.keys(f.notes)).has(REGIONS_QUALIFIER), true);
  assert.deepEqual(f.notes.db_xref, ["UniProtKB/Swiss-Prot:Q9UKG4"]);
});

test("manual nested regions, colours and library designs survive GenBank wrapping and edits", async () => {
  const parent = { ...region("Variable domain", 1, 20), id: "vhh", kind: "Domain", accession: "", color: "#4f8fba" };
  const child = { ...region("CDR1", 3, 5), id: "cdr1", kind: "CDR", parentId: "vhh", color: "#d57479", variable: { kind: "alternatives" as const, options: [{ name: "one", bases: "GCTGCTGCT" }, { name: "two", bases: "GGTGGTGGT" }] }, edited: true, sourceKey: "CDR:3-5" };
  const d = doc({ regions: [parent, child] });
  const written = serialize(toParsed({ data: d, extra: {}, wholeSources: [] }, d), "genbank");
  const loaded = fromParsed((await parseSequenceFile(new TextEncoder().encode(written), "regions.gb")).sequences[0]).data;
  assert.deepEqual(regionsOf(cds(loaded)), regionsOf(cds(d)));
  const moved = insertBases(loaded, 10 + 3, "GCT");
  const after = regionsOf(cds(moved));
  assert.deepEqual(after.map(r => [r.id, r.start, r.end, r.parentId]), [["vhh", 1, 21, undefined], ["cdr1", 4, 6, "vhh"]]);
  assert.equal(isClipped(after[0]), false, "a manual region has no stale source numbering");
  assert.deepEqual(after[1].variable, child.variable);
});

test("nested and overlapping regions have separate lanes, and map detail keeps their identities", () => {
  const parent = { ...region("VHH", 1, 20), id: "vhh" };
  const child = { ...region("CDR1", 3, 5), id: "cdr1", parentId: "vhh" };
  const other = { ...region("Site", 4, 8), id: "site" };
  const regions = [parent, child, other];
  const rows = layoutRegions(regions);
  assert.equal(new Set(rows.map(r => r.lane)).size, 3);
  assert.deepEqual(layoutRegions(regions, "domains").map(r => r.index), [0, 2]);
  assert.deepEqual(layoutRegions(regions, "none"), []);
  assert.deepEqual(regionTree(regions).map(r => [r.region.name, r.depth]), [["VHH", 0], ["CDR1", 1], ["Site", 0]]);
  assert.equal(regionTree([{ ...parent, parentId: "cdr1" }, { ...child, start: 1, end: 20 }]).length, 2, "a bad file cannot create an infinite tree");
});

test("protein library regions use the CDS frame without adding another coding feature", () => {
  const r = { ...region("CDR1", 3, 5), id: "cdr1", variable: { kind: "any" as const } };
  const d = doc({ regions: [r] });
  const f = cds(d);
  const projected = variableProteinFeatures(f, d.sequence.length);
  assert.equal(projected[0].type, "misc_feature");
  assert.deepEqual([projected[0].start, projected[0].end], [16, 24]);
  const changedAt = 16;
  const difference: CloneDifference = { kind: "substitution", refPos: changedAt, refBases: d.sequence[changedAt], readBases: "A", readPos: changedAt, quality: 40, confident: true, reads: [0] };
  const lists = splitVariable([difference], projected, d.sequence.length);
  const clone: CloneResult = { key: "c", reads: [0], differences: lists.differences, variable: lists.variable, conflicts: [], pieces: [{ refFrom: 0, refTo: d.sequence.length, gappedReference: d.sequence, gappedConsensus: d.sequence.slice(0, changedAt) + "A" + d.sequence.slice(changedAt + 1), qualities: Array(d.sequence.length).fill(40), depth: Array(d.sequence.length).fill(1) }] };
  const result = cloneVariants(clone, d.sequence, true, [f, ...projected]);
  assert.equal(result.mutations.length, 0);
  assert.equal(result.proteins.length, 1);
  assert.equal(result.regions[0].feature, "CDR1");
  assert.ok(result.regions[0].protein, "the region is translated in its parent's frame");
  const reverse = doc({ strand: -1, regions: [r] });
  assert.equal(variableProteinFeatures(cds(reverse), reverse.sequence.length)[0].strand, -1);
  // Selecting the projection (the Reads tab's coverage list) selects the region itself.
  assert.deepEqual(regionOfFeatureId(d.features, projected[0].id!), { id: f.id, region: 0 });
  const unnamed = doc({ regions: [region("Plain", 1, 2), { ...region("Library", 3, 5), variable: { kind: "any" as const } }] });
  assert.deepEqual(regionOfFeatureId(unnamed.features, variableProteinFeatures(cds(unnamed), unnamed.sequence.length)[0].id!), { id: cds(unnamed).id, region: 1 });
  assert.equal(regionOfFeatureId(d.features, f.id), null);
});

test("portable region annotations preserve direction and split CDS locations", () => {
  const f: SeqFeature = { id: "cds", name: "g", type: "CDS", start: 0, end: 21, strand: -1, locations: [{ start: 0, end: 8 }, { start: 13, end: 21 }], notes: withRegions({}, [region("Domain", 3, 4)]), raw: {} };
  const [out] = proteinRegionFeatures(f, 22);
  assert.deepEqual(out.locations, [{ start: 6, end: 8 }, { start: 13, end: 15 }]);
  assert.equal(out.strand, -1);
  assert.equal(out.type, "misc_feature");
  assert.match(String(out.notes.note), /residues 3-4/);
});

test("selected bases become whole residues in their CDS's frame on either strand", () => {
  const d = doc();
  assert.deepEqual(selectedProteinResidues(cds(d), { start: 17, end: 20 }, d.sequence), { start: 3, end: 4, rounded: true });
  for (const strand of [1, -1] as const) {
    const d = doc({ strand });
    const f = cds(d);
    const range = regionRange(f, region("CDR1", 3, 5), d.sequence.length)!;
    assert.deepEqual(selectedProteinResidues(f, range, d.sequence), { start: 3, end: 5, rounded: false });
    assert.equal(selectedProteinResidues(f, { start: f.start - 1, end: f.start + 5 }, d.sequence), null);
  }
  const stop = { start: cds(d).end - 2, end: cds(d).end };
  assert.deepEqual(proteinRegionTargets(d, stop), [], "a terminal stop is not a protein region");
});

test("region selections follow a spliced CDS and can cross a circular origin", () => {
  const f: SeqFeature = { id: "cds", name: "g", type: "CDS", start: 0, end: 21, strand: 1, locations: [{ start: 0, end: 8 }, { start: 13, end: 21 }], notes: {}, raw: {} };
  assert.deepEqual(selectedProteinResidues(f, { start: 6, end: 15 }, "A".repeat(26)), { start: 3, end: 4, rounded: false });
  assert.equal(selectedProteinResidues(f, { start: 9, end: 12 }, "A".repeat(26)), null, "an intron alone has no protein residues");
  const wrapped = { ...f, start: 90, end: 8, locations: undefined };
  assert.deepEqual(selectedProteinResidues(wrapped, { start: 93, end: 4 }, "A".repeat(100)), { start: 2, end: 5, rounded: false });
});

test("overlapping CDSs are all offered as parents for a selected protein region", () => {
  const d = doc();
  const f = cds(d);
  d.features = [f, { ...f, id: "other", name: "Other protein", strand: -1 }, { ...f, id: "domain", type: "misc_feature" }];
  const choices = proteinRegionTargets(d, { start: f.start + 9, end: f.start + 14 });
  assert.deepEqual(choices.map(x => x.feature.id), ["cds", "other"]);
  assert.deepEqual([choices[0].start, choices[0].end], [4, 5]);
});

test("new regions cycle through coordinated colours within each CDS, regardless of name", () => {
  const regions: ProteinRegion[] = [];
  for (let i = 0; i < 7; i++) regions.push({ ...region("Domain", 1, 10), color: nextRegionColor(regions, "#4F8FBA") });
  assert.equal(new Set(regions.map(regionColor)).size, 7);
  assert.equal(regions[0].color, "#4F8FBA", "the first colour follows the CDS");
  assert.equal(regions[1].color, "#58A68C", "the next colour follows the palette");
  assert.equal(nextRegionColor(regions, "#4F8FBA"), regions[0].color, "the palette repeats after all colours are used");
  assert.equal(nextRegionColor([], "#D99049"), "#D99049", "another CDS starts from its own colour");
  assert.equal(nextRegionColor([], "#4F8FBA"), nextRegionColor([], "#4F8FBA"), "opening or cancelling a dialog consumes no colour");
});

test("region defaults preserve custom and legacy colours and avoid colours already used", () => {
  const custom = { ...region("Custom", 1, 10), color: "#123456" };
  const blue = { ...region("Blue", 11, 20), color: "#4f8fba" };
  const legacy = region("Uncoloured legacy annotation", 21, 30);
  const before = [regionColor(custom), regionColor(blue), regionColor(legacy)];
  const next = nextRegionColor([custom, blue, legacy], "#4F8FBA");
  assert.ok(!before.map(c => c.toLowerCase()).includes(next.toLowerCase()));
  assert.equal(regionColor({ ...custom, name: "Renamed", start: 3 }), "#123456");
  assert.deepEqual([custom, blue, legacy].map(regionColor), before);
  assert.equal(parseRegion(formatRegion(custom))!.color, "#123456", "the chosen colour survives saving");
  assert.match(nextRegionColor([], "not a colour"), /^#[0-9A-F]{6}$/);
});
