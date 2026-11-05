// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What a plate of clones says as a library: how many are different, how many are broken,
// how fast mutations came in, which ones recur and which codons turned up at degenerate
// sites. Worked out from each clone's `CloneVariants`. Pure, so it is unit-tested.
//
// Mixed clones and clones no read aligned to tell nothing about one plasmid, so they are
// only counted as such. Identical clones count once wherever one event shouldn't count
// many times (recurring mutations, transitions and transversions, codons); the mutation
// rate and the share of broken clones count them all, or a plate of unchanged clones
// would count as one clone and the rate would look high.

import { featurePositions, translateCodon } from "./genetics.ts";
import { degenerateCodons, type CloneVariants, type Mutation } from "./variants.ts";
import type { Feature } from "./types.ts";
import { variableFeatures } from "./variable.ts";

export interface SummaryClone {
  name: string;
  variants: CloneVariants;
}

/** One mutation at a site. */
export interface SiteMutation {
  label: string;
  feature: string | null;
  kind: Mutation["kind"];
  /** Different clones that have it. */
  different: number;
  /** All the clones that have it, identical ones too. */
  clones: string[];
}

/** A reference position with mutations. */
export interface RecurringSite {
  refPos: number;
  mutations: SiteMutation[];
  /** Different clones changed here. */
  different: number;
  /** Different clones that read this position: the rest can't say. */
  read: number;
}

/** What clones have at a codon the design lets vary. */
export interface CodonSite {
  region: string;
  /** Number of the codon in its CDS, from 1. */
  number: number;
  refPos: number;
  pattern: string;
  /** Codons the pattern allows. */
  allowed: number;
  /** Different clones with this codon read for certain. */
  read: number;
  /** Allowed codons seen, most clones first. */
  seen: { codon: string; aminoAcid: string; clones: number }[];
  /** Clones with a codon the pattern doesn't allow. */
  outside: number;
  /** Codons `read` clones would show if the library gives each allowed codon equally. */
  expected: number;
}

export interface CloneSummary {
  /** Every clone, including those that don't count. */
  total: number;
  unaligned: number;
  mixed: number;
  /** Aligned and not mixed: what everything below is about. */
  counted: number;
  different: number;
  /** Counted clones with a stop or a frameshift. */
  broken: number;
  /** Changes in counted clones, and the bases they could have been in. */
  changes: number;
  bases: number;
  /** Substitutions in different clones. */
  transitions: number;
  transversions: number;
  sites: RecurringSite[];
  codons: CodonSite[];
}

/** Whether one base for another is a transition, or null if either isn't a plain base. */
function isTransition(from: string, to: string): boolean | null {
  const a = from.toUpperCase();
  const b = to.toUpperCase();
  if (a === b || !/^[ACGT]$/.test(a) || !/^[ACGT]$/.test(b)) return null;
  return "AG".includes(a) === "AG".includes(b);
}

/** Positions a clone's calls can be trusted at. */
function readMask(v: CloneVariants, n: number): Uint8Array {
  const mask = new Uint8Array(n);
  for (const r of v.covered) {
    if (r.start <= r.end) mask.fill(1, r.start, r.end + 1);
    else {
      mask.fill(1, r.start, n);
      mask.fill(1, 0, r.end + 1);
    }
  }
  for (const p of v.unreliable) mask[p] = 0;
  return mask;
}

export function cloneSummary(clones: SummaryClone[], reference: string, features: Feature[]): CloneSummary {
  const n = reference.length;
  const annotated = features.filter(f => (f.type || "").toLowerCase() !== "source");
  const regions = [...variableFeatures(annotated)].sort((a, b) => a.start - b.start);
  const counted = clones.filter(c => !c.variants.flags.includes("unaligned") && !c.variants.flags.includes("mixed"));
  const byKey = new Map<string, SummaryClone[]>();
  for (const c of counted) byKey.set(c.variants.key, [...(byKey.get(c.variants.key) ?? []), c]);
  const groups = [...byKey.values()];

  // Bases that could show a change: read, and not in a region meant to vary.
  const varying = new Uint8Array(n);
  for (const f of regions) for (const p of featurePositions(f, n)) varying[p] = 1;
  let bases = 0;
  const masks = new Map<SummaryClone, Uint8Array>();
  for (const c of counted) {
    const mask = readMask(c.variants, n);
    masks.set(c, mask);
    for (let p = 0; p < n; p++) if (mask[p] && !varying[p]) bases++;
  }

  let transitions = 0;
  let transversions = 0;
  const bySite = new Map<number, RecurringSite>();
  for (const group of groups) {
    const { variants: v } = group[0];
    for (const d of v.changes) {
      if (d.kind !== "substitution") continue;
      for (let i = 0; i < d.refBases.length; i++) {
        const t = isTransition(d.refBases[i], d.readBases[i] ?? "");
        if (t === true) transitions++;
        else if (t === false) transversions++;
      }
    }
    const names = group.map(c => c.name);
    for (const m of v.mutations) {
      let site = bySite.get(m.refPos);
      if (!site) bySite.set(m.refPos, (site = { refPos: m.refPos, mutations: [], different: 0, read: 0 }));
      const same = site.mutations.find(x => x.label === m.label && x.feature === m.feature);
      if (same) {
        same.different++;
        same.clones.push(...names);
      } else site.mutations.push({ label: m.label, feature: m.feature, kind: m.kind, different: 1, clones: [...names] });
    }
    for (const site of new Set(v.mutations.map(m => m.refPos))) bySite.get(site)!.different++;
  }
  const sites = [...bySite.values()].sort((a, b) => a.refPos - b.refPos);
  // A group's clones may read different parts: any of them reading a position will do.
  for (const site of sites) site.read = groups.filter(g => g.some(c => masks.get(c)![site.refPos])).length;

  return {
    total: clones.length,
    unaligned: clones.filter(c => c.variants.flags.includes("unaligned")).length,
    mixed: clones.filter(c => c.variants.flags.includes("mixed")).length,
    counted: counted.length,
    different: groups.length,
    broken: counted.filter(c => c.variants.flags.some(f => f === "stop" || f === "frameshift")).length,
    changes: counted.reduce((s, c) => s + c.variants.changes.length, 0),
    bases,
    transitions,
    transversions,
    sites,
    codons: regions.flatMap((f, k) => codonSites(f, k, groups, reference, annotated))
  };
}

function codonSites(f: Feature, index: number, groups: SummaryClone[][], reference: string, features: Feature[]): CodonSite[] {
  const length = featurePositions(f, reference.length).length;
  return degenerateCodons(f, reference, features).map(c => {
    const counts = new Map<string, number>();
    let read = 0;
    let outside = 0;
    for (const group of groups) {
      // Only a region of its designed length lines up with the design's codons.
      const call = group.map(x => x.variants.regions[index]).find(r => r?.read === "all" && r.bases.length === length);
      const codon = call?.bases.slice(c.at, c.at + 3);
      if (!codon || codon !== codon.toUpperCase()) continue;
      read++;
      if (c.allowed.includes(codon)) counts.set(codon, (counts.get(codon) ?? 0) + 1);
      else outside++;
    }
    const allowed = c.allowed.length;
    return {
      region: f.name || f.type || "Region",
      number: c.number,
      refPos: c.refPos,
      pattern: c.pattern,
      allowed,
      read,
      seen: [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([codon, clones]) => ({ codon, aminoAcid: translateCodon(codon), clones })),
      outside,
      expected: allowed * (1 - Math.pow(1 - 1 / allowed, read))
    };
  });
}

/** Mutations per kb of bases read, or null with nothing read. */
export const mutationRate = (s: CloneSummary): number | null => (s.bases ? (s.changes / s.bases) * 1000 : null);

/**
 * Sites along the whole sequence (`feature` null) or along a CDS, by codon. `at` counts
 * from 0, and sites outside the CDS are left out.
 */
export function sitesAlong(sites: RecurringSite[], feature: Feature | null, n: number): { length: number; points: { at: number; site: RecurringSite }[] } {
  if (!feature) return { length: n, points: sites.map(site => ({ at: site.refPos, site })) };
  const positions = featurePositions(feature, n);
  const index = new Map(positions.map((p, i) => [p, i]));
  const points = sites.flatMap(site => {
    const i = index.get(site.refPos);
    return i === undefined ? [] : [{ at: Math.floor(i / 3), site }];
  });
  return { length: Math.floor(positions.length / 3), points: points.sort((a, b) => a.at - b.at) };
}

const share = (part: number, whole: number) => `${part} of ${whole}${whole ? ` (${Math.round((part / whole) * 100)}%)` : ""}`;

/** Mutations recurring in two different clones or more first, then by position. */
export function byRecurrence(sites: RecurringSite[]): { site: RecurringSite; mutation: SiteMutation }[] {
  return sites
    .flatMap(site => site.mutations.map(mutation => ({ site, mutation })))
    .sort((a, b) => b.site.different - a.site.different || b.mutation.different - a.mutation.different || a.site.refPos - b.site.refPos);
}

export const mutationName = (m: SiteMutation) => (m.feature && m.kind !== "dna" ? `${m.feature} ${m.label}` : m.feature ? `${m.label} (${m.feature})` : m.label);

/** The summary as text for a lab notebook. */
export function summaryText(s: CloneSummary, name: string, date: string): string {
  const left = [s.mixed ? `${s.mixed} mixed` : "", s.unaligned ? `${s.unaligned} not aligned` : ""].filter(Boolean).join(", ");
  const rate = mutationRate(s);
  const lines = [
    `Clones of ${name}, ${date}`,
    `Clones: ${s.total}${left ? ` (${left}, left out below)` : ""}`,
    `Different clones: ${share(s.different, s.counted)}`,
    `Stops or frameshifts: ${share(s.broken, s.counted)}`,
    `Mutations: ${rate === null ? "nothing read" : `${rate.toFixed(2)} per kb (${s.changes} in ${(s.bases / 1000).toFixed(1)} kb read, outside variable regions)`}`,
    `Transitions / transversions: ${s.transitions} / ${s.transversions}`
  ];
  const recurring = byRecurrence(s.sites);
  if (recurring.length) {
    lines.push("", "Mutations (different clones of those that read the position):");
    for (const { site, mutation: m } of recurring) lines.push(`${mutationName(m)}: ${m.different} of ${site.read} (${m.clones.join(", ")})`);
  }
  if (s.codons.length) {
    lines.push("", "Degenerate codons:");
    for (const c of s.codons) {
      const seen = c.seen.map(x => `${x.codon} ${x.aminoAcid} ${x.clones}`).join(", ");
      lines.push(`${c.region} codon ${c.number} (${c.pattern}): ${c.seen.length} of ${c.allowed} seen in ${c.read} clones, ${c.expected.toFixed(1)} expected${c.outside ? `, ${c.outside} outside the design` : ""}${seen ? `; ${seen}` : ""}`);
    }
  }
  return lines.join("\n");
}
