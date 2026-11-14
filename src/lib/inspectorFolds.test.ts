// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Which inspector sections are folded. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { foldedIn, readFolds, withFold } from "./inspectorFolds.ts";

test("long sections start folded and the rest open", () => {
  for (const id of ["translation", "qualifiers", "inside", "region-list"] as const) assert.equal(foldedIn({}, id), true, id);
  for (const id of ["note", "regions", "sequencing", "binding", "checks", "frame-translation"] as const) assert.equal(foldedIn({}, id), false, id);
});

test("a choice overrides the default either way", () => {
  assert.equal(foldedIn(withFold({}, "translation", false), "translation"), false);
  assert.equal(foldedIn(withFold({}, "note", true), "note"), true);
  assert.equal(foldedIn(withFold({}, "note", true), "sequencing"), false);
});

test("a stored state keeps only known sections with a yes or no", () => {
  assert.deepEqual(readFolds({ translation: false, note: true, bogus: true, inside: "yes" }), { translation: false, note: true });
  assert.deepEqual(readFolds(null), {});
  assert.deepEqual(readFolds(["translation"]), {});
  assert.deepEqual(readFolds("translation"), {});
});
