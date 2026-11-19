// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { libraryMatch, newEntries, parseLibraryJson, type LibraryPrimer } from "./library.ts";

test("parseLibraryJson preserves primer color and notes across storage round-trips", () => {
  const saved: LibraryPrimer[] = [
    { id: "lib-1", name: "M13-F", bases: "gtaaaacgacggccag", notes: "sequencing", color: "#2563eb" },
    { id: "lib-2", name: "T7", bases: "TAATACGACTCACTATAGGG", notes: "" },
    { id: "lib-3", name: "BadColor", bases: "ACGTACGTACGTACGT", notes: "note", color: "" }
  ];
  let seqId = 0;
  const mkId = () => `gen-${++seqId}`;
  const parsed = parseLibraryJson(JSON.stringify(saved), mkId);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].bases, "GTAAAACGACGGCCAG");
  assert.equal(parsed[0].notes, "sequencing");
  assert.equal(parsed[0].color, "#2563EB");
  assert.equal(parsed[1].color, undefined);
  assert.equal(parsed[2].color, undefined);

  // Invalid / non-array JSON returns empty safely.
  assert.deepEqual(parseLibraryJson("", mkId), []);
  assert.deepEqual(parseLibraryJson("not json", mkId), []);
  assert.deepEqual(parseLibraryJson("{}", mkId), []);
});

test("libraryMatch matches name+sequence like newEntries and surfaces same-sequence aliases", () => {
  const lib: LibraryPrimer[] = [
    { id: "lib-1", name: "M13-F", bases: "GTAAAACGACGGCCAG", notes: "univ", color: "#2563EB" }
  ];

  // Exact match (case-insensitive name & bases) -> matches newEntries deduplication.
  const exact = libraryMatch(lib, "m13-f", "gtaaaacgacggccag");
  assert.equal(exact.exact, true);
  assert.equal(exact.sameBases?.name, "M13-F");
  assert.equal(newEntries(lib, [{ name: "m13-f", bases: "gtaaaacgacggccag", notes: "" }]).length, 0);

  // Same bases under a different name -> NOT an exact match, reports sameBases hint, allowed by newEntries.
  const alias = libraryMatch(lib, "My-Seq-F", "GTAAAACGACGGCCAG");
  assert.equal(alias.exact, false);
  assert.equal(alias.sameBases?.name, "M13-F");
  assert.equal(newEntries(lib, [{ name: "My-Seq-F", bases: "GTAAAACGACGGCCAG", notes: "custom", color: "#16A34A" }]).length, 1);

  // Completely new primer -> neither exact nor sameBases.
  const fresh = libraryMatch(lib, "New-R", "CAGGAAACAGCTATGAC");
  assert.equal(fresh.exact, false);
  assert.equal(fresh.sameBases, null);
});
