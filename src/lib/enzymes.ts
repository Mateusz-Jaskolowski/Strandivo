// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Restriction sites, using the enzyme list and site search from TeselaGen's sequence-utils.

import { aliasedEnzymesByName, getCutsitesFromSequence, type RestrictionEnzyme } from "@teselagen/sequence-utils";

export type EnzymeSet = "unique6" | "unique" | "unique2" | "none";

export const ENZYME_SETS: { id: EnzymeSet; label: string }[] = [
  { id: "unique6", label: "Unique 6+ cutters" },
  { id: "unique", label: "Unique cutters" },
  { id: "unique2", label: "Unique and dual cutters" },
  { id: "none", label: "None" }
];

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

const MAX_SITE = Math.max(...ALL_ENZYMES.map(e => e.site.length));
/** How far from an edit sites are looked for again: longer than any site plus any cut outside it. */
const MARGIN = MAX_SITE + 40;

function search(sequence: string, circular: boolean, offset = 0): SiteHit[] {
  let found: ReturnType<typeof getCutsitesFromSequence>;
  try {
    found = getCutsitesFromSequence(sequence, circular, ALL_ENZYMES);
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

/** Every site of every enzyme in the list. */
export function scanSites(sequence: string, circular: boolean): SiteHit[] {
  return sequence.length ? search(sequence, circular) : [];
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
export function rescanSites(before: { sequence: string; circular: boolean; hits: SiteHit[] }, sequence: string, circular: boolean): SiteHit[] {
  const a = before.sequence;
  const b = sequence;
  if (a === b && circular === before.circular) return before.hits;
  if (circular !== before.circular || !a.length || !b.length) return scanSites(b, circular);
  let [p, s] = commonEnds(a, b);
  if (!circular || (p >= MARGIN && s >= MARGIN)) return updateAround(a, b, p, s, before.hits, circular);
  // The unchanged bases run from the end of the change round the origin to its start.
  const unchanged = p + s;
  if (unchanged < 2 * MARGIN) return scanSites(b, true);
  const half = Math.floor(unchanged / 2);
  const byA = (a.length - s + half) % a.length;
  const byB = (b.length - s + half) % b.length;
  const ta = a.slice(byA) + a.slice(0, byA);
  const tb = b.slice(byB) + b.slice(0, byB);
  [p, s] = commonEnds(ta, tb);
  const hits = updateAround(ta, tb, p, s, before.hits.map(h => turn(h, byA, a.length)), true);
  return hits.map(h => turn(h, -byB, b.length));
}

function updateAround(a: string, b: string, p: number, s: number, hits: SiteHit[], circular: boolean): SiteHit[] {
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
  const fresh = search(b.slice(from, to), false, from).filter(h => !(hi(h) < p || lo(h) >= newEnd));
  return [...kept, ...fresh];
}

/** The sites shown for an enzyme set, with how often each enzyme cuts, sorted by position. */
export function selectSites(hits: SiteHit[], set: EnzymeSet): CutSite[] {
  if (set === "none") return [];
  const maxCuts = set === "unique2" ? 2 : 1;
  const minSpecificity = set === "unique6" ? 6 : 0;
  const counts = new Map<string, number>();
  for (const h of hits) counts.set(h.enzyme, (counts.get(h.enzyme) ?? 0) + 1);
  const out: CutSite[] = [];
  for (const h of hits) {
    const cuts = counts.get(h.enzyme)!;
    if (cuts > maxCuts || (SPECIFICITY.get(h.enzyme) ?? 0) < minSpecificity) continue;
    // Stable ids, so a selected site stays selected when the sites are recomputed.
    out.push({ id: `${h.enzyme}@${h.start}`, ...h, cuts });
  }
  out.sort((x, y) => x.cut - y.cut || x.enzyme.localeCompare(y.enzyme));
  return out;
}

const SPECIFICITY = new Map(ALL_ENZYMES.map(e => [e.name, specificity(e)]));

/** An enzyme's recognition site in upper case ("GGTCTC" for BsaI), or "" if it isn't in the list. */
export function enzymeSite(name: string): string {
  return ALL_ENZYMES.find(e => e.name === name)?.site.toUpperCase() ?? "";
}

/** Enzymes whose site can be added to a primer as written (no N or other ambiguity codes). */
export const TAIL_ENZYMES: { name: string; site: string }[] = ALL_ENZYMES.filter(e => /^[acgt]{6,}$/i.test(e.site))
  .map(e => ({ name: e.name, site: e.site.toUpperCase() }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** How many times each named enzyme cuts a sequence. */
export function cutCounts(sequence: string, circular: boolean, names: string[]): Map<string, number> {
  const out = new Map(names.map(n => [n, 0]));
  if (!names.length || !sequence.length) return out;
  for (const h of scanSites(sequence, circular)) if (out.has(h.enzyme)) out.set(h.enzyme, out.get(h.enzyme)! + 1);
  return out;
}

/** Cut sites of the enzymes in a set, sorted by position. */
export function findCutSites(sequence: string, circular: boolean, set: EnzymeSet): CutSite[] {
  return set === "none" ? [] : selectSites(scanSites(sequence, circular), set);
}

/** "5′ overhang AATT", "blunt", … */
export function overhangText(c: CutSite): string {
  if (!c.overhang) return "Blunt end";
  // Cut positions are on top-strand coordinates whichever way the site points.
  const five = c.cut < c.bottomCut;
  return `${five ? "5′" : "3′"} overhang ${c.overhang.toUpperCase()}`;
}
