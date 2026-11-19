// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// E. coli strains a plasmid is grown in, as the Info tab's "Host / strain" field names them:
// whether they methylate GATC (Dam) and CCWGG (Dcm), which decides whether some restriction
// sites cut (src/lib/methylation.ts), and whether they read TAG as glutamine.

/** The Info tab's field that names the strain, saved in the file with the other lab fields. */
export const HOST_FIELD = "Host / strain";

export interface Strain {
  /** As the field's suggestions write it. */
  name: string;
  /** Other ways of writing it, compared as `strainKey` leaves them. */
  aliases: string[];
  dam: boolean;
  dcm: boolean;
  /**
   * An amber suppressor (supE44, also written glnV44): it reads TAG as glutamine. Only
   * mentioned beside the field: it says where the DNA was grown, not where a protein is made.
   */
  amber: boolean;
}

/**
 * Common cloning and expression strains, from their published genotypes. B strains such as
 * BL21 lack Dcm; JM110, SCS110 and NEB's dam−/dcm− strain lack both, which is what they are for.
 */
export const STRAINS: readonly Strain[] = [
  { name: "DH5α", aliases: ["dh5a", "dh5alpha"], dam: true, dcm: true, amber: true },
  { name: "NEB 5-alpha", aliases: ["neb5alpha", "neb5α"], dam: true, dcm: true, amber: true },
  { name: "TOP10", aliases: ["top10", "oneshottop10"], dam: true, dcm: true, amber: false },
  { name: "DH10B", aliases: ["dh10b"], dam: true, dcm: true, amber: false },
  { name: "NEB 10-beta", aliases: ["neb10beta", "neb10β"], dam: true, dcm: true, amber: false },
  { name: "XL1-Blue", aliases: ["xl1blue"], dam: true, dcm: true, amber: true },
  { name: "JM109", aliases: ["jm109"], dam: true, dcm: true, amber: true },
  { name: "TG1", aliases: ["tg1"], dam: true, dcm: true, amber: true },
  { name: "Stbl3", aliases: ["stbl3"], dam: true, dcm: true, amber: true },
  { name: "BL21(DE3)", aliases: ["bl21de3"], dam: true, dcm: false, amber: false },
  { name: "BL21", aliases: ["bl21"], dam: true, dcm: false, amber: false },
  { name: "JM110", aliases: ["jm110"], dam: false, dcm: false, amber: true },
  { name: "SCS110", aliases: ["scs110"], dam: false, dcm: false, amber: true },
  { name: "NEB dam−/dcm−", aliases: ["nebdamdcm", "damdcm", "c2925"], dam: false, dcm: false, amber: true }
];

/** A strain's name as compared: lower case, Greek letters spelt out, no spaces, dashes, brackets or "E. coli". */
export function strainKey(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/^e\.?\s*coli\s+/, "")
    .replace(/α/g, "alpha")
    .replace(/β/g, "beta")
    .replace(/[\s\-–−_().,/⁻]+/g, "");
}

const BY_KEY = new Map(STRAINS.flatMap(s => [strainKey(s.name), ...s.aliases.map(strainKey)].map(k => [k, s] as const)));

/** The known strain the field names, whatever its case or spacing, or null. */
export function findStrain(text: string): Strain | null {
  return BY_KEY.get(strainKey(text)) ?? null;
}
