// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The construct library's summaries, folders and search. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { describeContents, matchesSearch, subfolder, type ConstructInfo } from "./constructs.ts";

test("contents list the insert, then markers, origins and promoters", () => {
  const features = [
    { name: "pBR322 ori", type: "rep_origin" },
    { name: "KanR", type: "CDS" },
    { name: "T7 promoter", type: "promoter" },
    { name: "6xHis", type: "misc_feature" },
    { name: "EGFP", type: "CDS" },
    { name: "source", type: "source" },
    { name: "New feature", type: "misc_feature" }
  ];
  assert.equal(describeContents(features), "EGFP · KanR · pBR322 ori · T7 promoter");
});

test("contents name each part once and say how many more there are", () => {
  const features = ["lacZα", "lacI", "MBP", "TEV site", "araC", "Cas9"].map(name => ({ name, type: "CDS" }));
  assert.equal(describeContents([...features, { name: "lacI", type: "gene" }], 4), "lacZα · lacI · MBP · TEV site · 2 more");
  assert.equal(describeContents([]), "");
});

test("files are grouped by their subfolder of a library folder", () => {
  assert.equal(subfolder("/lab/plasmids/pET/pET-28a.gb", "/lab/plasmids"), "pET");
  assert.equal(subfolder("/lab/plasmids/pUC19.gb", "/lab/plasmids/"), "");
  assert.equal(subfolder("C:\\Lab\\Plasmids\\Yeast\\CEN\\pRS416.dna", "C:\\Lab\\Plasmids"), "Yeast/CEN");
  assert.equal(subfolder("/elsewhere/x.gb", "/lab/plasmids"), "");
});

test("search matches every word in the file name, contents, note and lab fields", () => {
  const info: ConstructInfo = {
    path: "/lab/pET28-GFP.gb",
    size: 1,
    modified: 1,
    name: "pET28-GFP",
    length: 5900,
    circular: true,
    features: 6,
    contents: "EGFP · T7 promoter · KanR",
    description: "",
    fields: { "Stored at": "Box 3, A4" }
  };
  assert.ok(matchesSearch(info, "", ""));
  assert.ok(matchesSearch(info, "", "gfp kanr"));
  assert.ok(matchesSearch(info, "made by Ana", "ana box"));
  assert.ok(!matchesSearch(info, "", "gfp ampr"));
});
