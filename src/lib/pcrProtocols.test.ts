// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Every number in NEB's protocols as src/lib/pcrProtocols.ts holds them: one test for each
// protocol, with the whole entry typed out here and the NEB page and value each number
// comes from beside it. A number changes only from NEB's own page, so a change to one has to
// change this file too. NEB's pages as read on 17 Nov 2026. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { PCR_PROTOCOLS } from "./pcrProtocols.ts";

test("the polymerases that have a protocol", () => {
  assert.deepEqual(Object.keys(PCR_PROTOCOLS).sort(), ["onetaq", "onetaq-gc", "phusion", "q5", "taq"]);
});

test("Q5 follows NEB's M0491", () => {
  // "PCR Using Q5 High-Fidelity DNA Polymerase (NEB #M0491)":
  // https://www.neb.com/en-gb/protocols/pcr-using-q5-high-fidelity-dna-polymerase-m0491
  assert.deepEqual(PCR_PROTOCOLS.q5, {
    source: "PCR Using Q5 High-Fidelity DNA Polymerase",
    product: "Q5 High-Fidelity DNA Polymerase",
    number: "M0491",
    // 98 °C for 30 s.
    initial: { temp: 98, seconds: 30 },
    // 98 °C for 5–10 s.
    denature: { temp: 98, seconds: 10 },
    // 50–72 °C for 10–30 s.
    anneal: 20,
    extend: {
      temp: 72,
      // The table's pDNA rows: 10–15 s/kb up to 6 kb, 20–30 s/kb from 6 kb (the top of both).
      plasmid: 15,
      // gDNA 20–30 s/kb up to 6 kb and cDNA 30–40: 30 lies in both.
      complex: 30,
      // From 6 kb: gDNA 30–50, cDNA 40–50, pDNA 20–30, and "when amplifying products > 6 kb,
      // it is often helpful to increase the extension time to 40–50 seconds/kb" (45 for complex).
      longer: { above: 6000, plasmid: 30, complex: 45 }
    },
    // "A final extension of 2 minutes at 72°C is recommended".
    final: { temp: 72, seconds: 120 },
    // 25–35 cycles; "For genomic amplicons, 30-35 cycles are recommended" (30 for complex and a colony).
    cycles: { plasmid: 25, complex: 30, colony: 30 },
    cycleRange: [25, 35],
    // "When primers with annealing temperatures ≥ 72°C are used, a 2-step thermocycling
    // protocol … is possible."
    twoStepFrom: 72
  });
  // The hold is 4–10 °C there; the program holds at 4 (pcrProgram.ts).
});

test("Phusion follows NEB's M0530", () => {
  // "PCR Protocol for Phusion High-Fidelity DNA Polymerase (M0530)":
  // https://www.neb.com/en-gb/protocols/pcr-protocol-m0530
  assert.deepEqual(PCR_PROTOCOLS.phusion, {
    source: "PCR Protocol for Phusion High-Fidelity DNA Polymerase",
    product: "Phusion High-Fidelity DNA Polymerase",
    number: "M0530",
    // 98 °C for 30 s.
    initial: { temp: 98, seconds: 30 },
    // 98 °C for 5–10 s.
    denature: { temp: 98, seconds: 10 },
    // 45–72 °C for 10–30 s.
    anneal: 20,
    // 72 °C, 15–30 s/kb: "Generally, an extension time of 15 seconds per kb can be used. For
    // complex amplicons, such as genomic DNA, an extension time of 30 seconds per kb is recommended".
    extend: { temp: 72, plasmid: 15, complex: 30 },
    // 72 °C for 5–10 minutes.
    final: { temp: 72, seconds: 300 },
    // 25–35 cycles.
    cycles: { plasmid: 25, complex: 30, colony: 30 },
    cycleRange: [25, 35],
    // "When primers with annealing temperatures ≥ 72°C are used", annealing and extension are one step.
    twoStepFrom: 72
  });
});

test("OneTaq follows NEB's M0481, in both of its buffers", () => {
  // "Protocol for OneTaq Hot Start DNA Polymerase (M0481)":
  // https://www.neb.com/en-gb/protocols/one-taq-hot-start-dna-polymerase-m0481
  const entry = {
    source: "Protocol for OneTaq Hot Start DNA Polymerase",
    product: "OneTaq Hot Start DNA Polymerase",
    number: "M0481",
    // 94 °C for 30 s (2–4 min for GC-rich templates, which the program doesn't ask about).
    initial: { temp: 94, seconds: 30 },
    // "With colony PCR, an initial 2–5 minute incubation at 94°C is recommended to lyse cells".
    colonyInitial: 180,
    // 94 °C for 10–30 s.
    denature: { temp: 94, seconds: 20 },
    // 45–68 °C for 15–60 s.
    anneal: 30,
    // 68 °C, 1 minute per kb. The shortest, 45 s, is not in the protocol: it is from NEB's
    // usage guidelines, 45–60 s below 1 kb.
    extend: { temp: 68, plasmid: 60, complex: 60, shortest: 45 },
    // 68 °C: the text says "A final extension of 5 minutes at 68°C is recommended", its table 10 minutes.
    final: { temp: 68, seconds: 300 },
    // The table gives 30 cycles; "Generally, 25–35 cycles yield sufficient product".
    cycles: { plasmid: 25, complex: 30, colony: 30 },
    cycleRange: [25, 35],
    // "When primers with annealing temperatures of 68°C or above are used".
    twoStepFrom: 68
  };
  assert.deepEqual(PCR_PROTOCOLS.onetaq, entry);
  assert.deepEqual(PCR_PROTOCOLS["onetaq-gc"], entry);
});

test("Taq follows NEB's M0273", () => {
  // "PCR Protocol for Taq DNA Polymerase with Standard Taq Buffer (NEB #M0273)":
  // https://www.neb.com/en-gb/protocols/taq-dna-polymerase-with-standard-taq-buffer-m0273
  assert.deepEqual(PCR_PROTOCOLS.taq, {
    source: "PCR Protocol for Taq DNA Polymerase with Standard Taq Buffer",
    product: "Taq DNA Polymerase with Standard Taq Buffer",
    number: "M0273",
    // 95 °C for 30 s: "An initial denaturation of 30 seconds at 95°C is sufficient for most
    // amplicons from pure DNA templates" (2–4 min for GC-rich templates, which the program doesn't ask about).
    initial: { temp: 95, seconds: 30 },
    // "With colony PCR, an initial 5-minute denaturation at 95°C is recommended".
    colonyInitial: 300,
    // 95 °C for 15–30 s.
    denature: { temp: 95, seconds: 20 },
    // 45–68 °C for 15–60 s.
    anneal: 30,
    // 68 °C, 1 minute/kb. The shortest, 45 s, is not in the protocol: it is from NEB's usage
    // guidelines, 45–60 s below 1 kb.
    extend: { temp: 68, plasmid: 60, complex: 60, shortest: 45 },
    // 68 °C for 5 minutes.
    final: { temp: 68, seconds: 300 },
    // The table gives 25–30 cycles; "Generally, 25–35 cycles yield sufficient product".
    cycles: { plasmid: 25, complex: 30, colony: 30 },
    cycleRange: [25, 35],
    // "When primers with annealing temperatures above 65°C are used": 66, as temperatures show in whole degrees.
    twoStepFrom: 66
  });
});
