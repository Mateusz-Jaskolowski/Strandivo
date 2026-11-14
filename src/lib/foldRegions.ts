// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Turning features into protein regions: files often mark a protein's domains, CDRs,
// linkers or tags as short features inside its CDS. Each such feature becomes a region of
// the CDS (`src/lib/regions.ts`) and is deleted, all in one edit. Which features count,
// the residues they cover, what may go wrong and the kind each suggests are decided here,
// so the dialog only draws them. Pure, so it is unit-tested.

import { codingPositions, featurePositions, isForward, translateCodon } from "./genetics.ts";
import { otherQualifiers } from "./featureNotes.ts";
import { complement, newId, rangeWithin, type SeqData, type SeqFeature } from "./seqdata.ts";
import { nextRegionColor, parseRegionFeatureNote, regionsOf, withRegions, type ProteinRegion } from "./regions.ts";
import { designOf } from "./variable.ts";

/** Why a listed feature is marked in the dialog. */
export type FoldFlag =
  /** Its ends fall between codons, so the region takes the whole codons. */
  | "partial-codon"
  /** It is drawn on the other strand: likely something else, so it starts unticked. */
  | "opposite-strand"
  /** A region with its name and residues is there already: only the feature goes. */
  | "duplicate"
  /** Its residues aren't one stretch, which a region has to be: it can't be ticked. */
  | "pieces";

export interface FoldRow {
  feature: SeqFeature;
  /** Residues of the CDS, from 1, inclusive; a codon the feature covers in part counts. */
  start: number;
  end: number;
  /** The region it becomes, without an id; its kind is a suggestion the user can change. */
  region: ProteinRegion;
  /** The regions of a CDS folded into this one, renumbered in it, to go under `region`. */
  children: ProteinRegion[];
  flags: FoldFlag[];
  /** Qualifiers that won't survive: the region keeps the name, note and design only. */
  lost: string[];
  /** Whether it starts ticked. */
  ticked: boolean;
  tickable: boolean;
}

/** The colour each feature is drawn in (`featureStyles`), by id. */
export type Fills = ReadonlyMap<string, { fill: string }>;

// Types for a part of a protein: generic ones, the protein ones GenBank has, and ones other
// software lets users write. A CDS inside counts when it reads on in the same frame: a
// fused protein, or a framework annotated as a CDS of its own.
const GENERIC = new Set(["misc_feature", "variation", "region"]);
const PROTEIN = new Set(["sig_peptide", "transit_peptide", "mat_peptide", "propeptide"]);
const OTHER = new Set(["domain", "tag", "linker", "epitope", "motif"]);

/** Kinds that follow from a feature's type. */
const TYPE_KINDS: Record<string, string> = {
  sig_peptide: "Signal peptide",
  transit_peptide: "Transit peptide",
  mat_peptide: "Chain",
  propeptide: "Propeptide",
  domain: "Domain",
  tag: "Tag",
  linker: "Linker",
  motif: "Motif"
};

// A name's words: a match must not run on into letters, so FRT is no framework and This
// no His tag.
const START = "(?:^|[^a-z])";
const END = "(?:[^a-z]|$)";

/** DNA that a generic feature inside a CDS names more often than a part of its protein. */
const DNA_NAME = new RegExp(
  `${START}(?:mcs|polylinker|multiple cloning site|lox[a-z0-9]*|frt\\d*|att[bplr]\\d*|operator|promoter|terminator|enhancer|insulator|ori|orit|origin|kozak|shine[- ]?dalgarno|rbs|ires|utr|poly ?\\(?a\\)?|primer|restriction site)${END}`,
  "i"
);

/** Kinds that follow from a name, tried in order: the first that matches wins. */
const NAME_KINDS: [RegExp, string][] = [
  [new RegExp(`${START}[hl]?cdr`, "i"), "CDR"],
  [new RegExp(`${START}(?:[hl]?fw?r[-_ ]?[hl]?\\d|framework)`, "i"), "Framework"],
  [new RegExp(`${START}(?:v[hl]h?|v[kκλ]|nanobody|variable (?:domain|region))${END}`, "i"), "Variable domain"],
  [new RegExp(`${START}(?:c[hl]\\d?|c[kκλ]|fc|constant (?:domain|region))${END}`, "i"), "Constant domain"],
  [new RegExp(`linker|${START}g4s|\\(g{3,4}s\\)|${START}g{3,4}s${END}`, "i"), "Linker"],
  [new RegExp(`${START}(?:tev|hrv ?3c|3c|prescission|thrombin|enterokinase|factor ?xa|fxa|furin)${END}|cleavage`, "i"), "Cleavage site"],
  [new RegExp(`${START}(?:\\d*x?his\\d*|polyhis|\\d*x?flag|\\d*x?ha|c-?myc|\\d*x?myc|v5|strep(?:-?tag)?(?: ?ii)?|twin-?strep|avi|t7|vsv-?g|ollas|alfa|spot)${END}|tag${END}`, "i"), "Tag"],
  [new RegExp(`${START}[ptef]?2a${END}`, "i"), "Peptide"],
  [new RegExp(`${START}tmd?\\d*${END}|transmembrane`, "i"), "Transmembrane"],
  [new RegExp(`${START}(?:nls|nes|kdel|hdel|pts1)${END}|nuclear (?:localization|localisation|export)|motif`, "i"), "Motif"],
  [new RegExp(`signal|leader|${START}(?:sp|pelb|ompa|dsba|phoa|gp67)${END}`, "i"), "Signal peptide"],
  [new RegExp(`domain|${START}(?:gst|mbp|sumo|trxa?)${END}`, "i"), "Domain"]
];

/** The kind a feature's name suggests, if any. */
export function kindFromName(name: string): string | null {
  return NAME_KINDS.find(([re]) => re.test(name))?.[1] ?? null;
}

/** Qualifiers that only say how a feature is drawn, or what is worked out again. */
const UNLOST = /^(?:label|direction|benchling_strand|translation|codon_start|transl_table|apeinfo_.*)$/i;

const values = (v: unknown): string[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]).map(String);

/** 1 or -1 for a feature drawn with a direction, 0 for one without (as Benchling can say). */
function direction(f: SeqFeature): 0 | 1 | -1 {
  if (f.strand === 0 || values(f.notes.benchling_strand).some(v => v.toLowerCase() === "none")) return 0;
  return f.strand;
}

/** What is worked out once per CDS: where each base falls in its protein. */
interface Protein {
  cds: SeqFeature;
  /** The coding index of each base of the sequence, or -1. */
  at: Int32Array;
  /** Residues, not counting a stop at the end. */
  length: number;
  regions: ProteinRegion[];
  fill?: string;
  varies: boolean;
}

function proteinOf(d: SeqData, cds: SeqFeature, fills?: Fills): Protein {
  const n = d.sequence.length;
  const positions = codingPositions(cds, n);
  const at = new Int32Array(n).fill(-1);
  positions.forEach((p, i) => (at[p] = i));
  let length = Math.floor(positions.length / 3);
  const last = positions.slice((length - 1) * 3, length * 3).map(p => (cds.strand === -1 ? complement(d.sequence[p]) : d.sequence[p])).join("");
  if (length && translateCodon(last) === "*") length--;
  return { cds, at, length, regions: regionsOf(cds), fill: fills?.get(cds.id)?.fill, varies: !!designOf(cds.notes) };
}

/** The row for feature `f` in this protein, or null if it isn't one to list. */
function rowFor(d: SeqData, p: Protein, f: SeqFeature, fills?: Fills): FoldRow | null {
  const { cds } = p;
  const n = d.sequence.length;
  const type = f.type.toLowerCase();
  const coding = type === "cds";
  if (f.id === cds.id || !(coding || GENERIC.has(type) || PROTEIN.has(type) || OTHER.has(type))) return null;
  if (GENERIC.has(type) && DNA_NAME.test(f.name)) return null;
  if (!rangeWithin({ start: f.start, end: f.end }, cds, n)) return null;
  // Every base must be in the protein: none in an intron, before the first whole codon or
  // past the CDS's ends.
  const bases = [...new Set(featurePositions(f, n))];
  if (!bases.length || bases.some(b => p.at[b] < 0)) return null;
  if (coding) {
    // A CDS inside is part of this protein only if it is read the same way, in its frame.
    const first = codingPositions(f, n)[0];
    if (isForward(f) !== isForward(cds) || first === undefined || p.at[first] % 3 !== 0) return null;
    if (bases.length >= codingPositions(cds, n).length) return null;
  }
  const covered = new Map<number, number>();
  for (const b of bases) {
    const i = p.at[b];
    if (i < p.length * 3) covered.set(Math.floor(i / 3), (covered.get(Math.floor(i / 3)) ?? 0) + 1);
  }
  if (!covered.size) return null; // Only the stop codon.
  const residues = [...covered.keys()].sort((a, b) => a - b);
  const start = residues[0] + 1;
  const end = residues[residues.length - 1] + 1;
  const flags: FoldFlag[] = [];
  const pieces = end - start + 1 !== residues.length;
  if (pieces) flags.push("pieces");
  if ([...covered.values()].some(c => c < 3)) flags.push("partial-codon");
  const dir = direction(f);
  if (!coding && dir !== 0 && dir !== (isForward(cds) ? 1 : -1)) flags.push("opposite-strand");
  const name = f.name.trim() || f.type;
  if (p.regions.some(r => r.name.trim().toLowerCase() === name.toLowerCase() && r.start === start && r.end === end)) flags.push("duplicate");

  // What was written when a region became this feature tells its kind and source; any
  // other note is the user's, kept as the region's note.
  const notes = values(f.notes.note);
  const madeAt = notes.findIndex(v => parseRegionFeatureNote(v));
  const made = madeAt < 0 ? null : parseRegionFeatureNote(notes[madeAt])!;
  const note = notes.filter((_, i) => i !== madeAt).map(l => l.trim()).filter(Boolean).join("\n");
  const kind = made?.kind ?? TYPE_KINDS[type] ?? kindFromName(name) ?? (coding ? "Domain" : "Region");

  // The feature's own colour, unless the app doesn't draw it (white) or it is the CDS's,
  // where the region's stripe wouldn't show.
  const drawn = fills?.get(f.id)?.fill;
  const own = f.color && /^#[0-9a-f]{6}$/i.test(f.color) && (!fills || drawn?.toLowerCase() === f.color.toLowerCase()) && f.color.toLowerCase() !== p.fill?.toLowerCase() ? f.color : undefined;

  // A design can't go on a region of a CDS that varies as a whole, or overlap another's.
  const design = designOf(f.notes) ?? undefined;
  const designFits = !p.varies && !p.regions.some(r => r.variable && r.start <= end && r.end >= start);
  const lost = otherQualifiers(f.notes).map(q => q.name).filter(q => !UNLOST.test(q));
  if (design && !designFits) lost.push("library design");

  const region: ProteinRegion = {
    name,
    kind,
    start,
    end,
    accession: made?.accession ?? "",
    sourceStart: made?.sourceStart ?? start,
    sourceEnd: made?.sourceEnd ?? end,
    predicted: made?.predicted ?? false,
    ...(own ? { color: own } : {}),
    ...(note ? { note } : {}),
    ...(design && designFits ? { variable: design } : {})
  };
  // A CDS's own regions come along, numbered from its first whole codon here.
  const shift = coding ? p.at[codingPositions(f, n)[0]] / 3 : 0;
  const children = coding
    ? regionsOf(f).map(r => ({ ...r, start: r.start + shift, end: Math.min(p.length, r.end + shift), ...(r.accession ? {} : { sourceStart: r.start + shift, sourceEnd: Math.min(p.length, r.end + shift) }) }))
    : [];
  const tickable = !pieces;
  return { feature: f, start, end, region, children, flags, lost, ticked: tickable && !flags.includes("opposite-strand") && !flags.includes("duplicate"), tickable };
}

/** The features listed for turning into regions of `cds`, in order along its protein. */
export function foldRows(d: SeqData, cds: SeqFeature, fills?: Fills): FoldRow[] {
  if (cds.type.toUpperCase() !== "CDS") return [];
  const p = proteinOf(d, cds, fills);
  if (!p.length) return [];
  return d.features
    .flatMap(f => rowFor(d, p, f, fills) ?? [])
    .sort((a, b) => a.start - b.start || b.end - a.end || a.region.name.localeCompare(b.region.name));
}

/** How many features start ticked: the link and menu item show only when there are any. */
export const foldOffered = (rows: readonly FoldRow[]) => rows.filter(r => r.ticked).length;

/** Every CDS that feature `f` can become a region of, with its row there. */
export function foldTargets(d: SeqData, f: SeqFeature, fills?: Fills): { cds: SeqFeature; row: FoldRow }[] {
  const n = d.sequence.length;
  return d.features.flatMap(cds => {
    if (cds.id === f.id || cds.type.toUpperCase() !== "CDS" || !rangeWithin({ start: f.start, end: f.end }, cds, n)) return [];
    const p = proteinOf(d, cds, fills);
    const row = p.length ? rowFor(d, p, f, fills) : null;
    return row?.tickable ? [{ cds, row }] : [];
  });
}

/**
 * The colour each chosen row's region gets: its own, else the next of the CDS's palette
 * after the regions it has and those placed before it. The dialog shows the same ones.
 */
export function foldColors(regions: readonly ProteinRegion[], chosen: readonly FoldRow[], fill?: string): Map<string, string> {
  const placed: ProteinRegion[] = [...regions];
  const out = new Map<string, string>();
  for (const row of chosen) {
    if (row.flags.includes("duplicate")) continue;
    const color = row.region.color ?? nextRegionColor(placed, fill);
    out.set(row.feature.id, color);
    placed.push({ ...row.region, color }, ...row.children);
  }
  return out;
}

/**
 * Turns the chosen features into regions of the CDS and deletes them, as one new document
 * (one undo step). `chosen` maps each ticked feature's id to the kind picked for it. A new
 * region goes under the smallest region, new or old, that holds it and is larger; regions
 * already there stay as they were. Returns null if nothing chosen can be turned.
 */
export function foldFeatures(
  d: SeqData,
  cdsId: string,
  chosen: ReadonlyMap<string, string>,
  opts: { fills?: Fills; makeId?: () => string } = {}
): { data: SeqData; regionIds: Map<string, string> } | null {
  const makeId = opts.makeId ?? (() => newId("r"));
  const cds = d.features.find(f => f.id === cdsId);
  if (!cds) return null;
  const rows = foldRows(d, cds, opts.fills).filter(r => r.tickable && chosen.has(r.feature.id));
  if (!rows.length) return null;
  const old = regionsOf(cds).map(r => ({ ...r, id: r.id ?? makeId() }));
  const taken = new Set(old.map(r => r.id));
  const fresh = (id?: string) => {
    let out = id && !taken.has(id) ? id : makeId();
    while (taken.has(out)) out = makeId();
    taken.add(out);
    return out;
  };
  const colors = foldColors(old, rows, opts.fills?.get(cds.id)?.fill);
  const added: (ProteinRegion & { id: string })[] = [];
  const children: ProteinRegion[] = [];
  const regionIds = new Map<string, string>();
  for (const row of rows) {
    if (row.flags.includes("duplicate")) continue;
    const kind = chosen.get(row.feature.id)?.trim() || row.region.kind;
    const region = { ...row.region, id: fresh(), kind, color: colors.get(row.feature.id) };
    // Library designs never overlap: the first chosen keeps its own.
    if (region.variable && [...added, ...children].some(r => r.variable && r.start <= region.end && r.end >= region.start)) delete region.variable;
    added.push(region);
    regionIds.set(row.feature.id, region.id);
    // A folded CDS's regions keep their nesting under the region it became.
    const ids = row.children.map(c => fresh(c.id));
    const renamed = new Map(row.children.flatMap((c, i) => (c.id ? [[c.id, ids[i]] as const] : [])));
    row.children.forEach((c, i) => children.push({ ...c, id: ids[i], parentId: (c.parentId && renamed.get(c.parentId)) || region.id }));
  }
  const holders = [...old, ...added];
  for (const r of added) {
    const parent = holders
      .filter(o => o !== r && o.start <= r.start && o.end >= r.end && (o.start < r.start || o.end > r.end))
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0];
    if (parent) r.parentId = parent.id;
  }
  const gone = new Set(rows.map(r => r.feature.id));
  const next = { ...cds, notes: withRegions(cds.notes, [...old, ...added, ...children]) };
  return { data: { ...d, features: d.features.filter(f => !gone.has(f.id)).map(f => (f.id === cdsId ? next : f)) }, regionIds };
}
