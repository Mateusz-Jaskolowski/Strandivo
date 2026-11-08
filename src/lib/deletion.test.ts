// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Delete with something clicked, and what an edit to bases takes with it. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { describeLost, firstDelete, lostWith } from "./deletion.ts";
import { REGIONS_QUALIFIER, regionsOf } from "./regions.ts";
import { deleteRange, replaceRange, type SeqData, type SeqFeature, type SeqPrimer } from "./seqdata.ts";

const feature = (id: string, name: string, start: number, end: number, notes: Record<string, unknown> = {}): SeqFeature => ({
  id,
  name,
  type: "CDS",
  start,
  end,
  strand: 1,
  notes,
  raw: {}
});
const primer = (id: string, name: string, start: number, end: number): SeqPrimer => ({ id, name, start, end, strand: 1, bases: "ACGT".repeat(5), notes: {}, raw: {} });

const data: SeqData = {
  name: "t",
  description: "",
  circular: true,
  sequence: "ACGT".repeat(50),
  features: [
    feature("cds", "lacZ", 10, 99, { [REGIONS_QUALIFIER]: ["TM1|Transmembrane|2-8|P1:2-8", "TM2|Transmembrane|12-20|P1:12-20"] }),
    feature("pro", "lac", 100, 129)
  ],
  primers: [primer("f", "F", 20, 39), primer("r", "R", 150, 169)],
  sources: []
};

test("the first Delete on a feature deletes the feature and keeps its bases selected", () => {
  const range = { start: 100, end: 129 };
  const step = firstDelete(data, { range, focus: { kind: "feature", id: "pro" } });
  assert.ok(step);
  assert.equal(step.data.sequence, data.sequence);
  assert.deepEqual(step.data.features.map(f => f.id), ["cds"]);
  assert.equal(step.data.primers, data.primers);
  assert.equal(step.label, "Delete feature");
  assert.deepEqual(step.range, range);
  assert.match(step.message, /^Deleted lac; its bases are still selected\. Press Delete again/);
});

test("the first Delete on a primer deletes the primer and keeps the bases it binds selected", () => {
  const step = firstDelete(data, { range: { start: 20, end: 39 }, focus: { kind: "primer", id: "f" } });
  assert.ok(step);
  assert.equal(step.data.sequence, data.sequence);
  assert.deepEqual(step.data.primers.map(p => p.id), ["r"]);
  assert.equal(step.data.features, data.features);
  assert.equal(step.label, "Delete primer");
  assert.match(step.message, /^Deleted F; the bases it binds are still selected/);
});

test("the first Delete on a protein region removes only that region from its CDS", () => {
  const step = firstDelete(data, { range: { start: 43, end: 69 }, focus: { kind: "feature", id: "cds", region: 1 } });
  assert.ok(step);
  const cds = step.data.features.find(f => f.id === "cds");
  assert.ok(cds);
  assert.deepEqual(regionsOf(cds).map(r => r.name), ["TM1"]);
  assert.equal(step.data.features.length, 2);
  assert.equal(step.label, "Remove region");
  assert.match(step.message, /^Removed TM2 from lacZ/);
});

test("cut sites and ORFs only become plain bases on the first Delete", () => {
  for (const kind of ["cutsite", "orf"] as const) {
    const range = { start: 4, end: 9 };
    const step = firstDelete(data, { range, focus: { kind, id: "x" } });
    assert.ok(step);
    assert.equal(step.data, data, kind);
    assert.equal(step.label, undefined);
    assert.deepEqual(step.range, range);
    assert.match(step.message, /only their bases can be deleted/);
  }
});

test("Delete deletes bases when nothing was clicked or what was clicked is gone", () => {
  assert.equal(firstDelete(data, { range: { start: 0, end: 5 }, focus: null }), null);
  assert.equal(firstDelete(data, { range: null, focus: null }), null);
  assert.equal(firstDelete(data, { range: { start: 0, end: 5 }, focus: { kind: "feature", id: "gone" } }), null);
  assert.equal(firstDelete(data, { range: { start: 0, end: 5 }, focus: { kind: "primer", id: "gone" } }), null);
  assert.equal(firstDelete(data, { range: { start: 0, end: 5 }, focus: { kind: "feature", id: "cds", region: 9 } }), null);
});

test("a nameless feature is still described", () => {
  const d = { ...data, features: [feature("x", " ", 0, 9)] };
  assert.match(firstDelete(d, { range: { start: 0, end: 9 }, focus: { kind: "feature", id: "x" } })?.message ?? "", /^Deleted the feature;/);
});

test("deleting bases reports the features and primers inside them", () => {
  // 95…135 holds all of lac (100–129) but only the end of lacZ.
  const after = deleteRange(data, { start: 95, end: 135 });
  const lost = lostWith(data, after);
  assert.ok(lost);
  assert.deepEqual(lost.features.map(f => f.name), ["lac"]);
  assert.deepEqual(lost.primers, []);
  assert.equal(describeLost(lost), "The feature lac was inside the deleted bases, so it was deleted too.");
});

test("replacing bases reports what was inside them too", () => {
  const after = replaceRange(data, { start: 18, end: 41 }, "GG").data;
  const lost = lostWith(data, after);
  assert.ok(lost);
  assert.deepEqual(lost.primers.map(p => p.name), ["F"]);
});

test("nothing is reported when nothing went, or the bases didn't change", () => {
  assert.equal(lostWith(data, deleteRange(data, { start: 0, end: 3 })), null);
  // Deleting a feature on purpose leaves the bases alone.
  assert.equal(lostWith(data, { ...data, features: [] }), null);
});

test("lost features and primers are described in a sentence that stays short", () => {
  const f = (...names: string[]) => names.map((n, i) => feature(`f${i}`, n, 0, 1));
  const p = (...names: string[]) => names.map((n, i) => primer(`p${i}`, n, 0, 1));
  assert.equal(describeLost({ features: f("lacZ", "GFP"), primers: [] }), "The features lacZ and GFP were inside the deleted bases, so they were deleted too.");
  assert.equal(describeLost({ features: f("a", "b", "c"), primers: [] }), "The features a, b and c were inside the deleted bases, so they were deleted too.");
  assert.equal(describeLost({ features: f("a", "b", "c", "d"), primers: [] }), "4 features were inside the deleted bases, so they were deleted too.");
  assert.equal(describeLost({ features: [], primers: p("M13 fwd") }), "The primer M13 fwd was inside the deleted bases, so it was deleted too.");
  assert.equal(describeLost({ features: f("lacZ"), primers: p("F") }), "The feature lacZ and the primer F were inside the deleted bases, so they were deleted too.");
  assert.equal(describeLost({ features: f("a", "b"), primers: p("F") }), "2 features and the primer F were inside the deleted bases, so they were deleted too.");
});
