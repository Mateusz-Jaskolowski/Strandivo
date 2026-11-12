// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// A feature's note and other qualifiers. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { noteText, otherQualifiers, withNote } from "./featureNotes.ts";
import { parseSequenceFile, serialize } from "../doc/fileio.ts";
import { fromParsed, toParsed } from "../doc/convert.ts";

test("each /note value is a line of the field", () => {
  assert.equal(noteText({ note: ["Codon optimised", "From Addgene #1234"] }), "Codon optimised\nFrom Addgene #1234");
  assert.equal(noteText({ gene: ["bla"] }), "");
  assert.equal(noteText(undefined), "");
});

test("while typing, spaces and new lines stay where they are", () => {
  assert.deepEqual(withNote({}, "Codon ", false), { note: ["Codon "] });
  assert.deepEqual(withNote({}, "Codon optimised\n", false), { note: ["Codon optimised", ""] });
});

test("leaving the field trims lines and drops empty ones", () => {
  assert.deepEqual(withNote({ note: ["Codon ", ""] }, "  Codon \n\n From Addgene ", true), { note: ["Codon", "From Addgene"] });
});

test("no text removes the note and keeps other qualifiers in order", () => {
  const notes = { gene: ["bla"], note: ["old"], codon_start: [1] };
  assert.deepEqual(Object.keys(withNote(notes, "", false)), ["gene", "codon_start"]);
  assert.deepEqual(Object.keys(withNote(notes, " \n ", true)), ["gene", "codon_start"]);
  assert.deepEqual(Object.entries(withNote(notes, "new", true)), [["gene", ["bla"]], ["note", ["new"]], ["codon_start", [1]]]);
});

test("an unchanged note gives back the same notes, so no undo step is made", () => {
  const notes = { note: ["Codon optimised"] };
  assert.equal(withNote(notes, "Codon optimised", true), notes);
  const empty = { gene: ["bla"] };
  assert.equal(withNote(empty, "", false), empty);
});

test("other qualifiers leave out the note and the app's own", () => {
  assert.deepEqual(otherQualifiers({ gene: ["bla"], note: ["x"], strandivo_regions: ["…"], codon_start: [2], db_xref: ["GeneID:1", "UniProtKB:P1"], empty: [""] }), [
    { name: "gene", values: ["bla"] },
    { name: "codon_start", values: ["2"] },
    { name: "db_xref", values: ["GeneID:1", "UniProtKB:P1"] }
  ]);
});

test("a note with quotes and two lines comes back after saving as GenBank", async () => {
  const gb = (text: string) => parseSequenceFile(new TextEncoder().encode(text), "note.gb").then(p => fromParsed(p.sequences[0]));
  const doc = await gb(`LOCUS       note                      30 bp    DNA     linear   SYN 01-JAN-2026
FEATURES             Location/Qualifiers
     misc_feature    1..12
                     /label="tag"
ORIGIN
        1 atggctagca tgactggtgg acagcaaatg
//
`);
  const f = doc.data.features[0];
  const note = 'Says "stop" here\nA second line, long enough that GenBank has to wrap it onto another line of the file';
  const data = { ...doc.data, features: [{ ...f, notes: withNote(f.notes, note, true) }] };
  const again = await gb(serialize(toParsed(doc, data), "genbank"));
  assert.equal(noteText(again.data.features[0].notes), note);
});
