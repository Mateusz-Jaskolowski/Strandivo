// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { pcrDialogFoldedIn, readPcrDialogFolds, withPcrDialogFold } from "./pcrDialogFolds.ts";

test("PCR dialog fold state defaults to open, preserves known booleans, and ignores junk", () => {
  assert.deepEqual(readPcrDialogFolds(null), {});
  assert.deepEqual(readPcrDialogFolds({ map: true, gel: false, program: "yes", unknown: true }), { map: true, gel: false });
  const empty = readPcrDialogFolds({});
  assert.equal(pcrDialogFoldedIn(empty, "map"), false);
  assert.equal(pcrDialogFoldedIn(empty, "gel"), false);
  assert.equal(pcrDialogFoldedIn(empty, "program"), false);

  const next = withPcrDialogFold(empty, "gel", true);
  assert.equal(pcrDialogFoldedIn(next, "gel"), true);
  assert.equal(pcrDialogFoldedIn(next, "map"), false);
});
