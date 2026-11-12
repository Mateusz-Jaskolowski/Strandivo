// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Read names in the alignment. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { nameParts, sharedPrefix } from "./readNames.ts";

test("a plate's shared date is left out, up to the separator before the well", () => {
  assert.equal(sharedPrefix(["2026-08-05_F01_AKK1FOR", "2026-08-05_D03_AKK1FOR", "2026-08-05_A02_AKK1FOR"]), "2026-08-05_");
  // The wells share a letter, but a part of a name is never cut in two.
  assert.equal(sharedPrefix(["2026-10-13_A01_MJF3PRIMER", "2026-10-13_A02_MJE4PRIMER"]), "2026-10-13_");
});

test("nothing is left out of one read, the same read twice, or names with too little in common", () => {
  assert.equal(sharedPrefix([]), "");
  assert.equal(sharedPrefix(["2026-08-05_F01_AKK1FOR"]), "");
  // A read across the origin has two rows with the same name.
  assert.equal(sharedPrefix(["2026-08-05_F01_AKK1FOR", "2026-08-05_F01_AKK1FOR"]), "");
  assert.equal(sharedPrefix(["A01_x", "A02_x"]), "");
  assert.equal(sharedPrefix(["sample", "sample2"]), "");
});

test("something is left of every name", () => {
  // "c7_bla-" would leave just "F" and "R".
  assert.equal(sharedPrefix(["c7_bla-F", "c7_bla-R"]), "");
  assert.equal(sharedPrefix(["plate_1_A01", "plate_1_B01"]), "plate_1_");
  assert.equal(sharedPrefix(["plate_1_A01", "plate_1_B01", "plate_1_"]), "");
});

test("names break after their separators", () => {
  assert.deepEqual(nameParts("2026-08-05_F01_AKK1FOR"), ["2026-", "08-", "05_", "F01_", "AKK1FOR"]);
  assert.deepEqual(nameParts("read"), ["read"]);
  // Runs of separators stay together, and one at the end has nothing after it.
  assert.deepEqual(nameParts("a__b."), ["a__", "b."]);
  assert.deepEqual(nameParts(""), []);
});
