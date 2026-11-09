// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What the right-click menus offer. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { digestEnzymes, menuFor, readsMenu, type MenuContext, type MenuEntry, type MenuTarget, type ReadsTarget } from "./contextMenu.ts";
import type { SeqData } from "./seqdata.ts";

const data: SeqData = {
  name: "t",
  description: "",
  circular: true,
  sequence: "ACGT".repeat(50),
  features: [
    { id: "cds", name: "lacZ", type: "CDS", start: 10, end: 99, strand: 1, notes: {}, raw: {} },
    { id: "pro", name: "lac", type: "promoter", start: 100, end: 129, strand: 1, notes: {}, raw: {} }
  ],
  primers: [
    { id: "plain", name: "F", start: 0, end: 19, strand: 1, bases: "ACGT".repeat(5), notes: {}, raw: {} },
    { id: "tailed", name: "R", start: 40, end: 59, strand: -1, bases: "GAATTC" + "ACGT".repeat(5), notes: {}, raw: {} }
  ],
  sources: []
};
const context = (over: Partial<MenuContext> = {}): MenuContext => ({ data, onMap: false, inLibrary: () => false, ...over });
const labels = (target: MenuTarget, over?: Partial<MenuContext>) => menuFor(target, context(over)).map((e: MenuEntry) => (e === "separator" ? "—" : e.label));
const submenu = (target: MenuTarget, label: string) => {
  const e = menuFor(target, context()).find(x => x !== "separator" && x.label === label);
  return e && e !== "separator" && "items" in e ? e.items : [];
};

test("selected bases: primers for primer-sized stretches, design for longer ones", () => {
  assert.deepEqual(labels({ kind: "selection", range: { start: 0, end: 19 } }), [
    "Copy",
    "Copy reverse complement",
    "—",
    "Add forward primer",
    "Add reverse primer",
    "Mutagenesis primers…",
    "Add feature",
    "—",
    "Reverse-complement selection",
    "—",
    "Delete bases"
  ]);
  const long = labels({ kind: "selection", range: { start: 0, end: 99 } });
  assert.ok(long.includes("Design primers to amplify…") && !long.includes("Add forward primer"));
  const short = labels({ kind: "selection", range: { start: 0, end: 4 } });
  assert.ok(!short.includes("Add forward primer") && !short.includes("Design primers to amplify…"));
  // Across the origin: no reverse-complementing.
  assert.ok(!labels({ kind: "selection", range: { start: 190, end: 9 } }).includes("Reverse-complement selection"));
});

test("cut sites and ORFs", () => {
  assert.deepEqual(labels({ kind: "cutsite", id: "EcoRI@395" }), ["Copy recognition site", "Digest with EcoRI…", "Show on map"]);
  // With enzymes picked, a site of one of them digests with them all; any other only with its own.
  assert.equal(labels({ kind: "cutsite", id: "EcoRI@395" }, { enzymes: ["EcoRI", "BamHI"] })[1], "Digest with EcoRI and BamHI…");
  assert.equal(labels({ kind: "cutsite", id: "XbaI@423" }, { enzymes: ["EcoRI", "BamHI"] })[1], "Digest with XbaI…");
  assert.deepEqual(digestEnzymes("BamHI@417", ["EcoRI", "BamHI"]), ["EcoRI", "BamHI"]);
  assert.deepEqual(digestEnzymes("XbaI@423", ["EcoRI", "BamHI"]), ["XbaI"]);
  assert.deepEqual(labels({ kind: "orf", id: "1:10" }, { onMap: true }), ["Copy DNA", "Copy protein", "—", "Add as feature", "Show in sequence"]);
});

test("features: protein only for coding ones, and the other view", () => {
  assert.ok(labels({ kind: "feature", id: "cds" }).includes("Copy protein"));
  assert.ok(!labels({ kind: "feature", id: "pro" }).includes("Copy protein"));
  assert.ok(labels({ kind: "feature", id: "cds" }).includes("Mutagenesis primers…"));
  assert.ok(!labels({ kind: "feature", id: "pro" }).includes("Mutagenesis primers…"));
  assert.ok(labels({ kind: "feature", id: "pro" }).includes("Show on map"));
  assert.ok(labels({ kind: "feature", id: "pro" }, { onMap: true }).includes("Show in sequence"));
  assert.equal(labels({ kind: "feature", id: "pro" }).at(-1), "Delete feature");
  // Colour: swatches, then the system picker and the type's own colour (once one is set).
  const colours = submenu({ kind: "feature", id: "pro" }, "Colour");
  assert.deepEqual(colours[0], { action: "set-colour", label: "Red", color: "#D9534F" });
  assert.deepEqual(colours.slice(-2), [{ action: "pick-colour", label: "Other colour…" }, { action: "default-colour", label: "Default colour", enabled: false }]);
  assert.deepEqual(labels({ kind: "feature", id: "gone" }), []);
});

test("protein regions have their own edit and removal actions", () => {
  const withRegion = { ...data, features: data.features.map(f => f.id === "cds" ? { ...f, notes: { strandivo_regions: ["CDR1|CDR|2-5|:2-5"] } } : f) };
  const entries = labels({ kind: "feature", id: "cds", region: 0 }, { data: withRegion });
  assert.ok(entries.includes("Edit region…") && entries.includes("Remove region"));
  assert.ok(!entries.includes("Delete feature"));
  assert.ok(labels({ kind: "selection", range: { start: 13, end: 24 } }).includes("Add as region…"));
  assert.ok(!labels({ kind: "selection", range: { start: 95, end: 105 } }).includes("Add as region…"));
});

test("primers: the other places they show, and a PCR product", () => {
  const inPrimers = labels({ kind: "primer", id: "plain" }, { tab: "primers" });
  assert.ok(inPrimers.includes("Show on map") && inPrimers.includes("Show in sequence") && !inPrimers.includes("Show in Primers tab"));
  const onMap = labels({ kind: "primer", id: "plain" }, { onMap: true, tab: "map" });
  assert.ok(!onMap.includes("Show on map") && onMap.includes("Show in sequence") && onMap.includes("Show in Primers tab"));
  // Without a tab, the sequence is assumed unless on the map.
  assert.ok(!labels({ kind: "primer", id: "plain" }).includes("Show in sequence"));
  assert.ok(labels({ kind: "primer", id: "plain" }).includes("PCR product…"));
});

test("primers: flipping only without a tail, and whether it is in the library", () => {
  assert.ok(labels({ kind: "primer", id: "plain" }).includes("Make it a reverse primer"));
  assert.ok(!labels({ kind: "primer", id: "tailed" }).some(l => l.startsWith("Make it")));
  const saved = menuFor({ kind: "primer", id: "plain" }, context({ inLibrary: () => true })).find(e => e !== "separator" && "action" in e && e.action === "save-to-library");
  assert.deepEqual(saved, { action: "save-to-library", label: "In the lab library", enabled: false });
  assert.equal(labels({ kind: "primer", id: "plain" }).at(-1), "Delete primer");
  // Colours without red, which marks a primer's changes, and no free picker.
  const colours = submenu({ kind: "primer", id: "plain" }, "Colour");
  assert.ok(!colours.some(c => c !== "separator" && c.label === "Red"));
  assert.deepEqual(colours.at(-1), { action: "default-colour", label: "Default colour", enabled: false });
  assert.ok(!colours.some(c => c !== "separator" && "action" in c && c.action === "pick-colour"));
});

test("the cursor: set origin only inside a circular sequence", () => {
  assert.deepEqual(labels({ kind: "cursor", at: 50 }), ["Select all", "—", "Set origin here", "Reverse-complement sequence"]);
  assert.ok(!labels({ kind: "cursor", at: 0 }).includes("Set origin here"));
  assert.ok(!labels({ kind: "cursor", at: 50 }, { data: { ...data, circular: false } }).includes("Set origin here"));
});

const readsLabels = (target: ReadsTarget) => readsMenu(target).map(e => (e === "separator" ? "—" : e.label));

test("a read on its own: no way out of a clone, and clones to move to only if there are any", () => {
  assert.deepEqual(readsLabels({ kind: "read", inClone: false, clones: [] }), ["Copy sequence", "—", "Remove read"]);
  assert.deepEqual(readsLabels({ kind: "read", inClone: false, clones: [{ key: "a", label: "A01" }] }), ["Copy sequence", "—", "Move to clone", "—", "Remove read"]);
});

test("a read in a clone can be taken out of it", () => {
  assert.deepEqual(readsLabels({ kind: "read", inClone: true, clones: [] }), ["Copy sequence", "—", "Take out of clone", "—", "Remove read"]);
});

test("Move to clone lists the clones", () => {
  const e = readsMenu({ kind: "read", inClone: false, clones: [{ key: "a", label: "A01" }, { key: "b", label: "A02" }] }).find(x => x !== "separator" && x.label === "Move to clone");
  assert.ok(e && e !== "separator" && "items" in e);
  assert.deepEqual(e.items, [
    { action: "move-read", label: "A01", clone: "a" },
    { action: "move-read", label: "A02", clone: "b" }
  ]);
});

test("a clone: what needs a consensus waits for one", () => {
  assert.deepEqual(readsLabels({ kind: "clone", aligned: true }), ["Copy consensus", "Open clone as file", "—", "Split into single reads", "—", "Remove clone"]);
  const items = readsMenu({ kind: "clone", aligned: false }).filter(e => e !== "separator");
  assert.deepEqual(items.filter(e => "enabled" in e && e.enabled === false).map(e => e.label), ["Copy consensus", "Open clone as file"]);
});

test("several reads: group them or remove them, and the count is shown", () => {
  assert.deepEqual(readsLabels({ kind: "many", reads: 5 }), ["Group into one clone", "—", "Remove 5 reads"]);
});
