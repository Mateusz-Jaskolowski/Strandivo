// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What the PCR product dialog decides (src/lib/pcrPlan.ts). Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { nebPolymerase } from "./polymerases.ts";
import { alignPrimer } from "./primerAlign.ts";
import { annealingTemp, DEFAULT_TM, tmBases, withNebPolymerase, type TmSettings } from "./primers.ts";
import { followsSettings, startPolymerase, tmStrip, wholePrimerTa } from "./pcrPlan.ts";
import { reverseComplement } from "./seqdata.ts";

const neb = (polymerase: string, nebPrimer = nebPolymerase(polymerase).primer): TmSettings => ({ ...DEFAULT_TM, method: "neb", polymerase, nebPrimer });

test("the dialog starts on Settings' polymerase, or Q5 under another Tm method", () => {
  assert.equal(startPolymerase(neb("onetaq")), "onetaq");
  assert.equal(startPolymerase(DEFAULT_TM), "q5");
  assert.equal(startPolymerase({ ...DEFAULT_TM, method: "wallace", polymerase: "taq" }), "q5");
  // An id from newer settings that this version doesn't know is Q5, as everywhere else.
  assert.equal(startPolymerase(neb("not-a-polymerase")), "q5");
});

test("the strip says when the Tms are not Settings', and what its button does", () => {
  assert.equal(tmStrip(neb("q5"), "q5"), null);
  assert.equal(followsSettings(neb("q5"), "q5"), true);
  const other = tmStrip(neb("q5"), "onetaq")!;
  assert.equal(other.text, `Tms here are for ${nebPolymerase("onetaq").name}; the rest of the app uses ${nebPolymerase("q5").name}.`);
  assert.equal(other.button, "Use for all Tms");
  // A user of primer3's method sees it at once, as the numbers differ from the Primers tab's.
  const away = tmStrip(DEFAULT_TM, "q5")!;
  assert.equal(away.text, `Tms here are NEB's for ${nebPolymerase("q5").name}; the rest of the app uses SantaLucia 1998.`);
  assert.equal(away.button, "Switch all Tms to NEB");
  assert.equal(followsSettings(DEFAULT_TM, "q5"), false);
});

test("the Tm settings for a polymerase keep a primer concentration Settings already hold for it", () => {
  // Settings keep the polymerase and its concentration while another method is chosen.
  const kept = withNebPolymerase({ ...DEFAULT_TM, method: "santalucia", polymerase: "q5", nebPrimer: 250 }, "q5");
  assert.deepEqual([kept.method, kept.polymerase, kept.nebPrimer], ["neb", "q5", 250]);
  assert.equal(withNebPolymerase(neb("onetaq", 300), "onetaq").nebPrimer, 300);
  // Another polymerase starts from its own concentration.
  const moved = withNebPolymerase(neb("q5", 250), "onetaq");
  assert.deepEqual([moved.polymerase, moved.nebPrimer], ["onetaq", nebPolymerase("onetaq").primer]);
  // The rest of Settings stays as it was.
  assert.equal(withNebPolymerase({ ...DEFAULT_TM, monovalent: 77 }, "q5").monovalent, 77);
});

// A template, and primers placed on it as the Primers tab stores them: `start..end` is the
// site that pairs, and `bases` also holds the 5′ tail.
let seed = 7;
const template = Array.from({ length: 300 }, () => "ACGT"[(seed = (seed * 1103515245 + 12345) % 2147483648) >> 16 & 3]).join("");
const site = { f: template.slice(50, 72), r: template.slice(200, 222) };
const forward = (bases: string) => ({ start: 50, end: 71, strand: 1 as const, bases });
const reverse = (bases: string) => ({ start: 200, end: 221, strand: -1 as const, bases });
const TAIL = "GGATCCAAGCTTGGAT";

test("whole primers anneal higher than their pairing parts when tails are there", () => {
  const conf = withNebPolymerase(DEFAULT_TM, "q5");
  const fBases = TAIL + site.f;
  const rBases = TAIL + reverseComplement(site.r);
  const a = alignPrimer(forward(fBases), template);
  const b = alignPrimer(reverse(rBases), template);
  assert.equal(a.tail, TAIL);
  const paired = annealingTemp(tmBases(a), tmBases(b), conf)!.ta;
  const whole = wholePrimerTa(fBases, rBases, a, b, conf)!;
  assert.ok(whole > paired, `${whole} should be above ${paired}`);
  // The tail of one primer is enough to ask.
  const plain = alignPrimer(reverse(reverseComplement(site.r)), template);
  assert.notEqual(wholePrimerTa(fBases, reverseComplement(site.r), a, plain, conf), null);
});

test("there is no whole-primer temperature without a tail, with changes or with an unknown Tm", () => {
  const conf = withNebPolymerase(DEFAULT_TM, "q5");
  const rBases = reverseComplement(site.r);
  const plainF = alignPrimer(forward(site.f), template);
  const plainR = alignPrimer(reverse(rBases), template);
  assert.equal(wholePrimerTa(site.f, rBases, plainF, plainR, conf), null);
  // A primer with a changed base: its whole length doesn't pair.
  const changed = TAIL + site.f.slice(0, 10) + (site.f[10] === "A" ? "C" : "A") + site.f.slice(11);
  const a = alignPrimer(forward(changed), template);
  assert.ok(a.substitutions > 0);
  assert.equal(wholePrimerTa(changed, rBases, a, plainR, conf), null);
  // A degenerate base in the tail leaves the whole primer with no Tm.
  const degenerate = "NNNN" + site.f;
  const d = alignPrimer(forward(degenerate), template);
  assert.equal(wholePrimerTa(degenerate, rBases, d, plainR, conf), null);
});

test("a tail on the reverse primer alone also gives a whole-primer temperature", () => {
  const conf = withNebPolymerase(DEFAULT_TM, "q5");
  const rBases = TAIL + reverseComplement(site.r);
  const plainF = alignPrimer(forward(site.f), template);
  const b = alignPrimer(reverse(rBases), template);
  assert.equal(b.tail, TAIL);
  const paired = annealingTemp(tmBases(plainF), tmBases(b), conf)!.ta;
  const whole = wholePrimerTa(site.f, rBases, plainF, b, conf)!;
  assert.ok(whole > paired, `${whole} should be above ${paired}`);
});

test("a changed base in either primer leaves no whole-primer temperature, whichever primer has the tail", () => {
  const conf = withNebPolymerase(DEFAULT_TM, "q5");
  const flip = (base: string) => (base === "A" ? "C" : "A");
  const plainF = alignPrimer(forward(site.f), template);
  const rBases = reverseComplement(site.r);
  const changedR = rBases.slice(0, 10) + flip(rBases[10]) + rBases.slice(11);
  const changedF = site.f.slice(0, 10) + flip(site.f[10]) + site.f.slice(11);

  // A changed base in the reverse primer, the forward primer having the tail.
  const tailedF = TAIL + site.f;
  const a = alignPrimer(forward(tailedF), template);
  const b = alignPrimer(reverse(changedR), template);
  assert.equal(a.tail, TAIL);
  assert.ok(b.substitutions > 0);
  assert.equal(wholePrimerTa(tailedF, changedR, a, b, conf), null);

  // The same changed base, with the tail on the reverse primer itself.
  const tailedChangedR = TAIL + changedR;
  const c = alignPrimer(reverse(tailedChangedR), template);
  assert.equal(c.tail, TAIL);
  assert.ok(c.substitutions > 0);
  assert.equal(wholePrimerTa(site.f, tailedChangedR, plainF, c, conf), null);

  // A changed base in the forward primer, the reverse primer having the tail.
  const tailedR = TAIL + rBases;
  const d = alignPrimer(forward(changedF), template);
  const e = alignPrimer(reverse(tailedR), template);
  assert.ok(d.substitutions > 0);
  assert.equal(e.tail, TAIL);
  assert.equal(wholePrimerTa(changedF, tailedR, d, e, conf), null);
});
