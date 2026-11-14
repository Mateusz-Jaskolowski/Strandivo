// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// A protein's mass and ε280, against ExPASy ProtParam's answers. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { absorbance, extinctionNote, kilodaltons, proteinProperties, residueLines } from "./proteinProperties.ts";

const EGFP =
  "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITLGMDELYK";

/** AmpR of pUC19 (`testdata/e2e/pUC19-annotated.gb`), as translated, with its stop. */
const AMPR =
  "MSIQHFRVALIPFFAAFCLPVFAHPETLVKVKDAEDQLGARVGYIELDLNSGKILESFRPEERFPMMSTFKVLLCGAVLSRIDAGQEQLGRRIHYSQNDLVEYSPVTEKHLTDGMTVRELCSAAITMSDNTAANLLLTTIGGPKELTAFLHNMGDHVTRLDRWEPELNEAIPNDERDTTMPVAMATTLRKLLTGELLTLASRQQLIDWMEADKVAGPLLRSALPAGWFIADKSGAGERGSRGIIAALGPDGKPSRIVVIYTTGSQATMDERNRQIAEIGASLIKHW*";

test("EGFP matches ProtParam", () => {
  // ProtParam: 239 aa, 26941.48 Da, 21890 reduced (Abs 0.1% 0.813), 22015 as cystines (0.817).
  const p = proteinProperties(`${EGFP}*`);
  assert.equal(p.residues, 239);
  assert.equal(p.mass!.toFixed(2), "26941.48");
  assert.deepEqual([p.trp, p.tyr, p.cys], [1, 11, 2]);
  assert.equal(p.reduced, 21890);
  assert.equal(p.cystines, 22015);
  assert.equal(absorbance(p.reduced!, p.mass!).toFixed(3), "0.813");
  assert.equal(absorbance(p.cystines!, p.mass!).toFixed(3), "0.817");
  assert.equal(p.earlyStop, null);
  assert.equal(extinctionNote(p), null);
});

test("pUC19's AmpR matches ProtParam", () => {
  // ProtParam: 286 aa, 31557.28 Da, 27960 reduced (0.886), 28085 as cystines (0.890).
  const p = proteinProperties(AMPR);
  assert.equal(p.residues, 286);
  assert.equal(p.mass!.toFixed(2), "31557.28");
  assert.equal(p.reduced, 27960);
  assert.equal(p.cystines, 28085);
  assert.equal(absorbance(p.reduced!, p.mass!).toFixed(3), "0.886");
  assert.equal(absorbance(p.cystines!, p.mass!).toFixed(3), "0.890");
});

test("cystines are pairs of Cys, so an odd one out adds nothing", () => {
  // ProtParam: 38 aa, 4413.21 Da, 1490 reduced, 1615 as cystines (three Cys, one pair).
  const p = proteinProperties("MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQCCAPC");
  assert.equal(p.mass!.toFixed(2), "4413.21");
  assert.equal(p.cys, 3);
  assert.equal(p.reduced, 1490);
  assert.equal(p.cystines, 1615);
});

test("without Trp the coefficient comes with ProtParam's warning", () => {
  // ProtParam: 34 aa, 4038.74 Da, 1490 either way, "could result in more than 10% error".
  const p = proteinProperties("MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQC");
  assert.equal(p.mass!.toFixed(2), "4038.74");
  assert.equal(p.reduced, 1490);
  assert.equal(p.cystines, 1490);
  assert.match(extinctionNote(p)!, /more than 10%/);
});

test("without Trp, Tyr or Cys it can't be measured at 280 nm", () => {
  // ProtParam: 3843.51 Da, "should not be visible by UV spectrophotometry".
  const p = proteinProperties("MKTAAIAKQRQISFVKSHFSRQLEERLGLIEVQ");
  assert.equal(p.mass!.toFixed(2), "3843.51");
  assert.equal(p.reduced, 0);
  assert.match(extinctionNote(p)!, /can't be measured at 280 nm/);
});

test("the protein ends at its first stop", () => {
  const p = proteinProperties("MWY*CCW*");
  assert.equal(p.residues, 3);
  assert.equal(p.earlyStop, 4);
  assert.equal(p.cys, 0);
  assert.equal(p.reduced, 5500 + 1490);
  assert.equal(proteinProperties("MWY*").earlyStop, null);
});

test("an unknown residue leaves out the mass and coefficient", () => {
  const p = proteinProperties("MWXYX*");
  assert.equal(p.unknown, 2);
  assert.equal(p.mass, null);
  assert.equal(p.reduced, null);
  assert.equal(p.cystines, null);
  assert.match(extinctionNote(p)!, /2 residues are unknown/);
  assert.match(extinctionNote(proteinProperties("MXW"))!, /A residue is unknown/);
});

test("an empty translation has nothing to say", () => {
  const p = proteinProperties("*");
  assert.equal(p.residues, 0);
  assert.equal(p.mass, null);
  assert.equal(extinctionNote(p), null);
});

test("lower-case letters count", () => {
  assert.equal(proteinProperties("mwy").reduced, 5500 + 1490);
});

test("masses read in kilodaltons", () => {
  assert.equal(kilodaltons(26941.48), "26.9 kDa");
  assert.equal(kilodaltons(3843.51), "3.8 kDa");
});

test("a sequence prints in numbered lines of blocks of ten", () => {
  const lines = residueLines("A".repeat(25), 20);
  assert.deepEqual(lines.map(l => l.first), [1, 21]);
  assert.deepEqual(lines[0].blocks, ["AAAAAAAAAA", "AAAAAAAAAA"]);
  assert.deepEqual(lines[1].blocks, ["AAAAA"]);
  assert.equal(residueLines(EGFP).length, 4);
  assert.deepEqual(residueLines(""), []);
});
