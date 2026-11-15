// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// NEB's routine PCR conditions for the polymerases in polymerases.ts, which the PCR product
// dialog turns into a cycling program (pcrProgram.ts). Each follows the protocol NEB
// publishes for that polymerase (read in Nov 2026, from copies of its PDFs, as NEB's site
// refuses scripts): the temperatures and the lengths of the steps are NEB's, and where NEB
// gives a range (cycles, extension per kb, annealing time) the value is one inside it.
// pcrProgram.test.ts holds the numbers, so change them only from NEB's protocol pages.
//
// A polymerase with no entry here has no program: its protocol has not been read yet, and
// a lab tool should not guess at one. The dialog says so.

/** What the template is, which sets the first denaturation, the cycles and how long to extend. */
export type TemplateKind = "plasmid" | "complex" | "colony";

export const TEMPLATES: { id: TemplateKind; label: string; why: string }[] = [
  { id: "plasmid", label: "Plasmid", why: "Plenty of target in a simple background, so fewer cycles and a quicker extension do." },
  { id: "complex", label: "Genomic DNA or cDNA", why: "The target is rare among a lot of other DNA, so it takes more cycles and a longer extension." },
  { id: "colony", label: "Colony", why: "The cells have to be opened first, so the first denaturation is longer." }
];

export interface PcrProtocol {
  /** NEB's protocol it follows, as the tests and the next person to check it will want. */
  source: string;
  initial: { temp: number; seconds: number };
  /** The first denaturation on a colony; absent where NEB gives none, and the template is not offered. */
  colonyInitial?: number;
  denature: { temp: number; seconds: number };
  /** The time at the annealing temperature. */
  anneal: number;
  extend: {
    temp: number;
    /** Seconds for each kb of product. */
    plasmid: number;
    complex: number;
    /** For products longer than `above` bp, where NEB asks for more. */
    longer?: { above: number; perKb: number };
  };
  final: { temp: number; seconds: number };
  cycles: { plasmid: number; complex: number; colony: number };
  /** From this annealing temperature (as shown, in whole degrees) annealing and extension are one step. */
  twoStepFrom: number;
  /** NEB's range of cycles, for the note on why this many. */
  cycleRange: [number, number];
}

const Q5: PcrProtocol = {
  source: "PCR Using Q5 High-Fidelity DNA Polymerase (M0491)",
  initial: { temp: 98, seconds: 30 },
  denature: { temp: 98, seconds: 10 }, // 5–10 s
  anneal: 20, // 10–30 s
  // 20–30 s/kb, "reduced to 10 s/kb for simple templates (plasmid, E. coli, etc.)", and
  // 40–50 s/kb past 6 kb. A plasmid gets the low end of the routine range, not the 10.
  extend: { temp: 72, plasmid: 20, complex: 30, longer: { above: 6000, perKb: 45 } },
  final: { temp: 72, seconds: 120 },
  cycles: { plasmid: 25, complex: 30, colony: 30 }, // 25–35, genomic 30–35
  cycleRange: [25, 35],
  twoStepFrom: 72
};

const PHUSION: PcrProtocol = {
  source: "PCR Protocol for Phusion High-Fidelity DNA Polymerase (M0530)",
  initial: { temp: 98, seconds: 30 },
  denature: { temp: 98, seconds: 10 }, // 5–10 s
  anneal: 20, // 10–30 s
  extend: { temp: 72, plasmid: 15, complex: 30 }, // "generally 15 s/kb", 30 s/kb for complex amplicons
  final: { temp: 72, seconds: 300 }, // 5–10 min
  cycles: { plasmid: 25, complex: 30, colony: 30 }, // 25–35
  cycleRange: [25, 35],
  twoStepFrom: 72
};

const ONETAQ: PcrProtocol = {
  source: "Protocol for OneTaq Hot Start DNA Polymerase (M0481)",
  initial: { temp: 94, seconds: 30 },
  colonyInitial: 180, // 2–5 min "to lyse cells"
  denature: { temp: 94, seconds: 20 }, // 15–30 s
  anneal: 30, // 15–60 s
  extend: { temp: 68, plasmid: 60, complex: 60 }, // 1 min/kb
  // Its table says 10 min and its guidelines 5 min; the table is what to follow.
  final: { temp: 68, seconds: 600 },
  cycles: { plasmid: 25, complex: 30, colony: 30 }, // 30 in the table, 25–35 in the guidelines
  cycleRange: [25, 35],
  twoStepFrom: 68
};

const TAQ: PcrProtocol = {
  source: "PCR Protocol for Taq DNA Polymerase with Standard Taq Buffer (M0273)",
  initial: { temp: 95, seconds: 30 },
  colonyInitial: 300, // "an initial 5-minute denaturation"
  denature: { temp: 95, seconds: 20 }, // 15–30 s
  anneal: 30, // 15–60 s
  extend: { temp: 68, plasmid: 60, complex: 60 }, // 1 min/kb
  final: { temp: 68, seconds: 300 },
  cycles: { plasmid: 25, complex: 30, colony: 30 }, // 30 in the table, 25–35 in the guidelines
  cycleRange: [25, 35],
  // "Above 65 °C", and annealing temperatures are shown in whole degrees.
  twoStepFrom: 66
};

/** By `NebPolymerase.id`. OneTaq's guidelines cover both of its buffers. */
export const PCR_PROTOCOLS: Record<string, PcrProtocol> = {
  q5: Q5,
  phusion: PHUSION,
  onetaq: ONETAQ,
  "onetaq-gc": ONETAQ,
  taq: TAQ
};

/** The templates a polymerase's protocol has something for. */
export function templatesFor(polymerase: string): TemplateKind[] {
  const p = PCR_PROTOCOLS[polymerase];
  return TEMPLATES.map(t => t.id).filter(t => t !== "colony" || p?.colonyInitial !== undefined);
}
