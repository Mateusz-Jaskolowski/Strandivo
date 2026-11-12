// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Things computed from the document for drawing: feature colours, cut sites, codons.
// Results are cached on the sequence so redraws stay cheap.

import { extraKey, sourceEnzymes, rescanSites, scanSites, selectSites, type CutSite, type EnzymeOptions, type SiteHit } from "../lib/enzymes.ts";
import { amberSuppressed, codingPositions, translateCodon } from "../lib/genetics.ts";
import { findOrfs, frameLabel, type Orf, type OrfOptions } from "../lib/orfs.ts";
import { gcProfile } from "../lib/gc.ts";
import { bindingTm, changesText } from "../lib/primers.ts";
import { alignPrimer, type PrimerAlignment } from "../lib/primerAlign.ts";
import { fmt, fmtRange } from "../ui/format.ts";
import { type SeqData, type SeqFeature, type SeqPrimer } from "../lib/seqdata.ts";

// Primers are replaced, never changed, so each keeps its alignment until the sequence changes.
const alignCache = new WeakMap<SeqPrimer, { sequence: string; a: PrimerAlignment }>();

/** How the primer pairs with its site: tail, matches and changes. */
export function primerAlignment(d: SeqData, p: SeqPrimer): PrimerAlignment {
  const c = alignCache.get(p);
  if (c && c.sequence === d.sequence) return c.a;
  const a = alignPrimer(p, d.sequence);
  alignCache.set(p, { sequence: d.sequence, a });
  return a;
}

/** A primer's own colour, if it has one that shows on the page, and the text that reads on it. */
export function primerColors(p: SeqPrimer): { color?: string; colorText?: string } {
  const c = p.color && /^#[0-9a-f]{6}$/i.test(p.color) && luminance(p.color) <= 0.82 ? p.color : "";
  return c ? { color: c, colorText: luminance(c) < 0.35 ? "#FFFFFF" : "#1A1D23" } : {};
}

/** A primer's tooltip: name, length, tail, changes and where it binds. */
export function primerTitle(d: SeqData, p: SeqPrimer): string {
  const a = primerAlignment(d, p);
  const changes = changesText({ mismatches: a.substitutions, insertions: a.insertions, deletions: a.deletions });
  return `${p.name} · ${p.bases.length} nt${a.tail ? `, ${a.tail.length} nt 5′ tail` : ""}${changes ? ` · ${changes}` : ""} · ${fmtRange(p.start + 1, p.end + 1)}`;
}

/**
 * Tm of the part of the primer that binds; for a primer that differs from its site, of its
 * 3′ arm, which has to anneal for the first cycle.
 */
export function primerTm(d: SeqData, p: SeqPrimer): number | null {
  return bindingTm(primerAlignment(d, p));
}

// ---------- colours ----------

const TYPE_COLORS: Record<string, string> = {
  promoter: "#4FB3A3",
  terminator: "#A3A9B4",
  rep_origin: "#9D8BE3",
  oriT: "#9D8BE3",
  protein_bind: "#8C9BC0",
  misc_binding: "#8C9BC0",
  RBS: "#C994BE",
  polyA_signal: "#C9B07A",
  enhancer: "#7FC8B8",
  LTR: "#C9B07A",
  misc_feature: "#A3A9B4",
  primer_bind: "#7D8697",
  mRNA: "#BFC5CF",
  gene: "#D9C27A",
  sig_peptide: "#E7B7A0",
  repeat_region: "#B9A6D9",
  regulatory: "#7FC8B8",
  intron: "#C7CCD4",
  exon: "#E8A83E"
};

/** Distinct colours for coding sequences, chosen by name so each CDS keeps its own. */
const CDS_COLORS = ["#E8A83E", "#E58063", "#6FAEE0", "#8CC46B", "#D98BC5", "#F2C14E", "#6CC2B0", "#B39DDB"];

/**
 * Which of them a CDS gets: from its name (its id while it has none), not its place in the
 * sequence, or adding a CDS near the start would recolour every CDS after it and the map
 * the user knows. Two names can land on the same colour, as nine CDSs did before.
 */
function cdsColor(f: SeqFeature): number {
  const key = f.name.trim().toLowerCase() || f.id;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0.5;
  const v = parseInt(m[1], 16);
  const ch = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((v >> 16) & 255) + 0.7152 * ch((v >> 8) & 255) + 0.0722 * ch(v & 255);
}

export interface FeatureStyle {
  fill: string;
  /** Text drawn on top of the fill. */
  text: string;
}

const styleCache = new WeakMap<SeqData, Map<string, FeatureStyle>>();

/** Colours for every feature: the file's own colour when it is usable, else one by type. */
export function featureStyles(d: SeqData): Map<string, FeatureStyle> {
  const cached = styleCache.get(d);
  if (cached) return cached;
  const out = new Map<string, FeatureStyle>();
  for (const f of d.features) {
    let fill = f.color && /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : "";
    // Files often use white or near-white, which disappears on the page.
    if (fill && luminance(fill) > 0.82) fill = "";
    if (!fill) {
      if (f.type.toUpperCase() === "CDS") fill = CDS_COLORS[cdsColor(f) % CDS_COLORS.length];
      else fill = TYPE_COLORS[f.type] ?? TYPE_COLORS[f.type.toLowerCase()] ?? "#A3A9B4";
    }
    out.set(f.id, { fill, text: luminance(fill) < 0.28 ? "#FFFFFF" : "#1A1D23" });
  }
  styleCache.set(d, out);
  return out;
}

// ---------- cut sites ----------

// Sites are rescanned only around an edit; changing the source scans its extra names once.
let hitCache: { sequence: string; circular: boolean; extra: string; hits: SiteHit[] } | null = null;
// A few filters at once, so asking for every site (search, the outline's fallback) doesn't
// make the views' own list again on the next draw.
let cutCache: { hits: SiteHit[]; lists: Map<string, CutSite[]> } | null = null;
const MAX_SITE_LISTS = 4;

/** Shared display choices for Map, Sequence and the outline. */
export function cutSites(d: SeqData, o: EnzymeOptions): CutSite[] {
  const names = sourceEnzymes(o);
  const extra = extraKey(names);
  if (!hitCache || hitCache.sequence !== d.sequence || hitCache.circular !== d.circular || hitCache.extra !== extra) {
    const hits = hitCache && hitCache.extra === extra ? rescanSites(hitCache, d.sequence, d.circular, names) : scanSites(d.sequence, d.circular, names);
    hitCache = { sequence: d.sequence, circular: d.circular, extra, hits };
  }
  const key = JSON.stringify([o.enzymeSource, o.enzymeFilter, names]);
  if (!cutCache || cutCache.hits !== hitCache.hits) cutCache = { hits: hitCache.hits, lists: new Map() };
  let sites = cutCache.lists.get(key);
  if (!sites) {
    sites = selectSites(hitCache.hits, o);
    if (cutCache.lists.size >= MAX_SITE_LISTS) cutCache.lists.delete(cutCache.lists.keys().next().value!);
    cutCache.lists.set(key, sites);
  }
  return sites;
}

/** Every site of the chosen source, whatever the filter shows (`findCutSites`' own order). */
export const allCutSites = (d: SeqData, o: EnzymeOptions): CutSite[] => cutSites(d, { ...o, enzymeFilter: "all" });

/**
 * A site by its id: in what the views show, or, for one the filter hides, among all of
 * them. Search offers every enzyme in the list, so a selected site may be either.
 */
export function cutSiteById(d: SeqData, o: EnzymeOptions, id: string): CutSite | undefined {
  return cutSites(d, o).find(x => x.id === id) ?? allCutSites(d, o).find(x => x.id === id);
}

// ---------- open reading frames ----------

let orfCache: { sequence: string; circular: boolean; key: string; orfs: Orf[] } | null = null;

/** ORFs on both strands, the same list while the sequence and options don't change. */
export function orfs(d: SeqData, o: OrfOptions): Orf[] {
  const key = `${o.minCodons}:${o.starts.join(",")}:${o.amberAsQ ? "Q" : "*"}`;
  if (!orfCache || orfCache.sequence !== d.sequence || orfCache.circular !== d.circular || orfCache.key !== key)
    orfCache = { sequence: d.sequence, circular: d.circular, key, orfs: findOrfs(d.sequence, d.circular, o) };
  return orfCache.orfs;
}

// One profile per window size (the rows' and the overview's), for the current sequence.
const gcCache = new Map<number, { sequence: string; circular: boolean; values: Float64Array }>();

/** GC in a window centred on each base, counted once per sequence and window. */
export function gcValues(d: SeqData, window: number): Float64Array {
  const c = gcCache.get(window);
  if (c && c.sequence === d.sequence && c.circular === d.circular) return c.values;
  if (gcCache.size > 3) gcCache.clear();
  const values = gcProfile(d.sequence, d.circular, window);
  gcCache.set(window, { sequence: d.sequence, circular: d.circular, values });
  return values;
}

const orfFeatures = new WeakMap<Orf, SeqFeature>();

/** An ORF as a CDS feature, so `codons` and `protein` read it like any coding feature. */
export function orfFeature(orf: Orf): SeqFeature {
  let f = orfFeatures.get(orf);
  if (!f) {
    f = { id: `orf:${orf.id}`, name: `ORF ${frameLabel(orf)}`, type: "CDS", start: orf.start, end: orf.end, strand: orf.strand, notes: {}, raw: {} };
    orfFeatures.set(orf, f);
  }
  return f;
}

/** "ORF · 1,236 bp · 411 aa · frame +2" */
export const orfTitle = (orf: Orf) => `ORF · ${fmt((orf.codons + 1) * 3)} bp · ${fmt(orf.codons)} aa · frame ${frameLabel(orf)}`;

// ---------- coding sequences ----------

export const isCds = (f: SeqFeature) => f.type.toUpperCase() === "CDS";

export interface Codon {
  /** Number of the codon in the feature, from 1. */
  index: number;
  /** Lowest and highest base positions of the codon (may cross the origin: lo > hi). */
  lo: number;
  hi: number;
  /** Position of the codon's middle base, where its letter is drawn. */
  mid: number;
  aa: string;
}

const codonCache = new WeakMap<SeqFeature, { seq: string; amber: boolean; codons: Codon[] }>();

/** Codons of a CDS in reading order. */
export function codons(f: SeqFeature, sequence: string): Codon[] {
  const hit = codonCache.get(f);
  if (hit && hit.seq === sequence && hit.amber === amberSuppressed()) return hit.codons;
  const n = sequence.length;
  // A spliced CDS is read across its parts only, skipping the gaps between them, and from
  // its first whole codon (/codon_start).
  const positions = codingPositions(f, n);
  const out: Codon[] = [];
  for (let k = 0; k + 2 < positions.length; k += 3) {
    // Positions are in reading order; on the reverse strand read the complement.
    const p = positions.slice(k, k + 3);
    const reverse = f.strand === -1;
    const triplet = p.map(i => (reverse ? complementBase(sequence[i]) : sequence[i])).join("");
    out.push({ index: k / 3 + 1, lo: reverse ? p[2] : p[0], hi: reverse ? p[0] : p[2], mid: p[1], aa: translateCodon(triplet) });
  }
  codonCache.set(f, { seq: sequence, amber: amberSuppressed(), codons: out });
  return out;
}

const COMP: Record<string, string> = { A: "T", T: "A", G: "C", C: "G", a: "t", t: "a", g: "c", c: "g" };
const complementBase = (b: string) => COMP[b] ?? "N";

/** Protein sequence of a CDS. */
export function protein(f: SeqFeature, sequence: string): string {
  return codons(f, sequence)
    .map(c => c.aa)
    .join("");
}
