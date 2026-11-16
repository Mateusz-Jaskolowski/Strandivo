// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Analysis of the final, linear PCR product, including tails and primer edits.
import { scanSites, selectSites, sourceEnzymes, type CutSite, type EnzymeOptions, type SiteHit } from "./enzymes.ts";
import { gcProfile, gcRuns, overviewWindow } from "./gc.ts";
import { alignPrimer } from "./primerAlign.ts";
import { PCR_GUIDANCE } from "./pcrGuidance.ts";
import type { PcrProduct } from "./pcr.ts";
import type { TemplateKind } from "./pcrProtocols.ts";

export function productOverview(product: PcrProduct, template: string, circular: boolean, options: EnzymeOptions) {
  const members = sourceEnzymes(options);
  const hits = scanSites(product.sequence, false, members);
  const templateHits = scanSites(template, circular, members);
  const templateCounts = new Map<string, number>();
  for (const h of templateHits) templateCounts.set(h.enzyme, (templateCounts.get(h.enzyme) ?? 0) + 1);
  const window = overviewWindow(product.length);
  const gc = gcProfile(product.sequence, false, window);
  const highGc = gcRuns(gc.length, i => gc[i]).filter(r => r.level === "gc");
  const tails = { left: alignPrimer(product.forward, template).tail.length, right: alignPrimer(product.reverse, template).tail.length };
  // A site can straddle a tail/paired-base boundary and still be introduced by that tail.
  const tailSites = selectSites(hits, { ...options, enzymeFilter: "all" }).filter(h => h.start < tails.left || h.end >= product.length - tails.right);
  return { hits, sites: selectSites(hits, options), templateCounts, gc, window, highGc, tails, tailSites, digests: suggestedDigests(product.length, hits, members) };
}

/** NEB's general fallback is 6 flanking bp; this is a prompt to check, not an enzyme-specific failure. */
// "As a general rule and for enzymes not listed below, 6 base pairs should be added ..."
// https://www.neb.com/en-us/tools-and-resources/usage-guidelines/cleavage-close-to-the-end-of-dna-fragments
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

/** A drawing heuristic, not a claim about gel resolution: favour substantial, distinct sizes. */
function digestScore(sizes: number[], length: number): number {
  return Math.min(sizes[sizes.length - 1] / length, ...sizes.slice(1).map((s, i) => (sizes[i] - s) / sizes[i]));
}

/** Prefer one enzyme; try pairs only if none gives well-separated, substantial fragments. */
export function suggestedDigests(length: number, hits: SiteHit[], members: readonly string[]): SuggestedDigest[] {
  const byName = new Map<string, SiteHit[]>();
  const allowed = new Set(members);
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
  // 10% is deliberately conservative for this suggestion, not the simulated gel's resolution.
  if (!candidates.some(c => c.score >= 0.1)) {
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) add([names[i], names[j]]);
  }
  return candidates
    .sort((a, b) => Number(b.score >= 0.1) - Number(a.score >= 0.1) || a.enzymes.length - b.enzymes.length || b.score - a.score || a.enzymes.join().localeCompare(b.enzymes.join()))
    .slice(0, 12);
}

export function productAdvice(polymerase: string, template: TemplateKind, length: number, highGc: boolean): string[] {
  const guidance = PCR_GUIDANCE[polymerase];
  const out: string[] = [];
  if (highGc) out.push(`The product has a GC-rich region. ${guidance?.enhancer ?? "There is no enhancer guidance for this polymerase yet."}`);
  if (guidance) {
    // A colony's background is complex; only a purified plasmid uses the simple limit.
    const max = template === "plasmid" ? guidance.maxLength.simple : guidance.maxLength.complex;
    if (length > max) out.push(`The product exceeds NEB’s ${max.toLocaleString("en")} bp maximum for ${guidance.product} on this template.`);
  }
  return out;
}

/** Dotted leaders and labels in non-overlapping lanes; widths come from the actual font. */
export function productLabels(sites: CutSite[], length: number, width: number, widths: number[]) {
  const lanes: { left: number; right: number }[][] = [];
  return sites.map((site, i) => {
    const w = Math.min(width, widths[i]);
    const anchor = Math.max(0, Math.min(width, (site.cut / length) * width));
    const left = Math.max(0, Math.min(width - w, anchor - w / 2));
    const right = left + w;
    let row = lanes.findIndex(lane => lane.every(p => right + 7 < p.left || left > p.right + 7));
    if (row < 0) {
      row = lanes.length;
      lanes.push([]);
    }
    lanes[row].push({ left, right });
    return { site, row, left, width: w, anchor };
  });
}
