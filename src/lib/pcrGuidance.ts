// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Read from NEB on 16 November 2026. The named product is explicit because the menu groups
// products by Tm rule; Q5-XT, for example, has a different maximum. Never infer missing data.
export interface PcrGuidance {
  product: string;
  ends: string;
  maxLength: { simple: number; complex: number };
  enhancer?: string;
}
// NEB DNA Polymerase Selection Chart, "Resulting 3′ Ends" and "Max PCR Product":
// Q5 and Phusion: "Blunt", "20 kb simple, 10 kb complex";
// OneTaq: "3' dA/Blunt", "6 kb"; Taq: "3' dA", "5 kb".
// https://www.neb.com/en-us/tools-and-resources/selection-charts/dna-polymerase-selection-chart
const Q5: PcrGuidance = {
  product: "Q5 (M0491)",
  ends: "Blunt",
  maxLength: { simple: 20000, complex: 10000 },
  // "Can be coupled with Q5 High GC Enhancer to amplify high GC (>= 65%) amplicons."
  // https://www.neb.com/en-us/products/b9027-q5-reaction-buffer-pack
  // Protocol: enhancer "should be added only ... when other conditions have failed".
  // https://www.neb.com/protocols/pcr-using-q5-high-fidelity-dna-polymerase-m0491?pdf=true
  enhancer: "If amplification is difficult, consider Q5 High GC Enhancer with Q5 Reaction Buffer."
};
const ONETAQ: PcrGuidance = { product: "OneTaq (M0481)", ends: "3′ A overhangs or blunt", maxLength: { simple: 6000, complex: 6000 } };
export const PCR_GUIDANCE: Readonly<Record<string, PcrGuidance>> = {
  q5: Q5,
  onetaq: ONETAQ,
  "onetaq-gc": ONETAQ,
  phusion: { product: "Phusion (M0530)", ends: "Blunt", maxLength: { simple: 20000, complex: 10000 } },
  taq: { product: "Taq (M0273)", ends: "3′ A overhangs", maxLength: { simple: 5000, complex: 5000 } }
};
