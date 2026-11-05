// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The parts catalog is generated into crates/seqcore/data/parts.tsv and searched by the
// Rust core, but what the user ends up seeing goes through this folder: `detectFromFeatures`
// fills Home's contents column and the Info tab's markers, and it matches on a feature's
// name. So a catalog entry named "TetR" would be read as tetracycline resistance even if
// it were a repressor, and a marker named anything unexpected would show up nowhere.
// These tests tie the catalog's names to that code. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { detectFromFeatures } from "./labinfo.ts";
import { describeContents } from "./constructs.ts";
import type { Feature } from "./types.ts";

const CATALOG = new URL("../../crates/seqcore/data/parts.tsv", import.meta.url);

interface Entry {
  id: string;
  name: string;
  type: string;
  molecule: string;
  sequence: string;
}

const entries: Entry[] = readFileSync(CATALOG, "utf8")
  .split("\n")
  .filter(l => l && !l.startsWith("#"))
  .slice(1)
  .map(l => {
    const [id, name, type, molecule, sequence] = l.split("\t");
    return { id, name, type, molecule, sequence };
  });

const asFeature = (e: Entry): Feature => ({ name: e.name, type: e.type, start: 0, end: e.sequence.length - 1 });
const byName = (name: string) => {
  const hit = entries.find(e => e.name === name);
  assert.ok(hit, `the catalog has no entry named ${name}`);
  return hit;
};

/** What the user must see on Home and in Info for each marker the catalog carries. */
const MARKERS: [string, string][] = [
  ["AmpR", "Ampicillin"],
  ["TetA", "Tetracycline"],
  ["KanR", "Kanamycin"],
  ["NeoR", "Neomycin/G418"],
  ["CmR", "Chloramphenicol"],
  ["SpecR", "Spectinomycin/Streptomycin"],
  ["BleoR", "Zeocin/Bleomycin"],
  ["GentR", "Gentamicin"],
  ["ErmR", "Erythromycin"]
];

test("the catalog is there and has entries", () => {
  assert.ok(entries.length >= 30, `only ${entries.length} entries read from the catalog`);
  for (const e of entries) assert.ok(e.id && e.name && e.type && e.molecule && e.sequence, `incomplete row: ${JSON.stringify(e)}`);
});

test("each resistance marker is recognised, and names the drug it should", () => {
  for (const [name, drug] of MARKERS) {
    const found = detectFromFeatures([asFeature(byName(name))]);
    assert.deepEqual(found.resistance, [drug], `${name} should be read as ${drug}`);
  }
});

test("nothing else is mistaken for a resistance marker", () => {
  const markerNames = MARKERS.map(([n]) => n);
  for (const e of entries) {
    if (markerNames.includes(e.name)) continue;
    const found = detectFromFeatures([asFeature(e)]);
    assert.deepEqual(found.resistance, [], `${e.id} (${e.name}) is being read as resistance to ${found.resistance.join(", ")}`);
  }
});

test("origins and promoters land in their own groups", () => {
  // Every origin's name has to be one the ORIGIN pattern in labinfo.ts recognises, or it
  // would be listed as an ordinary feature instead of the plasmid's backbone.
  for (const name of ["ori", "p15A ori", "f1 ori"]) {
    const found = detectFromFeatures([asFeature(byName(name))]);
    assert.deepEqual(found.origins, [name], `${name} should be grouped as an origin`);
  }

  for (const name of ["T7 promoter", "T3 promoter", "SP6 promoter"]) {
    const found = detectFromFeatures([asFeature(byName(name))]);
    assert.deepEqual(found.promoters, [name.replace(/\s*promoter$/, "")], `${name} should be grouped as a promoter`);
  }
});

test("no entry is named something Home would hide as generic", () => {
  // describeContents drops names like "feature", "CDS" or "source" as saying nothing.
  for (const e of entries) {
    if (e.type !== "CDS" && e.type !== "gene") continue;
    const contents = describeContents([{ name: e.name, type: e.type }]);
    assert.notEqual(contents, "", `${e.id} is named ${e.name}, which Home treats as generic and leaves out`);
  }
});

test("tags stay out of Home's contents, so they can't crowd out the insert", () => {
  // describeContents lists coding sequences first, as they are usually the insert. A tag
  // typed as CDS would take one of the five places; as a misc_feature it doesn't.
  const tags = entries.filter(e => ["his6", "flag", "ha", "myc", "v5", "strep2"].includes(e.id));
  assert.ok(tags.length >= 5, "expected the common tags in the catalog");
  for (const t of tags) {
    assert.equal(t.type, "misc_feature", `${t.id} should be a misc_feature, not ${t.type}`);
    assert.equal(describeContents([{ name: t.name, type: t.type }]), "", `${t.id} should not appear in Home's contents`);
  }
});

test("a plasmid's markers, origin and promoter read as a sentence on Home", () => {
  const picked = ["AmpR", "lacZ", "p15A ori", "T7 promoter"].map(n => {
    const e = byName(n);
    return { name: e.name, type: e.type };
  });
  // Coding sequences first, then markers, origins and promoters, each under its own name
  // (detectFromFeatures trims "promoter" for the Info tab; Home keeps the whole name).
  assert.equal(describeContents(picked), "lacZ · AmpR · p15A ori · T7 promoter");
});
