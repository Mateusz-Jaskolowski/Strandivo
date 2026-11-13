// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Variable regions: features a library replaces or varies (CDRs, NNK sites, a framework
// with a few known versions), marked in the file as /strandivo_variable="<design>". Reads
// are aligned with them as N, so their edges come out right, and a clone's bases there are
// its contents, not mutations. Pure, so it is unit-tested.

import { featureContains } from "./genetics.ts";
import type { Difference, Feature, VariableDesign } from "./types.ts";

/** The GenBank qualifier that marks a feature as variable; its value is the design. */
export const VARIABLE_QUALIFIER = "strandivo_variable";

const bases = (s: string) => s.toUpperCase().replace(/U/g, "T").replace(/[^ACGTRYSWKMBDHVN]/g, "");
const residues = (s: string) => s.toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWYX*]/g, "");
// Written before a protein design's versions, each with a name. A DNA design whose first
// version is named "protein" isn't one: that version has only one colon.
const PROTEIN = "protein:";

/** Versions as `name:sequence|name:sequence`; a version without a name is numbered. */
function parseVersions(value: string, clean: (s: string) => string): { name: string; bases: string }[] {
  return value
    .split("|")
    .map(s => s.trim())
    .filter(Boolean)
    .map((s, i) => {
      const at = s.indexOf(":");
      return at < 0 ? { name: String(i + 1), bases: clean(s) } : { name: s.slice(0, at).trim() || String(i + 1), bases: clean(s.slice(at + 1)) };
    })
    .filter(o => o.bases);
}

/**
 * Reads a design: `any`, a pattern (`NNK`), versions as `name:bases|name:bases`, or
 * protein versions as `protein:name:residues|name:residues`.
 */
export function parseDesign(value: string): VariableDesign {
  const v = value.trim();
  if (!v || v.toLowerCase() === "any") return { kind: "any" };
  if (v.toLowerCase().startsWith(PROTEIN) && v.split("|")[0].split(":").length > 2) {
    const options = parseVersions(v.slice(PROTEIN.length), residues);
    if (options.length) return { kind: "alternatives", protein: true, options };
  }
  if (v.includes("|") || v.includes(":")) {
    const options = parseVersions(v, bases);
    if (options.length) return { kind: "alternatives", options };
  }
  const pattern = bases(v);
  return pattern ? { kind: "pattern", pattern } : { kind: "any" };
}

/**
 * Versions typed one per line as `name: sequence`, DNA bases or amino acids, or a message
 * saying what is wrong with them.
 */
export function versionsFromText(text: string, protein: boolean): VariableDesign | string {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) return protein ? "Enter versions as name: amino acids, one per line." : "Enter versions as name: DNA bases, one per line.";
  // Spaces and numbers, as in a pasted GenBank sequence, are left out.
  const stray = protein ? /[^ACDEFGHIKLMNPQRSTVWYX*\s\d]/i : /[^ACGTURYSWKMBDHVN\s\d]/i;
  for (const [i, line] of lines.entries()) {
    const at = line.indexOf(":");
    const name = at < 0 ? String(i + 1) : line.slice(0, at).trim() || String(i + 1);
    const sequence = at < 0 ? line : line.slice(at + 1);
    if (name.includes("|")) return "Version names can’t include “|”.";
    if (!(protein ? residues : bases)(sequence)) return `Version ${name} has no sequence.`;
    if (stray.test(sequence)) {
      return protein
        ? `Version ${name} has letters that aren’t amino acids.`
        : /[EFILPQ*]/i.test(sequence)
          ? `Version ${name} looks like amino acids, not DNA bases.`
          : `Version ${name} has letters that aren’t DNA bases.`;
    }
  }
  const options = parseVersions(lines.join("|"), protein ? residues : bases);
  return protein ? { kind: "alternatives", protein: true, options } : { kind: "alternatives", options };
}

export function formatDesign(d: VariableDesign): string {
  if (d.kind === "any") return "any";
  if (d.kind === "pattern") return d.pattern;
  return (d.protein ? PROTEIN : "") + d.options.map(o => `${o.name}:${o.bases}`).join("|");
}

/** The design in a feature's qualifiers (bio-parsers keeps each as a list), or null. */
export function designOf(notes: Record<string, unknown> | undefined): VariableDesign | null {
  const raw = notes?.[VARIABLE_QUALIFIER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value === null ? null : parseDesign(String(value));
}

export const variableFeatures = (features: Feature[]) => features.filter(f => f.variable);

/** The variable regions as half-open ranges that never wrap, for the core. */
export function variableRanges(features: Feature[], n: number): [number, number][] {
  const out: [number, number][] = [];
  for (const f of variableFeatures(features)) {
    for (const r of f.locations?.length ? f.locations : [{ start: f.start, end: f.end }]) {
      if (r.start <= r.end) out.push([r.start, r.end + 1]);
      else out.push([r.start, n], [0, r.end + 1]);
    }
  }
  return out;
}

/** Whether a difference is in a variable region; bases inserted right before or after one count. */
export function inVariable(d: Difference, regions: Feature[], n: number): boolean {
  if (!regions.length || !n) return false;
  const probe =
    d.kind === "insertion"
      ? [d.refPos % n, (d.refPos - 1 + n) % n]
      : Array.from({ length: Math.max(1, d.refBases.length) }, (_, i) => (d.refPos + i) % n);
  return regions.some(f => probe.some(p => featureContains(f, n, p)));
}

/** Sets apart the differences in variable regions. */
export function splitVariable<T extends Difference>(diffs: T[], regions: Feature[], n: number): { differences: T[]; variable: T[] } {
  const differences: T[] = [];
  const variable: T[] = [];
  for (const d of diffs) (inVariable(d, regions, n) ? variable : differences).push(d);
  return { differences, variable };
}
