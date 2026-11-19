// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { CODON_GROUPS, DEFAULT_CLAMP, enzymeSnippet, INSERT_ENZYMES, insertIntoPrimer, SHORT_TAGS } from "./primerInsert.ts";
import { reverseComplement } from "./seqdata.ts";

test("enzymeSnippet returns recognition site with optional 5′ clamp", () => {
  const eco = INSERT_ENZYMES.find(e => e.name === "EcoRI");
  assert.ok(eco, "EcoRI is in INSERT_ENZYMES");
  assert.equal(enzymeSnippet(eco.site, { clamp: false }), "GAATTC");
  assert.equal(enzymeSnippet(eco.site, { clamp: true }), `${DEFAULT_CLAMP}GAATTC`);
  assert.equal(DEFAULT_CLAMP.length, 6);
});

test("CODON_GROUPS covers all 20 amino acids plus Stop with valid triplets", () => {
  assert.equal(CODON_GROUPS.length, 21);
  for (const g of CODON_GROUPS) {
    assert.ok(g.codons.length >= 1, `${g.aa} has at least one codon`);
    for (const c of g.codons) assert.match(c, /^[ACGT]{3}$/);
  }
  const met = CODON_GROUPS.find(g => g.aa === "M");
  assert.deepEqual(met?.codons, ["ATG"]);
});

test("SHORT_TAGS contains valid uppercase DNA motifs", () => {
  assert.ok(SHORT_TAGS.length >= 8);
  for (const tag of SHORT_TAGS) {
    assert.ok(tag.name.length > 0);
    assert.match(tag.bases, /^[ACGT]+$/);
  }
});

test("insertIntoPrimer inserts at 5′ end, mid-sequence, over selection, and with revComp", () => {
  // Insert at 5′ end (caret 0).
  const at5 = insertIntoPrimer("ATGCATGC", 0, 0, "GAATTC", false);
  assert.equal(at5.bases, "GAATTCATGCATGC");
  assert.equal(at5.caret, 6);

  // Replace selected span [2, 6).
  const repl = insertIntoPrimer("AAATTTCCC", 3, 6, "GGG", false);
  assert.equal(repl.bases, "AAAGGGCCC");
  assert.equal(repl.caret, 6);

  // Reverse-complement insertion of an asymmetric site (e.g. BsaI GGTCTC -> GAGACC).
  const rc = insertIntoPrimer("ATGCATGC", 0, 0, "GGTCTC", true);
  assert.equal(rc.bases, `${reverseComplement("GGTCTC")}ATGCATGC`);
  assert.equal(rc.caret, 6);

  // Out-of-bounds or reversed caret indices clamp cleanly.
  const clamped = insertIntoPrimer("ACGT", 99, 2, "TT", false);
  assert.equal(clamped.bases, "ACTT");
  assert.equal(clamped.caret, 4);
});
