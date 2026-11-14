// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// A protein's mass and extinction coefficient at 280 nm, worked out as ExPASy ProtParam
// does, so the numbers can be checked against it: average residue masses plus one water,
// and ε280 from Pace et al. (1995), Protein Sci 4:2411, of 5500 for each Trp, 1490 for each
// Tyr and 125 for each cystine (a pair of Cys). Also how a protein sequence is printed.
// Pure, so it is unit-tested.

/** Average masses of residues in a chain (the amino acid less a water), in daltons. */
const RESIDUE_MASS: Record<string, number> = {
  A: 71.0788,
  R: 156.1875,
  N: 114.1038,
  D: 115.0886,
  C: 103.1388,
  E: 129.1155,
  Q: 128.1307,
  G: 57.0519,
  H: 137.1411,
  I: 113.1594,
  L: 113.1594,
  K: 128.1741,
  M: 131.1926,
  F: 147.1766,
  P: 97.1167,
  S: 87.0782,
  T: 101.1051,
  W: 186.2132,
  Y: 163.176,
  V: 99.1326
};
const WATER = 18.01524;

const TRP = 5500;
const TYR = 1490;
const CYSTINE = 125;

export interface ProteinProperties {
  /** Residues up to the first stop, which is where the protein ends. */
  residues: number;
  /** The residue a stop takes the place of when it comes before the last codon, else null. */
  earlyStop: number | null;
  /** Residues that aren't one of the twenty (X, from an ambiguous codon). */
  unknown: number;
  /** In daltons; null when a residue is unknown or there are none. */
  mass: number | null;
  trp: number;
  tyr: number;
  cys: number;
  /** ε280 in M⁻¹ cm⁻¹ with every Cys reduced; null when a residue is unknown. */
  reduced: number | null;
  /** ε280 with every pair of Cys a cystine (the same as `reduced` below two Cys). */
  cystines: number | null;
}

/**
 * The protein a translation makes: up to its first stop. `aa` is one letter per codon,
 * as `protein()` gives it, with `*` for a stop.
 */
export function proteinProperties(aa: string): ProteinProperties {
  const upper = aa.toUpperCase();
  const stop = upper.indexOf("*");
  const chain = stop < 0 ? upper : upper.slice(0, stop);
  let mass = WATER;
  let trp = 0;
  let tyr = 0;
  let cys = 0;
  let unknown = 0;
  for (const r of chain) {
    const m = RESIDUE_MASS[r];
    if (m === undefined) {
      unknown++;
      continue;
    }
    mass += m;
    if (r === "W") trp++;
    else if (r === "Y") tyr++;
    else if (r === "C") cys++;
  }
  const known = unknown === 0 && chain.length > 0;
  const reduced = TRP * trp + TYR * tyr;
  return {
    residues: chain.length,
    earlyStop: stop >= 0 && stop < upper.length - 1 ? stop + 1 : null,
    unknown,
    mass: known ? mass : null,
    trp,
    tyr,
    cys,
    reduced: known ? reduced : null,
    cystines: known ? reduced + CYSTINE * Math.floor(cys / 2) : null
  };
}

/** Absorbance at 280 nm of 1 mg/mL (1 g/L) over 1 cm: ε divided by the mass. */
export function absorbance(epsilon: number, mass: number): number {
  return epsilon / mass;
}

/** A mass in daltons as the interface writes it: 26.9 kDa. */
export function kilodaltons(mass: number): string {
  return `${(mass / 1000).toFixed(1)} kDa`;
}

/**
 * A sequence in lines of `perLine` residues, in blocks of ten, each line with the number of
 * its first residue, as protein sequences are printed.
 */
export function residueLines(aa: string, perLine = 60): { first: number; blocks: string[] }[] {
  const lines: { first: number; blocks: string[] }[] = [];
  for (let i = 0; i < aa.length; i += perLine) {
    const line = aa.slice(i, i + perLine);
    const blocks: string[] = [];
    for (let j = 0; j < line.length; j += 10) blocks.push(line.slice(j, j + 10));
    lines.push({ first: i + 1, blocks });
  }
  return lines;
}

/** What to say about a protein's ε280, or null when nothing needs saying. */
export function extinctionNote(p: ProteinProperties): string | null {
  if (p.residues === 0) return null;
  if (p.unknown) return `${p.unknown === 1 ? "A residue is" : `${p.unknown} residues are`} unknown (X), so its mass and ε280 can't be worked out.`;
  if (!p.trp && !p.tyr && !p.cys) return "No Trp, Tyr or Cys, so it can't be measured at 280 nm.";
  if (!p.trp) return "No Trp: ε280 may be off by more than 10%.";
  return null;
}
