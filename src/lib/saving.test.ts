// Saving and reopening: every sequence file in testdata/ must come back unchanged, also
// after edits. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseSequenceFile, serialize } from "../doc/fileio.ts";
import { fromParsed, toParsed, type LoadedDocument } from "../doc/convert.ts";
import { formatComments, parseComments } from "./labinfo.ts";
import { designOf, formatDesign, VARIABLE_QUALIFIER } from "./variable.ts";
import { protein } from "../doc/analysis.ts";
import { deleteRange, featureBases, insertBases, reverseComplement, reverseComplementRange, setOrigin, type SeqData, type SeqFeature } from "./seqdata.ts";

const root = new URL("../../", import.meta.url);
const FILES = [
  "testdata/e2e/pUC19-annotated.gb",
  "testdata/library/library-parent.gb",
  "testdata/sanger/pUC19.gb",
  "testdata/sanger/sage-sample-reference.fa",
  "testdata/snapgene/pFA-KanMX4.dna",
  "testdata/snapgene/pIB2-SEC13-mEGFP.dna",
  "testdata/snapgene/sample-d.dna",
  "testdata/snapgene/sample-e.dna",
  "testdata/snapgene/sample-hybridization-params.dna"
];

async function open(path: string): Promise<LoadedDocument> {
  const parsed = await parseSequenceFile(new Uint8Array(readFileSync(new URL(path, root))), path);
  return fromParsed(parsed.sequences[0]);
}

async function reopen(text: string, name = "saved.gb"): Promise<LoadedDocument> {
  const parsed = await parseSequenceFile(new TextEncoder().encode(text), name);
  return fromParsed(parsed.sequences[0]);
}

const save = (doc: LoadedDocument, data: SeqData = doc.data, extra: Record<string, unknown> = {}) => serialize({ ...toParsed(doc, data), ...extra }, "genbank");

/** What a user would notice about a feature: name, kind, where (all parts), direction. */
const describe = (f: SeqFeature) => `${f.name}|${f.type}|${f.start}-${f.end}|${f.strand}|${(f.locations || []).map(l => `${l.start}-${l.end}`).join(",")}`;

function assertSameDocument(a: SeqData, b: SeqData, file: string) {
  assert.equal(b.sequence.toUpperCase(), a.sequence.toUpperCase(), `${file}: sequence`);
  assert.equal(b.circular, a.circular, `${file}: topology`);
  assert.deepEqual(b.features.map(describe), a.features.map(describe), `${file}: features`);
  assert.deepEqual(
    b.primers.map(p => `${p.name}|${p.start}-${p.end}|${p.strand}|${p.bases}`),
    a.primers.map(p => `${p.name}|${p.start}-${p.end}|${p.strand}|${p.bases}`),
    `${file}: primers`
  );
  assert.deepEqual(b.sources.map(describe), a.sources.map(describe), `${file}: source features`);
}

for (const file of FILES) {
  test(`${file} comes back unchanged after saving as GenBank`, async () => {
    const doc = await open(file);
    const again = await reopen(save(doc));
    assertSameDocument(doc.data, again.data, file);
    assert.equal(again.data.name, doc.data.name.replace(/\s/g, "_"), `${file}: name`);
    assert.equal(again.data.description, doc.data.description.replace(/\s*\n\s*/g, " ").trim(), `${file}: description`);
  });
}

test("SnapGene features in several parts keep every part, but not their gaps", async () => {
  const doc = await open("testdata/snapgene/pIB2-SEC13-mEGFP.dna");
  const sec13 = doc.data.features.find(f => f.name === "SEC13")!;
  // Exon 1 (3 bases), a 74-base intron SnapGene marks as a gap, exon 2.
  assert.deepEqual(sec13.locations, [{ start: 690, end: 692 }, { start: 767, end: 1630 }]);
  const prot = protein(sec13, doc.data.sequence);
  assert.ok(prot.startsWith("MVTIGNAHD") && !prot.includes("*"), prot);
  // Parts that only change colour stay.
  assert.equal(doc.data.features.find(f => f.name === "AmpR")!.locations?.length, 2);
  const again = await reopen(save(doc));
  assert.deepEqual(again.data.features.find(f => f.name === "SEC13")!.locations, sec13.locations);
});

test("a feature's colour is saved, and so is going back to the default one", async () => {
  const doc = await open("testdata/snapgene/pIB2-SEC13-mEGFP.dna");
  const recolour = (color: string | undefined) => ({ ...doc.data, features: doc.data.features.map(f => (f.name === "mEGFP" ? { ...f, color } : f)) });
  const egfp = (d: SeqData) => d.features.find(f => f.name === "mEGFP")!;
  assert.equal(egfp(doc.data).color, "#05fd14");
  assert.equal(egfp((await reopen(save(doc, recolour("#D9534F")))).data).color, "#D9534F");
  assert.equal(egfp((await reopen(save(doc, recolour(undefined)))).data).color, undefined);
});

test("a primer's colour is saved, and so is going back to the default one", async () => {
  const doc = await open("testdata/library/library-parent.gb");
  const id = doc.data.primers[0].id;
  const recolour = (color: string | undefined) => ({ ...doc.data, primers: doc.data.primers.map(p => (p.id === id ? { ...p, color } : p)) });
  const first = (d: SeqData) => d.primers[0];
  const teal = (await reopen(save(doc, recolour("#6CC2B0")))).data;
  assert.equal(first(teal).color?.toUpperCase(), "#6CC2B0");
  assert.deepEqual(teal.primers.slice(1).map(p => p.color), doc.data.primers.slice(1).map(p => p.color));
  assert.equal(first((await reopen(save(doc, recolour(undefined)))).data).color, undefined);
});

test("edits keep every part of a multi-part feature on its bases", async () => {
  const doc = await open("testdata/snapgene/pIB2-SEC13-mEGFP.dna");
  const d = doc.data;
  const before = new Map(d.features.map(f => [f.name, featureBases(d.sequence, f)]));
  // Upstream of SEC13 (690…), then inside AmpR's first part, then remove a stretch of PpHIS4.
  let e = insertBases(d, 100, "GATTACA");
  const ampR = e.features.find(f => f.name === "AmpR")!;
  e = deleteRange(e, { start: 5000, end: 5009 });
  const again = await reopen(save(doc, e));
  for (const f of again.data.features) {
    const want = before.get(f.name)!;
    if (f.name === "PpHIS4") assert.equal(featureBases(again.data.sequence, f).length, want.length - 10, f.name);
    else assert.equal(featureBases(again.data.sequence, f).toUpperCase(), want.toUpperCase(), f.name);
  }
  assert.ok(ampR.locations && ampR.locations.length === 2);
  assert.deepEqual(again.data.features.find(f => f.name === "SEC13")!.locations?.map(l => l.start), [697, 774]);
});

test("a spliced feature keeps its exons through origin moves and reverse-complementing", () => {
  const seq = "AAAAATGCCCCCCCGGGTAAAAAAAAAA";
  const exons: SeqFeature = { id: "g", name: "gene", type: "CDS", start: 4, end: 18, strand: 1, locations: [{ start: 4, end: 6 }, { start: 14, end: 18 }], notes: {}, raw: {} };
  const d: SeqData = { name: "t", description: "", circular: true, sequence: seq, features: [exons], primers: [], sources: [] };
  const want = featureBases(seq, exons);
  const moved = setOrigin(d, 10);
  assert.equal(featureBases(moved.sequence, moved.features[0]), want);
  const turned = reverseComplementRange(d, null);
  const t = turned.features[0];
  assert.equal(t.strand, -1);
  assert.equal(reverseComplement(featureBases(turned.sequence, t)), want);
  assert.ok(t.locations![0].start < t.locations![1].start, "parts stay in order along the sequence");
  // Deleting one exon leaves the feature in one piece.
  const cut = deleteRange(d, { start: 3, end: 7 });
  assert.equal(cut.features[0].locations, undefined);
});

test("source features follow edits; one covering the whole sequence still does", async () => {
  const doc = await open("testdata/sanger/pUC19.gb");
  assert.equal(doc.wholeSources.length, 1);
  const partial: SeqFeature = { id: "src-2", name: "insert origin", type: "source", start: 1000, end: 1099, strand: 1, notes: {}, raw: { type: "source", name: "insert origin" } };
  const d = { ...doc.data, sources: [...doc.data.sources, partial] };
  const edited = insertBases(d, 10, "TTTT");
  const again = await reopen(save(doc, edited));
  const n = again.data.sequence.length;
  assert.deepEqual(
    again.data.sources.map(s => [s.start, s.end]),
    [
      [0, n - 1],
      [1004, 1103]
    ]
  );
});

test("an edited description is saved, on one line, in GenBank and FASTA", async () => {
  const doc = await open("testdata/e2e/pUC19-annotated.gb");
  const data = { ...doc.data, description: "Line one\nLine two" };
  const gb = await reopen(save(doc, data));
  assert.equal(gb.data.description, "Line one Line two");
  const fasta = serialize(toParsed(doc, data), "fasta");
  const fa = await reopen(fasta, "saved.fasta");
  assert.equal(fa.data.sequence.toUpperCase(), data.sequence.toUpperCase());
});

test("lab fields survive saving, including several lines", async () => {
  const doc = await open("testdata/e2e/pUC19-annotated.gb");
  const fields: [string, string][] = [
    ["Stored at", "Box 3, A4"],
    ["Notes", "first line\nsecond line"]
  ];
  const again = await reopen(save(doc, doc.data, { comments: formatComments(fields, ["An original comment"]) }));
  const parsed = parseComments(again.extra.comments as string[]);
  assert.deepEqual(parsed.fields, fields);
  assert.deepEqual(parsed.otherComments, ["An original comment"]);
});

test("a variable region's design is saved in its qualifier", async () => {
  const doc = await open("testdata/library/library-parent.gb");
  const designs: Record<string, string> = { cdr1: "any", cdr2: "NNK", "FR2": "v1:TGGTTTCGC|v2:TGGGTTCGC" };
  const features = doc.data.features.map(f => (designs[f.name] ? { ...f, notes: { ...f.notes, [VARIABLE_QUALIFIER]: [designs[f.name]] } } : f));
  const text = save(doc, { ...doc.data, features });
  assert.match(text, /\/strandivo_variable="NNK"/);
  const again = await reopen(text);
  for (const [name, value] of Object.entries(designs)) {
    const f = again.data.features.find(x => x.name === name)!;
    assert.equal(formatDesign(designOf(f.notes)!), value, name);
  }
  // Other features stay unmarked.
  assert.equal(designOf(again.data.features.find(x => x.name === "cdr3")!.notes), null);
});
