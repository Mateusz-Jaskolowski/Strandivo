// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Analysis of the final, linear PCR product, including tails and primer edits.
import { blockedSite, completeLinearCuts, digestSites, enzymeName, extraKey, scanSites, selectSites, sourceEnzymes, type CutSite, type EnzymeOptions, type SiteHit } from "./enzymes.ts";
import { overlappingCuts } from "./cloning.ts";
import { methylationKey, PCR_DNA, type DnaMethylation } from "./methylation.ts";
import { gcProfile, overviewWindow } from "./gc.ts";
import { digestSequence, fragmentSize, LADDERS, SUPERCOILED_RUNS_AS } from "./gel.ts";
import { gcPercent } from "./labinfo.ts";
import { alignPrimer } from "./primerAlign.ts";
import { PCR_GUIDANCE } from "./pcrGuidance.ts";
import type { PcrProduct } from "./pcr.ts";
import { topStrandLength, type SeqData } from "./seqdata.ts";
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

/** The last template digested, kept for the reason the counts above are. */
let digested: { sequence: string; circular: boolean; enzymes: string; sizes: number[]; problem?: string } | null = null;

function templateDigest(template: SeqData, enzymes: readonly string[], methylation?: DnaMethylation) {
  const key = `${[...enzymes].sort().join("+")}|${methylationKey(methylation ?? template.methylation)}|${JSON.stringify(template.ends ?? null)}`;
  if (digested && digested.sequence === template.sequence && digested.circular === template.circular && digested.enzymes === key) return digested;
  const { fragments, problem } = digestSequence(template, [...enzymes], methylation);
  return (digested = { sequence: template.sequence, circular: template.circular, enzymes: key, sizes: fragments.map(fragmentSize), problem });
}

/**
 * The template cut by a digest's enzymes, as top-strand sizes largest first, so a lane of it
 * can run beside the product's. A circular template cut once gives one fragment of its whole
 * length, as the plasmid is only opened up; enzymes that don't cut it at all give none, which
 * is what a site a primer's 5′ tail brought in looks like from here, and so does a digest that
 * can't be simulated (`templateDigestProblem` says which). The template is grown
 * in cells (`methylation`, its file's strain), so Dam or Dcm methylation may block a site
 * the unmethylated product cuts, and DpnI cuts it where it can't cut the product.
 */
export function templateDigestSizes(template: SeqData, enzymes: readonly string[], methylation?: DnaMethylation): number[] {
  return templateDigest(template, enzymes, methylation).sizes;
}

/**
 * Why the template has no lane cut by this digest when the digest can't be simulated on it,
 * as the Digest dialog says, rather than because the enzymes don't cut it: null otherwise,
 * and where the template isn't in the tube (genomic DNA, cDNA) or no digest is shown, as
 * `pcrGelLanes` leaves its lanes out. It takes no lane or band in its place.
 */
export function templateDigestProblem(template: SeqData, kind: TemplateKind, digest: SuggestedDigest | null, methylation?: DnaMethylation): string | null {
  if (kind === "complex" || !digest) return null;
  return templateDigest(template, digest.enzymes, methylation).problem ?? null;
}

/** One lane of the PCR product's gel. */
export interface PcrGelLane {
  /** Whose DNA it holds. */
  of: "template" | "product";
  /** What the key calls it. */
  what: string;
  /** Top-strand sizes of the fragments in it. */
  sizes: number[];
  /** Set on an uncut plasmid: the length of linear DNA it runs as, which is less than its own. */
  runsAs?: number;
}

/**
 * The lanes of the gel beside the suggested digest, in the order they would be loaded: the
 * template, so an extra band in the product can be matched against it, then the product,
 * each whole and cut by the digest. A circular template runs supercoiled, and cut only if the
 * enzymes cut it; a linear one runs uncut only when its length differs from the product's,
 * as one the product's length would run where the product does, and is cut only if the
 * enzymes leave it in two pieces or more, as whole it is the lane above.
 *
 * The template is the open file, which is what is in the tube for a plasmid or a colony, as
 * the plasmid is in the cells. For genomic DNA or cDNA it is not, so only the product runs.
 */
export function pcrGelLanes(template: SeqData, kind: TemplateKind, productLength: number, digest: SuggestedDigest | null, methylation?: DnaMethylation): PcrGelLane[] {
  const length = topStrandLength(template.sequence, template.ends);
  const lanes: PcrGelLane[] = [];
  if (kind !== "complex") {
    if (template.circular) lanes.push({ of: "template", what: "Template, supercoiled", sizes: [length], runsAs: length * SUPERCOILED_RUNS_AS });
    else if (length !== productLength) lanes.push({ of: "template", what: "Template, uncut", sizes: [length] });
    const cut = digest ? templateDigestSizes(template, digest.enzymes, methylation) : [];
    if (digest && (template.circular ? cut.length > 0 : cut.length > 1)) lanes.push({ of: "template", what: `Template, ${digestName(digest)}`, sizes: cut });
  }
  lanes.push({ of: "product", what: "Product, uncut", sizes: [productLength] });
  if (digest) lanes.push({ of: "product", what: `Product, ${digestName(digest)}`, sizes: digest.sizes });
  return lanes;
}

/** Where the gel's smallest band runs, in bp: an uncut plasmid by where it runs, the rest by size. */
export function smallestGelBand(lanes: readonly PcrGelLane[]): number {
  return Math.min(...lanes.map(lane => lane.runsAs ?? Math.min(...lane.sizes)));
}

/**
 * The product's sites, digests and GC. A PCR product is unmethylated whatever its template
 * was grown in, so no site of it is blocked by Dam or Dcm, and DpnI, which needs Dam
 * methylation, cuts none: its sites are drawn with the reason, and no digest uses it.
 */
export function productOverview(product: PcrProduct, template: string, circular: boolean, options: EnzymeOptions) {
  const members = sourceEnzymes(options);
  const hits = scanSites(product.sequence, false, members);
  const unmethylated = { ...options, methylation: PCR_DNA };
  const dna = { sequence: product.sequence, circular: false };
  const cutting = digestSites(product.sequence, false, members).filter(h => !blockedSite(product.sequence, false, h, PCR_DNA));
  const templateCounts = templateCutCounts(template, circular, members);
  const window = overviewWindow(product.length);
  const gc = gcProfile(product.sequence, false, window);
  const tails = { left: alignPrimer(product.forward, template).tail.length, right: alignPrimer(product.reverse, template).tail.length };
  // A site can straddle a tail/paired-base boundary and still be introduced by that tail.
  const tailSites = selectSites(hits, { ...unmethylated, enzymeFilter: "all" }, dna).filter(h => h.start < tails.left || h.end >= product.length - tails.right);
  return {
    hits,
    sites: selectSites(hits, unmethylated, dna),
    templateCounts,
    gc,
    window,
    /** The whole product's GC, %, counted as the status bar and inspector count it. */
    gcPercent: gcPercent(product.sequence),
    tails,
    tailSites,
    digests: suggestedDigests(product.length, cutting, members),
    /** The template's, from its file's strain, for its lanes of the gel. */
    templateMethylation: options.methylation
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
export const completeProductCut = (h: SiteHit, length: number) => completeLinearCuts(h, length).length > 0;

export interface SuggestedDigest {
  enzymes: string[];
  sizes: number[];
  score: number;
}
/** Top-strand lengths. Reject overlapping overhangs rather than inventing a band. */
export function productDigestSizes(length: number, hits: SiteHit[]): number[] | null {
  const pairs = hits.flatMap(h => completeLinearCuts(h, length).map(([top, bottom]) => ({ enzyme: h.enzyme, top, bottom })));
  const cuts = [...new Map(pairs.map(c => [`${c.top}:${c.bottom}`, c])).values()].sort(
    (a, b) => Math.min(a.top, a.bottom) - Math.min(b.top, b.bottom)
  );
  if (!cuts.length || overlappingCuts(cuts)) return null;
  const boundaries = [0, ...cuts.map(c => c.top), length];
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
  // Names as the sites carry them, as the drawn sites do: a lab's "ecori" is EcoRI. A name
  // REBASE doesn't list can't be in a hit found by scanning, so it is kept as written.
  const allowed = new Set(members.map(m => enzymeName(m) ?? m));
  for (const h of hits) if (allowed.has(h.enzyme) && completeProductCut(h, length)) byName.set(h.enzyme, [...(byName.get(h.enzyme) ?? []), h]);
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

/** Sentinel stored in `ProductViewChoice.digest` when the user explicitly chooses no diagnostic digest (uncut DNA only). */
export const NO_DIGEST = "__none__";

/** A digest as its menu names it ("ScaI", "AseI + PstI"), which is also how the choice is kept. */
export const digestName = (d: SuggestedDigest) => d.enzymes.join(" + ");

/** The digest to show: null if the user explicitly chose `NO_DIGEST`, else the one chosen before while still offered, else the best. */
export function pickDigest(digests: SuggestedDigest[], chosen: string): SuggestedDigest | null {
  if (chosen === NO_DIGEST) return null;
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
  // Compared as the header above the strip shows it, to one decimal: NEB's 65% is a
  // threshold, so 64.6% is below it, and a product headed 65.0% is never left without it.
  const shown = gcPercent.toFixed(1);
  if (Number(shown) >= HIGH_GC) out.push(`The product is ${shown}% GC, which can be hard to amplify.${guidance?.enhancer ? ` ${guidance.enhancer}` : ""}`);
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
