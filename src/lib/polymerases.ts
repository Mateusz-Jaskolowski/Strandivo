// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// NEB polymerases for the "neb" Tm method: the salt NEB's Tm Calculator assumes for each
// polymerase's buffer, the primer concentration it starts from, and its rule for a pair's
// annealing temperature (Ta). The Tm itself is worked out in primers.ts.
//
// The list of polymerases and their rules follows polymerase-tm
// (https://github.com/Dioskurides/polymerase-tm, MIT). Every salt and rule here was then
// fitted to NEB's own Tm API (tmapi.neb.com, version 0.19.0, Nov 2026), which answers for
// every NEB product code: they reproduce its Tm to within 1e-12 °C and its Ta for all 53
// products, and polymerases.test.ts holds a sample of its answers. polymerase-tm's code
// (2.3.2) had five salts wrong (51 mM for Taq and Crimson Taq, where NEB has 55; for
// OneTaq 54 and OneTaq GC 80; and 180 for Q5U's 170) and other Ta rules for Q5U, Crimson
// Taq and Multiplex. NEB gives no way to read the primer concentrations its calculator
// starts from, so those are polymerase-tm's (and the protocols'), and Settings lets them
// be changed.

/** Ta = `slope` × the lower Tm + `by` (`shortBy` if either primer is under `minLength`), at most `cap`. */
export interface AnnealingRule {
  slope: number;
  by: number;
  cap: number | null;
  minLength?: number;
  shortBy?: number;
}

export interface NebPolymerase {
  id: string;
  /** As NEB names it, for menus. */
  name: string;
  /** For a menu's groups. */
  family: string;
  /** Other NEB products the calculator treats the same, or "" if none. */
  also: string;
  /** Monovalent salt the calculator assumes for its buffer, mM. */
  salt: number;
  /**
   * Owczarzy et al. (2004) on SantaLucia (1998) for every buffer but Phusion's, which NEB
   * corrects as Schildkraut and Lifson (1965) do, also with a quarter of the primer.
   */
  correction: "owczarzy" | "schildkraut";
  /** Each primer's concentration the calculator starts from, nM. */
  primer: number;
  annealing: AnnealingRule;
}

const offset = (by: number, cap: number | null): AnnealingRule => ({ slope: 1, by, cap });

// Q5U and the Taq master mixes get no offset and no cap from NEB's API, unlike their
// relatives; checked through Q5U's own endpoint too, so it is NEB's choice, kept as it is.
export const NEB_POLYMERASES: NebPolymerase[] = [
  { id: "q5", name: "Q5 High-Fidelity", family: "Q5", also: "Q5 Hot Start, the Q5 2X Master Mixes, Q5-XT and Q5 Blood Direct", salt: 150, correction: "owczarzy", primer: 500, annealing: offset(1, 72) },
  { id: "q5u", name: "Q5U Hot Start", family: "Q5", also: "", salt: 170, correction: "owczarzy", primer: 500, annealing: offset(0, null) },
  { id: "phusion", name: "Phusion High-Fidelity (HF or GC buffer)", family: "Phusion", also: "Phusion Hot Start Flex, the Phusion kits and master mixes", salt: 222, correction: "schildkraut", primer: 500, annealing: { slope: 0.93, by: 7.5, cap: 72 } },
  { id: "onetaq", name: "OneTaq, Standard buffer", family: "OneTaq", also: "OneTaq Hot Start and the OneTaq master mixes with Standard buffer", salt: 54, correction: "owczarzy", primer: 200, annealing: offset(-5, 68) },
  { id: "onetaq-gc", name: "OneTaq, GC buffer", family: "OneTaq", also: "OneTaq Hot Start and the OneTaq master mixes with GC buffer", salt: 80, correction: "owczarzy", primer: 200, annealing: offset(-5, 68) },
  { id: "taq", name: "Taq, Standard Taq buffer", family: "Taq", also: "the Mg-free Standard buffer, Hot Start Taq and its 2X Master Mix, and EpiMark Hot Start Taq", salt: 55, correction: "owczarzy", primer: 200, annealing: offset(-5, 68) },
  { id: "taq-thermopol", name: "Taq, ThermoPol buffer", family: "Taq", also: "the ThermoPol II (Mg-free) buffer", salt: 40, correction: "owczarzy", primer: 200, annealing: offset(-5, 68) },
  { id: "taq-mastermix", name: "Taq 2X or 5X Master Mix", family: "Taq", also: "Quick-Load Taq 2X Master Mix, the Taq PCR Kit and Crimson Taq", salt: 55, correction: "owczarzy", primer: 200, annealing: offset(0, null) },
  { id: "hemo-klentaq", name: "Hemo KlenTaq", family: "Taq", also: "", salt: 70, correction: "owczarzy", primer: 200, annealing: offset(-5, 68) },
  { id: "multiplex", name: "Multiplex PCR 5X Master Mix", family: "Taq", also: "", salt: 90, correction: "owczarzy", primer: 200, annealing: offset(0, null) },
  { id: "longamp", name: "LongAmp Taq", family: "LongAmp", also: "LongAmp Hot Start Taq, their 2X Master Mixes and kit, and Crimson LongAmp Taq", salt: 100, correction: "owczarzy", primer: 400, annealing: offset(-5, 65) },
  { id: "vent", name: "Vent or Deep Vent", family: "Vent", also: "their (exo–) forms", salt: 40, correction: "owczarzy", primer: 200, annealing: { slope: 1, by: -2, cap: 72, minLength: 21, shortBy: 0 } }
];

export const DEFAULT_POLYMERASE = "q5";

/** The polymerase with this id, or Q5 for one this version doesn't know (from newer settings). */
export function nebPolymerase(id: string): NebPolymerase {
  return NEB_POLYMERASES.find(p => p.id === id) ?? NEB_POLYMERASES.find(p => p.id === DEFAULT_POLYMERASE)!;
}

/**
 * NEB's annealing temperature for a pair, given each primer's Tm and the length of the bases
 * it was worked out from: rounded to 0.1 °C, as NEB's API gives it. NEB's calculator shows
 * it rounded again to a whole degree (`Math.round`), so 54.45 shows as 54.5 here and 55 there.
 */
export function annealingTemp(p: NebPolymerase, a: { tm: number; length: number }, b: { tm: number; length: number }): number {
  const r = p.annealing;
  const short = Math.min(a.length, b.length) < (r.minLength ?? 0);
  let ta = r.slope * Math.min(a.tm, b.tm) + (short ? (r.shortBy ?? r.by) : r.by);
  if (r.cap !== null) ta = Math.min(ta, r.cap);
  return Math.round(ta * 10) / 10;
}

const signed = (n: number) => (n < 0 ? ` − ${-n} °C` : n > 0 ? ` + ${n} °C` : "");

/** The rule in words, e.g. "lower Tm + 1 °C, at most 72 °C". */
export function annealingRuleText(r: AnnealingRule): string {
  const base = r.slope === 1 ? (r.by ? `lower Tm${signed(r.by)}` : "the lower Tm") : `${r.slope} × lower Tm${signed(r.by)}`;
  const short = r.minLength ? ` (${r.shortBy ? `lower Tm${signed(r.shortBy)}` : "the lower Tm"} if a primer is under ${r.minLength} bases)` : "";
  return `${base}${short}${r.cap !== null ? `, at most ${r.cap} °C` : ""}`;
}
