// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The sequence's name. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { tidyName } from "./sequenceName.ts";

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
