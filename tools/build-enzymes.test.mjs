// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The enzyme list's generator. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCut, render, selectEnzymes } from "./build-enzymes.mjs";

test("REBASE's notation becomes the cuts the site search takes", () => {
  assert.deepEqual(parseCut("G^AATTC"), { site: "GAATTC", top: 1, bottom: 5, bothSides: false });
  assert.deepEqual(parseCut("GGTAC^C"), { site: "GGTACC", top: 5, bottom: 1, bothSides: false });
  assert.deepEqual(parseCut("GGTCTC(1/5)"), { site: "GGTCTC", top: 7, bottom: 11, bothSides: false });
  // Inside a site that isn't a palindrome, counted back from its end.
  assert.deepEqual(parseCut("CCGC(-3/-1)"), { site: "CCGC", top: 1, bottom: 3, bothSides: false });
  // Only the cut after the site is searched for.
  assert.deepEqual(parseCut("(10/12)CGANNNNNNTGC(12/10)"), { site: "CGANNNNNNTGC", top: 24, bottom: 22, bothSides: true });
  // A palindromic core cut outside on both strands: searched with Ns in front too.
  assert.deepEqual(parseCut("CASTGNN^"), { site: "NNCASTGNN", top: 9, bottom: 0, bothSides: false });
  assert.equal(parseCut("GGTACC"), null);
  assert.throws(() => parseCut("GAAG^AC"), /isn't a palindrome/);
  assert.throws(() => parseCut("G^AAT^TC"), /more than one cut/);
  assert.throws(() => parseCut("GAATTC?"), /Can't read/);
});

const file = (...records) => `REBASE version 611                                              withrefm.611
Rich Roberts                                                    Oct 29 2026
<ENZYME NAME>   Restriction enzyme name.
REBASE codes for commercial sources of enzymes

                B        Thermo Fisher Scientific (5/23)
                N        New England Biolabs (8/24)

${records.map(([name, site, sold]) => `<1>${name}\n<2>\n<3>${site}\n<4>\n<5>\n<6>\n<7>${sold}\n<8>\n`).join("\n")}`;

test("only enzymes someone sells are kept, and those of no use on a map are named", () => {
  const r = selectEnzymes(file(["EcoRI", "G^AATTC", "BN"], ["BspJ106I", "GGTACC", ""], ["MspJI", "CNNR(9/13)", "N"], ["NoCutI", "GAAGAC", "N"]));
  assert.equal(r.version, "611");
  assert.equal(r.date, "Oct 29 2026");
  assert.deepEqual(r.suppliers, { B: "Thermo Fisher Scientific", N: "New England Biolabs" });
  assert.deepEqual(r.kept.map(e => e.name), ["EcoRI"]);
  assert.deepEqual(r.left, ["MspJI CNNR(9/13): too short a site", "NoCutI GAAGAC: its cut isn't known"]);
  assert.throws(() => selectEnzymes(file(["EcoRI", "G^AATTC", "BW"])), /"W", which the header doesn't list/);
  assert.throws(() => selectEnzymes(file(["EcoRI", "G^AATTC", "B"], ["ecoRI", "G^AATTC", "N"])), /listed twice/);
  assert.match(render(r), /^EcoRI\tG\^AATTC\tGAATTC\t1\t5\t0\tBN$/m);
});

test("a supplier's name can't break out of its string in the generated file", () => {
  // A backslash before the quote would swallow the escape added for it, and one at the end
  // would swallow the closing quote.
  const name = 'Evil\\"; globalThis.pwned = 1; // \\';
  const r = selectEnzymes(file(["EcoRI", "G^AATTC", "B"]).replace("Thermo Fisher Scientific", name));
  assert.equal(r.suppliers.B, name);
  const written = /^ {2}B: (.*?),?$/m.exec(render(r))[1];
  assert.equal(JSON.parse(written), name);
});

test("the committed list cites REBASE, as its terms ask", () => {
  const list = readFileSync(new URL("../src/lib/rebaseEnzymes.ts", import.meta.url), "utf8");
  assert.match(list, /REBASE, The Restriction Enzyme Database, http:\/\/rebase\.neb\.com, is an open database/);
  assert.match(list, /Roberts, R\.J\., Vincze, T\.,\n\/\/ Posfai, J\., Macelis, D\. \(2023\)/);
});
