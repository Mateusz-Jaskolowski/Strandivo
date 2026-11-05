// What UniProt says about a protein, placed on a CDS. A construct's protein is rarely
// UniProt's exactly: both mRNAs that entry Q9UKG4 cites differ from it, one by a residue
// more, and tags, fusions and truncations are the norm. So residues are never taken at face
// value: the CDS's translation is aligned to the entry, and each region is carried across
// that alignment. Pure, so it is unit-tested; the fetching is in `src/platform.ts`.

import { isClipped, type ProteinRegion } from "./regions.ts";

/** Below this the CDS isn't taken to be the entry's protein: placing regions would be a guess. */
export const MIN_IDENTITY = 0.6;
export const MIN_ALIGNED = 20;
/** Cells of the alignment, a byte each: two proteins of about 8,000 residues. */
const MAX_CELLS = 64_000_000;

const MATCH = 5;
const MISMATCH = -3;
const GAP_OPEN = -12;
const GAP_EXTEND = -1;

const ACCESSION = /[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2}/;

/** The accession in what was typed or pasted (an ID, or a link to the entry), or null. */
export function parseAccession(text: string): string | null {
  const m = new RegExp(`(?:^|[^A-Z0-9])(${ACCESSION.source})(-\\d+)?(?![A-Z0-9])`).exec(text.trim().toUpperCase());
  return m ? m[1] + (m[2] ?? "") : null;
}

/** The accession in a feature's /db_xref qualifiers, as ENA's records have it. */
export function accessionOf(notes: Record<string, unknown> | undefined): string | null {
  const raw = notes?.db_xref;
  for (const v of Array.isArray(raw) ? raw : raw ? [raw] : []) {
    const m = /^(?:UniProt(?:KB)?(?:\/(?:Swiss-Prot|TrEMBL))?|Swiss-?Prot):(.+)$/i.exec(String(v).trim());
    if (m) return parseAccession(m[1]);
  }
  return null;
}

/** Qualifiers with this entry as the feature's UniProt cross-reference, the others kept. */
export function withAccession(notes: Record<string, unknown>, accession: string, reviewed: boolean): Record<string, unknown> {
  const raw = notes.db_xref;
  const others = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(v => !/^(?:UniProt|Swiss-?Prot)/i.test(String(v)));
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
  "Transit peptide": "Transit peptide"
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

export interface ProteinAlignment {
  /** For each residue of the entry (from 0), the residue of the CDS facing it, or -1. */
  map: Int32Array;
  /** Residues aligned to each other, and how many of those are the same. */
  aligned: number;
  same: number;
}

/**
 * Local alignment with affine gaps (Smith-Waterman-Gotoh), since a tag or a fusion partner
 * shouldn't count against a match, and an indel must not throw off what follows it. Null
 * if the proteins are too long to compare.
 */
export function alignProteins(cds: string, entry: string): ProteinAlignment | null {
  const n = cds.length;
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
    const a = cds.charCodeAt(i - 1);
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
  let aligned = 0;
  let same = 0;
  let i = Math.floor(bestCell / w);
  let j = bestCell % w;
  let state = back[bestCell] & 3;
  while (i > 0 && j > 0 && state) {
    const cell = back[i * w + j];
    if (state === 1) {
      map[j - 1] = i - 1;
      aligned++;
      if (cds[i - 1] === entry[j - 1]) same++;
      i--;
      j--;
      state = back[i * w + j] & 3;
    } else if (state === 2) {
      const extends_ = cell & 4;
      i--;
      state = extends_ ? 2 : back[i * w + j] & 3;
    } else {
      const extends_ = cell & 8;
      j--;
      state = extends_ ? 3 : back[i * w + j] & 3;
    }
  }
  return { map, aligned, same };
}

// ---------- placing regions ----------

export type Placement = "whole" | "clipped" | "absent";

export interface PlacedFeature {
  feature: UniprotFeature;
  placement: Placement;
  /** In this CDS; null if none of it is here. */
  region: ProteinRegion | null;
}

/** Carries an entry's features across the alignment onto a CDS. */
export function placeFeatures(entry: UniprotEntry, alignment: ProteinAlignment): PlacedFeature[] {
  return entry.features.map(feature => {
    let first = -1;
    let last = -1;
    for (let i = feature.start - 1; i < feature.end && i < alignment.map.length; i++) {
      if (alignment.map[i] < 0) continue;
      if (first < 0) first = i;
      last = i;
    }
    if (first < 0) return { feature, placement: "absent", region: null };
    const region: ProteinRegion = {
      name: feature.name,
      kind: feature.kind,
      start: alignment.map[first] + 1,
      end: alignment.map[last] + 1,
      accession: entry.accession,
      sourceStart: first + 1,
      sourceEnd: last + 1,
      predicted: feature.predicted
    };
    const whole = first === feature.start - 1 && last === feature.end - 1;
    return { feature, placement: whole && !isClipped(region) ? "whole" : "clipped", region };
  });
}

export interface Match {
  /** Share of aligned residues that are the same, 0…1. */
  identity: number;
  aligned: number;
  /** Is it fair to place the entry's features on this CDS? */
  ok: boolean;
}

export function describeAlignment(a: ProteinAlignment): Match {
  const identity = a.aligned ? a.same / a.aligned : 0;
  return { identity, aligned: a.aligned, ok: a.aligned >= MIN_ALIGNED && identity >= MIN_IDENTITY };
}

/** The protein of a CDS as UniProt would write it: no stop at the end. */
export const translationForMatch = (protein: string) => protein.replace(/\*+$/, "");
