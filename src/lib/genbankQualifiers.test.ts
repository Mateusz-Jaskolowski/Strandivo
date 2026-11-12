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
