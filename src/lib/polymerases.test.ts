// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The NEB Tm method and annealing temperatures, against NEB's own answers. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { annealingRuleText, annealingTemp as rawAnnealing, NEB_POLYMERASES, nebPolymerase } from "./polymerases.ts";
import { annealingTemp, DEFAULT_TM, meltingTemp, tmLabel, type TmSettings } from "./primers.ts";

const neb = (polymerase: string, nebPrimer: number): TmSettings => ({ ...DEFAULT_TM, method: "neb", polymerase, nebPrimer });

// NEB's Tm API (tmapi.neb.com, version 0.19.0, Nov 2026) asked with fmt=long, which gives
// each Tm unrounded and Ta to 0.1 °C: [polymerase, primer 1, primer 2, nM, Tm 1, Tm 2, Ta],
// from the product code in the comment.
const NEB_ANSWERS: [string, string, string, number, number, number, number][] = [
  ["q5", "AGCGGATAACAATTTCACACAGGA", "GTAAAACGACGGCCAGT", 500, 66.23719386401854, 62.27251195078054, 63.3], // q5-0
  ["q5", "TTACTTGTACAGCTCGTCCATGCC", "ATGGTGAGCAAGGGCGAGGAG", 200, 67.78281470064917, 71.01454828309551, 68.8], // q5-0
  ["q5u", "AGCGGATAACAATTTCACACAGGA", "GTAAAACGACGGCCAGT", 500, 67.04811296962163, 62.99615458275832, 63], // q5u-0
  ["q5u", "TTACTTGTACAGCTCGTCCATGCC", "ATGGTGAGCAAGGGCGAGGAG", 200, 68.54889324952069, 71.71919279254206, 68.5], // q5u-0
  ["phusion", "AGCGGATAACAATTTCACACAGGA", "GTAAAACGACGGCCAGT", 500, 62.431538786656574, 56.56968063620599, 60.1], // phusion-0
  ["phusion", "TTACTTGTACAGCTCGTCCATGCC", "ATGGTGAGCAAGGGCGAGGAG", 200, 63.26263734411498, 65.16921848398385, 66.3], // phusion-0
  ["onetaq", "AGCGGATAACAATTTCACACAGGA", "GTAAAACGACGGCCAGT", 500, 58.543676660380754, 55.28788542535818, 50.3], // onetaq-0
  ["onetaq", "TTACTTGTACAGCTCGTCCATGCC", "ATGGTGAGCAAGGGCGAGGAG", 200, 60.42578305649164, 64.11136091818622, 55.4], // onetaq-0
  ["onetaq-gc", "AGCGGATAACAATTTCACACAGGA", "GTAAAACGACGGCCAGT", 500, 61.72206369238387, 58.195042244338765, 53.2], // onetaq-1
  ["onetaq-gc", "TTACTTGTACAGCTCGTCCATGCC", "ATGGTGAGCAAGGGCGAGGAG", 200, 63.48121183836838, 67.00258208225273, 58.5], // onetaq-1
  ["taq", "AGCGGATAACAATTTCACACAGGA", "GTAAAACGACGGCCAGT", 500, 58.697832878778, 55.4294473427517, 50.4], // taq-0
  ["taq", "TTACTTGTACAGCTCGTCCATGCC", "ATGGTGAGCAAGGGCGAGGAG", 200, 60.574388127985515, 64.25260014072796, 55.6], // taq-0
  ["taq-thermopol", "AGCGGATAACAATTTCACACAGGA", "GTAAAACGACGGCCAGT", 500, 55.945264423989386, 52.89426944320007, 47.9], // taq-2
  ["taq-thermopol", "TTACTTGTACAGCTCGTCCATGCC", "ATGGTGAGCAAGGGCGAGGAG", 200, 57.915465877254235, 61.71725940116261, 52.9], // taq-2
  ["taq-mastermix", "AGCGGATAACAATTTCACACAGGA", "GTAAAACGACGGCCAGT", 500, 58.697832878778, 55.4294473427517, 55.4], // taqmaster-0
  ["taq-mastermix", "TTACTTGTACAGCTCGTCCATGCC", "ATGGTGAGCAAGGGCGAGGAG", 200, 60.574388127985515, 64.25260014072796, 60.6], // taqmaster-0
  ["hemo-klentaq", "AGCGGATAACAATTTCACACAGGA", "GTAAAACGACGGCCAGT", 500, 60.671731285634905, 57.23716872552802, 52.2], // hktaq-0
  ["hemo-klentaq", "TTACTTGTACAGCTCGTCCATGCC", "ATGGTGAGCAAGGGCGAGGAG", 200, 62.473597135916464, 66.05225616241864, 57.5], // hktaq-0
  ["multiplex", "AGCGGATAACAATTTCACACAGGA", "GTAAAACGACGGCCAGT", 500, 62.62265078090553, 59.013866216226916, 59], // multiplex-0
  ["multiplex", "TTACTTGTACAGCTCGTCCATGCC", "ATGGTGAGCAAGGGCGAGGAG", 200, 64.34333063396667, 67.81290918924537, 64.3], // multiplex-0
  ["longamp", "AGCGGATAACAATTTCACACAGGA", "GTAAAACGACGGCCAGT", 500, 63.40733327550845, 59.7252762589128, 54.7], // lataq-0
  ["longamp", "TTACTTGTACAGCTCGTCCATGCC", "ATGGTGAGCAAGGGCGAGGAG", 200, 65.09298653234504, 68.51524966448744, 60.1], // lataq-0
  ["vent", "AGCGGATAACAATTTCACACAGGA", "GTAAAACGACGGCCAGT", 500, 55.945264423989386, 52.89426944320007, 52.9], // vent-0
  ["vent", "TTACTTGTACAGCTCGTCCATGCC", "ATGGTGAGCAAGGGCGAGGAG", 200, 57.915465877254235, 61.71725940116261, 55.9] // vent-0
];

test("the NEB method gives NEB's Tm and Ta for every polymerase", () => {
  for (const [id, a, b, nM, tmA, tmB, ta] of NEB_ANSWERS) {
    const s = neb(id, nM);
    assert.ok(Math.abs(meltingTemp(a, s)! - tmA) < 1e-9, `${id} ${a}: ${meltingTemp(a, s)} vs NEB's ${tmA}`);
    assert.ok(Math.abs(meltingTemp(b, s)! - tmB) < 1e-9, `${id} ${b}: ${meltingTemp(b, s)} vs NEB's ${tmB}`);
    assert.equal(annealingTemp(a, b, s)?.ta, ta, `${id}: Ta`);
  }
  // Every polymerase in the menu is checked above.
  assert.deepEqual(new Set(NEB_ANSWERS.map(x => x[0])), new Set(NEB_POLYMERASES.map(p => p.id)));
});

test("NEB's annealing rules at their edges, as its API answers", () => {
  const GC_A = "GCGCGGCCGCGGCGGCCGCGGCCGCG";
  const GC_B = "GCGGCCGCGGCGGCCGCGCGGCGG";
  // Capped at 72 °C for Q5, Vent and Phusion, 68 °C for Taq in any buffer; not at all for Q5U.
  assert.equal(annealingTemp(GC_A, GC_B, neb("q5", 500))?.ta, 72);
  assert.equal(annealingTemp(GC_A, GC_B, neb("vent", 500))?.ta, 72);
  assert.equal(annealingTemp(GC_A, GC_B, neb("taq-thermopol", 500))?.ta, 68);
  assert.equal(annealingTemp(GC_A, GC_B, neb("q5u", 500))?.ta, 97);
  // Vent subtracts 2 °C only when both primers have 21 bases or more, whichever has the lower Tm.
  assert.equal(annealingTemp("ATTATAAATTGCATAATATTTATAGCAAT", "CGGCCGCGGCATG", neb("vent", 500))?.ta, 43.4);
  // The calculator shows Ta in whole degrees, rounding NEB's 0.1 °C value again: Phusion's
  // 34.516 becomes 34.5 and then 35, and Taq's 54.499 (lower Tm 59.499) 54.5 and then 55.
  assert.equal(Math.round(annealingTemp("TAGATCTAGAGT", "GGCACTCGCCGCCCAAC", neb("phusion", 500))!.ta), 35);
  assert.equal(Math.round(annealingTemp("ATAATATTCTTAATATACTTATGC", "CTGGGCGTGCTCGGCCACTTCTAAGTGGGTT", neb("phusion", 500))!.ta), 52);
  assert.equal(Math.round(annealingTemp("AAACTAAATGTGTGTTCAGAGTCAAAAGACTATCC", "TGGGGCTCCCTCCGG", neb("taq", 500))!.ta), 55);
  assert.equal(rawAnnealing(nebPolymerase("q5"), { tm: 59.94, length: 20 }, { tm: 70, length: 20 }), 60.9);
});

test("the NEB method's labels, fallbacks and rules in words", () => {
  assert.equal(tmLabel(neb("q5", 500)), "NEB · Q5 High-Fidelity · 500 nM primer");
  assert.equal(annealingTemp("AGCGGATAACAATTTCACACAGGA", "GTAAAACGACGGCCAGT", DEFAULT_TM), null);
  assert.equal(annealingTemp("AGCGGATAACAATTTCACACAGGA", "GTAAAACGNNGGCCAGT", neb("q5", 500)), null);
  // A polymerase from newer settings falls back to Q5 rather than failing.
  assert.equal(nebPolymerase("q7").id, "q5");
  assert.equal(meltingTemp("GTAAAACGACGGCCAGT", neb("q7", 500)), meltingTemp("GTAAAACGACGGCCAGT", neb("q5", 500)));
  assert.equal(annealingRuleText(nebPolymerase("q5").annealing), "lower Tm + 1 °C, at most 72 °C");
  assert.equal(annealingRuleText(nebPolymerase("phusion").annealing), "0.93 × lower Tm + 7.5 °C, at most 72 °C");
  assert.equal(annealingRuleText(nebPolymerase("taq").annealing), "lower Tm − 5 °C, at most 68 °C");
  assert.equal(annealingRuleText(nebPolymerase("vent").annealing), "lower Tm − 2 °C (the lower Tm if a primer is under 21 bases), at most 72 °C");
  assert.equal(annealingRuleText(nebPolymerase("q5u").annealing), "the lower Tm");
  // The SantaLucia default is untouched: still primer3's numbers.
  assert.equal(meltingTemp("GTAAAACGACGGCCAGT")!.toFixed(1), "54.7");
});
