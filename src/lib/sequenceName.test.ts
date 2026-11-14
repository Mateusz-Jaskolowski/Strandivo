// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The sequence's name. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { locusName, nameFromFile, nameToKeep, tidyName } from "./sequenceName.ts";

test("a typed name is trimmed and kept on one line", () => {
  assert.equal(tidyName("  pUC19 K45A  "), "pUC19 K45A");
  assert.equal(tidyName("pUC19\n K45A\tmutant"), "pUC19 K45A mutant");
  assert.equal(tidyName("pUC19   K45A"), "pUC19 K45A");
  // Underscores are the user's own.
  assert.equal(tidyName("pLKO.1_puro"), "pLKO.1_puro");
});

test("a blank name keeps the old one", () => {
  assert.equal(tidyName(""), null);
  assert.equal(tidyName("  \n\t "), null);
});

test("only a name with spaces is kept beside the LOCUS line", () => {
  assert.equal(locusName("pUC19 mutant 3"), "pUC19_mutant_3");
  assert.equal(nameToKeep("pUC19 mutant 3"), "pUC19 mutant 3");
  assert.equal(nameToKeep("pLKO.1_puro"), null);
  assert.equal(nameToKeep("pUC19"), null);
});

test("the kept name counts only while the LOCUS line still holds it", () => {
  // Saved by Strandivo with spaces.
  assert.equal(nameFromFile("pUC19_mutant_3", "pUC19 mutant 3"), "pUC19 mutant 3");
  // Typed with underscores: nothing kept.
  assert.equal(nameFromFile("pLKO.1_puro", undefined), "pLKO.1_puro");
  // Renamed elsewhere since: the LOCUS line wins over the stale name.
  assert.equal(nameFromFile("pUC19_v2", "pUC19 mutant 3"), "pUC19_v2");
  assert.equal(nameFromFile("pUC19_mutant_3", ""), "pUC19_mutant_3");
});
