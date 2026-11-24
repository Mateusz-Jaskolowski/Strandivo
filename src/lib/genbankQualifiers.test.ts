// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// GenBank qualifier values, read and written as the format has them. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { formatQualifier, readFeatureTables } from "./genbankQualifiers.ts";
import { parseSequenceFile, serialize } from "../doc/fileio.ts";
import { fromParsed, toParsed } from "../doc/convert.ts";

const FILE = `LOCUS       quals                     60 bp    DNA     circular SYN 01-JAN-2026
DEFINITION  Test.
FEATURES             Location/Qualifiers
     source          1..60
                     /organism="synthetic construct"
     CDS             complement(join(1..12,
                     20..30))
                     /gene="bla"
                     /codon_start=2
                     /note="An NCBI note, wrapped at a space as GenBank does, onto
                     another line, with ""quotes"" and a back\\slash, and/or
                     /slashes"
                     /note="A second note"
                     /pseudo
                     /translation="MSIQHFRVALIPFFAAFCLPVFAHPETLVKVKDAEDQLGARVGYIELDLNSGKILE
                     SFRPEERFPMMSTFK"
     misc_feature    40..50
                     /label="tag"
                     /note="short"
ORIGIN
        1 atggctagca tgactggtgg acagcaaatg atggctagca tgactggtgg acagcaaatg
//
`;

test("the table gives each value whole: quotes, wrapped lines and slashes", () => {
  const [features] = readFeatureTables(FILE);
  assert.deepEqual(features.map(f => f.key), ["source", "CDS", "misc_feature"]);
  assert.equal(features[1].location, "complement(join(1..12,20..30))");
  assert.deepEqual(features[1].qualifiers, [
    ["gene", "bla"],
    ["codon_start", "2"],
    ["note", 'An NCBI note, wrapped at a space as GenBank does, onto another line, with "quotes" and a back\\slash, and/or /slashes'],
    ["note", "A second note"],
    ["pseudo", ""],
    ["translation", "MSIQHFRVALIPFFAAFCLPVFAHPETLVKVKDAEDQLGARVGYIELDLNSGKILESFRPEERFPMMSTFK"]
  ]);
});

test("each record of a file has its own table", () => {
  const tables = readFeatureTables(FILE + FILE.replace("bla", "neo"));
  assert.equal(tables.length, 2);
  assert.equal(tables[1][1].qualifiers[0][1], "neo");
});

test("opening a GenBank file reads notes as written", async () => {
  const parsed = await parseSequenceFile(new TextEncoder().encode(FILE), "quals.gb");
  const doc = fromParsed(parsed.sequences[0]);
  const cds = doc.data.features.find(f => f.type === "CDS")!;
  assert.deepEqual(cds.notes.note, ['An NCBI note, wrapped at a space as GenBank does, onto another line, with "quotes" and a back\\slash, and/or /slashes', "A second note"]);
  assert.equal(cds.notes.codon_start?.toString(), "2");
});

test("a long value wraps at spaces with its quotes doubled", () => {
  const lines = formatQualifier("note", 'Says "stop" here, and then goes on for long enough that it has to wrap onto a second line');
  assert.ok(lines.every(l => l.length <= 79 && l.startsWith(" ".repeat(21))), lines.join("\n"));
  assert.equal(lines.join("\n"), [
    '                     /note="Says ""stop"" here, and then goes on for long',
    '                     enough that it has to wrap onto a second line"'
  ].join("\n"));
});

test("a word too long for a line, or one starting with a slash, isn't split off", () => {
  const url = "https://example.org/" + "x".repeat(70);
  assert.deepEqual(formatQualifier("note", `See ${url}`).map(l => l.trim()), ['/note="See', `${url}"`]);
  const slash = formatQualifier("note", "word ".repeat(10) + "and /or more");
  assert.ok(!slash.some(l => l.trim().startsWith("/or")), slash.join("\n"));
});

test("translations and the app's own values are cut to the width", () => {
  const lines = formatQualifier("strandivo_regions", "x".repeat(100));
  assert.ok(lines.length > 1 && lines.slice(0, -1).every(l => l.length === 79));
});

test("saving and reopening keeps every value, whatever it holds", async () => {
  const parsed = await parseSequenceFile(new TextEncoder().encode(FILE), "quals.gb");
  const doc = fromParsed(parsed.sequences[0]);
  const values = [
    'Says "stop" here, and then goes on for long enough that it has to wrap onto a second line',
    "and/or a line starting with a slash after wrapping, as it might: word word word /or",
    "https://example.org/" + "x".repeat(70),
    "A back\\slash"
  ];
  const data = { ...doc.data, features: doc.data.features.map(f => (f.type === "misc_feature" ? { ...f, notes: { ...f.notes, note: values } } : f)) };
  const text = serialize(toParsed(doc, data), "genbank");
  assert.ok(!/SVQ/.test(text));
  const again = fromParsed((await parseSequenceFile(new TextEncoder().encode(text), "saved.gb")).sequences[0]);
  assert.deepEqual(again.data.features.find(f => f.type === "misc_feature")!.notes.note, values);
  const cds = again.data.features.find(f => f.type === "CDS")!;
  assert.deepEqual(cds.notes.note, doc.data.features.find(f => f.type === "CDS")!.notes.note);
  assert.equal(String((cds.notes.translation as string[])[0]), "MSIQHFRVALIPFFAAFCLPVFAHPETLVKVKDAEDQLGARVGYIELDLNSGKILESFRPEERFPMMSTFK");
});

// A note as Strandivo up to 0.4.0-rc.1 saved it: the generic writer, which cut values at 79
// columns mid-word, and padded locations to the longest key.
const OLD_NOTE = "Codon optimised for E. coli by the core facility, checked by Sanger sequencing in March, with a silent change at base 120.";
const oldFile = async () => {
  const { jsonToGenbank } = await import("@teselagen/bio-parsers");
  return jsonToGenbank({
    name: "old",
    sequence: "atggctagcatgactggtggacagcaaatgatggctagcatgactggtggacagcaaatg",
    circular: true,
    features: [
      { name: "tag", type: "misc_feature", start: 0, end: 11, strand: 1, notes: { note: [OLD_NOTE, "short"] } },
      { name: "bla", type: "CDS", start: 20, end: 40, strand: -1, notes: {} }
    ]
  }) as string;
};

test("a note the old writer cut mid-word opens whole", async () => {
  const text = await oldFile();
  // The cut is mid-word, so this checks something.
  assert.ok(text.split(/\r?\n/).some(l => l.length === 79 && /\w$/.test(l)), text);
  const [features] = readFeatureTables(text);
  assert.deepEqual(features[0].qualifiers.filter(([n]) => n === "note").map(([, v]) => v), [OLD_NOTE, "short"]);
  const doc = fromParsed((await parseSequenceFile(new TextEncoder().encode(text), "old.gb")).sequences[0]);
  assert.deepEqual(doc.data.features.find(f => f.name === "tag")!.notes.note, [OLD_NOTE, "short"]);
});

test("a note wrapped at a space at the 79th column still joins with a space elsewhere", () => {
  const first = '                     /note="Wrapped at a space, as GenBank does; this line ends';
  assert.equal(first.length, 79);
  const text = FILE.replace('/note="short"', `${first}\n                     exactly at the edge"`);
  const [features] = readFeatureTables(text);
  assert.equal(features[2].qualifiers[1][1], "Wrapped at a space, as GenBank does; this line ends exactly at the edge");
});

test("the app's own wrapped lines stop short of the 79th column", () => {
  for (let n = 40; n < 200; n++) {
    const value = Array.from({ length: n }, (_, i) => "ab".repeat(1 + (i % 4))).join(" ");
    const lines = formatQualifier("note", value);
    assert.ok(lines.slice(0, -1).every(l => l.length < 79), lines.join("\n"));
  }
});

// Values with no spaces to wrap at (a protein region's name, kind and numbers) are cut to
// the width and joined with nothing between the lines. Each line is trimmed when read, so
// a space at a cut would be lost, and a quote ending a line closes the value.

/** The text of the lines `formatQualifier` writes for a value, read back as a file's table gives it. */
function readBack(name: string, value: string): string {
  const record = [
    "LOCUS       one                       12 bp    DNA     linear   SYN 01-JAN-2026",
    "FEATURES             Location/Qualifiers",
    "     CDS             1..12",
    ...formatQualifier(name, value),
    "ORIGIN",
    "        1 atggctagca tg",
    "//"
  ].join("\n");
  return readFeatureTables(record)[0][0].qualifiers[0][1];
}

/** A protein region as `formatRegion` writes it: name, kind, residues, and where from. */
const region = (name: string, kind = "Signal peptide") => `${name}|${kind}|1-5|:1-5`;

/** The text cut every 58 characters, wherever that falls: how the lines were cut until now. */
const everyCharacter = (name: string, value: string) => `/${name}="${value.replace(/"/g, '""')}"`.match(/.{1,58}/g)!;

test("a region's name and kind keep their spaces wherever the qualifier is cut", () => {
  const a = (n: number) => "A".repeat(n);
  // The 58th character of the text, which ended a line before, or the 59th, which started the next.
  for (const value of [
    region(a(3), `${a(33)} B`),
    region(`${a(28)} B`),
    region(`${a(37)} B`),
    region(`${a(38)} B`),
    region(`${a(27)} B`),
    region(`${a(36)}"B" C`)
  ]) {
    assert.equal(readBack("strandivo_regions", value), value);
  }
});

test("no cut position loses a space or a quote, whatever the name", () => {
  // Names are trimmed before they are written, so none starts with a space.
  for (let n = 1; n < 130; n++) {
    for (const name of [`${"A".repeat(n)} B`, `${"A".repeat(n)}  B`, `${"A".repeat(n)}"B"`, `${"A".repeat(n)} "B" C`, `${"A".repeat(n)}"" B`]) {
      const value = region(name);
      assert.equal(readBack("strandivo_regions", value), value, `${n}: ${name}`);
    }
  }
});

test("a cut moves back off a space or between a doubled quote's two, and lines keep to the width", () => {
  const text = (name: string, kind: string) => formatQualifier("strandivo_regions", region(name, kind)).map(l => l.slice(21));
  const a = (n: number) => "A".repeat(n);
  // The kind's space is the 58th character: the line ends before the word that follows it.
  assert.deepEqual(text(`${a(28)} B`, "Signal peptide"), [`/strandivo_regions="${a(28)} B|Signa`, 'l peptide|1-5|:1-5"']);
  // The name's space is the 58th and then the 59th.
  assert.deepEqual(text(`${a(37)} B`, "Signal peptide"), [`/strandivo_regions="${a(36)}`, 'A B|Signal peptide|1-5|:1-5"']);
  assert.deepEqual(text(`${a(38)} B`, "Signal peptide"), [`/strandivo_regions="${a(37)}`, 'A B|Signal peptide|1-5|:1-5"']);
  // A quote is written doubled, and its two stay together: they would have been split between the 58th and 59th.
  assert.deepEqual(text(`${a(37)}"B"`, "Signal peptide"), [`/strandivo_regions="${a(37)}`, '""B""|Signal peptide|1-5|:1-5"']);
  for (let n = 1; n < 130; n++) {
    for (const lines of [formatQualifier("strandivo_regions", region(`${"A".repeat(n)} B`)), formatQualifier("strandivo_regions", region(`${"A".repeat(n)}"B"`))]) {
      assert.ok(lines.every(l => l.length <= 79), lines.join("\n"));
    }
  }
});

test("a run of spaces too long to cut within runs on to a longer line rather than lose one", () => {
  const value = region(`A${" ".repeat(100)}B`);
  assert.equal(readBack("strandivo_regions", value), value);
});

test("a value with no space or quote at a cut is cut as it always was", () => {
  const same = (name: string, value: string) => assert.deepEqual(formatQualifier(name, value).map(l => l.slice(21)), everyCharacter(name, value), value);
  // The cut falls inside the word after the kind's space, and then inside a name.
  same("strandivo_regions", region(`${"A".repeat(27)} B`));
  same("strandivo_regions", region("CDR1", "Complementarity-determining"));
  same("strandivo_regions", region("A".repeat(80), "Domain"));
  same("strandivo_regions", "x".repeat(100));
  same("translation", "M".repeat(150));
});

test("a value cut the old way, with its lines joined with nothing between, still reads whole", () => {
  const value = "Loop|Antigen-binding loop of the nanobody|25-33|:25-33";
  const old = [
    "LOCUS       one                       12 bp    DNA     linear   SYN 01-JAN-2026",
    "FEATURES             Location/Qualifiers",
    "     CDS             1..12",
    '                     /strandivo_regions="Loop|Antigen-binding loop of the nanob',
    '                     ody|25-33|:25-33"',
    "ORIGIN",
    "        1 atggctagca tg",
    "//"
  ].join("\n");
  assert.equal(old.split("\n")[3].length, 79);
  assert.equal(readFeatureTables(old)[0][0].qualifiers[0][1], value);
});
