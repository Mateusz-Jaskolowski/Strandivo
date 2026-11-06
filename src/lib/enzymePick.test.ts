// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Picking enzymes for a digest. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { enzymeOf, enzymesText, pickedEnzymes, togglePick } from "./enzymePick.ts";

test("a site's enzyme comes from its id", () => {
  assert.equal(enzymeOf("EcoRI@395"), "EcoRI");
  assert.equal(enzymeOf("BsmBI"), "BsmBI");
});

test("the picked enzymes, else the selected site's own", () => {
  assert.deepEqual(pickedEnzymes({ focus: null }), []);
  assert.deepEqual(pickedEnzymes({ focus: { kind: "feature", id: "x" } }), []);
  assert.deepEqual(pickedEnzymes({ focus: { kind: "cutsite", id: "BglI@244" } }), ["BglI"]);
  assert.deepEqual(pickedEnzymes({ focus: { kind: "cutsite", id: "BglI@244" }, enzymes: ["EcoRI", "BglI"] }), ["EcoRI", "BglI"]);
});

test("⌘/Ctrl-click adds an enzyme or takes it out", () => {
  assert.deepEqual(togglePick(["EcoRI"], "BamHI"), ["EcoRI", "BamHI"]);
  assert.deepEqual(togglePick(["EcoRI", "BamHI"], "EcoRI"), ["BamHI"]);
  assert.deepEqual(togglePick([], "EcoRI"), ["EcoRI"]);
});

test("enzymes are named in a list up to three", () => {
  assert.equal(enzymesText(["EcoRI"]), "EcoRI");
  assert.equal(enzymesText(["EcoRI", "BamHI"]), "EcoRI and BamHI");
  assert.equal(enzymesText(["EcoRI", "BamHI", "XbaI"]), "EcoRI, BamHI and XbaI");
  assert.equal(enzymesText(["EcoRI", "BamHI", "XbaI", "PstI"]), "4 enzymes");
});
