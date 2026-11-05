// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Amino acids coloured by their chemistry, as in Clustal X (simplified: Clustal's rules
// that depend on the rest of an alignment column don't apply to a single sequence).

export type AminoGroup = "hydrophobic" | "positive" | "negative" | "polar" | "cysteine" | "glycine" | "proline" | "aromatic" | "stop";

const GROUPS: Record<string, AminoGroup> = {
  A: "hydrophobic",
  I: "hydrophobic",
  L: "hydrophobic",
  M: "hydrophobic",
  F: "hydrophobic",
  W: "hydrophobic",
  V: "hydrophobic",
  K: "positive",
  R: "positive",
  D: "negative",
  E: "negative",
  N: "polar",
  Q: "polar",
  S: "polar",
  T: "polar",
  C: "cysteine",
  G: "glycine",
  P: "proline",
  H: "aromatic",
  Y: "aromatic",
  "*": "stop"
};

/** The group of a one-letter amino acid, or null for unknown ones (X). */
export const aminoGroup = (aa: string): AminoGroup | null => GROUPS[aa.toUpperCase()] ?? null;
