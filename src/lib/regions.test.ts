// Regions of a protein inside a CDS: the qualifier and what edits do to them. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseSequenceFile, serialize } from "../doc/fileio.ts";
import { fromParsed, toParsed } from "../doc/convert.ts";
import { protein } from "../doc/analysis.ts";
import { carryRegions, formatRegion, isClipped, parseRegion, regionRange, regionSpans, regionsOf, REGIONS_QUALIFIER, withRegions, type ProteinRegion } from "./regions.ts";
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

const cds = (d: SeqData) => d.features.find(f => f.id === "cds")!;
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
