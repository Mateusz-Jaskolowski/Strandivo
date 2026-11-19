// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Regions of a protein inside a CDS: the qualifier and what edits do to them. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSequenceFile, serialize } from "../doc/fileio.ts";
import { fromParsed, toParsed } from "../doc/convert.ts";
import { protein } from "../doc/analysis.ts";
import { carryRegions, formatRegion, isClipped, layoutRegions, nextRegionColor, parseRegion, parseRegionFeatureNote, proteinRegionFeatures, regionFeatureNotes, proteinRegionTargets, regionColor, regionRange, regionSpans, regionsOf, regionOfFeatureId, regionTree, selectedProteinResidues, REGIONS_QUALIFIER, variableProteinFeatures, withRegions, type ProteinRegion } from "./regions.ts";
import { codingPositions } from "./genetics.ts";
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

test("a region's note and metadata this version doesn't know survive being written and read", () => {
  const r: ProteinRegion = { ...region("CDR1", 3, 5), id: "cdr1", note: 'a|b "quoted"\nsecond line, 4 °C', more: { future: [1, 2] } };
  assert.deepEqual(parseRegion(formatRegion(r)), r);
  assert.equal(formatRegion(r).split("|").length, 6, "the note is inside the metadata, not a field of its own");
  // A blank note isn't written, so a region without one reads as before.
  assert.equal(formatRegion({ ...region("TM1", 13, 33), note: "" }), "TM1|Transmembrane|13-33|Q9UKG4:13-33|predicted");
  const newer = `CDR1|CDR|3-5|:3-5||${encodeURIComponent(JSON.stringify({ id: "cdr1", note: "kept", shape: "loop" }))}`;
  const read = parseRegion(newer)!;
  assert.deepEqual([read.note, read.more], ["kept", { shape: "loop" }]);
  assert.deepEqual(JSON.parse(decodeURIComponent(formatRegion({ ...read, name: "CDR1 renamed" }).split("|")[5])), { shape: "loop", id: "cdr1", note: "kept" });
});

test("an edit that moves a region keeps its note", () => {
  const d = doc({ regions: [{ ...region("TM2", 10, 12), note: "kept" }] });
  const moved = insertBases(d, 10 + 3, "GCT");
  assert.deepEqual(regionsOf(cds(moved)).map(r => [r.start, r.note]), [[11, "kept"]]);
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
  const turned = carryRegions<SeqFeature>(f, { ...f, strand: -1 }, n, n, r => r);
  assert.deepEqual(regionsOf(turned).map(r => [r.name, r.start, r.end]), [["TM2", 11, 13], ["TM1", 18, 20]]);
  assert.deepEqual(spans(turned).reverse(), spans(f));
  const back = carryRegions(turned, { ...turned, strand: 1 }, n, n, r => r);
  assert.deepEqual(regionsOf(back), regionsOf(f));
  assert.equal(carryRegions(f, { ...f, strand: 0 }, n, n, r => r).notes, f.notes, "no direction counts from the same end");
});

test("on a reverse strand, upstream is to the right", () => {
  const d = doc({ strand: -1 });
  const l = CODING.length;
  // The reverse CDS's start is at its right end: an insertion there moves everything.
  assert.deepEqual(residues(insertBases(d, 10 + l - 3, "GCT")), [["TM1", 4, 6], ["TM2", 11, 13]]);
  const inserted = insertBases(d, 11, "GCA");
  assert.deepEqual(residues(inserted), [["TM1", 3, 5], ["TM2", 10, 12]], "past the stop");
});

test("replacing bases with as many moves nothing, even at a region's or the CDS's edge", () => {
  let d = doc();
  const want = residues(d);
  for (let i = 0; i < CODING.length; i++) {
    const at = 10 + i;
    d = replaceRange(d, { start: at, end: at }, "A").data;
    assert.deepEqual(residues(d), want, `after base ${i}`);
    assert.deepEqual([cds(d).start, cds(d).end], [10, 10 + CODING.length - 1]);
  }
  d = replaceRange(doc(), { start: 10 + 6, end: 10 + 14 }, "GGTGGTGGT").data;
  assert.deepEqual(residues(d), want, "TM1's three codons at once");
});

/** Three regions in a row, as FR1, CDR1 and FR2 are: A 1–4, B 5–8, C 9–12. */
const tiled = () => doc({ regions: [region("A", 1, 4), region("B", 5, 8), region("C", 9, 12)] });
/** Sequence positions of residue `from`'s first base to residue `to`'s last, in `tiled`. */
const codons = (from: number, to: number) => ({ start: 10 + (from - 1) * 3, end: 10 + to * 3 - 1 });

test("a region replaced whole keeps the new bases, however many", () => {
  const b = codons(5, 8);
  assert.deepEqual(residues(replaceRange(tiled(), b, "GGT".repeat(4)).data), [["A", 1, 4], ["B", 5, 8], ["C", 9, 12]]);
  assert.deepEqual(residues(replaceRange(tiled(), b, "GGT".repeat(2)).data), [["A", 1, 4], ["B", 5, 6], ["C", 7, 10]]);
  assert.deepEqual(residues(replaceRange(tiled(), b, "GGT".repeat(6)).data), [["A", 1, 4], ["B", 5, 10], ["C", 11, 14]]);
  assert.deepEqual(residues(replaceRange(tiled(), codons(5, 5), "GGTGGT").data), [["A", 1, 4], ["B", 5, 9], ["C", 10, 13]], "its first codon");
});

test("a replacement across a region's edge leaves the new bases in neither, and what lies inside it goes", () => {
  // A's last codon and B's first, replaced by three codons: residues 4–6 belong to no region.
  assert.deepEqual(residues(replaceRange(tiled(), codons(4, 5), "GGT".repeat(3)).data), [["A", 1, 3], ["B", 7, 9], ["C", 10, 13]]);
  assert.deepEqual(residues(replaceRange(tiled(), codons(4, 5), "GGT".repeat(2)).data), [["A", 1, 4], ["B", 5, 8], ["C", 9, 12]], "as many: nothing moves");
  assert.deepEqual(residues(replaceRange(tiled(), codons(4, 9), "GGT".repeat(4)).data), [["A", 1, 3], ["C", 8, 10]], "B lay inside");
});

test("typing or deleting a codon a base at a time moves what is downstream by a residue", () => {
  let d = doc();
  for (let i = 0; i < 3; i++) d = insertBases(d, 10 + 3 + i, "GCT"[i]);
  assert.deepEqual(residues(d), [["TM1", 4, 6], ["TM2", 11, 13]]);
  assert.equal(translated(d, "TM1"), translated(doc(), "TM1"));
  assert.ok(regionsOf(cds(d)).every(r => !r.codingBases), "back on whole residues");
  d = doc();
  for (let i = 0; i < 3; i++) d = deleteRange(d, { start: 10 + 5 - i, end: 10 + 5 - i });
  assert.deepEqual(residues(d), [["TM1", 2, 4], ["TM2", 9, 11]]);
  assert.equal(translated(d, "TM2"), translated(doc(), "TM2"));
  d = doc();
  for (let i = 0; i < 3; i++) d = insertBases(d, 10 + 9 + i, "GCT"[i]);
  assert.deepEqual(residues(d), [["TM1", 3, 6], ["TM2", 11, 13]], "inside TM1, it grows");
});

test("a region between codons keeps its exact bases, in the file too", async () => {
  const d = doc();
  const shifted = insertBases(d, 10 + 3, "G");
  assert.deepEqual(residues(shifted), residues(d), "its nearest residues");
  assert.deepEqual(regionsOf(cds(shifted))[0].codingBases, { start: 8, end: 16 });
  const text = serialize(toParsed({ data: shifted, extra: {}, wholeSources: [] }, shifted), "genbank");
  const back = fromParsed((await parseSequenceFile(new TextEncoder().encode(text), "t.gb")).sequences[0]).data;
  assert.deepEqual(regionsOf(cds(back)), regionsOf(cds(shifted)));
  const tm1 = regionsOf(cds(shifted))[0];
  assert.ok(formatRegion(tm1).includes("codingBases"));
  assert.ok(!formatRegion({ ...tm1, start: 4, end: 6 }).includes("codingBases"), "residues set without them win");
  assert.equal(parseRegion(formatRegion(tm1).replace("3-5", "4-6"))!.codingBases, undefined, "as written by a version that doesn't know them");
});

test("a frameshift and its repair leave regions where they were", () => {
  const d = doc();
  const shifted = insertBases(d, 10 + 3, "G");
  assert.deepEqual(residues(shifted), residues(d));
  assert.deepEqual(regionsOf(cds(deleteRange(shifted, { start: 10 + 3, end: 10 + 3 }))), regionsOf(cds(d)));
});

test("random edits keep each region on the same bases as a feature on them", () => {
  // Seeded, so a failure can be replayed.
  const rng = (seed: number) => {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)) };
  };
  const bases = (r: ReturnType<typeof rng>, k: number) => Array.from({ length: k }, () => "ACGT"[r.int(0, 3)]).join("");
  /** Where a region's bases are now: its exact bases, else its residues', as one range. */
  const placed = (d: SeqData, x: ProteinRegion) => {
    const f = cds(d);
    const all = codingPositions(f, d.sequence.length);
    const from = x.codingBases ? x.codingBases.start - 1 : (x.start - 1) * 3;
    const to = x.codingBases ? x.codingBases.end - 1 : Math.min(all.length, x.end * 3) - 1;
    const ends = [all[from], all[to]];
    return f.strand === -1 ? [ends[1], ends[0]] : ends;
  };
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed);
    const strand: Strand = r.next() < 0.5 ? 1 : -1;
    const residuesCount = r.int(12, 30);
    const length = residuesCount * 3;
    const regions = Array.from({ length: r.int(1, 4) }, (_, k) => {
      const start = r.int(1, residuesCount - 1);
      return region(`R${k}`, start, Math.min(residuesCount, start + r.int(0, 8)));
    });
    // A feature on each region's bases, which edits map as they always have.
    const twins: SeqFeature[] = regions.map(x => {
      const first = (x.start - 1) * 3;
      const last = x.end * 3 - 1;
      const [start, end] = strand === 1 ? [15 + first, 15 + last] : [15 + length - 1 - last, 15 + length - 1 - first];
      return { id: x.name, name: x.name, type: "misc_feature", start, end, strand, notes: {}, raw: {} };
    });
    const f: SeqFeature = { id: "cds", name: "gene", type: "CDS", start: 15, end: 15 + length - 1, strand, notes: withRegions({}, regions), raw: {} };
    let d: SeqData = { name: "t", description: "", circular: false, sequence: bases(r, 15 + length + 15), features: [f, ...twins], primers: [], sources: [] };
    for (let step = 0; step < 15; step++) {
      const n = d.sequence.length;
      const c = cds(d);
      const at = Math.max(0, Math.min(n - 1, r.int(c.start - 4, c.end + 4)));
      const kind = r.int(0, 3);
      const end = Math.min(n - 1, at + r.int(0, 8));
      const what = ["insert", "delete", "replace", "type"][kind];
      // New bases at an edge go to the side the edit card was told, or to neither.
      const side = (["neither", "before", "after"] as const)[r.int(0, 2)];
      if (kind === 0) d = insertBases(d, at, bases(r, r.int(1, 4)), side);
      else if (kind === 1) d = deleteRange(d, { start: at, end: Math.min(n - 1, at + r.int(0, 3)) });
      else if (kind === 2) d = replaceRange(d, { start: at, end }, bases(r, r.next() < 0.3 ? end - at + 1 : r.int(1, 9)), side).data;
      else for (let k = 0; k < r.int(1, 4); k++) d = insertBases(d, at + k, bases(r, 1), side);
      if (!d.features.some(x => x.type === "CDS")) break;
      const label = `seed ${seed} step ${step} (${what} at ${at}, ${side})`;
      const kept = regionsOf(cds(d));
      for (const twin of twins) {
        const now = d.features.find(x => x.id === twin.id);
        const x = kept.find(y => y.name === twin.id);
        assert.equal(!!x, !!now, `${label}: ${twin.id} should ${now ? "stay" : "go"}`);
        if (x && now) assert.deepEqual(placed(d, x), [now.start, now.end], `${label}: ${twin.id}`);
      }
    }
  }
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
  assert.deepEqual(regionTree(regions).map(r => [r.region.name, r.depth, r.parent]), [["VHH", 0, null], ["CDR1", 1, 0], ["Site", 0, null]]);
  assert.equal(regionTree([{ ...parent, parentId: "cdr1" }, { ...child, start: 1, end: 20 }]).length, 2, "a bad file cannot create an infinite tree");
});

test("a protein region's amino-acid versions are saved and matched to the clone's translation, on either strand", async () => {
  // Residues 3–5 are CDE; the clone has TGT made AGT, so SDE.
  const versions = { kind: "alternatives" as const, protein: true, options: [{ name: "parent", bases: "CDE" }, { name: "serine", bases: "SDE" }] };
  for (const strand of [1, -1] as const) {
    const d = doc({ strand, regions: [{ ...region("Loop", 3, 5), id: "loop", variable: versions }] });
    const written = serialize(toParsed({ data: d, extra: {}, wholeSources: [] }, d), "genbank");
    const loaded = fromParsed((await parseSequenceFile(new TextEncoder().encode(written), "loop.gb")).sequences[0]).data;
    assert.deepEqual(regionsOf(cds(loaded))[0].variable, versions);
    const check = (design: typeof versions) => {
      const f = { ...cds(d), notes: withRegions(cds(d).notes, [{ ...regionsOf(cds(d))[0], variable: design }]) };
      const projected = variableProteinFeatures(f, d.sequence.length);
      const at = strand === 1 ? projected[0].start : projected[0].end;
      const read = strand === 1 ? "A" : "T";
      const difference: CloneDifference = { kind: "substitution", refPos: at, refBases: d.sequence[at], readBases: read, readPos: at, quality: 40, confident: true, reads: [0] };
      const lists = splitVariable([difference], projected, d.sequence.length);
      const clone: CloneResult = { key: "c", reads: [0], differences: lists.differences, variable: lists.variable, conflicts: [], pieces: [{ refFrom: 0, refTo: d.sequence.length, gappedReference: d.sequence, gappedConsensus: d.sequence.slice(0, at) + read + d.sequence.slice(at + 1), qualities: Array(d.sequence.length).fill(40), depth: Array(d.sequence.length).fill(1) }] };
      return cloneVariants(clone, d.sequence, true, [f, ...projected]).regions[0];
    };
    const both = check(versions);
    assert.deepEqual([both.protein, both.alternative, both.mutations], ["SDE", "serine", []]);
    const parentOnly = check({ ...versions, options: [versions.options[0]] });
    assert.equal(parentOnly.alternative, "parent");
    assert.deepEqual(parentOnly.mutations.map(m => `${m.feature} ${m.label} ${m.kind}`), ["Loop C3S missense"]);
  }
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

test("a region as a feature says what it is, whether predicted, and its note, a line per value", () => {
  const f: SeqFeature = { id: "cds", name: "SLC13A4", type: "CDS", start: 0, end: 59, strand: 1, notes: withRegions({}, [{ ...region("TM1", 3, 5), note: "First helix\n\n  checked by AlphaFold  " }, { ...region("Signal", 1, 2), kind: "Signal peptide", accession: "", predicted: false }]), raw: {} };
  const [signal, tm] = proteinRegionFeatures(f, 60);
  assert.deepEqual(tm.notes.note, ["Transmembrane, predicted; SLC13A4, residues 3-5; UniProtKB Q9UKG4 3-5", "First helix", "checked by AlphaFold"]);
  assert.deepEqual(signal.notes.note, ["Signal peptide; SLC13A4, residues 1-2"]);
  assert.equal(signal.type, "sig_peptide");
  // Added as a feature in the document, it leaves out the CDS and residues.
  assert.deepEqual(regionFeatureNotes(regionsOf(f)[1]), ["Transmembrane, predicted; UniProtKB Q9UKG4 3-5", "First helix", "checked by AlphaFold"]);
});

test("what a region wrote as a feature's note is read back, from this version and older ones", () => {
  assert.deepEqual(parseRegionFeatureNote("Transmembrane, predicted; SLC13A4, residues 3-5; UniProtKB Q9UKG4 13-33"), { kind: "Transmembrane", predicted: true, accession: "Q9UKG4", sourceStart: 13, sourceEnd: 33 });
  // Before "predicted" was written, and with a CDS whose name has the separator in it.
  assert.deepEqual(parseRegionFeatureNote("My kind; heavy; chain, residues 1-9"), { kind: "My kind", predicted: false, accession: "" });
  assert.deepEqual(parseRegionFeatureNote("Signal peptide; UniProtKB P1 1-20"), { kind: "Signal peptide", predicted: false, accession: "P1", sourceStart: 1, sourceEnd: 20 });
  assert.deepEqual(parseRegionFeatureNote("Linker"), { kind: "Linker", predicted: false, accession: "" });
  // A note of the user's is no kind.
  assert.equal(parseRegionFeatureNote("Binds the antigen"), null);
  assert.equal(parseRegionFeatureNote("linker"), null);
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
