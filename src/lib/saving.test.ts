// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Saving and reopening: every sequence file in testdata/ must come back unchanged, also
// after edits. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseSequenceFile, serialize } from "../doc/fileio.ts";
import { fromParsed, toParsed, type LoadedDocument } from "../doc/convert.ts";
import { formatComments, NAME_KEY, parseComments } from "./labinfo.ts";
import { nameToKeep } from "./sequenceName.ts";
import { designOf, formatDesign, VARIABLE_QUALIFIER } from "./variable.ts";
import { regionsOf, withRegions, type ProteinRegion } from "./regions.ts";
import { readFeatureTables } from "./genbankQualifiers.ts";
import { protein } from "../doc/analysis.ts";
import { basesIn, deleteRange, featureBases, insertBases, linearize, reverseComplement, reverseComplementRange, reverseEnd, setOrigin, topStrandLength, withTopology, type Range, type SeqData, type SeqFeature, type SeqPrimer, type Strand } from "./seqdata.ts";
import { cutsFor, fragmentDigest, wholeFragment, type Fragment } from "./cloning.ts";
import { reactionCounts } from "./enzymes.ts";
import { translateCodon } from "./genetics.ts";
import { digestSequence, fragmentDocument, fragmentSize } from "./gel.ts";
import { documentMethylation, hostMethylation, PCR_DNA } from "./methylation.ts";
import { pcrProduct, productDocument } from "./pcr.ts";

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

test("a whole-circle PCR product saves its full CDS and reopens unmethylated", async () => {
  const sequence = "TGTTACCGTCTCGATCAGGTCGTTGAATAGCCTATCCGTTACTGTTTTGATGAACCATGTGATCTTGGTTTAGCGGTACAA";
  const template = fromParsed({ name: "template", sequence, circular: true });
  const cds: SeqFeature = { id: "cds", name: "wrapped CDS", type: "CDS", start: 61, end: 17, strand: -1, notes: { codon_start: ["2"] }, raw: {} };
  const f = { name: "F", start: 0, end: 19, strand: 1 as const, bases: "ACG" + sequence.slice(0, 20) };
  const r = { name: "R", start: 61, end: 80, strand: -1 as const, bases: reverseComplement(sequence.slice(61)) };
  const product = pcrProduct(sequence, true, f, r)!;
  const made = productDocument({ ...template.data, features: [cds] }, product);
  const again = await reopen(save(fromParsed({}), made));
  assert.equal(again.data.sequence, "ACG" + sequence);
  assert.equal(again.data.circular, false);
  assert.deepEqual(again.data.features[0].locations, [{ start: 64, end: 83 }, { start: 3, end: 20 }]);
  assert.equal(featureBases(again.data.sequence, again.data.features[0]), featureBases(sequence, cds));
  assert.deepEqual(again.data.features[0].notes.codon_start, ["2"]);
  assert.deepEqual(documentMethylation("", again.data.methylation), PCR_DNA);
  assert.equal(cutsFor(again.data.sequence, false, ["DpnI"], documentMethylation("", again.data.methylation)).length, 0);
  assert.ok(cutsFor(again.data.sequence, false, ["DpnI"], documentMethylation("DH5a", again.data.methylation)).length > 0);
});

test("a saved digest fragment keeps its gel size, exact bases and ends", async () => {
  const sequence = "A".repeat(65) + "GAATTC" + "C".repeat(50);
  const template = fromParsed({ name: "template", sequence, circular: false });
  const r = digestSequence(template.data, ["EcoRI"]);
  const fragment = r.fragments.find(f => fragmentSize(f) === 66)!;
  const made = fragmentDocument(fragment, template.data.name, hostMethylation("JM110"));
  const again = await reopen(save(fromParsed({}), made));
  assert.equal(again.data.sequence, "A".repeat(65) + "GAATT");
  assert.equal(again.data.circular, false);
  assert.equal(topStrandLength(again.data.sequence, again.data.ends), 66);
  assert.deepEqual(again.data.ends, { left: fragment.left, right: fragment.right });
  assert.equal(again.data.methylation?.name, "JM110");
  assert.deepEqual(wholeFragment(again.data).right, fragment.right);
  assert.equal(digestSequence(again.data, []).fragments.map(fragmentSize)[0], 66);
  const fields: [string, string][] = [["Fragment ends", "Checked"], ["DNA methylation", "Measured"]];
  const savedWithFields = await reopen(serialize(toParsed(again, again.data, fields), "genbank"));
  assert.deepEqual(parseComments(savedWithFields.extra.comments as string[]).fields, fields);
  assert.deepEqual(savedWithFields.data.ends, again.data.ends);
  const flipped = reverseComplementRange(again.data, null);
  assert.deepEqual(flipped.ends?.left, fragment.right);
  assert.equal(insertBases(again.data, again.data.sequence.length, "A").ends?.right.kind, "blunt");
  for (const data of [again.data, flipped]) {
    const fasta = await reopen(serialize(toParsed(again, data), "fasta"), "digest.fa");
    const expected = data === flipped ? reverseComplement(again.data.sequence) : "A".repeat(65) + "G";
    assert.equal(fasta.data.sequence, expected);
  }
});

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

test("a name with spaces comes back with them; one with underscores stays as typed", async () => {
  const doc = await open("testdata/e2e/pUC19-annotated.gb");
  const fields: [string, string][] = [["Stored at", "Box 3, A4"]];
  const saveNamed = (name: string) => save(doc, { ...doc.data, name }, { comments: formatComments(fields, [], nameToKeep(name)) });
  const spaced = saveNamed("pUC19 K45A mutant");
  assert.match(spaced, /^LOCUS {7}pUC19_K45A_mutant /);
  const again = await reopen(spaced);
  assert.equal(again.data.name, "pUC19 K45A mutant");
  // Kept apart from the lab fields, which come back as they were.
  assert.deepEqual(parseComments(again.extra.comments as string[]).fields, fields);
  const underscored = saveNamed("pLKO.1_puro");
  assert.ok(!underscored.includes(NAME_KEY));
  assert.equal((await reopen(underscored)).data.name, "pLKO.1_puro");
});

test("a name changed elsewhere on the LOCUS line wins over the kept one", async () => {
  const doc = await open("testdata/e2e/pUC19-annotated.gb");
  const text = save(doc, { ...doc.data, name: "pUC19 K45A" }, { comments: formatComments([], [], nameToKeep("pUC19 K45A")) });
  // Another program renames it, leaving our comment as it was.
  const elsewhere = text.replace(/^LOCUS {7}pUC19_K45A/, "LOCUS       pUC19_v2  ");
  assert.equal((await reopen(elsewhere)).data.name, "pUC19_v2");
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

test("a protein region's note is saved, also after an edit moves the region", async () => {
  const doc = await open("testdata/library/protein-regions.gb");
  const cds = doc.data.features.find(f => f.name === "Nanobody")!;
  // Characters the qualifier's own format uses, quotes GenBank doubles, a line break, and
  // enough words to be wrapped, which the region's metadata must survive.
  const notes: Record<string, string> = {
    CDR1: 'Binds the "tip" | loop of the antigen; Kd ≈ 4 nM (SPR, 25 °C)\nSee lab book 7, p. 112',
    CDR3: "Randomised in the library with NNK codons, so every clone differs here and nowhere else in this domain"
  };
  // A field from a newer version is kept as it was.
  const regions = regionsOf(cds).map(r => (notes[r.name] ? { ...r, note: notes[r.name], more: { future: { kept: true } } } : r));
  const data = { ...doc.data, features: doc.data.features.map(f => (f.id === cds.id ? { ...f, notes: withRegions(f.notes, regions) } : f)) };
  const again = await reopen(save(doc, data));
  const back = regionsOf(again.data.features.find(f => f.name === "Nanobody")!);
  assert.deepEqual(back, regionsOf(data.features.find(f => f.id === cds.id)!));
  assert.equal(back.find(r => r.name === "CDR1")!.note, notes.CDR1);
  assert.deepEqual(back.find(r => r.name === "CDR3")!.more, { future: { kept: true } });
  // Three bases before the CDS's 30th codon move CDR3 a residue on, with its note.
  const nanobody = again.data.features.find(f => f.name === "Nanobody")!;
  const moved = insertBases(again.data, nanobody.start + 29 * 3, "GCT");
  const third = await reopen(save(again, moved));
  const cdr3 = regionsOf(third.data.features.find(f => f.name === "Nanobody")!).find(r => r.name === "CDR3")!;
  assert.equal(cdr3.start, back.find(r => r.name === "CDR3")!.start + 1);
  assert.equal(cdr3.note, notes.CDR3);
});

test("numeric qualifiers and web addresses survive saving, and /codon_start sets the frame", async () => {
  const gb = `LOCUS       partial                   21 bp    DNA     linear   SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     CDS             <1..21
                     /codon_start=2
                     /transl_table=11
                     /product="part of a protein"
                     /note="from https://www.addgene.org/12345/"
     CDS             complement(1..>21)
                     /codon_start=3
                     /label="rev"
ORIGIN
        1 aatgaaatgg taaccccccc c
//
`;
  const doc = await reopen(gb);
  const [fwd, rev] = doc.data.features;
  // Read from base 2: ATG AAA TGG TAA CCC CCC.
  assert.equal(protein(fwd, doc.data.sequence), "MKW*PP");
  // On the minus strand, from its third base.
  const revFrom3 = reverseComplement(doc.data.sequence).slice(2);
  assert.equal(protein(rev, doc.data.sequence).length, Math.floor(revFrom3.length / 3));
  const again = await reopen(save(doc));
  const [f2, r2] = again.data.features;
  assert.equal(String((f2.notes.codon_start as unknown[])[0]), "2");
  assert.equal(String((f2.notes.transl_table as unknown[])[0]), "11");
  assert.deepEqual(f2.notes.product, ["part of a protein"]);
  assert.deepEqual(f2.notes.note, ["from https://www.addgene.org/12345/"]);
  assert.equal(String((r2.notes.codon_start as unknown[])[0]), "3");
  assert.equal(protein(f2, again.data.sequence), protein(fwd, doc.data.sequence));
});

// ---------- annotations across the origin, a circle opened at it, fragment ends ----------
// Synthetic records throughout: bases made up, the same on every run, meaning nothing.

function synthetic(n: number): string {
  let x = 20260;
  let out = "";
  for (let i = 0; i < n; i++) {
    x = (x * 48271) % 2147483647;
    out += "ACGT"[(x >>> 12) & 3];
  }
  return out;
}

const mark = (name: string, type: string, start: number, end: number, strand: Strand = 1, locations?: Range[]): SeqFeature => ({
  id: `${type}:${name}`,
  name,
  type,
  start,
  end,
  strand,
  ...(locations ? { locations } : {}),
  notes: {},
  raw: {}
});

const bind = (name: string, start: number, end: number, strand: 1 | -1, sequence: string): SeqPrimer => {
  const site = basesIn(sequence, { start, end });
  return { id: `primer:${name}`, name, start, end, strand, bases: strand === 1 ? site : reverseComplement(site), notes: {}, raw: {} };
};

const bare = (name: string, sequence: string, circular: boolean) => fromParsed({ name, sequence, circular });

/** Each entry of a saved file's feature table: its key and its location as written. */
const locationsIn = (text: string) => readFeatureTables(text)[0].map(f => [f.key, f.location]);

test("annotations across a circle's origin are saved as joins in order, and read back exactly", async () => {
  const sequence = synthetic(366);
  const doc = bare("ring", sequence, true);
  const data: SeqData = {
    ...doc.data,
    features: [
      { ...mark("forward", "misc_feature", 300, 3), notes: { note: ["across the origin"] } },
      { ...mark("reverse", "misc_feature", 300, 3, -1), notes: { note: ["on the other strand"] } },
      mark("inside", "misc_feature", 10, 20)
    ],
    primers: [bind("across-F", 300, 3, 1, sequence), bind("across-R", 300, 3, -1, sequence), bind("inside-F", 50, 69, 1, sequence)],
    sources: [mark("across", "source", 300, 3)]
  };
  const text = save(doc, data);
  assert.deepEqual(locationsIn(text), [
    ["source", "join(301..366,1..4)"],
    ["misc_feature", "join(301..366,1..4)"],
    ["misc_feature", "complement(join(301..366,1..4))"],
    ["misc_feature", "11..21"],
    ["primer_bind", "join(301..366,1..4)"],
    ["primer_bind", "complement(join(301..366,1..4))"],
    ["primer_bind", "51..70"]
  ]);
  const again = await reopen(text);
  assertSameDocument(data, again.data, "ring");
  // 66 bases before the origin and 4 after it, on either strand.
  const across = sequence.slice(300) + sequence.slice(0, 4);
  assert.equal(across.length, 70);
  for (const f of [again.data.features[0], again.data.features[1], again.data.sources[0]]) assert.equal(featureBases(again.data.sequence, f), across, f.name);
  assert.deepEqual(again.data.primers.map(p => p.bases), data.primers.map(p => p.bases));
  // Their qualifiers are matched to them by where they start and end, which is still so.
  assert.deepEqual(again.data.features.slice(0, 2).map(f => f.notes.note), [["across the origin"], ["on the other strand"]]);
  // A file written the way older versions did (`301..4`) opens the same way, and is saved in order.
  const older = text.replace(/join\(301\.\.366,1\.\.4\)/g, "301..4");
  assert.ok(older.includes("complement(301..4)") && !older.includes("join("));
  const opened = await reopen(older);
  assertSameDocument(data, opened.data, "301..4");
  assert.deepEqual(locationsIn(save(opened)), locationsIn(text));
  assert.deepEqual(locationsIn(save(again)), locationsIn(text));
});

test("a circle whose topology alone was flipped still saves what crossed its origin as ordered joins", async () => {
  // Not how the Info tab makes a sequence linear (`withTopology`), but a way a document can
  // arrive here: ranges that run past the end, on a sequence with no origin to cross.
  const sequence = synthetic(366);
  const doc = bare("ring", sequence, true);
  const data: SeqData = {
    ...doc.data,
    circular: false,
    features: [mark("forward", "misc_feature", 300, 3), mark("reverse", "misc_feature", 300, 3, -1)],
    primers: [],
    sources: [mark("across", "source", 300, 3)]
  };
  const text = save(doc, data);
  assert.match(text, /^LOCUS .* linear /);
  assert.deepEqual(locationsIn(text), [
    ["source", "join(301..366,1..4)"],
    ["misc_feature", "join(301..366,1..4)"],
    ["misc_feature", "complement(join(301..366,1..4))"]
  ]);
  const again = await reopen(text);
  assert.equal(again.data.circular, false);
  assert.equal(again.data.sequence, sequence);
  const across = sequence.slice(300) + sequence.slice(0, 4);
  for (const f of [...again.data.features, ...again.data.sources]) {
    assert.deepEqual(f.locations, [{ start: 300, end: 365 }, { start: 0, end: 3 }], f.name);
    assert.equal(featureBases(again.data.sequence, f), across, f.name);
  }
});

test("features in several parts are written as they are, and only a part across the origin is split", async () => {
  const sequence = synthetic(366);
  const doc = bare("parts", sequence, true);
  const data: SeqData = {
    ...doc.data,
    features: [
      // In order round the origin, which falls between two parts.
      mark("between", "CDS", 0, 365, 1, [{ start: 0, end: 3 }, { start: 300, end: 365 }]),
      mark("between-reverse", "CDS", 0, 365, -1, [{ start: 0, end: 3 }, { start: 300, end: 365 }]),
      // The origin inside the first part, as a file's join reads back.
      mark("within", "CDS", 300, 19, -1, [{ start: 300, end: 3 }, { start: 9, end: 19 }]),
      mark("exons", "CDS", 30, 99, 1, [{ start: 30, end: 40 }, { start: 90, end: 99 }])
    ],
    primers: [],
    sources: []
  };
  const text = save(doc, data);
  assert.deepEqual(locationsIn(text), [
    ["CDS", "join(1..4,301..366)"],
    ["CDS", "complement(join(1..4,301..366))"],
    ["CDS", "complement(join(301..366,1..4,10..20))"],
    ["CDS", "join(31..41,91..100)"]
  ]);
  const again = await reopen(text);
  assertSameDocument(data, again.data, "parts");
  for (const [i, f] of data.features.entries()) assert.equal(featureBases(again.data.sequence, again.data.features[i]), featureBases(sequence, f), f.name);
});

test("a linear sequence's features in order keep their order, also when it runs back past the first part's start", async () => {
  const sequence = synthetic(120);
  const doc = bare("exons", sequence, false);
  // Ordered parts: `start` and `end` are the first part's start and the last part's end, so
  // the end can be before the start. Neither coordinate is put in order.
  const data: SeqData = {
    ...doc.data,
    features: [mark("exons", "CDS", 80, 29, 1, [{ start: 80, end: 99 }, { start: 10, end: 29 }]), mark("exons-reverse", "CDS", 80, 29, -1, [{ start: 80, end: 99 }, { start: 10, end: 29 }])],
    primers: [],
    sources: []
  };
  const text = save(doc, data);
  assert.deepEqual(locationsIn(text), [["CDS", "join(81..100,11..30)"], ["CDS", "complement(join(81..100,11..30))"]]);
  const parsed = await parseSequenceFile(new TextEncoder().encode(text), "exons.gb");
  assert.deepEqual(parsed.warnings, []);
  const again = fromParsed(parsed.sequences[0]);
  assertSameDocument(data, again.data, "exons");
  assert.equal(featureBases(again.data.sequence, again.data.features[0]), sequence.slice(80, 100) + sequence.slice(10, 30));
});

test("making a circle linear keeps what crossed the origin, as ordered parts, through saving", async () => {
  const sequence = synthetic(60);
  const doc = bare("ring", sequence, true);
  const data: SeqData = {
    ...doc.data,
    features: [mark("forward", "misc_feature", 50, 9), mark("reverse", "misc_feature", 50, 9, -1), mark("inside", "misc_feature", 20, 29)],
    primers: [bind("inside-F", 30, 49, 1, sequence)],
    sources: [mark("across", "source", 50, 9)]
  };
  const linear = withTopology(data, false);
  // The helper that opens a circle at its origin, with nothing added or dropped by the document.
  assert.deepEqual(linear, linearize(data));
  assert.equal(linear.circular, false);
  assert.equal(linear.sequence, sequence);
  const text = save(doc, linear);
  assert.match(text, /^LOCUS .* linear /);
  assert.deepEqual(locationsIn(text), [
    ["source", "join(51..60,1..10)"],
    ["misc_feature", "join(51..60,1..10)"],
    ["misc_feature", "complement(join(51..60,1..10))"],
    ["misc_feature", "21..30"],
    ["primer_bind", "31..50"]
  ]);
  const parsed = await parseSequenceFile(new TextEncoder().encode(text), "ring.gb");
  assert.deepEqual(parsed.warnings, []);
  const again = fromParsed(parsed.sequences[0]);
  assertSameDocument(linear, again.data, "linear ring");
  // All 20 bases, 10 before the origin and 10 after it, in order, on either strand.
  const across = sequence.slice(50) + sequence.slice(0, 10);
  assert.equal(across.length, 20);
  for (const f of [again.data.features[0], again.data.features[1], again.data.sources[0]]) {
    assert.deepEqual(f.locations, [{ start: 50, end: 59 }, { start: 0, end: 9 }], f.name);
    assert.equal(featureBases(again.data.sequence, f), across, f.name);
  }
  assert.deepEqual(again.data.features.slice(0, 2).map(f => f.strand), [1, -1]);
  // Making it circular again changes the flag and nothing else; the parts join up on reopening.
  const closed = withTopology(again.data, true);
  assert.equal(closed.circular, true);
  assert.deepEqual({ ...closed, circular: false }, again.data);
  const circle = await reopen(save(again, closed));
  assert.equal(circle.data.circular, true);
  assert.deepEqual(circle.data.features.slice(0, 2).map(f => [f.start, f.end, f.locations]), [[50, 9, undefined], [50, 9, undefined]]);
  assert.equal(featureBases(circle.data.sequence, circle.data.features[0]), across);
});

test("opening a circle at its origin keeps each annotation on its bases as ordered parts", () => {
  const sequence = synthetic(60);
  const data: SeqData = {
    name: "ring",
    description: "",
    circular: true,
    sequence,
    features: [
      mark("forward", "misc_feature", 50, 9),
      mark("reverse", "misc_feature", 50, 9, -1),
      mark("exons", "CDS", 55, 25, 1, [{ start: 55, end: 4 }, { start: 20, end: 25 }]),
      mark("inside", "misc_feature", 20, 29)
    ],
    primers: [bind("across-F", 55, 4, 1, sequence), bind("inside-F", 30, 49, 1, sequence)],
    sources: [mark("across", "source", 50, 9)]
  };
  const linear = linearize(data);
  assert.equal(linear.circular, false);
  assert.equal(linear.sequence, sequence);
  const [forward, reverse, exons, inside] = linear.features;
  assert.deepEqual(forward.locations, [{ start: 50, end: 59 }, { start: 0, end: 9 }]);
  assert.deepEqual(reverse.locations, forward.locations);
  assert.equal(reverse.strand, -1);
  assert.deepEqual(exons.locations, [{ start: 55, end: 59 }, { start: 0, end: 4 }, { start: 20, end: 25 }]);
  assert.deepEqual(linear.sources[0].locations, forward.locations);
  // Each covers the same bases, in the same order, as it did on the circle.
  for (const [i, f] of data.features.entries()) assert.equal(featureBases(linear.sequence, linear.features[i]), featureBases(sequence, f), f.name);
  assert.equal(featureBases(linear.sequence, linear.sources[0]), featureBases(sequence, data.sources[0]));
  assert.equal(featureBases(linear.sequence, forward).length, 20);
  // Their `start` and `end` stay as they were, so the end of a feature in order can come before its start.
  assert.deepEqual([forward.start, forward.end, exons.start, exons.end], [50, 9, 55, 25]);
  // What doesn't cross the origin is the same object, and a linear sequence comes back as it is.
  assert.equal(inside, data.features[3]);
  assert.equal(linearize(linear), linear);
  // Today a primer whose site crosses the origin is left out and the others stay as they were.
  // What should become of it is undecided; this records what the helper does.
  assert.deepEqual(linear.primers.map(p => p.name), ["inside-F"]);
  assert.equal(linear.primers[0], data.primers[1]);
});

test("every origin of a circle saves and reopens with each annotation on the same bases", async () => {
  const sequence = synthetic(60);
  const doc = bare("ring", sequence, true);
  const data: SeqData = {
    ...doc.data,
    features: [
      mark("forward", "misc_feature", 5, 24),
      mark("reverse", "misc_feature", 30, 49, -1),
      mark("exons", "CDS", 8, 41, 1, [{ start: 8, end: 14 }, { start: 20, end: 29 }, { start: 36, end: 41 }])
    ],
    primers: [bind("F", 12, 31, 1, sequence), bind("R", 40, 59, -1, sequence)],
    sources: [mark("part", "source", 2, 57)]
  };
  for (let origin = 0; origin < sequence.length; origin++) {
    const turned = setOrigin(data, origin);
    const text = save(doc, turned);
    // No range is written backwards: what crosses the origin is a join of the two sides.
    for (const [, location] of locationsIn(text)) {
      for (const [, from, to] of String(location).matchAll(/(\d+)\.\.(\d+)/g)) assert.ok(Number(from) <= Number(to), `origin ${origin}: ${location}`);
    }
    const again = await reopen(text);
    assertSameDocument(turned, again.data, `origin ${origin}`);
    for (const f of turned.features) {
      assert.equal(featureBases(again.data.sequence, again.data.features.find(g => g.name === f.name)!), featureBases(turned.sequence, f), `origin ${origin}: ${f.name}`);
    }
  }
});

for (const circular of [true, false]) {
  test(`${circular ? "circular" : "linear"} sources come back as saved: whole, partial, reverse, in parts${circular ? " and across the origin" : ""}`, async () => {
    const sequence = synthetic(120);
    const organism = { notes: { organism: ["synthetic construct"], mol_type: ["other DNA"] } };
    const whole = { ...mark("whole", "source", 0, 119), notes: organism.notes, raw: organism };
    const sources = [
      whole,
      mark("partial", "source", 10, 29),
      mark("reverse", "source", 40, 59, -1),
      mark("parts", "source", 60, 99, 1, [{ start: 60, end: 69 }, { start: 90, end: 99 }]),
      ...(circular ? [mark("across", "source", 110, 5)] : [])
    ];
    const doc = { ...bare("src", sequence, circular), wholeSources: [whole.id] };
    const data: SeqData = { ...doc.data, sources };
    const again = await reopen(save(doc, data));
    assertSameDocument(data, again.data, "sources");
    assert.deepEqual(again.wholeSources, [again.data.sources[0].id]);
    assert.deepEqual(again.data.sources[0].notes, organism.notes);
    assert.deepEqual(locationsIn(save(again)).slice(0, sources.length).map(([, location]) => location), [
      "1..120",
      "11..30",
      "complement(41..60)",
      "join(61..70,91..100)",
      ...(circular ? ["join(111..120,1..6)"] : [])
    ]);
  });
}

test("a protein region's name and kind keep their spaces wherever its qualifier wraps", async () => {
  const doc = await open("testdata/library/protein-regions.gb");
  const cds = doc.data.features.find(f => f.name === "Nanobody")!;
  const a = (n: number) => "A".repeat(n);
  // The text before a region starts at the 21st column, so these put a space at the 58th
  // character, at the end of a line, at the 59th, and then at the start of the next, with
  // one that doesn't, and one with a quote there.
  const regions: ProteinRegion[] = [
    { name: a(3), kind: `${a(33)} B`, start: 1, end: 3 },
    { name: `${a(28)} B`, kind: "Signal peptide", start: 5, end: 7 },
    { name: `${a(37)} B`, kind: "Signal peptide", start: 9, end: 11 },
    { name: `${a(38)} B`, kind: "Signal peptide", start: 13, end: 15 },
    { name: `${a(27)} B`, kind: "Signal peptide", start: 17, end: 19 },
    { name: `${a(36)}"B" C`, kind: "Signal peptide", start: 21, end: 23 }
  ].map(r => ({ ...r, accession: "", sourceStart: r.start, sourceEnd: r.end, predicted: false }));
  const edited = { ...doc.data, features: doc.data.features.map(f => (f.id === cds.id ? { ...f, notes: withRegions(f.notes, regions) } : f)) };
  const again = await reopen(save(doc, edited));
  const back = regionsOf(again.data.features.find(f => f.name === "Nanobody")!);
  assert.deepEqual(back.map(r => [r.name, r.kind]), regions.map(r => [r.name, r.kind]));
  assert.deepEqual(back, regions);
});

// A KpnI site cuts GGTAC^C, leaving 3′ overhangs; EcoRI cuts G^AATTC, leaving 5′ ones. The
// pieces of the two: 0–44, 41–80 (top strand 45–76) and 77–111.
const STICKY = "A".repeat(40) + "GGTACC" + "C".repeat(30) + "GAATTC" + "T".repeat(30);
const piece = (enzymes: string[], size: number): Fragment => digestSequence(fromParsed({ name: "template", sequence: STICKY, circular: false }).data, enzymes).fragments.find(f => fragmentSize(f) === size)!;

test("fragment ends save every base on either strand to GenBank and the top strand to FASTA", async () => {
  const cases: [string[], number, string, string][] = [
    // enzymes, size of the top strand, the bases in a GenBank file, the bases in FASTA
    [["KpnI"], 45, STICKY.slice(0, 45), STICKY.slice(0, 45)], // a 3′ end on the right: the top strand runs past the other
    [["KpnI"], 67, STICKY.slice(41), STICKY.slice(45)], // a 3′ end on the left: four bases of the other strand only
    [["KpnI", "EcoRI"], 32, STICKY.slice(41, 81), STICKY.slice(45, 77)], // a 3′ end and a 5′ end
    [["KpnI", "EcoRI"], 35, STICKY.slice(77), STICKY.slice(77)] // a 5′ end on the left
  ];
  for (const [enzymes, size, stored, top] of cases) {
    const fragment = piece(enzymes, size);
    const label = `${enzymes.join("+")}, ${size} bp`;
    const again = await reopen(save(fromParsed({}), fragmentDocument(fragment, "template")));
    assert.equal(again.data.sequence, stored, `${label}: bases in the file`);
    assert.deepEqual(again.data.ends, { left: fragment.left, right: fragment.right }, `${label}: ends`);
    assert.equal(topStrandLength(again.data.sequence, again.data.ends), size, `${label}: top strand`);
    const fasta = await reopen(serialize(toParsed(again, again.data), "fasta"), "piece.fa");
    assert.equal(fasta.data.sequence, top, `${label}: FASTA`);
  }
});

test("ends that don't match the bases are blunt on opening, and a circle has none", async () => {
  const middle = piece(["KpnI", "EcoRI"], 32);
  const stored = STICKY.slice(41, 81);
  const text = save(fromParsed({}), fragmentDocument(middle, "template"));
  const left = '["3\'","GTAC","KpnI"]';
  const right = '["5\'","AATT","EcoRI"]';
  assert.ok(text.includes(`[${left},${right}]`), text);
  const opened = async (ends: string) => (await reopen(text.replace(`[${left},${right}]`, ends))).data;
  // Bases an end names that aren't there: that end is blunt and the other stays.
  const oneOff = await opened(`[${left.replace("GTAC", "TTTT")},${right}]`);
  assert.deepEqual(oneOff.ends, { left: { kind: "blunt", bases: "" }, right: middle.right });
  assert.equal(oneOff.sequence, stored);
  // Both ends: none, and the bases stay.
  const bothOff = await opened(`[${left.replace("GTAC", "TTTT")},${right.replace("AATT", "CCCC")}]`);
  assert.equal(bothOff.ends, undefined);
  assert.equal(bothOff.sequence, stored);
  // Text that isn't a pair of ends.
  for (const ends of ["[]", `[${left}]`, `[["sticky","GTAC"],${right}]`, `[["3'","GT-C"],${right}]`, "not json"]) {
    const d = await opened(ends);
    assert.equal(d.ends, undefined, ends);
    assert.equal(d.sequence, stored, ends);
  }
  // Overhangs that together are as long as the molecule can't both be there.
  const tiny = bare("tiny", "ACGTAC", false);
  const tooLong = await reopen(save(tiny, tiny.data, { comments: formatComments([], [], undefined, { ends: '[["5\'","ACGT"],["5\'","GTAC"]]' }) }));
  assert.equal(tooLong.data.ends, undefined);
  assert.equal(tooLong.data.sequence, "ACGTAC");
  // A circle has no ends: a file that says it is circular has none, and its bases stay.
  const circle = await reopen(text.replace(/ linear {3}/, " circular "));
  assert.equal(circle.data.circular, true);
  assert.equal(circle.data.ends, undefined);
  assert.equal(circle.data.sequence, stored);
  // A document made circular saves none either.
  assert.ok(!save(fromParsed({}), { ...fragmentDocument(middle, "template"), circular: true }).includes("Strandivo fragment ends"));
});

// ---------- a fragment's outer ends when it is digested again or edited ----------

test("digesting a fragment again keeps its outer ends and never cuts inside an overhang", async () => {
  // BamHI leaves GATC on both ends of the middle piece, and DpnI cuts GA^TC: it has a site in each overhang and one between.
  const sequence = "A".repeat(30) + "GGATCC" + "C".repeat(40) + "GATC" + "C".repeat(40) + "GGATCC" + "A".repeat(30);
  const middle = digestSequence(bare("template", sequence, false).data, ["BamHI"]).fragments.find(f => fragmentSize(f) === 90)!;
  assert.deepEqual([middle.left.kind, middle.left.bases, middle.right.kind, middle.right.bases], ["5'", "GATC", "5'", "GATC"]);
  const opened = (await reopen(save(fromParsed({}), fragmentDocument(middle, "template")))).data;
  assert.equal(opened.sequence.length, 94);
  const dam = hostMethylation("");
  const counts = reactionCounts(opened, ["DpnI"], dam);
  assert.equal(counts.sites.get("DpnI"), 3, "a site in each overhang and one between");
  assert.equal(counts.cuts.get("DpnI"), 1, "only the one between cuts");
  const again = fragmentDigest(opened, ["DpnI"], dam);
  assert.equal(again.fragments.length, 2);
  assert.deepEqual(again.fragments[0].left, opened.ends!.left);
  assert.deepEqual(again.fragments[1].right, opened.ends!.right);
  assert.equal(again.fragments[0].right.kind, "blunt");
  assert.equal(again.fragments[1].left.kind, "blunt");
  assert.equal(again.fragments.map(fragmentSize).reduce((a, b) => a + b), fragmentSize(middle), "the pieces add up to the top strand");
  // A 3′ overhang on the left and a 5′ one on the right hide sites of RsaI (GT^AC) and MluCI (^AATT) the same way.
  const sticky = (await reopen(save(fromParsed({}), fragmentDocument(piece(["KpnI", "EcoRI"], 32), "template")))).data;
  for (const [enzyme, sites] of [["RsaI", 1], ["MluCI", 1]] as const) {
    assert.equal(reactionCounts(sticky, [enzyme], dam).sites.get(enzyme), sites, `${enzyme}'s site`);
    assert.equal(reactionCounts(sticky, [enzyme], dam).cuts.get(enzyme) ?? 0, 0, `${enzyme} can't cut inside an overhang`);
    assert.equal(fragmentDigest(sticky, [enzyme], dam).cut, false, enzyme);
  }
});

test("editing a fragment clears an end only when the edit reaches into its overhang", async () => {
  const stored = (await reopen(save(fromParsed({}), fragmentDocument(piece(["KpnI", "EcoRI"], 32), "template")))).data;
  const blunt = { kind: "blunt", bases: "" };
  // The piece as cut (a 3′ overhang on the left, a 5′ one on the right, four bases each), and turned round.
  const turned = reverseComplementRange(stored, null);
  assert.deepEqual(turned.ends, { left: reverseEnd(stored.ends!.right), right: reverseEnd(stored.ends!.left) });
  for (const [what, d] of [["as cut", stored], ["turned round", turned]] as const) {
    const { left, right } = d.ends!;
    const ends = (x: SeqData) => [x.ends?.left, x.ends?.right];
    assert.equal(d.sequence.length, 40);
    // Edits between the overhangs touch neither, and one at their edge keeps them.
    assert.deepEqual(ends(insertBases(d, 20, "TTT")), [left, right], `${what}: inside`);
    assert.deepEqual(ends(deleteRange(d, { start: 20, end: 22 })), [left, right], `${what}: deleting inside`);
    assert.deepEqual(ends(insertBases(d, 4, "T")), [left, right], `${what}: after the left overhang`);
    assert.deepEqual(ends(insertBases(d, 36, "T")), [left, right], `${what}: before the right overhang`);
    assert.deepEqual(ends(deleteRange(d, { start: 4, end: 7 })), [left, right], `${what}: deleting after the left overhang`);
    assert.deepEqual(ends(deleteRange(d, { start: 33, end: 35 })), [left, right], `${what}: deleting before the right overhang`);
    // One that reaches into an overhang or past an end clears that end only.
    assert.deepEqual(ends(insertBases(d, 3, "T")), [blunt, right], `${what}: in the left overhang`);
    assert.deepEqual(ends(insertBases(d, 0, "T")), [blunt, right], `${what}: before the first base`);
    assert.deepEqual(ends(insertBases(d, 37, "T")), [left, blunt], `${what}: in the right overhang`);
    assert.deepEqual(ends(insertBases(d, 40, "T")), [left, blunt], `${what}: after the last base`);
    assert.deepEqual(ends(deleteRange(d, { start: 3, end: 6 })), [blunt, right], `${what}: deleting into the left overhang`);
    assert.deepEqual(ends(deleteRange(d, { start: 33, end: 36 })), [left, blunt], `${what}: deleting into the right overhang`);
    // Bases that make the same overhang again are new bases: the end is still cleared.
    assert.deepEqual(ends(insertBases(d, 0, d.sequence.slice(0, 4))), [blunt, right], `${what}: the left overhang typed again`);
    assert.deepEqual(ends(insertBases(d, 40, d.sequence.slice(36))), [left, blunt], `${what}: the right overhang typed again`);
    // Turning round a stretch between the overhangs leaves both; one that takes in an overhang clears it.
    assert.deepEqual(ends(reverseComplementRange(d, { start: 10, end: 20 })), [left, right], `${what}: a stretch turned round`);
    assert.deepEqual(ends(reverseComplementRange(d, { start: 0, end: 10 })), [blunt, right], `${what}: a stretch with the left overhang`);
    assert.deepEqual(ends(reverseComplementRange(d, { start: 30, end: 39 })), [left, blunt], `${what}: a stretch with the right overhang`);
  }
});

// ---------- a piece cut through a CDS: its frame and its translation, saved and reopened ----------
// Synthetic records: codons picked from a short list, meaning nothing.

const SENSE = ["GCT", "CGT", "AAC", "GAT", "TGT", "CAG", "GGT", "CAT", "ATT", "CTG", "AAA", "CCT", "TCT", "ACC", "TGG", "TAT", "GTT"];
/** `count` sense codons picked by position, so that neighbours differ, beginning `from` places along. */
const codons = (count: number, from = 0) => Array.from({ length: count }, (_, i) => SENSE[((from + i) * 5) % SENSE.length]).join("");
const translated = (bases: string) => Array.from({ length: Math.floor(bases.length / 3) }, (_, i) => translateCodon(bases.slice(3 * i, 3 * i + 3))).join("");

/** A CDS as a database gives it: with the protein its bases make as /translation, the stop left off. */
const imported = (name: string, start: number, end: number, strand: Strand, coding: string): SeqFeature => ({
  ...mark(name, "CDS", start, end, strand),
  notes: { product: [`${name} protein`], translation: [translated(coding).replace(/\*$/, "")] }
});

/** A saved file's CDS entries by their /label, with their qualifiers as written. */
const cdsIn = (text: string) => Object.fromEntries(readFeatureTables(text)[0].filter(f => f.key === "CDS").map(f => {
  const q = Object.fromEntries(f.qualifiers);
  return [q.label, q];
}));

test("a digest piece cut through a CDS is saved in frame, without the translation it no longer matches", async () => {
  const spacer = "CT".repeat(15);
  const b = `ATG${codons(20)}TAA`;
  const a = `ATG${codons(40, 3)}GAATTC${codons(50, 7)}TAA`;
  const c = `ATG${codons(30, 11)}TAA`;
  const sequence = spacer + b + spacer + a + spacer + reverseComplement(c) + spacer;
  assert.equal(sequence.length, 564);
  assert.equal(cutsFor(sequence, false, ["EcoRI"]).length, 1, "one site, inside the middle gene");
  const features = [imported("B", 30, 95, 1, b), imported("A", 126, 407, 1, a), imported("C", 438, 533, -1, c)];
  const template = await reopen(save(fromParsed({}), { ...bare("template", sequence, false).data, features }));
  const original = (name: string) => template.data.features.find(f => f.name === name)!;
  assert.ok(original("A").notes.translation && original("B").notes.translation && original("C").notes.translation, "the file gave each a translation");
  const { fragments } = digestSequence(template.data, ["EcoRI"]);
  const saved = async (f: Fragment) => {
    const text = save(fromParsed({}), fragmentDocument(f, "template"));
    return { data: (await reopen(text)).data, cds: cdsIn(text) };
  };
  const named = (d: SeqData, name: string) => d.features.find(f => f.name === name)!;

  // The left piece ends inside the middle gene: that gene is cut short and the first one is whole.
  const left = await saved(fragments.find(f => fragmentSize(f) === 250)!);
  assert.deepEqual(left.data.features.map(f => f.name), ["B", "A"]);
  assert.deepEqual(named(left.data, "B").notes.translation, original("B").notes.translation);
  assert.equal(left.cds.B.translation, (original("B").notes.translation as string[])[0], "written in the file");
  assert.equal(named(left.data, "A").notes.translation, undefined);
  assert.ok(!("translation" in left.cds.A), "no translation written for the cut gene");
  assert.ok(!("codon_start" in left.cds.A) && !("codon_start" in left.cds.B), "no /codon_start where the frame did not move");

  // The right piece starts inside it, after 124 of its bases: two bases of a codon, then the next whole codon.
  const right = await saved(fragments.find(f => fragmentSize(f) === 314)!);
  assert.deepEqual(right.data.features.map(f => f.name), ["A", "C"]);
  const cut = named(right.data, "A");
  assert.ok(!("translation" in right.cds.A), "no translation written for the cut gene");
  assert.equal(right.cds.A.codon_start, "3");
  assert.deepEqual(cut.notes.codon_start, ["3"]);
  assert.equal(featureBases(right.data.sequence, cut), featureBases(template.data.sequence, original("A")).slice(124));
  assert.equal(protein(cut, right.data.sequence), protein(original("A"), template.data.sequence).slice(42), "it reads from the codon it had");
  assert.deepEqual(named(right.data, "C").notes.translation, original("C").notes.translation, "a gene it did not touch keeps its translation");
  assert.ok(!("codon_start" in right.cds.C));
});

test("a piece cut from a partial CDS keeps its codons, whatever frame the file gave", async () => {
  const body = codons(30, 2);
  const sequence = `T${body}GG`;
  const origin = sequence.match(/.{1,60}/g)!.map((line, i) => `${String(i * 60 + 1).padStart(9)} ${line.toLowerCase().match(/.{1,10}/g)!.join(" ")}`).join("\n");
  // /codon_start=2 as GenBank writes it, with no quotes: the first base ends a codon before the CDS.
  const file = `LOCUS       partial                  ${sequence.length} bp    DNA     linear   SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     CDS             <1..${sequence.length}
                     /codon_start=2
                     /transl_table=11
                     /product="part of a protein"
                     /translation="${translated(body)}"
ORIGIN
${origin}
//
`;
  const doc = await reopen(file);
  assert.equal(doc.data.features.length, 1);
  const whole = protein(doc.data.features[0], doc.data.sequence);
  assert.equal(whole, translated(body));
  for (let lead = 0; lead <= 5; lead++) {
    const label = `${lead} bases cut off its start`;
    const again = (await reopen(save(fromParsed({}), wholeFragment(doc.data, { start: lead, end: sequence.length - 1 }).data))).data;
    const f = again.features[0];
    assert.equal(Number((f.notes.codon_start as unknown[])[0]), ((((1 - lead) % 3) + 3) % 3) + 1, `${label}: /codon_start`);
    assert.equal(protein(f, again.sequence), whole.slice(lead <= 1 ? 0 : Math.ceil((lead - 1) / 3)), `${label}: its protein`);
    // The first base was no part of a codon, so cutting only it changes nothing the translation says.
    assert.deepEqual(f.notes.translation, lead <= 1 ? [translated(body)] : undefined, `${label}: its translation`);
  }
});

test("a rotated, opened or turned-round circle keeps the translation its CDS was imported with", async () => {
  const translation = ["MKVLAAGIVGLLLAAQPAMAQKLSEE"];
  const circle: SeqData = { ...bare("circle", synthetic(366), true).data, features: [{ ...mark("wrapped", "CDS", 300, 59), notes: { translation } }] };
  const opened = wholeFragment(circle, { start: 200, end: 199 }).data;
  const made: [string, SeqData][] = [
    ["rotated", setOrigin(circle, 100)],
    ["opened elsewhere", opened],
    ["turned round", reverseComplementRange(circle, null)],
    ["opened and turned round", reverseComplementRange(opened, null)]
  ];
  for (const [what, d] of made) {
    const again = await reopen(save(fromParsed({}), d));
    assert.deepEqual(again.data.features[0].notes.translation, translation, what);
    assert.equal(again.data.features[0].notes.codon_start, undefined, what);
  }
});

test("a PCR product is saved in frame, with the translation only while its CDS is whole and unchanged", async () => {
  const sequence = synthetic(300);
  const coding = sequence.slice(100, 199);
  const template: SeqData = { ...bare("template", sequence, false).data, features: [imported("gene", 100, 198, 1, coding)] };
  const reverse = { name: "R", bases: reverseComplement(sequence.slice(211, 231)), start: 211, end: 230, strand: -1 as const };
  const site = sequence.slice(88, 121);
  const make = async (bases: string, start = 88, end = 120) => {
    const p = pcrProduct(sequence, false, { name: "F", bases, start, end, strand: 1 }, reverse);
    assert.ok(p, "the primers make a product");
    return (await reopen(save(fromParsed({}), productDocument(template, p)))).data;
  };
  const whole = await make(`GGATCC${site}`);
  assert.deepEqual(whole.features[0].notes.translation, template.features[0].notes.translation, "the whole CDS, with a tail");
  assert.equal(whole.features[0].notes.codon_start, undefined);
  // Starting one base into the CDS.
  const clipped = await make(sequence.slice(101, 121), 101, 120);
  assert.equal(clipped.features[0].notes.translation, undefined, "a CDS cut at its start");
  assert.deepEqual(clipped.features[0].notes.codon_start, ["3"]);
  assert.equal(protein(clipped.features[0], clipped.sequence), protein(template.features[0], sequence).slice(1));
  // A base the primer changes inside the CDS.
  const changed = await make(site.slice(0, 17) + (site[17] === "A" ? "C" : "A") + site.slice(18));
  assert.equal(changed.features[0].notes.translation, undefined, "a CDS the primer changed");
  assert.equal(changed.features[0].notes.codon_start, undefined);
});
