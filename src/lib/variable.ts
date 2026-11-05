// Variable regions: features a library replaces or varies (CDRs, NNK sites, a framework
// with a few known versions), marked in the file as /strandivo_variable="<design>". Reads
// are aligned with them as N, so their edges come out right, and a clone's bases there are
// its contents, not mutations. Pure, so it is unit-tested.

import { featureContains } from "./genetics.ts";
import type { Difference, Feature, VariableDesign } from "./types.ts";

/** The GenBank qualifier that marks a feature as variable; its value is the design. */
export const VARIABLE_QUALIFIER = "strandivo_variable";

const bases = (s: string) => s.toUpperCase().replace(/U/g, "T").replace(/[^ACGTRYSWKMBDHVN]/g, "");

/**
 * Reads a design: `any`, a pattern (`NNK`), or versions as `name:bases|name:bases` (a
 * version without a name is numbered).
 */
export function parseDesign(value: string): VariableDesign {
  const v = value.trim();
  if (!v || v.toLowerCase() === "any") return { kind: "any" };
  if (v.includes("|") || v.includes(":")) {
    const options = v
      .split("|")
      .map(s => s.trim())
      .filter(Boolean)
      .map((s, i) => {
        const at = s.indexOf(":");
        return at < 0 ? { name: String(i + 1), bases: bases(s) } : { name: s.slice(0, at).trim() || String(i + 1), bases: bases(s.slice(at + 1)) };
      })
      .filter(o => o.bases);
    if (options.length) return { kind: "alternatives", options };
  }
  const pattern = bases(v);
  return pattern ? { kind: "pattern", pattern } : { kind: "any" };
}

export function formatDesign(d: VariableDesign): string {
  if (d.kind === "any") return "any";
  if (d.kind === "pattern") return d.pattern;
  return d.options.map(o => `${o.name}:${o.bases}`).join("|");
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
