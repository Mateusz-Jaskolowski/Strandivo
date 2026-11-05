// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The review step of feature detection: grouping, how a row reads, and what accepting
// turns into. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  describeMatch,
  describeSource,
  describeWhere,
  existingFrom,
  featuresFrom,
  groupSuggestions,
  isConfident,
  looksUnannotated,
  plural,
  suggestionKey,
  uniqueName,
  type Suggestion
} from "./detect.ts";

const suggestion = (over: Partial<Suggestion> = {}): Suggestion => ({
  partId: "ampr",
  name: "AmpR",
  kind: "CDS",
  start: 1625,
  end: 2485,
  strand: -1,
  identity: 100,
  coverage: 100,
  fragment: false,
  source: "ncbi",
  accession: "J01749.1:3293-4153(-)",
  reference: "PMID 355891",
  note: "TEM-1 beta-lactamase",
  ...over
});

test("only whole parts are ticked to begin with", () => {
  assert.equal(isConfident(suggestion()), true);
  assert.equal(isConfident(suggestion({ fragment: true, coverage: 11 })), false);
});

test("a part found twice gets a key of its own each time", () => {
  const a = suggestion({ partId: "loxp", start: 100, end: 133 });
  const b = suggestion({ partId: "loxp", start: 900, end: 933 });
  assert.notEqual(suggestionKey(a), suggestionKey(b));
  // Strand is part of it too: the same bases read the other way are a different call.
  assert.notEqual(suggestionKey(a), suggestionKey({ ...a, strand: 1 }));
});

test("groups come in a fixed order, and empty ones are left out", () => {
  const groups = groupSuggestions([
    suggestion({ partId: "his6", name: "6xHis", kind: "misc_feature", start: 10, end: 27 }),
    suggestion({ partId: "ori", name: "ori", kind: "rep_origin", start: 800, end: 1388 }),
    suggestion(),
    suggestion({ partId: "t7-promoter", name: "T7 promoter", kind: "promoter", start: 5, end: 22 })
  ]);
  assert.deepEqual(
    groups.map(g => g.title),
    ["Genes and markers", "Origins", "Promoters and terminators", "Tags and other parts"]
  );
});

test("within a group, suggestions follow the sequence", () => {
  const groups = groupSuggestions([
    suggestion({ partId: "b", name: "KanR", start: 2000, end: 2815 }),
    suggestion({ partId: "a", name: "AmpR", start: 100, end: 960 })
  ]);
  assert.deepEqual(groups[0].items.map(s => s.name), ["AmpR", "KanR"]);
});

test("an unexpected type still shows up, under Other", () => {
  const groups = groupSuggestions([suggestion({ kind: "telomere", name: "odd" })]);
  assert.deepEqual(groups.map(g => g.title), ["Other"]);
});

test("where a part is, with its direction, 1-based for the user", () => {
  assert.equal(describeWhere(suggestion()), "← 1,626–2,486");
  assert.equal(describeWhere(suggestion({ strand: 1 })), "1,626–2,486 →");
  // An origin is drawn without a direction, so it isn't claimed one.
  assert.equal(describeWhere(suggestion({ kind: "rep_origin", strand: -1, start: 0, end: 588 })), "1–589");
});

test("how good the match is, in as few words as say it", () => {
  assert.equal(describeMatch(suggestion()), "exact match");
  assert.equal(describeMatch(suggestion({ identity: 98.2 })), "98.2% identity");
  assert.equal(describeMatch(suggestion({ fragment: true, coverage: 10.6, identity: 99.1 })), "partial · 11% of the part · 99.1% identity");
});

test("each row says where its sequence came from", () => {
  assert.equal(describeSource(suggestion()), "NCBI J01749.1:3293-4153(-)");
  assert.equal(describeSource(suggestion({ source: "amrfinder", accession: "NG_056047.1:101-916" })), "AMRFinderPlus NG_056047.1:101-916");
  assert.equal(describeSource(suggestion({ source: "defined", accession: "J01749.1:2534-3122" })), "J01749.1:2534-3122 · defined extent");
  assert.equal(describeSource(suggestion({ source: "literal", accession: "-", reference: "PMID 6292866" })), "PMID 6292866");
  assert.equal(describeSource(suggestion({ source: "uniprot", accession: "Q99ZW2" })), "UniProtKB Q99ZW2");
  assert.equal(describeSource(suggestion({ source: "fpbase", accession: "fpbase:egfp" })), "FPbase egfp");
});

test("a protein match says so, instead of claiming the DNA matched", () => {
  // A codon-optimized EGFP is an exact protein match whose DNA is nothing like the entry.
  const egfp = suggestion({ name: "EGFP", molecule: "protein", identity: 100, coverage: 100 });
  assert.equal(describeMatch(egfp), "exact protein match");
  assert.equal(describeMatch({ ...egfp, identity: 99.6 }), "99.6% protein identity");
  assert.equal(describeMatch({ ...egfp, fragment: true, coverage: 40, identity: 98 }), "partial · 40% of the part · 98.0% protein identity");
  // A DNA entry is unchanged.
  assert.equal(describeMatch(suggestion()), "exact match");
});

test("accepting turns suggestions into features, keeping names apart", () => {
  const features = featuresFrom([suggestion(), suggestion({ partId: "ampr2", start: 50, end: 910 })], ["AmpR"]);
  assert.deepEqual(features.map(f => f.name), ["AmpR 2", "AmpR 3"]);
  assert.deepEqual(features.map(f => f.type), ["CDS", "CDS"]);
  assert.deepEqual(features.map(f => [f.start, f.end, f.strand]), [[1625, 2485, -1], [50, 910, -1]]);
  assert.ok(features[0].id && features[1].id !== features[0].id);
});

test("an origin is added without a direction, as a map draws it", () => {
  const [origin] = featuresFrom([suggestion({ kind: "rep_origin", strand: -1 })], []);
  assert.equal(origin.strand, 0);
  const [site] = featuresFrom([suggestion({ kind: "protein_bind", strand: -1 })], []);
  assert.equal(site.strand, 0);
  // A tag or a loxP does have an orientation that matters.
  const [tag] = featuresFrom([suggestion({ kind: "misc_feature", strand: -1 })], []);
  assert.equal(tag.strand, -1);
});

test("a part that wraps the origin keeps its wrapping range", () => {
  const [f] = featuresFrom([suggestion({ start: 2600, end: 40 })], []);
  assert.equal(f.start, 2600);
  assert.equal(f.end, 40);
});

test("what the document sends about the features it already has", () => {
  assert.deepEqual(
    existingFrom([{ type: "CDS", start: 10, end: 99, strand: -1 }]),
    [{ kind: "CDS", start: 10, end: 99, strand: -1 }]
  );
});

test("a file is only called unannotated when it really is thin", () => {
  // pUC19 with its three features: about one per 900 bp, so nothing to offer.
  assert.equal(looksUnannotated(3, 2686), false);
  // A plain FASTA.
  assert.equal(looksUnannotated(0, 2686), true);
  // A 10 kb plasmid with one feature is thin; with six it isn't.
  assert.equal(looksUnannotated(1, 10000), true);
  assert.equal(looksUnannotated(6, 10000), false);
  // A short fragment isn't worth asking about either way.
  assert.equal(looksUnannotated(0, 200), false);
});

test("counting reads plainly", () => {
  assert.equal(plural(1, "feature"), "1 feature");
  assert.equal(plural(3, "feature"), "3 features");
  assert.equal(uniqueName("ori", ["ori", "ori 2"]), "ori 3");
});
