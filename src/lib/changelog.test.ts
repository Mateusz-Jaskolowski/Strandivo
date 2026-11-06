// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { changesUrl, looksLikeAddress, notesFor, parseChangelog, shortNotes } from "./changelog.ts";

const sample = `# What's new

Intro, which isn't a release.

## 0.3.0

Faster maps
and new primer tools.

- Details, for the website.
- More.

## 0.2.0
Only a summary.
`;

test("each version's first paragraph is its short notes, the rest its details", () => {
  const notes = parseChangelog(sample);
  assert.deepEqual(notes.map(n => n.version), ["0.3.0", "0.2.0"]);
  assert.equal(notes[0].summary, "Faster maps and new primer tools.");
  assert.equal(notes[0].details, "- Details, for the website.\n- More.");
  assert.deepEqual(notesFor(sample, "0.2.0"), { version: "0.2.0", summary: "Only a summary.", details: "" });
  assert.equal(notesFor(sample, "9.9.9"), null);
});

test("notes from the server are cut to a few plain lines", () => {
  assert.deepEqual(shortNotes(null), []);
  // What the release script wrote before the changelog: only a link, so nothing to show.
  assert.deepEqual(shortNotes("What's new: https://github.com/o/r/releases/tag/v0.2.0"), []);
  // Notes that name an address aren't shown at all: the dialog then offers strandivo.com.
  for (const bad of ["Download it from strandivo-update.com.", "See www.example.org", "Write to help@example.com.", "Faster.\nftp://x/y", "Visit EXAMPLE.CO.UK now"]) {
    assert.deepEqual(shortNotes(bad), [], bad);
  }
  assert.deepEqual(shortNotes("Faster maps.\n\nNew primer tools."), ["Faster maps.", "New primer tools."]);
  assert.equal(shortNotes("x".repeat(1000))[0].length, 400);
  assert.equal(shortNotes(Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n")).length, 6);
});

test("the website's address is built from the version alone", () => {
  assert.equal(changesUrl("0.3.0"), "https://strandivo.com/changes#v0.3.0");
});

test("CHANGELOG.md's short notes are plain and short, as the app shows them", () => {
  const text = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
  const notes = parseChangelog(text);
  assert.ok(notes.length > 0);
  for (const n of notes) {
    assert.ok(n.summary.length > 0 && n.summary.length <= 400, `${n.version}: ${n.summary.length} characters`);
    assert.doesNotMatch(n.summary, /\]\(|`|\*\*/, `${n.version}'s short notes have formatting`);
    // The app wouldn't show them: an address in the notes means they go to the website only.
    assert.equal(looksLikeAddress(n.summary), false, `${n.version}'s short notes name an address (or something like pUC19.gb)`);
  }
});
