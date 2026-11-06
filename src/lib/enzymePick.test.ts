// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Picking enzymes for a digest. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { enzymeOf, enzymesText, pickedEnzymes, prunePick, togglePick } from "./enzymePick.ts";

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

test("pruning a pick drops only enzymes that left the stock", () => {
  const sites = [
    { id: "EcoRI@10", enzyme: "EcoRI" },
    { id: "BamHI@40", enzyme: "BamHI" },
    { id: "XbaI@70", enzyme: "XbaI" }
  ];
  const pick = (focus: string, enzymes?: string[]) => ({ focus: { kind: "cutsite", id: focus }, enzymes });
  // Nothing changed: left alone.
  assert.equal(prunePick(pick("EcoRI@10", ["EcoRI", "BamHI"]), sites), undefined);
  assert.equal(prunePick({ focus: { kind: "feature", id: "f1" } }, []), undefined);
  // A picked enzyme went: the others stay picked, and so does the selected site.
  assert.deepEqual(prunePick(pick("EcoRI@10", ["EcoRI", "PstI", "BamHI"]), sites), { site: sites[0], enzymes: ["EcoRI", "BamHI"] });
  // The selected site's enzyme went: the selection moves to the last one still picked.
  assert.deepEqual(prunePick(pick("PstI@5", ["BamHI", "PstI"]), sites), { site: sites[1], enzymes: ["BamHI"] });
  // The only enzyme went: the selection is cleared.
  assert.deepEqual(prunePick(pick("PstI@5"), sites), { site: null, enzymes: [] });
});
