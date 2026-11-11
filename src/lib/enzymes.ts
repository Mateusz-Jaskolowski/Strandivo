// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Restriction sites, using the enzyme list and site search from TeselaGen's sequence-utils.

import { aliasedEnzymesByName, getCutsitesFromSequence, type RestrictionEnzyme } from "@teselagen/sequence-utils";

export type EnzymeSource = "common" | "lab" | "personal";
export type EnzymeFilter = "unique6" | "unique" | "unique2" | "all";
export const ENZYME_SOURCES: { id: EnzymeSource; label: string }[] = [
  { id: "common", label: "Common enzymes" },
  { id: "lab", label: "Lab enzymes" },
  { id: "personal", label: "My enzymes" }
];
export const ENZYME_FILTERS: { id: EnzymeFilter; label: string }[] = [
  { id: "unique6", label: "Unique 6+ cutters" },
  { id: "unique", label: "Unique cutters" },
  { id: "unique2", label: "Unique and dual cutters" },
  { id: "all", label: "Every site" }
];

export interface EnzymeOptions {
  enzymeSource: EnzymeSource;
  enzymeFilter: EnzymeFilter;
  labEnzymes: readonly string[];
  personalEnzymes: readonly string[];
}

/**
 * Read old combined choices once; new choices and visibility are independent. Whether cut
 * sites show follows the "Restriction sites" setting for newly opened files, as features
 * and primers do; only an old "None" choice still hides them.
 */
export function enzymePreferences(saved: { enzymeSet?: unknown; enzymeSource?: unknown; enzymeFilter?: unknown }, visible = true): Pick<EnzymeOptions, "enzymeSource" | "enzymeFilter"> & { cutsites: boolean } {
  const legacy = saved.enzymeSet;
  const source = legacy === "lab" || legacy === "lab1" || legacy === "lab2" ? "lab" : "common";
  const filter = legacy === "lab" ? "all" : legacy === "lab1" ? "unique" : legacy === "lab2" ? "unique2" : legacy === "unique" || legacy === "unique2" ? legacy : "unique6";
  return {
    enzymeSource: ENZYME_SOURCES.some(s => s.id === saved.enzymeSource) ? saved.enzymeSource as EnzymeSource : source,
    enzymeFilter: ENZYME_FILTERS.some(f => f.id === saved.enzymeFilter) ? saved.enzymeFilter as EnzymeFilter : filter,
    cutsites: legacy === "none" ? false : visible
  };
}

/** Names to offer for this source, preserving the enzyme the user actually chose. */
export function sourceEnzymes(o: Pick<EnzymeOptions, "enzymeSource" | "labEnzymes" | "personalEnzymes">): readonly string[] {
  return o.enzymeSource === "lab" ? o.labEnzymes : o.enzymeSource === "personal" ? o.personalEnzymes : COMMON_ENZYMES;
}

export interface CutSite {
  id: string;
  enzyme: string;
  /** Recognition site, as written for the enzyme (e.g. "gaattc"). */
  site: string;
  /** Recognition site on the sequence (0-based, inclusive; may cross the origin). */
  start: number;
  end: number;
  /** Cut positions as boundaries: the top strand is cut between base cut-1 and cut. */
  cut: number;
  bottomCut: number;
  forward: boolean;
  overhang: string;
  /** Number of times this enzyme cuts the sequence. */
  cuts: number;
}

/** Length of the recognition site without N's (how specific the enzyme is). */
export function specificity(e: RestrictionEnzyme): number {
  return e.site.replace(/n/gi, "").length;
}

/**
 * Commonly used, commercially available enzymes, one name per recognition site and cut
 * (so isoschizomers don't crowd the map).
 */
export const COMMON_ENZYMES = (
  "AatII AccI AclI AfeI AflII AgeI AhdI AleI AlwNI ApaI ApaLI AscI AseI AsiSI AvaI AvrII BamHI BbsI BclI BglI BglII " +
  "BmtI BsaI BsgI BsiWI BsmBI BsmI BspEI BspHI BsrGI BssHII BstBI BstEII BstXI BstZ17I BtgI BtsI Bsu36I ClaI DraI " +
  "DraIII EagI EcoNI EcoO109I EcoRI EcoRV FseI FspI HincII HindIII HpaI KpnI MfeI MluI MscI NaeI NarI NcoI NdeI " +
  "NheI NotI NruI NsiI PacI PciI PflMI PmeI PmlI PspOMI PstI PvuI PvuII SacI SacII SalI SapI SbfI ScaI SfiI SmaI " +
  "SnaBI SpeI SphI SspI StuI SwaI XbaI XhoI XmaI XmnI"
).split(" ");

const ALL_ENZYMES: RestrictionEnzyme[] = COMMON_ENZYMES.flatMap(name => {
  const e = aliasedEnzymesByName[name.toLowerCase()];
  return e ? [{ ...e, name }] : [];
});
const CURATED = new Map(ALL_ENZYMES.map(e => [e.name.toLowerCase(), e]));

/**
 * The name Strandivo uses for any enzyme TeselaGen knows, or null: the curated list's own
 * name where it has one (BsmBI, not Esp3I), else the alias as the user wrote it (Esp3I).
 * Lab stock may hold any of these, so a lab's Acc65I isn't mistaken for KpnI, whose cut differs.
 */
export function enzymeName(name: string): string | null {
  const lower = name.trim().toLowerCase();
  if (!lower) return null;
  const curated = CURATED.get(lower);
  if (curated) return curated.name;
  const e = aliasedEnzymesByName[lower];
  return e ? (e.aliases?.find(a => a.toLowerCase() === lower) ?? e.name) : null;
}

/** Every enzyme name TeselaGen knows, the curated ones first, for choosing a lab's stock. */
export const KNOWN_ENZYMES: readonly string[] = [
  ...COMMON_ENZYMES,
  ...[...new Set(Object.values(aliasedEnzymesByName).flatMap(e => e.aliases?.length ? e.aliases : [e.name]))]
    .filter(n => !CURATED.has(n.toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
];

const extraCache = new Map<string, RestrictionEnzyme[]>();
/** The curated enzymes plus any other known enzyme named in `extra` (a lab's stock). */
function enzymeList(extra: readonly string[]): RestrictionEnzyme[] {
  const names = [...new Set(extra.map(enzymeName).filter((n): n is string => !!n && !CURATED.has(n.toLowerCase())))].sort();
  if (!names.length) return ALL_ENZYMES;
  const key = names.join(" ");
  let list = extraCache.get(key);
  if (!list) {
    list = [...ALL_ENZYMES, ...names.map(name => ({ ...aliasedEnzymesByName[name.toLowerCase()], name }))];
    extraCache.clear();
    extraCache.set(key, list);
  }
  return list;
}

/** The part of `extra` that changes what is scanned, as a cache key. */
export function extraKey(extra: readonly string[]): string {
  const list = enzymeList(extra);
  return list === ALL_ENZYMES ? "" : list.slice(ALL_ENZYMES.length).map(e => e.name).join(" ");
}

/** Where one enzyme recognises and cuts the sequence (before counting and filtering). */
export interface SiteHit {
  enzyme: string;
  site: string;
  start: number;
  end: number;
  cut: number;
  bottomCut: number;
  forward: boolean;
  overhang: string;
}

// Over every known enzyme, so a lab's stock can't outgrow it.
const MAX_SITE = Math.max(...Object.values(aliasedEnzymesByName).map(e => e.site.length));
/** How far from an edit sites are looked for again: longer than any site plus any cut outside it. */
const MARGIN = MAX_SITE + 40;

function search(sequence: string, circular: boolean, enzymes: RestrictionEnzyme[], offset = 0): SiteHit[] {
  let found: ReturnType<typeof getCutsitesFromSequence>;
  try {
    found = getCutsitesFromSequence(sequence, circular, enzymes);
  } catch (e) {
    console.error(e);
    return [];
  }
  const out: SiteHit[] = [];
  for (const list of Object.values(found)) {
    for (const c of list) {
      out.push({
        enzyme: c.restrictionEnzyme?.name || c.name,
        site: c.restrictionEnzyme?.site || "",
        start: (c.recognitionSiteRange?.start ?? c.start) + offset,
        end: (c.recognitionSiteRange?.end ?? c.end) + offset,
        cut: c.topSnipPosition + offset,
        bottomCut: c.bottomSnipPosition + offset,
        forward: c.forward,
        overhang: c.overhangBps || ""
      });
    }
  }
  return out;
}

/** Every site of every enzyme in the curated list, and of any other known enzyme in `extra`. */
export function scanSites(sequence: string, circular: boolean, extra: readonly string[] = []): SiteHit[] {
  return sequence.length ? search(sequence, circular, enzymeList(extra)) : [];
}

/** A site that crosses the origin, or cuts on the other side of it. */
const wraps = (h: SiteHit) => h.start > h.end || Math.abs(h.cut - h.start) > MARGIN || Math.abs(h.bottomCut - h.start) > MARGIN;

/** Lengths of the common start and common end of two strings (not overlapping). */
function commonEnds(a: string, b: string): [number, number] {
  const min = Math.min(a.length, b.length);
  let p = 0;
  while (p < min && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  let s = 0;
  while (s < min - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  return [p, s];
}

/**
 * A site with the sequence turned to start `by` bases later. Cuts keep their distance from
 * the site and, like the search's own results, may be reported as 0…n inclusive.
 */
const turn = (h: SiteHit, by: number, n: number): SiteHit => {
  const m = (x: number) => (((x - by) % n) + n) % n;
  const start = m(h.start);
  const boundary = (x: number) => {
    const v = start + (x - h.start);
    return v > n ? v - n : v < 0 ? v + n : v;
  };
  return { ...h, start, end: m(h.end), cut: boundary(h.cut), bottomCut: boundary(h.bottomCut) };
};

/**
 * Sites after an edit, from the sites before it: only the stretch around the change is
 * searched again, which keeps typing fast in long sequences. On a circular sequence an
 * edit near the origin is handled by turning both sequences so the edit sits in the middle.
 */
export function rescanSites(before: { sequence: string; circular: boolean; hits: SiteHit[] }, sequence: string, circular: boolean, extra: readonly string[] = []): SiteHit[] {
  const a = before.sequence;
  const b = sequence;
  const enzymes = enzymeList(extra);
  if (a === b && circular === before.circular) return before.hits;
  if (circular !== before.circular || !a.length || !b.length) return scanSites(b, circular, extra);
  let [p, s] = commonEnds(a, b);
  if (!circular || (p >= MARGIN && s >= MARGIN)) return updateAround(a, b, p, s, before.hits, circular, enzymes);
  // The unchanged bases run from the end of the change round the origin to its start.
  const unchanged = p + s;
  if (unchanged < 2 * MARGIN) return scanSites(b, true, extra);
  const half = Math.floor(unchanged / 2);
  const byA = (a.length - s + half) % a.length;
  const byB = (b.length - s + half) % b.length;
  const ta = a.slice(byA) + a.slice(0, byA);
  const tb = b.slice(byB) + b.slice(0, byB);
  [p, s] = commonEnds(ta, tb);
  const hits = updateAround(ta, tb, p, s, before.hits.map(h => turn(h, byA, a.length)), true, enzymes);
  return hits.map(h => turn(h, -byB, b.length));
}

function updateAround(a: string, b: string, p: number, s: number, hits: SiteHit[], circular: boolean, enzymes: RestrictionEnzyme[]): SiteHit[] {
  const delta = b.length - a.length;
  const oldEnd = a.length - s; // the change was [p, oldEnd) and is now [p, newEnd)
  const newEnd = b.length - s;
  // A site depends on its recognition bases and on the bases between its cuts (the overhang).
  const lo = (h: SiteHit) => Math.min(h.start, h.cut, h.bottomCut);
  const hi = (h: SiteHit) => Math.max(h.end, h.cut - 1, h.bottomCut - 1);
  const moved = (h: SiteHit, f: (x: number) => number) => ({ ...h, start: f(h.start), end: f(h.end), cut: f(h.cut), bottomCut: f(h.bottomCut) });
  const kept: SiteHit[] = [];
  for (const h of hits) {
    if (circular && wraps(h)) {
      // Across the origin: at least MARGIN bases from the change on both sides.
      kept.push(moved(h, x => (x >= oldEnd ? x + delta : x)));
    } else if (hi(h) < p) kept.push(h);
    else if (lo(h) >= oldEnd) kept.push(moved(h, x => x + delta));
  }
  const from = Math.max(0, p - MARGIN);
  const to = Math.min(b.length, newEnd + MARGIN);
  // On a linear sequence a window that reaches either end is searched just like the whole.
  const fresh = search(b.slice(from, to), false, enzymes, from).filter(h => !(hi(h) < p || lo(h) >= newEnd));
  return [...kept, ...fresh];
}

/**
 * Sites from the chosen list, filtered by their total cut counts and sorted by position.
 * Membership preserves chosen names, so a personal Esp3I does not add BsmBI labels.
 */
export function selectSites(hits: SiteHit[], o: EnzymeOptions): CutSite[] {
  const names = new Set(sourceEnzymes(o).map(enzymeName));
  const maxCuts = o.enzymeFilter === "all" ? Infinity : o.enzymeFilter === "unique2" ? 2 : 1;
  const minSpecificity = o.enzymeFilter === "unique6" ? 6 : 0;
  const counts = new Map<string, number>();
  for (const h of hits) counts.set(h.enzyme, (counts.get(h.enzyme) ?? 0) + 1);
  const out: CutSite[] = [];
  for (const h of hits) {
    const cuts = counts.get(h.enzyme)!;
    const e = aliasedEnzymesByName[h.enzyme.toLowerCase()];
    if (!names.has(h.enzyme) || cuts > maxCuts || (e ? specificity(e) : 0) < minSpecificity) continue;
    // Stable ids, so a selected site stays selected when the sites are recomputed.
    out.push({ id: `${h.enzyme}@${h.start}`, ...h, cuts });
  }
  out.sort((x, y) => x.cut - y.cut || x.enzyme.localeCompare(y.enzyme));
  return out;
}

/** An enzyme's recognition site in upper case ("GGTCTC" for BsaI), or "" if TeselaGen doesn't know it. */
export function enzymeSite(name: string): string {
  return aliasedEnzymesByName[name.trim().toLowerCase()]?.site.toUpperCase() ?? "";
}

/** Enzymes whose site can be added to a primer as written (no N or other ambiguity codes). */
export const TAIL_ENZYMES: { name: string; site: string }[] = ALL_ENZYMES.filter(e => /^[acgt]{6,}$/i.test(e.site))
  .map(e => ({ name: e.name, site: e.site.toUpperCase() }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** How many times each named enzyme cuts a sequence. */
export function cutCounts(sequence: string, circular: boolean, names: string[]): Map<string, number> {
  const out = new Map(names.map(n => [n, 0]));
  if (!names.length || !sequence.length) return out;
  for (const h of scanSites(sequence, circular, names)) if (out.has(h.enzyme)) out.set(h.enzyme, out.get(h.enzyme)! + 1);
  return out;
}

/** Cut sites of the chosen enzymes, sorted by position. */
export function findCutSites(sequence: string, circular: boolean, o: EnzymeOptions): CutSite[] {
  return selectSites(scanSites(sequence, circular, sourceEnzymes(o)), o);
}

/** Reaction choices honour membership, but already chosen enzymes always remain available. */
export function reactionEnzymes(counts: ReadonlyMap<string, number>, members: readonly string[], selected: readonly string[], maxCuts = Infinity, query = ""): string[] {
  const q = query.trim().toLowerCase();
  return [...new Set([...selected, ...members])]
    .filter(name => selected.includes(name) || ((counts.get(name) ?? 0) > 0 && counts.get(name)! <= maxCuts && (!q || name.toLowerCase().includes(q))))
    .sort((a, b) => Number(selected.includes(b)) - Number(selected.includes(a)) || a.localeCompare(b));
}

/** "5′ overhang AATT", "blunt", … */
export function overhangText(c: CutSite): string {
  if (!c.overhang) return "Blunt end";
  // Cut positions are on top-strand coordinates whichever way the site points.
  const five = c.cut < c.bottomCut;
  return `${five ? "5′" : "3′"} overhang ${c.overhang.toUpperCase()}`;
}
