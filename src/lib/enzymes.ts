// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Restriction sites: the enzymes REBASE lists as sold (src/lib/rebaseEnzymes.ts, built by
// tools/build-enzymes.mjs), found with the site search from TeselaGen's sequence-utils.

import { getCutsitesFromSequence, type RestrictionEnzyme } from "@teselagen/sequence-utils";
import { REBASE_ENZYMES, SUPPLIERS } from "./rebaseEnzymes.ts";
import { siteMethylation, type DnaMethylation, type SiteMethylation } from "./methylation.ts";

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
  /**
   * Where the DNA was grown, for Dam and Dcm methylation (`hostMethylation` in
   * src/lib/methylation.ts). Left out, no site is predicted blocked.
   */
  methylation?: DnaMethylation;
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
  /** Number of times this enzyme is predicted to cut the sequence: its sites less those methylation blocks. */
  cuts: number;
  /** Number of its sites, cut or not. */
  sites: number;
  /** What Dam or Dcm methylation does to this site, when it does anything worth saying. */
  methylation?: SiteMethylation;
}

/** An enzyme REBASE lists as sold, in the form the site search takes. */
interface Enzyme extends RestrictionEnzyme {
  /** Its cut as REBASE writes it: "G^AATTC", "GGTCTC(1/5)", "(10/12)CGANNNNNNTGC(12/10)". */
  notation: string;
  /** Also cuts before its site (BcgI); only the cut after it is searched for. */
  bothSides: boolean;
  /** REBASE's codes for the companies that sell it. */
  suppliers: string;
}

const BASES: Record<string, string> = { a: "a", c: "c", g: "g", t: "t", r: "ag", y: "ct", s: "cg", w: "at", k: "gt", m: "ac", b: "cgt", d: "agt", h: "act", v: "acg", n: "acgt" };
const COMPLEMENT: Record<string, string> = { a: "t", c: "g", g: "c", t: "a", r: "y", y: "r", s: "s", w: "w", k: "m", m: "k", b: "v", v: "b", d: "h", h: "d", n: "n" };
/**
 * What each letter of a site matches in a sequence: every code standing for some of its
 * bases, as TeselaGen's own list had it (R matches A, G and R; N matches any letter).
 */
const MATCHES: Record<string, string> = Object.fromEntries(
  Object.entries(BASES).map(([code, bases]) => {
    const letters = Object.keys(BASES).filter(l => [...BASES[l]].every(b => bases.includes(b))).sort().join("");
    return [code, letters.length === 1 ? letters : `[${letters}]`];
  })
);
const pattern = (site: string) => [...site].map(c => MATCHES[c]).join("");

const ENZYMES = new Map<string, Enzyme>(
  REBASE_ENZYMES.trim().split("\n").map(line => {
    const [name, notation, written, top, bottom, bothSides, suppliers] = line.split("\t");
    const site = written.toLowerCase();
    const reverse = [...site].reverse().map(c => COMPLEMENT[c]).join("");
    const e: Enzyme = { name, site, forwardRegex: pattern(site), reverseRegex: pattern(reverse), topSnipOffset: Number(top), bottomSnipOffset: Number(bottom), notation, bothSides: bothSides === "1", suppliers };
    return [name.toLowerCase(), e];
  })
);
const known = (name: string) => ENZYMES.get(name.trim().toLowerCase());

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

const ALL_ENZYMES: Enzyme[] = COMMON_ENZYMES.map(name => ENZYMES.get(name.toLowerCase())!);
const CURATED = new Set(COMMON_ENZYMES.map(n => n.toLowerCase()));

/**
 * The name Strandivo uses for an enzyme REBASE lists as sold, written as REBASE writes it,
 * or null. Isoschizomers keep their own names (Esp3I is not BsmBI), so a lab's Acc65I
 * isn't mistaken for KpnI, whose cut differs.
 */
export function enzymeName(name: string): string | null {
  return known(name)?.name ?? null;
}

/** Every enzyme REBASE lists as sold, the curated ones first, for choosing a lab's stock. */
export const KNOWN_ENZYMES: readonly string[] = [
  ...COMMON_ENZYMES,
  ...[...ENZYMES.values()].map(e => e.name).filter(n => !CURATED.has(n.toLowerCase())).sort((a, b) => a.localeCompare(b))
];

const extraCache = new Map<string, Enzyme[]>();
/** The curated enzymes plus any other known enzyme named in `extra` (a lab's stock). */
function enzymeList(extra: readonly string[]): Enzyme[] {
  const names = [...new Set(extra.map(enzymeName).filter((n): n is string => !!n && !CURATED.has(n.toLowerCase())))].sort();
  if (!names.length) return ALL_ENZYMES;
  const key = names.join(" ");
  let list = extraCache.get(key);
  if (!list) {
    list = [...ALL_ENZYMES, ...names.map(name => ENZYMES.get(name.toLowerCase())!)];
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
const MAX_SITE = Math.max(...[...ENZYMES.values()].map(e => e.site.length));
/** Furthest any enzyme cuts from its site (EcoP15I's 27 bases); a test holds it to this. */
export const MAX_CUT_DISTANCE = 40;
/** How far from an edit sites are looked for again: longer than any site plus any cut outside it. */
const MARGIN = MAX_SITE + MAX_CUT_DISTANCE;

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
 * Sites from the chosen list, filtered by how many times each enzyme is predicted to cut and
 * sorted by position. Membership preserves chosen names, so a personal Esp3I does not add
 * BsmBI labels. Given the sequence (`dna`) and `o.methylation`, a site Dam or Dcm methylation
 * blocks is still listed, with its `methylation`, but not counted as a cut, so an enzyme with
 * one of two sites blocked counts as a unique cutter.
 */
export function selectSites(hits: SiteHit[], o: EnzymeOptions, dna?: { sequence: string; circular: boolean }): CutSite[] {
  const names = new Set(sourceEnzymes(o).map(enzymeName));
  const maxCuts = o.enzymeFilter === "all" ? Infinity : o.enzymeFilter === "unique2" ? 2 : 1;
  const minSpecificity = o.enzymeFilter === "unique6" ? 6 : 0;
  const byEnzyme = new Map<string, SiteHit[]>();
  for (const h of hits) {
    if (!names.has(h.enzyme)) continue;
    const list = byEnzyme.get(h.enzyme);
    if (list) list.push(h);
    else {
      const e = ENZYMES.get(h.enzyme.toLowerCase());
      byEnzyme.set(h.enzyme, (e ? specificity(e) : 0) >= minSpecificity ? [h] : []);
    }
  }
  const methylation = dna && o.methylation;
  const out: CutSite[] = [];
  for (const [enzyme, list] of byEnzyme) {
    if (!list.length || (!methylation && list.length > maxCuts)) continue;
    const effects: (SiteMethylation | null)[] = [];
    let cuts = 0;
    // Once it cuts more often than the filter allows, the rest of its sites needn't be looked at.
    for (const h of list) {
      const m = methylation ? siteMethylation(dna.sequence, dna.circular, h, methylation) : null;
      effects.push(m);
      if (!m?.blocked && ++cuts > maxCuts) break;
    }
    // One that cuts nowhere stays only where its sites alone pass (a lone blocked XbaI under
    // unique cutters), so a filter for useful enzymes doesn't fill with blocked ones.
    if (cuts > maxCuts || (!cuts && list.length > maxCuts)) continue;
    // Stable ids, so a selected site stays selected when the sites are recomputed.
    list.forEach((h, i) => out.push({ id: `${enzyme}@${h.start}`, ...h, cuts, sites: list.length, ...(effects[i] ? { methylation: effects[i]! } : {}) }));
  }
  out.sort((x, y) => x.cut - y.cut || x.enzyme.localeCompare(y.enzyme));
  return out;
}

/** An enzyme's recognition site as REBASE writes it, without its cut ("GGTCTC" for BsaI), or "" if unknown. */
export function enzymeSite(name: string): string {
  return known(name)?.notation.replace(/\(-?\d+\/-?\d+\)|\^/g, "") ?? "";
}

/**
 * Whether an enzyme also cuts before its site (BcgI, BaeI, CspCI), where `scanSites` finds
 * only the cut after it, so what it gives for such an enzyme has a piece too few.
 */
export function cutsBothSides(name: string): boolean {
  return known(name)?.bothSides ?? false;
}

/** How an enzyme cuts, for lists of enzymes. */
export interface EnzymeCut {
  /**
   * The site with a ^ at the top strand's cut, and Ns past it out to the further cut:
   * "G^AATTC", "C^CGC" for AciI (REBASE's CCGC(-3/-1)), "GGTCTCN^NNNN" for BsaI (its
   * GGTCTC(1/5)), "GGATG(N)9^NNNN" for FokI. An enzyme that cuts both sides of its site
   * keeps REBASE's notation. The ends say where the bottom strand is cut.
   */
  notation: string;
  /** The recognition site as REBASE writes it, which `notation` starts with ("GGTCTC"). */
  site: string;
  /** As REBASE writes it ("GGTCTC(1/5)"), to check against REBASE. */
  rebase: string;
  /** "5′ AATT", "3′ GTAC", "Blunt", or "Cuts both sides" (BcgI, which cuts a piece out). */
  ends: string;
}

/** Ns beyond a site: more than five are written as NEB writes them, (N)9, to be read at a glance. */
const spacer = (k: number) => (k > 5 ? `(N)${k}` : "N".repeat(k));

/** The cut of an enzyme REBASE lists as sold, or null. Bases of an overhang outside the site are N. */
export function enzymeCut(name: string): EnzymeCut | null {
  const e = known(name);
  if (!e) return null;
  const written = e.notation.replace(/\(-?\d+\/-?\d+\)|\^/g, "");
  if (e.bothSides) return { notation: e.notation, site: written, rebase: e.notation, ends: "Cuts both sides" };
  const top = e.topSnipOffset;
  const bottom = e.bottomSnipOffset;
  const site = e.site.toUpperCase();
  const from = Math.min(top, bottom);
  const overhang = Array.from({ length: Math.abs(top - bottom) }, (_, i) => site[from + i] ?? "N").join("");
  const ends = top === bottom ? "Blunt" : `${top < bottom ? "5′" : "3′"} ${overhang}`;
  // A ^ in REBASE's own notation (G^AATTC, TspRI's CASTGNN^) is kept. Otherwise REBASE
  // counts from the site's end (m/n), and the site searched for is the one it writes:
  // REBASE always puts the cuts after the site, so Ns run on from it to the further cut.
  if (e.notation.includes("^")) return { notation: e.notation, site: written, rebase: e.notation, ends };
  const end = Math.max(top, bottom, site.length);
  const notation = top <= site.length
    ? `${site.slice(0, top)}^${site.slice(top)}${spacer(end - site.length)}`
    : `${site}${spacer(top - site.length)}^${spacer(end - top)}`;
  return { notation, site: written, rebase: e.notation, ends };
}

/** The companies REBASE says sell an enzyme, by name. */
export function enzymeSuppliers(name: string): string[] {
  return [...(known(name)?.suppliers ?? "")].map(code => SUPPLIERS[code] ?? code);
}

/**
 * Each cut as boundaries from the site's first base, the top strand's then the bottom
 * strand's: the one searched for and, for an enzyme that cuts both sides, the one before
 * its site, from REBASE's (m/n) in front ((10/12)CGA… cuts 10 and 12 bases before).
 */
function cutsOf(e: Enzyme): [number, number][] {
  const before = e.bothSides ? /^\((-?\d+)\/(-?\d+)\)/.exec(e.notation) : null;
  const after: [number, number] = [e.topSnipOffset, e.bottomSnipOffset];
  return before ? [[-Number(before[1]), -Number(before[2])], after] : [after];
}

const reverseComplement = (site: string) => [...site].reverse().map(c => COMPLEMENT[c]).join("");

/** An enzyme's site and cuts read along either strand, as keys, so two enzymes compare whichever way REBASE wrote them. */
function readings(e: Enzyme): { site: string; cuts: string }[] {
  const n = e.site.length;
  const key = (cuts: [number, number][]) => cuts.map(([top, bottom]) => `${top}/${bottom}`).sort().join(" ");
  const cuts = cutsOf(e);
  return [
    { site: e.site, cuts: key(cuts) },
    { site: reverseComplement(e.site), cuts: key(cuts.map(([top, bottom]) => [n - bottom, n - top])) }
  ];
}

/**
 * Other enzymes on sale with the same site: isoschizomers cut it the same way, so they
 * leave the same ends; neoschizomers cut it elsewhere (Acc65I and KpnI).
 */
export function enzymeRelatives(name: string): { isoschizomers: string[]; neoschizomers: string[] } {
  const out = { isoschizomers: [] as string[], neoschizomers: [] as string[] };
  const e = known(name);
  if (!e) return out;
  const [own] = readings(e);
  for (const other of ENZYMES.values()) {
    if (other === e) continue;
    const same = readings(other).filter(r => r.site === own.site);
    if (same.length) (same.some(r => r.cuts === own.cuts) ? out.isoschizomers : out.neoschizomers).push(other.name);
  }
  out.isoschizomers.sort((a, b) => a.localeCompare(b));
  out.neoschizomers.sort((a, b) => a.localeCompare(b));
  return out;
}

/** An enzyme's site on both strands with its cuts, to draw. */
export interface CutDrawing {
  /** The top strand, 5′ to 3′: the site, Ns out to its cuts and one more on each side. */
  top: string;
  /** The bottom strand under it, base for base, so read 3′ to 5′. */
  bottom: string;
  /** Where the site REBASE writes lies in `top`: from, and to (not included). */
  site: [number, number];
  /** Each cut as boundaries in `top`, the top strand's and the bottom strand's. */
  cuts: { top: number; bottom: number }[];
}

export function cutDrawing(name: string): CutDrawing | null {
  const e = known(name);
  if (!e) return null;
  const site = e.site.toUpperCase();
  const cuts = cutsOf(e);
  const from = Math.min(0, ...cuts.flat()) - 1;
  const to = Math.max(site.length, ...cuts.flat()) + 1;
  const top = Array.from({ length: to - from }, (_, i) => site[i + from] ?? "N").join("");
  // TspRI's CASTGNN^ is searched for with Ns in front (NNCASTGNN): they aren't its site.
  const written = enzymeSite(name).length;
  const start = site.length - written - from;
  return {
    top,
    bottom: [...top].map(c => COMPLEMENT[c.toLowerCase()].toUpperCase()).join(""),
    site: [start, start + written],
    cuts: cuts.map(([t, b]) => ({ top: t - from, bottom: b - from }))
  };
}

/** Where one enzyme recognises and cuts a sequence, whichever list it is in, by position. */
export function enzymeSites(sequence: string, circular: boolean, name: string): SiteHit[] {
  const e = known(name);
  return e && sequence.length ? search(sequence, circular, [e]).sort((a, b) => a.start - b.start) : [];
}

/** Enzymes whose site can be added to a primer as written (no N or other ambiguity codes). */
export const TAIL_ENZYMES: { name: string; site: string }[] = ALL_ENZYMES.filter(e => /^[acgt]{6,}$/i.test(e.site))
  .map(e => ({ name: e.name, site: e.site.toUpperCase() }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** How many times each named enzyme is predicted to cut a sequence from `methylation`'s DNA (every site, without it). */
export function cutCounts(sequence: string, circular: boolean, names: string[], methylation?: DnaMethylation): Map<string, number> {
  const out = new Map(names.map(n => [n, 0]));
  if (!names.length || !sequence.length) return out;
  for (const h of scanSites(sequence, circular, names)) if (out.has(h.enzyme) && !blockedSite(sequence, circular, h, methylation)) out.set(h.enzyme, out.get(h.enzyme)! + 1);
  return out;
}

/** Whether Dam or Dcm methylation is predicted to stop a site cutting. */
export const blockedSite = (sequence: string, circular: boolean, h: SiteHit, methylation: DnaMethylation | undefined) =>
  !!methylation && !!siteMethylation(sequence, circular, h, methylation)?.blocked;

/** An enzyme's sites in a sequence, and how many of them are predicted to cut. */
export interface SiteCount {
  sites: number;
  cuts: number;
}

/** Sites and predicted cuts of every enzyme the hits are of, for lists to choose enzymes from. */
export function siteCounts(hits: readonly SiteHit[], sequence: string, circular: boolean, methylation?: DnaMethylation): Map<string, SiteCount> {
  const out = new Map<string, SiteCount>();
  for (const h of hits) {
    let c = out.get(h.enzyme);
    if (!c) out.set(h.enzyme, (c = { sites: 0, cuts: 0 }));
    c.sites++;
    if (!blockedSite(sequence, circular, h, methylation)) c.cuts++;
  }
  return out;
}

/** Cut sites of the chosen enzymes, sorted by position. */
export function findCutSites(sequence: string, circular: boolean, o: EnzymeOptions): CutSite[] {
  return selectSites(scanSites(sequence, circular, sourceEnzymes(o)), o, { sequence, circular });
}

/**
 * Reaction choices honour membership, but already chosen enzymes always remain available.
 * `counts` are predicted cuts; given `sites`, a search by name also finds an enzyme whose
 * every site methylation blocks, so the list can say why it doesn't cut.
 */
export function reactionEnzymes(counts: ReadonlyMap<string, number>, members: readonly string[], selected: readonly string[], maxCuts = Infinity, query = "", sites?: ReadonlyMap<string, number>): string[] {
  const q = query.trim().toLowerCase();
  const cutting = (name: string) => (counts.get(name) ?? 0) > 0 && counts.get(name)! <= maxCuts;
  const blocked = (name: string) => !!q && (sites?.get(name) ?? 0) > 0 && !counts.get(name);
  return [...new Set([...selected, ...members])]
    .filter(name => selected.includes(name) || ((cutting(name) || blocked(name)) && (!q || name.toLowerCase().includes(q))))
    .sort((a, b) => Number(selected.includes(b)) - Number(selected.includes(a)) || a.localeCompare(b));
}

/** "5′ overhang AATT", "blunt", … */
export function overhangText(c: CutSite): string {
  if (!c.overhang) return "Blunt end";
  // Cut positions are on top-strand coordinates whichever way the site points.
  const five = c.cut < c.bottomCut;
  return `${five ? "5′" : "3′"} overhang ${c.overhang.toUpperCase()}`;
}
