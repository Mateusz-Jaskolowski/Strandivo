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
// Written before the versions, each followed by a colon: "exact" for a design whose clones
// must be one of them, "protein" for amino acids. Every version has a name, so a design
// whose first version is named "exact" or "protein" isn't one: that version has one colon.
const FLAGS = ["exact", "protein"] as const;

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
 * Reads a design: `any`, a pattern (`NNK`), or versions as `name:bases|name:bases`, after
 * `protein:` if they are amino acids and `exact:` if clones must be one of them.
 */
export function parseDesign(value: string): VariableDesign {
  const v = value.trim();
  if (!v || v.toLowerCase() === "any") return { kind: "any" };
  let rest = v;
  const flags = new Set<string>();
  for (;;) {
    const bar = rest.indexOf("|");
    const first = bar < 0 ? rest : rest.slice(0, bar);
    const at = first.indexOf(":");
    const word = first.slice(0, at).trim().toLowerCase();
    if (at < 0 || !(FLAGS as readonly string[]).includes(word) || first.indexOf(":", at + 1) < 0) break;
    flags.add(word);
    rest = rest.slice(at + 1);
  }
  if (flags.size) {
    const options = parseVersions(rest, flags.has("protein") ? residues : bases);
    if (options.length) return { kind: "alternatives", ...(flags.has("exact") ? { exact: true } : {}), ...(flags.has("protein") ? { protein: true } : {}), options };
  }
  if (v.includes("|") || v.includes(":")) {
    const options = parseVersions(v, bases);
    if (options.length) return { kind: "alternatives", options };
  }
  const pattern = bases(v);
  return pattern ? { kind: "pattern", pattern } : { kind: "any" };
}

/** How many versions are typed, one per line, and their letters (after each name). */
export function versionStats(text: string): { count: number; letters: number } {
  let count = 0;
  let letters = 0;
  // In one pass, as a list can be a million lines: the line's letters, and those before a colon.
  let line = 0;
  let named = -1;
  let filled = false;
  for (let i = 0; i <= text.length; i++) {
    const c = i < text.length ? text.charCodeAt(i) : 10;
    if (c === 10) {
      if (filled) {
        count++;
        letters += named < 0 ? line : line - named;
      }
      line = 0;
      named = -1;
      filled = false;
    } else {
      if (c > 32) filled = true;
      if (c === 58 && named < 0) named = line;
      else if (((c | 32) >= 97 && (c | 32) <= 122) || c === 42) line++;
    }
  }
  return { count, letters };
}

/**
 * Versions typed one per line as `name: sequence`, DNA bases or amino acids, or a message
 * saying what is wrong with them.
 */
export function versionsFromText(text: string, o: { protein?: boolean; exact?: boolean } = {}): VariableDesign | string {
  const protein = !!o.protein;
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
  return { kind: "alternatives", ...(o.exact ? { exact: true } : {}), ...(protein ? { protein: true } : {}), options };
}

export function formatDesign(d: VariableDesign): string {
  if (d.kind === "any") return "any";
  if (d.kind === "pattern") return d.pattern;
  return (d.exact ? "exact:" : "") + (d.protein ? "protein:" : "") + d.options.map(o => `${o.name}:${o.bases}`).join("|");
}

const designs = new WeakMap<object, VariableDesign | null>();

/**
 * The design in a feature's qualifiers (bio-parsers keeps each as a list), or null. Read
 * once for each set of qualifiers, as a design can hold a million versions.
 */
export function designOf(notes: Record<string, unknown> | undefined): VariableDesign | null {
  if (!notes) return null;
  let design = designs.get(notes);
  if (design === undefined) {
    const raw = notes[VARIABLE_QUALIFIER];
    const value = Array.isArray(raw) ? raw[0] : raw;
    design = value === undefined || value === null ? null : parseDesign(String(value));
    designs.set(notes, design);
  }
  return design;
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
