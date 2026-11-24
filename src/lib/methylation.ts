// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Whether Dam (GATC) or Dcm (CCWGG) methylation stops a restriction site cutting, site by
// site, from REBASE's reports (src/lib/rebaseEnzymes.ts, built by tools/build-enzymes.mjs).
//
// E. coli methylates every GATC's A and every CCWGG's second C on both strands, unless the
// strain lacks the methylase. A site is looked at with the bases around it: which of its
// bases are methylated decides which of REBASE's entries for the enzyme applies, so two
// XbaI sites of one plasmid can differ, as only one may run on into GATC. Only a site every
// matching report calls blocked is predicted not to cut; slow, disagreeing and untested
// ones still cut, with a note. CpG methylation, which E. coli doesn't make, is only listed
// for each enzyme (`enzymeMethylation`).

import { METHYL_DIRECTED, REBASE_METHYLATION } from "./rebaseEnzymes.ts";
import { findStrain } from "./strains.ts";

export type Methylase = "dam" | "dcm" | "cpg";
/** What a report says methylation does to cutting, in REBASE's words. */
export type Report = "cut" | "impaired" | "blocked";

interface Entry {
  /** The site with ambiguity codes narrowed in lower case, or "" when none are. */
  bases: string;
  /** Methylated bases as "t5 b0": strand (top, bottom) and position in the site searched for. */
  marks: string;
  reports: Report[];
}

const TABLE = new Map<string, Record<Methylase, Entry[]>>();
for (const line of REBASE_METHYLATION.trim().split("\n")) {
  if (!line) continue;
  const [name, methylase, bases, marks, reports] = line.split("\t");
  const key = name.toLowerCase();
  if (!TABLE.has(key)) TABLE.set(key, { dam: [], dcm: [], cpg: [] });
  TABLE.get(key)![methylase as Methylase].push({ bases, marks, reports: reports.split(",") as Report[] });
}

/** Enzymes that cut only methylated DNA, by lower-case name, with the methylase they need. */
const DIRECTED = new Map(Object.entries(METHYL_DIRECTED).map(([name, m]) => [name.toLowerCase(), m as "dam" | "dcm"]));

/**
 * Where the DNA came from, as far as methylation goes. `dam` and `dcm` are null when that
 * isn't known: a strain Strandivo doesn't know, whose sites are described but not predicted.
 */
export interface DnaMethylation {
  dam: boolean | null;
  dcm: boolean | null;
  /**
   * "assumed": no strain given, so dam⁺ dcm⁺ as most cloning strains are; "strain": a
   * known strain (`name`); "unknown": a strain it doesn't know (`name` as typed); "pcr":
   * made by PCR, which copies no methylation.
   */
  from: "assumed" | "strain" | "unknown" | "pcr";
  name: string;
}

/** A PCR product's DNA: unmethylated, whatever its template was grown in. */
export const PCR_DNA: DnaMethylation = { dam: false, dcm: false, from: "pcr", name: "" };

/** The methylation of DNA grown in the strain the "Host / strain" field names. */
export function hostMethylation(host: string): DnaMethylation {
  const text = host.trim();
  if (!text) return { dam: true, dcm: true, from: "assumed", name: "" };
  const strain = findStrain(text);
  return strain ? { dam: strain.dam, dcm: strain.dcm, from: "strain", name: strain.name } : { dam: null, dcm: null, from: "unknown", name: text };
}

/** A supplied strain describes the DNA after propagation, regardless of how it was made. */
export function documentMethylation(host: string, made?: DnaMethylation): DnaMethylation {
  return host.trim() || !made ? hostMethylation(host) : made;
}

/** The DNA's methylation in a sentence, for the Info tab's strain field. */
export function methylationSummary(dna: DnaMethylation): string {
  const state = `Dam${dna.dam ? "⁺" : "⁻"} Dcm${dna.dcm ? "⁺" : "⁻"}`;
  if (dna.from === "assumed") return `Methylation: ${state}, assumed until a strain is given.`;
  if (dna.from === "strain") return `Methylation: ${state}.`;
  if (dna.from === "pcr") return "Unmethylated, as made by PCR.";
  return `Methylation unknown: “${dna.name}” isn't a strain Strandivo knows, so no site is predicted blocked.`;
}

/** A key that differs whenever predictions could, for caches. */
export const methylationKey = (m: DnaMethylation | undefined) => (m ? `${m.dam}/${m.dcm}/${m.from}/${m.name}` : "");

/** What one methylase does to one site. */
export interface MethylationEffect {
  methylase: "dam" | "dcm";
  /**
   * blocked, impaired (cuts slowly) or cut, when the reports agree; "disagree" when they
   * don't (`reports` says how); "untested" when no report has these bases methylated; and
   * "needs" for an enzyme that cuts only methylated DNA (DpnI) on DNA without it.
   */
  verdict: "blocked" | "impaired" | "cut" | "disagree" | "untested" | "needs";
  reports: Report[];
  /** False when the strain isn't known, so this is what would happen if the DNA is methylated. */
  certain: boolean;
}

/** What methylation does to a site, when it does anything worth saying. */
export interface SiteMethylation {
  effects: MethylationEffect[];
  /** Predicted not to cut. */
  blocked: boolean;
  dna: DnaMethylation;
}

/** Where a site lies, as the site search gives it. */
export interface SiteSpot {
  enzyme: string;
  /** The site searched for, in lower case (`SiteHit.site`). */
  site: string;
  start: number;
  end: number;
  forward: boolean;
}

// Ambiguity codes too, so a site such as BsaWI's WCCGGW is seen to read the same on both strands.
const COMPLEMENT: Record<string, string> = { A: "T", C: "G", G: "C", T: "A", R: "Y", Y: "R", S: "S", W: "W", K: "M", M: "K", B: "V", V: "B", D: "H", H: "D", N: "N" };
const revcomp = (s: string) => [...s].reverse().map(c => COMPLEMENT[c] ?? "N").join("");
const IUPAC: Record<string, string> = { A: "A", C: "C", G: "G", T: "T", R: "AG", Y: "CT", S: "CG", W: "AT", K: "GT", M: "AC", B: "CGT", D: "AGT", H: "ACT", V: "ACG", N: "ACGT" };

/** Bases read either side of a site: enough for a GATC or CCWGG reaching into it. */
const FLANK = 4;
const OWN: Record<"dam" | "dcm", { site: RegExp; length: number; top: number; bottom: number }> = {
  dam: { site: /^GATC/, length: 4, top: 1, bottom: 2 },
  dcm: { site: /^CC[AT]GG/, length: 5, top: 1, bottom: 3 }
};

const QUICK = { dam: /GATC/, dcm: /CC[AT]GG/ };

/** Whether a site reads the same on both strands (ambiguity codes too), so it is looked at from both. */
const PALINDROMES = new Map<string, boolean>();
function palindromic(site: string): boolean {
  let p = PALINDROMES.get(site);
  if (p === undefined) PALINDROMES.set(site, (p = site.toUpperCase() === revcomp(site.toUpperCase())));
  return p;
}

/** The site with FLANK bases either side, upper case, read along the strand the site is on; N past a linear end. */
function frameOf(sequence: string, circular: boolean, at: SiteSpot): string {
  const n = sequence.length;
  const length = at.site.length;
  const from = at.start - FLANK;
  const to = at.start + length + FLANK;
  let s = "";
  // Nearly every site is well inside the sequence, read in one piece.
  if (from >= 0 && to <= n) s = sequence.slice(from, to);
  else
    for (let p = from; p < to; p++) s += circular ? sequence[((p % n) + n) % n] : p >= 0 && p < n ? sequence[p] : "N";
  s = s.toUpperCase();
  return at.forward ? s : revcomp(s);
}

/** The site's bases a methylase marks, as "t5 b0" (top strand's, then bottom strand's, each in order). */
function marksIn(frame: string, methylase: "dam" | "dcm", length: number): string {
  const own = OWN[methylase];
  const top: number[] = [];
  const bottom: number[] = [];
  for (let p = 0; p + own.length <= frame.length; p++) {
    if (!own.site.test(frame.slice(p, p + own.length))) continue;
    const t = p + own.top - FLANK;
    const b = p + own.bottom - FLANK;
    if (t >= 0 && t < length) top.push(t);
    if (b >= 0 && b < length) bottom.push(b);
  }
  return [...top.sort((x, y) => x - y).map(x => `t${x}`), ...bottom.sort((x, y) => x - y).map(x => `b${x}`)].join(" ");
}

/** Whether an entry's narrowed bases (lower case) are the site's. */
const fits = (e: Entry, frame: string) => [...e.bases].every((c, i) => c !== c.toLowerCase() || IUPAC[c.toUpperCase()]?.includes(frame[i + FLANK]));
const marksOf = (s: string) => new Set(s ? s.split(" ") : []);
const within = (a: Set<string>, b: Set<string>) => [...a].every(x => b.has(x));

function verdictOf(reports: Report[]): MethylationEffect["verdict"] {
  const kinds = new Set(reports);
  return kinds.size === 1 ? reports[0] : "disagree";
}

/**
 * What a methylase's methylation of this site does, from the entries whose methylated bases
 * are the site's: exactly, or else, if every report with fewer of them says blocked, blocked,
 * or if every report with more says cut, cut. A palindromic site is read from both strands.
 */
function judge(entries: Entry[], frames: string[], methylase: "dam" | "dcm", length: number): Pick<MethylationEffect, "verdict" | "reports"> | null {
  const actual = frames.map(f => marksIn(f, methylase, length));
  if (!actual[0]) return null;
  const sets = actual.map(marksOf);
  const matching = (test: (e: Set<string>, a: Set<string>) => boolean) =>
    entries.filter(e => frames.some((f, k) => fits(e, f) && test(marksOf(e.marks), sets[k])));
  const union = (list: Entry[]) => ["cut", "impaired", "blocked"].filter(r => list.some(e => e.reports.includes(r as Report))) as Report[];
  const exact = matching((e, a) => e.size === a.size && within(e, a));
  if (exact.length) {
    const reports = union(exact);
    return { verdict: verdictOf(reports), reports };
  }
  const fewer = union(matching((e, a) => within(e, a)));
  if (fewer.length === 1 && fewer[0] === "blocked") return { verdict: "blocked", reports: fewer };
  const more = union(matching((e, a) => within(a, e)));
  if (more.length === 1 && more[0] === "cut") return { verdict: "cut", reports: more };
  return { verdict: "untested", reports: [] };
}

/**
 * What Dam and Dcm methylation do to one site of a sequence from `dna`, or null when they
 * do nothing worth saying (no methylated base in the site, or every report says it cuts).
 */
export function siteMethylation(sequence: string, circular: boolean, at: SiteSpot, dna: DnaMethylation): SiteMethylation | null {
  const name = at.enzyme.toLowerCase();
  const table = TABLE.get(name);
  const needs = DIRECTED.get(name);
  if (!table && !needs) return null;
  const length = at.site.length;
  if (!sequence.length) return null;
  // Read only for an enzyme with reports on a methylase the DNA may have, and only once.
  let frames: string[] | null = null;
  const framesOf = () => {
    const frame = frameOf(sequence, circular, at);
    return palindromic(at.site) ? [frame, revcomp(frame)] : [frame];
  };
  const effects: MethylationEffect[] = [];
  for (const methylase of ["dam", "dcm"] as const) {
    const has = dna[methylase];
    if (needs === methylase) {
      // DpnI's site is GATC: methylated wherever the DNA has Dam methylation at all.
      if (has !== true) effects.push({ methylase, verdict: "needs", reports: [], certain: has === false });
      continue;
    }
    if (has === false || !table?.[methylase].length) continue;
    frames ??= framesOf();
    // Most sites have no GATC or CCWGG anywhere near them.
    if (!QUICK[methylase].test(frames[0])) continue;
    const found = judge(table[methylase], frames, methylase, length);
    if (found && found.verdict !== "cut") effects.push({ methylase, ...found, certain: has === true });
  }
  if (!effects.length) return null;
  return { effects, blocked: effects.some(e => e.certain && (e.verdict === "blocked" || e.verdict === "needs")), dna };
}

const NAMES = { dam: "Dam", dcm: "Dcm" } as const;
const SITES = { dam: "GATC", dcm: "CCWGG" } as const;

/** Where the DNA's methylation comes from, said after the sentence ("Assumed dam⁺ strain."). */
function sourceNote(e: MethylationEffect, dna: DnaMethylation): string {
  const has = dna[e.methylase] ? "⁺" : "⁻";
  const gene = e.methylase;
  if (dna.from === "assumed") return ` Assumed ${gene}⁺ strain.`;
  if (dna.from === "strain") return ` ${dna.name} is ${gene}${has}.`;
  if (dna.from === "pcr") return "";
  return ` “${dna.name}” isn't a strain Strandivo knows.`;
}

/**
 * One sentence per methylase about a site, keeping REBASE's categories apart: "Won't cut:
 * Dam methylation (GATC overlaps the site). Assumed dam⁺ strain."
 */
export function methylationNote(m: SiteMethylation, enzyme: string): string {
  return m.effects
    .map(e => {
      const what = NAMES[e.methylase];
      const own = SITES[e.methylase];
      const would = !e.certain;
      let text: string;
      switch (e.verdict) {
        case "needs":
          text =
            m.dna.from === "pcr"
              ? `Won't cut: ${enzyme} needs ${what} methylation, which a PCR product lacks.`
              : would
                ? `Cuts only if the DNA has ${what} methylation.`
                : `Won't cut: ${enzyme} needs ${what} methylation.`;
          break;
        case "blocked":
          text = would ? `Won't cut if the DNA has ${what} methylation (${own} overlaps the site).` : `Won't cut: ${what} methylation (${own} overlaps the site).`;
          break;
        case "impaired":
          text = would ? `Cuts slowly if the DNA has ${what} methylation (${own} overlaps the site).` : `Cuts slowly: ${what} methylation overlaps the site.`;
          break;
        case "disagree":
          text = e.reports.includes("blocked") ? `Reports disagree on whether ${what} methylation blocks this site.` : `Reports disagree on whether ${what} methylation slows this site.`;
          break;
        case "untested":
          text = `${what} methylation overlaps the site; its effect hasn't been tested.`;
          break;
        default:
          text = "";
      }
      return text + sourceNote(e, m.dna);
    })
    .join(" ");
}

/**
 * How often an enzyme cuts, for its tooltips and the inspector: "cuts once", "cuts 3 times",
 * or, when methylation blocks some of its sites, "2 sites · 1 predicted cut".
 */
export function cutCountText(sites: number, cuts: number): string {
  const n = (x: number) => x.toLocaleString("en-US");
  if (sites === cuts) return cuts === 1 ? "cuts once" : `cuts ${n(cuts)} times`;
  return `${n(sites)} ${sites === 1 ? "site" : "sites"} · ${n(cuts)} predicted ${cuts === 1 ? "cut" : "cuts"}`;
}

/** The methylases' own sites, and where they methylate them on each strand (the bottom strand's at the top strand's position). */
const OWN_SITES: Record<Methylase, { site: string; marks: number[] }> = {
  dam: { site: "GATC", marks: [1, 2] },
  dcm: { site: "CCWGG", marks: [1, 3] },
  cpg: { site: "CG", marks: [0, 1] }
};

/**
 * Whether a methylase's site can lie on an enzyme's so as to methylate one of its bases. A
 * base an N stands for doesn't count, as REBASE counts them (AlwNI's CAGNNNCTG has "no
 * overlap" with Dam). The same test as tools/rebase-methylation.mjs makes.
 */
export function canOverlap(methylase: Methylase, site: string): boolean {
  const s = site.toUpperCase();
  const own = OWN_SITES[methylase];
  const fitsAt = (start: number) => [...own.site].every((code, i) => {
    const j = start + i;
    return j < 0 || j >= s.length || [...IUPAC[code]].some(b => (IUPAC[s[j]] ?? "").includes(b));
  });
  return [...s].some((code, pos) => code !== "N" && own.marks.some(at => fitsAt(pos - at)));
}

/** What REBASE says a methylase does to an enzyme anywhere, for its details. */
export type EnzymeEffect = "cuts" | "slow" | "blocked" | "varies" | "not tested" | "no overlap" | "needs";

/**
 * Each methylase's effect on an enzyme, summed over REBASE's entries: one word when they
 * all agree, "varies" when it depends on which bases are methylated or reports disagree.
 * `canOverlap` says whether the methylase's site can reach a base of the enzyme's at all.
 */
export function enzymeMethylation(name: string, canOverlap: (m: Methylase) => boolean): Record<Methylase, EnzymeEffect> {
  const table = TABLE.get(name.toLowerCase());
  const needs = DIRECTED.get(name.toLowerCase());
  const word = (m: Methylase): EnzymeEffect => {
    if (needs === m) return "needs";
    const reports = new Set((table?.[m] ?? []).flatMap(e => e.reports));
    if (!reports.size) return canOverlap(m) ? "not tested" : "no overlap";
    if (reports.size > 1) return "varies";
    return ({ cut: "cuts", impaired: "slow", blocked: "blocked" } as const)[[...reports][0]];
  };
  return { dam: word("dam"), dcm: word("dcm"), cpg: word("cpg") };
}
