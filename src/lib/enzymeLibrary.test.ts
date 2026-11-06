// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatEnzymeLibrary, newEnzymeStocks, parseEnzymeLibrary, type LabEnzyme } from "./enzymeLibrary.ts";
import { findCutSites } from "./enzymes.ts";

const stock: LabEnzyme = { id: "enzyme-1", enzyme: "EcoRI", product: "NEB EcoRI-HF", location: "−20 °C, box A", notes: "New tube\nKeep in rack 2" };

test("stock exports preserve products, locations and notes when imported", () => {
  assert.deepEqual(parseEnzymeLibrary(formatEnzymeLibrary([stock])), [stock]);
  assert.deepEqual(parseEnzymeLibrary(formatEnzymeLibrary([])), []);
});

test("import canonicalises enzyme names without guessing from product names", () => {
  const entry = { ...stock, enzyme: " ecori ", product: " Thermo FastDigest EcoRI " };
  assert.deepEqual(parseEnzymeLibrary(formatEnzymeLibrary([entry])), [{ ...entry, enzyme: "EcoRI", product: "Thermo FastDigest EcoRI" }]);
  assert.throws(() => parseEnzymeLibrary(formatEnzymeLibrary([{ ...stock, enzyme: "EcoRI-HF" }])), /isn't in Strandivo/);
});

test("invalid files fail as a whole, including future versions, missing fields and repeated IDs", () => {
  assert.throws(() => parseEnzymeLibrary("{broken"));
  assert.throws(() => parseEnzymeLibrary('{"version":2,"entries":[]}'), /supported/);
  assert.throws(() => parseEnzymeLibrary('{"version":1,"entries":{}}'), /supported/);
  assert.throws(() => parseEnzymeLibrary('{"version":1,"entries":[null]}'), /invalid fields/);
  assert.throws(() => parseEnzymeLibrary(formatEnzymeLibrary([stock, { ...stock, id: "other", enzyme: "Unknown" }])));
  assert.throws(() => parseEnzymeLibrary(formatEnzymeLibrary([stock, stock])), /repeated ID/);
  assert.throws(() => parseEnzymeLibrary(formatEnzymeLibrary([{ ...stock, id: "" }])), /missing/);
  assert.throws(() => parseEnzymeLibrary(JSON.stringify({ version: 1, entries: [{ ...stock, notes: 3 }] })), /invalid fields/);
});

test("merging imports keeps different products, freezer locations and notes", () => {
  const product = { ...stock, product: "Other supplier EcoRI" };
  const location = { ...stock, location: "Freezer 3" };
  const notes = { ...stock, notes: "Spare tube" };
  const fresh = newEnzymeStocks([stock], [stock, product, product, location, notes]);
  assert.equal(fresh.length, 3);
  assert.deepEqual(fresh.map(e => [e.product, e.location, e.notes]), [product, location, notes].map(e => [e.product, e.location, e.notes]));
  assert.ok(fresh.every(e => !("id" in e)), "import assigns new IDs rather than colliding with existing stock");
});

test("lab enzymes show every cut, once per enzyme even with several stock records", () => {
  const sequence = "TTTGAATTCTTTGAATTCTTTGAATTCTTTAAGCTTTTT";
  const lab = findCutSites(sequence, false, "lab", ["EcoRI", "EcoRI"]);
  assert.equal(lab.length, 3);
  assert.ok(lab.every(c => c.enzyme === "EcoRI" && c.cuts === 3));
  assert.equal(new Set(lab.map(c => c.id)).size, 3);
  assert.deepEqual(findCutSites(sequence, false, "lab"), []);
  const unique = findCutSites(sequence, false, "unique6", ["EcoRI"]);
  assert.ok(unique.some(c => c.enzyme === "HindIII"));
  assert.ok(!unique.some(c => c.enzyme === "EcoRI"), "existing cutter filters stay independent of lab stock");
});

test("lab filtering retains both strands and sites crossing a circular origin", () => {
  // EcoRI's GAATTC wraps across the origin; reverse BsaI recognises GAGACC.
  const sequence = "AATTCTTTGAGACCTTTG";
  const sites = findCutSites(sequence, true, "lab", ["EcoRI", "BsaI"]);
  assert.ok(sites.some(c => c.enzyme === "EcoRI" && c.start > c.end));
  assert.ok(sites.some(c => c.enzyme === "BsaI" && !c.forward));
});
