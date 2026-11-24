// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What UniProt says about a protein, placed on a CDS. A construct's protein is rarely
// UniProt's exactly: both mRNAs that entry Q9UKG4 cites differ from it, one by a residue
// more, and tags, fusions and truncations are the norm. So residues are never taken at face
// value: the CDS's translation is aligned to the entry, and each region is carried across
// that alignment. Pure, so it is unit-tested; the fetching is in `src/platform.ts`.

import type { ProteinRegion } from "./regions.ts";

/** Below this the CDS isn't taken to be the entry's protein: placing regions would be a guess. */
export const MIN_IDENTITY = 0.6;
export const MIN_ALIGNED = 20;
/**
 * A region this alike, all of it facing the CDS's residues, is well supported: it starts
 * ticked. A fusion's partner, or the other protein of a chimera, lines up with less, as
 * homologues share well under this outside their most conserved stretches.
 */
export const STRONG_IDENTITY = 0.8;
/** Cells of the alignment, a byte each: two proteins of about 8,000 residues. */
const MAX_CELLS = 64_000_000;

const MATCH = 5;
const MISMATCH = -3;
const GAP_OPEN = -12;
const GAP_EXTEND = -1;

const ACCESSION = /[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2}/;

const accessionIn = () => new RegExp(`(?:^|[^A-Z0-9])(${ACCESSION.source})(-\\d+)?(?![A-Z0-9])`, "g");

/** Every accession in what was typed or pasted (IDs, or links to entries), each once, in order. */
export function parseAccessions(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toUpperCase().matchAll(accessionIn())) {
    const accession = m[1] + (m[2] ?? "");
    if (!out.includes(accession)) out.push(accession);
  }
  return out;
}

/** The accession in what was typed or pasted (an ID, or a link to the entry), or null. */
export function parseAccession(text: string): string | null {
  return parseAccessions(text.trim())[0] ?? null;
}

/** One thing to look up: an accession, or what was typed where one was meant (`accession` null). */
export interface Lookup {
  typed: string;
  accession: string | null;
}

/**
 * What was typed or pasted, piece by piece: each accession (an ID, or a link to the entry)
 * once, and each piece that was meant as one but isn't, so the user is told rather than
 * left wondering. A piece with no digit (a word such as "and", or "UniProt:") was never
 * meant as one, as every accession has digits.
 */
export function lookupsIn(text: string): Lookup[] {
  const out: Lookup[] = [];
  for (const typed of text.split(/[\s,;]+/)) {
    if (!/\d/.test(typed)) continue;
    const found = parseAccessions(typed);
    if (!found.length && !out.some(x => x.typed === typed)) out.push({ typed, accession: null });
    for (const accession of found) if (!out.some(x => x.accession === accession)) out.push({ typed: accession, accession });
  }
  return out;
}

// ---------- lookups that fail ----------

/** Why a lookup gave no entry: not found, no network, or something else. */
export type LookupFailure =
  | { kind: "not an accession" }
  | { kind: "not found" }
  /** UniProt answered, but with an entry that has no sequence: deleted, or merged away. */
  | { kind: "no sequence" }
  | { kind: "network" }
  | { kind: "error"; status: number }
  | { kind: "unreadable" }
  | { kind: "other"; message: string };

/** A lookup that failed: which accession, and why. */
export class UniprotLookupError extends Error {
  readonly accession: string;
  readonly failure: LookupFailure;
  constructor(accession: string, failure: LookupFailure) {
    super(`${accession}: ${failureText(failure)}`);
    this.name = "UniprotLookupError";
    this.accession = accession;
    this.failure = failure;
  }
}

/** What an answer's HTTP status means for the lookup: null for an entry to read. */
export function statusFailure(status: number): LookupFailure | null {
  if (status >= 200 && status < 300) return null;
  // 400 is UniProt's answer to an ID that isn't one of its accessions.
  if (status === 400 || status === 404 || status === 410) return { kind: "not found" };
  return { kind: "error", status };
}

/** Why a lookup failed, after the accession it was for and a colon. */
export function failureText(failure: LookupFailure): string {
  switch (failure.kind) {
    case "not an accession":
      return "not a UniProt accession, so it wasn't looked up. Accessions look like P42212 or Q9UKG4.";
    case "not found":
      return "not found. UniProt has no entry with this accession.";
    case "no sequence":
      return "not found. UniProt no longer lists this entry: it may have been deleted or merged into another.";
    case "network":
      return "network error. UniProt couldn't be reached: check your internet connection and try again.";
    case "error":
      return `UniProt answered with an error (${failure.status}). Try again later.`;
    case "unreadable":
      return "UniProt's answer couldn't be read. Try again later.";
    case "other":
      return `couldn't be looked up (${failure.message}).`;
  }
}

/** Why a lookup threw, whatever threw it. */
export function failureOf(e: unknown): LookupFailure {
  if (e instanceof UniprotLookupError) return e.failure;
  return { kind: "other", message: e instanceof Error ? e.message : String(e) };
}

/** Whether looking it up again may help: not when the accession is wrong. */
export const worthRetrying = (failure: LookupFailure) => failure.kind !== "not an accession" && failure.kind !== "not found" && failure.kind !== "no sequence";

const UNIPROT_XREF = /^(?:UniProt(?:KB)?(?:\/(?:Swiss-Prot|TrEMBL))?|Swiss-?Prot):(.+)$/i;
const xrefs = (notes: Record<string, unknown> | undefined) => {
  const raw = notes?.db_xref;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
};

/** The UniProt entries in a feature's /db_xref qualifiers, as ENA's records have them. */
export function accessionsOf(notes: Record<string, unknown> | undefined): string[] {
  const out: string[] = [];
  for (const v of xrefs(notes)) {
    const m = UNIPROT_XREF.exec(String(v).trim());
    const accession = m && parseAccession(m[1]);
    if (accession && !out.includes(accession)) out.push(accession);
  }
  return out;
}

/** The first UniProt entry in a feature's /db_xref qualifiers, or null. */
export const accessionOf = (notes: Record<string, unknown> | undefined): string | null => accessionsOf(notes)[0] ?? null;

/**
 * Qualifiers with this entry among the feature's UniProt cross-references. Every other
 * cross-reference stays, other UniProt entries too; one for the same entry is replaced, as
 * an entry can move from TrEMBL to Swiss-Prot.
 */
export function withAccession(notes: Record<string, unknown>, accession: string, reviewed: boolean): Record<string, unknown> {
  const others = xrefs(notes).filter(v => {
    const m = UNIPROT_XREF.exec(String(v).trim());
    return !m || parseAccession(m[1]) !== accession;
  });
  return { ...notes, db_xref: [...others, `UniProtKB/${reviewed ? "Swiss-Prot" : "TrEMBL"}:${accession}`] };
}

// ---------- the entry ----------

export interface UniprotFeature {
  /** UniProt's section and name for it, with a number where there are several. */
  name: string;
  kind: string;
  /** Residues of the entry, from 1, inclusive. */
  start: number;
  end: number;
  predicted: boolean;
}

export interface UniprotEntry {
  accession: string;
  reviewed: boolean;
  /** The gene's name, or the protein's. */
  title: string;
  sequence: string;
  features: UniprotFeature[];
}

const KINDS: Record<string, string> = {
  Transmembrane: "Transmembrane",
  Intramembrane: "Intramembrane",
  "Topological domain": "Topological domain",
  Signal: "Signal peptide",
  "Transit peptide": "Transit peptide",
  Domain: "Domain",
  Region: "Region",
  Repeat: "Repeat",
  Motif: "Motif",
  "Coiled coil": "Coiled coil",
  "Compositional bias": "Compositional bias",
  Propeptide: "Propeptide",
  Peptide: "Peptide",
  Chain: "Chain"
};

/** Evidence codes for "inferred from the sequence", as against shown by experiment. */
const PREDICTED = new Set(["ECO:0000255", "ECO:0000256", "ECO:0000259"]);

const obj = (x: unknown) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});
const list = (x: unknown) => (Array.isArray(x) ? (x as unknown[]) : []);

/** Reads the REST API's JSON for an entry; null if it holds no sequence (a deleted entry). */
export function parseEntry(json: unknown): UniprotEntry | null {
  const e = obj(json);
  const sequence = String(obj(e.sequence).value ?? "");
  if (!sequence) return null;
  const counts = new Map<string, number>();
  const features: UniprotFeature[] = [];
  for (const item of list(e.features)) {
    const f = obj(item);
    const kind = KINDS[String(f.type)];
    const location = obj(f.location);
    const start = Number(obj(location.start).value);
    const end = Number(obj(location.end).value);
    // Ends UniProt doesn't know are given as unknown, with no number or a negative one.
    if (!kind || !(start >= 1) || !(end >= start)) continue;
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    const description = String(f.description ?? "").trim();
    const evidence = list(f.evidences).map(x => String(obj(x).evidenceCode));
    features.push({
      name: kind === "Transmembrane" ? `TM${count}` : kind === "Intramembrane" ? `IM${count}` : description || kind,
      kind,
      start,
      end,
      predicted: evidence.length > 0 && evidence.every(code => PREDICTED.has(code))
    });
  }
  const genes = list(e.genes);
  const gene = obj(obj(genes[0]).geneName).value;
  const description = obj(e.proteinDescription);
  const protein = obj(obj(description.recommendedName).fullName).value ?? obj(obj(list(description.submissionNames)[0]).fullName).value;
  return {
    accession: String(e.primaryAccession ?? ""),
    reviewed: String(e.entryType ?? "").includes("reviewed") && !String(e.entryType).includes("unreviewed"),
    title: String(gene ?? protein ?? ""),
    sequence,
    features
  };
}

// ---------- the alignment ----------

/** A column of an alignment: a residue of each facing the other, or one facing a gap. */
export const PAIR = 0;
/** A residue of the CDS that the entry lacks. */
export const CDS_ONLY = 1;
/** A residue of the entry that the CDS lacks. */
export const ENTRY_ONLY = 2;

/** Residues of the CDS, from 1, inclusive: where the user said an entry's part of it is. */
export interface ResidueRange {
  start: number;
  end: number;
}

export interface ProteinAlignment {
  /** For each residue of the entry (from 0), the residue of the CDS facing it, or -1. */
  map: Int32Array;
  /** Residues aligned to each other, and how many of those are the same. */
  aligned: number;
  same: number;
  /** The two proteins: all of the CDS's, even when only part of it was searched. */
  cds: string;
  entry: string;
  /**
   * The alignment as traceback found it: where it starts in each protein (from 0) and its
   * columns from there (`PAIR`, `CDS_ONLY`, `ENTRY_ONLY`), so a region's gaps can be
   * counted and shown, not only its ends.
   */
  cdsStart: number;
  entryStart: number;
  path: Uint8Array;
  /** The CDS residues searched, if the user limited them; numbers stay the whole CDS's. */
  within: ResidueRange | null;
}

/**
 * Local alignment with affine gaps (Smith-Waterman-Gotoh), since a tag or a fusion partner
 * shouldn't count against a match, and an indel must not throw off what follows it. With
 * `within`, only those residues of the CDS are searched, as where a chimera's junction is
 * is the user's to say. Null if the proteins are too long to compare.
 */
export function alignProteins(cds: string, entry: string, within?: ResidueRange | null): ProteinAlignment | null {
  const from = within ? Math.max(1, Math.round(within.start)) : 1;
  const to = within ? Math.min(cds.length, Math.round(within.end)) : cds.length;
  const offset = from - 1;
  const part = cds.slice(offset, to);
  const n = part.length;
  const m = entry.length;
  if (!n || !m || (n + 1) * (m + 1) > MAX_CELLS) return null;
  const w = m + 1;
  // Each cell's way back: 2 bits for the best score (0 stop, 1 diagonal, 2 up, 3 left), a
  // bit each for whether a gap in that direction opened here or carries on.
  const back = new Uint8Array((n + 1) * w);
  const score = new Int32Array(w);
  const up = new Int32Array(w).fill(GAP_OPEN * 2);
  let best = 0;
  let bestCell = 0;
  for (let i = 1; i <= n; i++) {
    let diagonal = 0;
    let left = GAP_OPEN * 2;
    const a = part.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const openUp = score[j] + GAP_OPEN;
      const extendUp = up[j] + GAP_EXTEND;
      const u = extendUp > openUp ? extendUp : openUp;
      const openLeft = score[j - 1] + GAP_OPEN;
      const extendLeft = left + GAP_EXTEND;
      left = extendLeft > openLeft ? extendLeft : openLeft;
      up[j] = u;
      const d = diagonal + (a === entry.charCodeAt(j - 1) ? MATCH : MISMATCH);
      let s = 0;
      let way = 0;
      if (d > s) (s = d), (way = 1);
      if (u > s) (s = u), (way = 2);
      if (left > s) (s = left), (way = 3);
      diagonal = score[j];
      score[j] = s;
      back[i * w + j] = way | (extendUp > openUp ? 4 : 0) | (extendLeft > openLeft ? 8 : 0);
      if (s > best) (best = s), (bestCell = i * w + j);
    }
  }
  const map = new Int32Array(m).fill(-1);
  // Columns are found from the end; written backwards from the end of this buffer.
  const columns = new Uint8Array(n + m);
  let k = columns.length;
  let aligned = 0;
  let same = 0;
  let i = Math.floor(bestCell / w);
  let j = bestCell % w;
  let state = back[bestCell] & 3;
  while (i > 0 && j > 0 && state) {
    const cell = back[i * w + j];
    if (state === 1) {
      map[j - 1] = offset + i - 1;
      aligned++;
      if (part[i - 1] === entry[j - 1]) same++;
      columns[--k] = PAIR;
      i--;
      j--;
      state = back[i * w + j] & 3;
    } else if (state === 2) {
      const extends_ = cell & 4;
      columns[--k] = CDS_ONLY;
      i--;
      state = extends_ ? 2 : back[i * w + j] & 3;
    } else {
      const extends_ = cell & 8;
      columns[--k] = ENTRY_ONLY;
      j--;
      state = extends_ ? 3 : back[i * w + j] & 3;
    }
  }
  return {
    map,
    aligned,
    same,
    cds,
    entry,
    cdsStart: offset + i,
    entryStart: j,
    path: columns.slice(k),
    within: within && (from > 1 || to < cds.length) ? { start: from, end: to } : null
  };
}

// ---------- a region across the alignment ----------

/** How one of the entry's regions lines up with the CDS. */
export interface RegionMatch {
  /** Residues of the region in the entry. */
  length: number;
  /** Those facing a residue of the CDS, and how many of those are the same. */
  pairs: number;
  same: number;
  /** Residues of the CDS between the region's own that face none of the entry's. */
  inserted: number;
  /** Residues of the region before its first that faces the CDS, and after its last. */
  missingStart: number;
  missingEnd: number;
  /** The first and last residues facing each other (from 0), or -1 if none do. */
  entryFirst: number;
  entryLast: number;
  cdsFirst: number;
  cdsLast: number;
}

/** Identical residues over aligned pairs, 0…1. */
export const regionIdentity = (r: RegionMatch) => (r.pairs ? r.same / r.pairs : 0);

/** The region of the entry from `start` to `end` (from 1, inclusive) as the alignment has it. */
export function regionMatch(a: ProteinAlignment, start: number, end: number): RegionMatch {
  const first = start - 1;
  const last = Math.min(end, a.entry.length) - 1;
  let pairs = 0;
  let same = 0;
  let inserted = 0;
  let entryFirst = -1;
  let entryLast = -1;
  let e = a.entryStart;
  let c = a.cdsStart;
  for (let k = 0; k < a.path.length && e <= last; k++) {
    const column = a.path[k];
    if (column === PAIR) {
      if (e >= first) {
        pairs++;
        if (a.cds[c] === a.entry[e]) same++;
        if (entryFirst < 0) entryFirst = e;
        entryLast = e;
      }
      e++;
      c++;
    } else if (column === CDS_ONLY) {
      // Between two of the region's residues, whether or not they face anything.
      if (e > first && e <= last) inserted++;
      c++;
    } else e++;
  }
  const length = last - first + 1;
  return {
    length,
    pairs,
    same,
    inserted,
    missingStart: entryFirst < 0 ? length : entryFirst - first,
    missingEnd: entryLast < 0 ? length : last - entryLast,
    entryFirst,
    entryLast,
    cdsFirst: entryFirst < 0 ? -1 : a.map[entryFirst],
    cdsLast: entryLast < 0 ? -1 : a.map[entryLast]
  };
}

/** A column to show: residues of each (from 0), or null for a gap. */
export interface ShownColumn {
  entry: number | null;
  cds: number | null;
}

/**
 * The alignment under a region, as placing it used it: every residue of the region in the
 * entry, facing a CDS residue or a gap, with the CDS's own residues that fall between them.
 */
export function regionColumns(a: ProteinAlignment, start: number, end: number): ShownColumn[] {
  const first = start - 1;
  const last = Math.min(end, a.entry.length) - 1;
  const out: ShownColumn[] = [];
  // Residues of the region before the alignment starts face nothing.
  for (let e = first; e <= last && e < a.entryStart; e++) out.push({ entry: e, cds: null });
  let e = a.entryStart;
  let c = a.cdsStart;
  for (let k = 0; k < a.path.length && e <= last; k++) {
    const column = a.path[k];
    if (column === PAIR) {
      if (e >= first) out.push({ entry: e, cds: c });
      e++;
      c++;
    } else if (column === CDS_ONLY) {
      if (e > first && e <= last) out.push({ entry: null, cds: c });
      c++;
    } else {
      if (e >= first) out.push({ entry: e, cds: null });
      e++;
    }
  }
  // And so do those after it ends.
  for (let r = Math.max(e, first); r <= last; r++) out.push({ entry: r, cds: null });
  return out;
}

/** One line of a shown alignment, with the first and last residue of each (from 1) on it. */
export interface AlignmentLine {
  entry: string;
  marks: string;
  cds: string;
  entryFrom: number | null;
  entryTo: number | null;
  cdsFrom: number | null;
  cdsTo: number | null;
}

/** Columns as lines of text: residues or "-", and "|" for the same residue, "·" for another. */
export function alignmentLines(a: ProteinAlignment, columns: ShownColumn[], width = 50): AlignmentLine[] {
  const lines: AlignmentLine[] = [];
  for (let at = 0; at < columns.length; at += width) {
    const slice = columns.slice(at, at + width);
    const entries = slice.flatMap(x => (x.entry === null ? [] : [x.entry + 1]));
    const cdss = slice.flatMap(x => (x.cds === null ? [] : [x.cds + 1]));
    lines.push({
      entry: slice.map(x => (x.entry === null ? "-" : a.entry[x.entry])).join(""),
      marks: slice.map(x => (x.entry === null || x.cds === null ? " " : a.entry[x.entry] === a.cds[x.cds] ? "|" : "·")).join(""),
      cds: slice.map(x => (x.cds === null ? "-" : a.cds[x.cds])).join(""),
      entryFrom: entries[0] ?? null,
      entryTo: entries[entries.length - 1] ?? null,
      cdsFrom: cdss[0] ?? null,
      cdsTo: cdss[cdss.length - 1] ?? null
    });
  }
  return lines;
}

// ---------- placing regions ----------

/**
 * Whole: every residue faces one of the CDS's, with nothing between. Gapped: both ends do,
 * but residues inside face gaps or the CDS has residues the entry lacks. Clipped: one end or
 * both face nothing, so only part of it is here. Absent: none of it is.
 */
export type Placement = "whole" | "gapped" | "clipped" | "absent";

export interface PlacedFeature {
  feature: UniprotFeature;
  /** What it is known by among the entry's regions (`ProteinRegion.sourceKey`). */
  key: string;
  placement: Placement;
  /** In this CDS, from the first residue facing it to the last; null if none of it is here. */
  region: ProteinRegion | null;
  match: RegionMatch;
  /** Part of it may lie past the CDS residues the user limited the search to. */
  pastLimit: boolean;
}

/** The key a region is known by among its entry's, so another import finds it again. */
export const regionKey = (r: Pick<ProteinRegion, "kind" | "sourceStart" | "sourceEnd" | "sourceKey">) => r.sourceKey ?? `${r.kind}:${r.sourceStart}-${r.sourceEnd}`;

/** Carries an entry's features across the alignment onto a CDS. */
export function placeFeatures(entry: UniprotEntry, alignment: ProteinAlignment): PlacedFeature[] {
  const keys = new Map<string, number>();
  const within = alignment.within;
  return entry.features.map(feature => {
    const match = regionMatch(alignment, feature.start, feature.end);
    // UniProt can list two regions of a kind over the same residues (a disordered stretch
    // and a binding region); the second is told apart, so an import finds each again.
    const base = `${feature.kind}:${feature.start}-${feature.end}`;
    const seen = (keys.get(base) ?? 0) + 1;
    keys.set(base, seen);
    const key = seen > 1 ? `${base}#${seen}` : base;
    if (!match.pairs) return { feature, key, placement: "absent", region: null, match, pastLimit: !!within };
    const region: ProteinRegion = {
      name: feature.name,
      kind: feature.kind,
      sourceKey: key,
      start: match.cdsFirst + 1,
      end: match.cdsLast + 1,
      accession: entry.accession,
      sourceStart: match.entryFirst + 1,
      sourceEnd: match.entryLast + 1,
      predicted: feature.predicted
    };
    const placement: Placement = match.missingStart || match.missingEnd ? "clipped" : match.pairs < match.length || match.inserted ? "gapped" : "whole";
    // Residues it lacks at an end would have had to fit between it and the limit.
    const pastLimit = !!within && ((match.missingStart > 0 && within.start > 1 && match.cdsFirst - (within.start - 1) < match.missingStart) ||
      (match.missingEnd > 0 && within.end < alignment.cds.length && within.end - 1 - match.cdsLast < match.missingEnd));
    return { feature, key, placement, region, match, pastLimit };
  });
}

/** Whole, and alike enough to place without a second look. */
export const wellSupported = (p: PlacedFeature) => p.placement === "whole" && regionIdentity(p.match) >= STRONG_IDENTITY;

export interface Match {
  /** Share of aligned residues that are the same, 0…1. */
  identity: number;
  aligned: number;
  /** Where the alignment starts and ends in each protein, from 1. */
  entryFrom: number;
  entryTo: number;
  cdsFrom: number;
  cdsTo: number;
  /** Is it fair to place the entry's features on this CDS? */
  ok: boolean;
}

export function describeAlignment(a: ProteinAlignment): Match {
  const identity = a.aligned ? a.same / a.aligned : 0;
  let entryLength = 0;
  let cdsLength = 0;
  for (const column of a.path) {
    if (column !== CDS_ONLY) entryLength++;
    if (column !== ENTRY_ONLY) cdsLength++;
  }
  return {
    identity,
    aligned: a.aligned,
    entryFrom: a.entryStart + 1,
    entryTo: a.entryStart + entryLength,
    cdsFrom: a.cdsStart + 1,
    cdsTo: a.cdsStart + cdsLength,
    ok: a.aligned >= MIN_ALIGNED && identity >= MIN_IDENTITY
  };
}

/** The protein of a CDS as UniProt would write it: no stop at the end. */
export const translationForMatch = (protein: string) => protein.replace(/\*+$/, "");
