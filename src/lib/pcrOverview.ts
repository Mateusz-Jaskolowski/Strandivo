// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Analysis of the final, linear PCR product, including tails and primer edits.
import { cutsBothSides, extraKey, scanSites, selectSites, sourceEnzymes, type CutSite, type EnzymeOptions, type SiteHit } from "./enzymes.ts";
import { gcProfile, overviewWindow } from "./gc.ts";
import { LADDERS } from "./gel.ts";
import { gcPercent } from "./labinfo.ts";
import { alignPrimer } from "./primerAlign.ts";
import { PCR_GUIDANCE } from "./pcrGuidance.ts";
import type { PcrProduct } from "./pcr.ts";
import type { TemplateKind } from "./pcrProtocols.ts";

/**
 * The last template counted. The dialog is drawn again on every change around it (Settings,
 * the primer library, a view option), nearly always with the same template, whose whole
 * sequence this would otherwise be searched again each time.
 */
let counted: { sequence: string; circular: boolean; members: string; counts: Map<string, number> } | null = null;

/** How many times each enzyme of the chosen list cuts the template. */
function templateCutCounts(sequence: string, circular: boolean, members: readonly string[]): Map<string, number> {
  const key = extraKey(members);
  if (counted && counted.sequence === sequence && counted.circular === circular && counted.members === key) return counted.counts;
  const counts = new Map<string, number>();
  for (const h of scanSites(sequence, circular, members)) counts.set(h.enzyme, (counts.get(h.enzyme) ?? 0) + 1);
  counted = { sequence, circular, members: key, counts };
  return counts;
}

export function productOverview(product: PcrProduct, template: string, circular: boolean, options: EnzymeOptions) {
  const members = sourceEnzymes(options);
  const hits = scanSites(product.sequence, false, members);
  const templateCounts = templateCutCounts(template, circular, members);
  const window = overviewWindow(product.length);
  const gc = gcProfile(product.sequence, false, window);
  const tails = { left: alignPrimer(product.forward, template).tail.length, right: alignPrimer(product.reverse, template).tail.length };
  // A site can straddle a tail/paired-base boundary and still be introduced by that tail.
  const tailSites = selectSites(hits, { ...options, enzymeFilter: "all" }).filter(h => h.start < tails.left || h.end >= product.length - tails.right);
  return {
    hits,
    sites: selectSites(hits, options),
    templateCounts,
    gc,
    window,
    /** The whole product's GC, %, counted as the status bar and inspector count it. */
    gcPercent: gcPercent(product.sequence),
    tails,
    tailSites,
    digests: suggestedDigests(product.length, hits, members)
  };
}

/**
 * Bases beyond its site an enzyme is asked to have before this says to check it. NEB,
 * "Cleavage Close to the End of DNA Fragments" (read in a browser on 16 November 2026):
 * "As a general rule and for enzymes not listed below, 6 base pairs should be added on on
 * either side of the recognition site to cleave efficiently." It is that general rule, not
 * what any one enzyme needs, which is on the same page.
 * https://www.neb.com/en-us/tools-and-resources/usage-guidelines/cleavage-close-to-the-end-of-dna-fragments
 */
export const CHECK_FLANKS = 6;
export function tailSiteFlanks(length: number, sites: SiteHit[]) {
  return sites.map(site => ({ site, left: site.start, right: length - site.end - 1 })).filter(x => Math.min(x.left, x.right) < CHECK_FLANKS);
}

/** Complete cuts only, matching cutsFor in cloning.ts; a Type IIS site alone may not cut. */
export const completeProductCut = (h: SiteHit, length: number) => Math.min(h.cut, h.bottomCut) > 0 && Math.max(h.cut, h.bottomCut) < length;

export interface SuggestedDigest {
  enzymes: string[];
  sizes: number[];
  score: number;
}
/** Top-strand lengths. Reject overlapping overhangs rather than inventing a band. */
export function productDigestSizes(length: number, hits: SiteHit[]): number[] | null {
  const cuts = [...new Map(hits.filter(h => completeProductCut(h, length)).map(h => [`${h.cut}:${h.bottomCut}`, h])).values()].sort(
    (a, b) => Math.min(a.cut, a.bottomCut) - Math.min(b.cut, b.bottomCut)
  );
  if (!cuts.length || cuts.some((c, i) => i > 0 && Math.min(c.cut, c.bottomCut) <= Math.max(cuts[i - 1].cut, cuts[i - 1].bottomCut))) return null;
  const boundaries = [0, ...cuts.map(c => c.cut), length];
  return boundaries
    .slice(1)
    .map((end, i) => end - boundaries[i])
    .sort((a, b) => b - a);
}

/**
 * From this score up, a digest's fragments are far enough apart to suggest: the smallest is
 * a tenth of the product, and each is a tenth smaller than the one above it, and none is
 * too small for a gel to show (`SMALLEST_BAND`). It is this suggestion's own bar, well clear
 * of the 2% within which the gel draws bands as one.
 */
export const DISTINCT_DIGEST = 0.1;

/** The smallest band of any ladder the gel offers: a fragment below it is not one a gel can show. */
export const SMALLEST_BAND = Math.min(...LADDERS.map(ladder => Math.min(...ladder.bands)));

/**
 * How far apart a digest's fragments are: the smallest as a share of the product, or of the
 * next one up. Relative sizes alone would call 64 and 39 bp from a 103 bp product far apart,
 * so a digest with a fragment below `SMALLEST_BAND` is scaled to stay under
 * `DISTINCT_DIGEST`, and those are still ordered among themselves.
 */
function digestScore(sizes: number[], length: number): number {
  const apart = Math.min(sizes[sizes.length - 1] / length, ...sizes.slice(1).map((s, i) => (sizes[i] - s) / sizes[i]));
  return sizes[sizes.length - 1] < SMALLEST_BAND ? (apart * DISTINCT_DIGEST) / 2 : apart;
}

/** Prefer one enzyme; try pairs only if none gives well-separated, substantial fragments. */
export function suggestedDigests(length: number, hits: SiteHit[], members: readonly string[]): SuggestedDigest[] {
  const byName = new Map<string, SiteHit[]>();
  const allowed = new Set(members);
  // An enzyme that cuts on both sides of its site is left out: only the cut after it is found,
  // so its fragments would be one too few (BcgI's 324 + 288 are 290 + 34 + 288).
  for (const h of hits) if (allowed.has(h.enzyme) && !cutsBothSides(h.enzyme) && completeProductCut(h, length)) byName.set(h.enzyme, [...(byName.get(h.enzyme) ?? []), h]);
  // Small patterns are readable; a digest with many sites is still accessible in Digest.
  const names = [...byName]
    .filter(([, sites]) => sites.length <= 3)
    .map(([name]) => name)
    .sort();
  const candidates: SuggestedDigest[] = [];
  const add = (enzymes: string[]) => {
    const sizes = productDigestSizes(
      length,
      enzymes.flatMap(e => byName.get(e)!)
    );
    if (sizes && sizes.length >= 2 && sizes.length <= 4) candidates.push({ enzymes, sizes, score: digestScore(sizes, length) });
  };
  names.forEach(name => add([name]));
  if (!candidates.some(c => c.score >= DISTINCT_DIGEST)) {
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) add([names[i], names[j]]);
  }
  return candidates
    .sort(
      (a, b) => Number(b.score >= DISTINCT_DIGEST) - Number(a.score >= DISTINCT_DIGEST) || a.enzymes.length - b.enzymes.length || b.score - a.score || a.enzymes.join().localeCompare(b.enzymes.join())
    )
    .slice(0, 12);
}

/** A digest as its menu names it ("ScaI", "AseI + PstI"), which is also how the choice is kept. */
export const digestName = (d: SuggestedDigest) => d.enzymes.join(" + ");

/** The digest to show: the one chosen before while it is still offered, else the best. */
export function pickDigest(digests: SuggestedDigest[], chosen: string): SuggestedDigest | null {
  return digests.find(d => digestName(d) === chosen) ?? digests[0] ?? null;
}

/** The site to describe: the one clicked while it is still drawn, else one the digest uses, else the first. */
export function pickSite(sites: CutSite[], clicked: string, digest: SuggestedDigest | null): CutSite | null {
  return sites.find(s => s.id === clicked) ?? sites.find(s => digest?.enzymes.includes(s.enzyme)) ?? sites[0] ?? null;
}

/**
 * A GC-rich product, as NEB's Q5 High GC Enhancer is described for: "high GC (>= 65%)
 * amplicons" (https://www.neb.com/en-us/products/b9027-q5-reaction-buffer-pack, read in a
 * browser on 16 November 2026). It is the whole product's GC, not a window of it, as that
 * is what the sentence is about; where GC runs high within the product is on the strip.
 */
export const HIGH_GC = 65;

/**
 * Which of NEB's two maximum lengths a template takes. Its selection chart: "Simple
 * templates include plasmid, viral, and E. coli genomic DNA. Complex templates include
 * plant, human, and other mammalian genomic DNA and cDNA." So a colony, which is E. coli,
 * is simple, and only the menu's genomic DNA or cDNA is complex.
 */
const isSimple = (template: TemplateKind) => template !== "complex";

/**
 * What is said about this product for the polymerase picked. The GC sentence is about the
 * product, so every polymerase gets it. What comes from `PCR_GUIDANCE` (the longest product,
 * the enhancer) is said only where NEB's row for the polymerase has been read, and
 * nothing is borrowed from another member of its Tm family.
 */
export function productAdvice(polymerase: string, template: TemplateKind, length: number, gcPercent: number): string[] {
  const guidance = PCR_GUIDANCE[polymerase];
  const out: string[] = [];
  // Compared as counted, not rounded: NEB's 65% is a threshold, so 64.6% is below it. The
  // warning gives one decimal, as the header above the strip does.
  if (gcPercent >= HIGH_GC) out.push(`The product is ${gcPercent.toFixed(1)}% GC, which can be hard to amplify.${guidance?.enhancer ? ` ${guidance.enhancer}` : ""}`);
  if (guidance) {
    const max = isSimple(template) ? guidance.maxLength.simple : guidance.maxLength.complex;
    if (length > max) out.push(`The product is longer than NEB’s ${max.toLocaleString("en")} bp maximum for ${guidance.product} on this template.`);
  }
  return out;
}

/**
 * How many lanes of names are drawn. A multiple cloning site holds a dozen enzymes within a
 * few bases, and a lane each would push the product line, its GC and the digest out of the
 * dialog, so the sites past these lanes are counted where they cut instead of named.
 */
export const MAX_LABEL_LANES = 5;

/** How far apart, in pixels, counted sites are taken to be separate crowds. */
const CROWD_APART = 40;

export interface ProductLabel {
  site: CutSite;
  row: number;
  left: number;
  width: number;
  anchor: number;
}

/** Sites with no lane left, kept together where they cut so one chip can count them. */
export interface LabelCrowd {
  id: string;
  anchor: number;
  sites: { site: CutSite; anchor: number }[];
}

/** Dotted leaders and labels in non-overlapping lanes; widths come from the actual font. */
export function productLabels(sites: CutSite[], length: number, width: number, widths: number[]): { labels: ProductLabel[]; crowds: LabelCrowd[]; lanes: number } {
  const lanes: { left: number; right: number }[][] = [];
  const labels: ProductLabel[] = [];
  const over: { site: CutSite; anchor: number }[] = [];
  sites.forEach((site, i) => {
    const w = Math.min(width, widths[i]);
    const anchor = Math.max(0, Math.min(width, (site.cut / length) * width));
    const left = Math.max(0, Math.min(width - w, anchor - w / 2));
    const right = left + w;
    let row = lanes.findIndex(lane => lane.every(p => right + 7 < p.left || left > p.right + 7));
    if (row < 0) {
      row = lanes.length;
      if (row >= MAX_LABEL_LANES) {
        over.push({ site, anchor });
        return;
      }
      lanes.push([]);
    }
    lanes[row].push({ left, right });
    labels.push({ site, row, left, width: w, anchor });
  });
  const crowds: LabelCrowd[] = [];
  let last = -Infinity;
  for (const mark of [...over].sort((a, b) => a.anchor - b.anchor)) {
    if (mark.anchor - last > CROWD_APART) crowds.push({ id: mark.site.id, anchor: mark.anchor, sites: [] });
    crowds.at(-1)!.sites.push(mark);
    last = mark.anchor;
  }
  // The chip sits over the crowd it counts, not over its first site.
  for (const crowd of crowds) crowd.anchor = crowd.sites.reduce((sum, m) => sum + m.anchor, 0) / crowd.sites.length;
  return { labels, crowds, lanes: lanes.length };
}
