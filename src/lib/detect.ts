// The review step of feature detection: how a suggestion reads, and what accepting it adds
// to the document. The search itself runs in the Rust core
// (crates/seqcore/src/annotate.rs); this is only the part between it and the user, so it
// stays pure and `npm test` covers it.

import { newId, type SeqFeature, type Strand } from "./seqdata.ts";

/** A feature the file already has, so the same thing isn't suggested again. */
export interface ExistingFeature {
  /** The file's own feature type. */
  kind: string;
  start: number;
  end: number;
  /** 1, -1, or 0 when the file gives no direction. */
  strand: number;
}

export interface DetectRequest {
  sequence: string;
  circular: boolean;
  existing: ExistingFeature[];
}

/** One catalog part found in the sequence. Mirrors `SuggestionDto` in the shell. */
export interface Suggestion {
  partId: string;
  name: string;
  /** GenBank feature type, so it can be added as it stands. */
  kind: string;
  /** 0-based and inclusive; `start > end` crosses the origin. */
  start: number;
  end: number;
  strand: number;
  identity: number;
  /** Percent of the catalog entry covered. */
  coverage: number;
  fragment: boolean;
  /** `protein` when the match was made by translating: the identity is the protein's. */
  molecule?: string;
  /** `ncbi`, `amrfinder`, `defined`, `literal`, `uniprot` or `fpbase`. */
  source: string;
  accession: string;
  reference: string;
  note: string;
}

export interface DetectResponse {
  suggestions: Suggestion[];
  /** Fingerprint of the catalog these came from; cached results keep it. */
  catalogVersion?: string;
}

/**
 * Whether a file is annotated so thinly that it is worth offering to look for parts. A
 * plasmid carries something every kilobase or two, so a file with far less than that was
 * either never annotated or only partly. Nothing is done about it here: the offer is a
 * suggestion, and the user may always ask for it themselves.
 */
export function looksUnannotated(featureCount: number, length: number): boolean {
  if (length < 500) return false;
  if (featureCount === 0) return true;
  return featureCount / (length / 2000) < 1;
}

const INTEGER = new Intl.NumberFormat("en-US");
const num = (n: number) => INTEGER.format(n);

/** Only a whole part is ticked to begin with; a fragment is left for the user to judge. */
export const isConfident = (s: Suggestion) => !s.fragment;

/** Identifies a suggestion in the dialog: a part may be found more than once. */
export const suggestionKey = (s: Suggestion) => `${s.partId}:${s.start}:${s.strand}`;

// Headings in the order they are shown: the backbone first, odds and ends last.
const GROUPS: [string, string[]][] = [
  ["Genes and markers", ["CDS", "gene"]],
  ["Origins", ["rep_origin", "oriT"]],
  ["Promoters and terminators", ["promoter", "terminator", "regulatory", "RBS", "polyA_signal"]],
  ["Binding sites", ["protein_bind", "misc_binding"]],
  ["Recombination sites", ["misc_recomb"]],
  ["Tags and other parts", ["misc_feature", "ncRNA"]]
];

export interface SuggestionGroup {
  title: string;
  items: Suggestion[];
}

/** Suggestions under their headings, each group in position order. Empty groups are left out. */
export function groupSuggestions(list: Suggestion[]): SuggestionGroup[] {
  const byPosition = (a: Suggestion, b: Suggestion) => a.start - b.start;
  const out: SuggestionGroup[] = [];
  const placed = new Set<Suggestion>();
  for (const [title, kinds] of GROUPS) {
    const items = list.filter(s => kinds.includes(s.kind)).sort(byPosition);
    for (const s of items) placed.add(s);
    if (items.length) out.push({ title, items });
  }
  const rest = list.filter(s => !placed.has(s)).sort(byPosition);
  if (rest.length) out.push({ title: "Other", items: rest });
  return out;
}

/** "1,626–2,486 ←", or without an arrow where direction says nothing. */
export function describeWhere(s: Suggestion): string {
  const range = `${num(s.start + 1)}–${num(s.end + 1)}`;
  if (DIRECTIONLESS.includes(s.kind)) return range;
  return s.strand === -1 ? `← ${range}` : `${range} →`;
}

/**
 * How good the match is, in as few words as say it. A protein match says so: a
 * codon-optimized insert can be an exact protein match while its DNA is nothing like the
 * entry's, and "exact match" alone would claim more than was found.
 */
export function describeMatch(s: Suggestion): string {
  const protein = s.molecule === "protein";
  const kind = protein ? "protein identity" : "identity";
  const identity = `${s.identity.toFixed(s.identity < 100 ? 1 : 0)}% ${kind}`;
  if (!s.fragment) return s.identity >= 100 ? (protein ? "exact protein match" : "exact match") : identity;
  return `partial · ${s.coverage.toFixed(0)}% of the part · ${identity}`;
}

/** Where the entry's sequence came from, short enough for a row. */
export function describeSource(s: Suggestion): string {
  switch (s.source) {
    case "ncbi":
      return `NCBI ${s.accession}`;
    case "amrfinder":
      return `AMRFinderPlus ${s.accession}`;
    case "defined":
      // Short enough to survive the column: the row's tooltip has the citation.
      return `${s.accession} · defined extent`;
    case "uniprot":
      return `UniProtKB ${s.accession}`;
    case "fpbase":
      return `FPbase ${s.accession.replace(/^fpbase:/, "")}`;
    default:
      return s.reference && s.reference !== "-" ? s.reference : "published sequence";
  }
}

/** Types drawn without a direction, as a map shows an origin. */
const DIRECTIONLESS = ["rep_origin", "oriT", "protein_bind", "misc_binding"];

export function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  for (let i = 2; ; i++) if (!taken.includes(`${name} ${i}`)) return `${name} ${i}`;
}

/**
 * The features to add for the accepted suggestions. Names are kept apart from those the
 * document already uses, so accepting twice doesn't give two features with one name.
 */
export function featuresFrom(chosen: Suggestion[], taken: string[]): SeqFeature[] {
  const names = [...taken];
  return chosen.map(s => {
    const name = uniqueName(s.name, names);
    names.push(name);
    const strand: Strand = DIRECTIONLESS.includes(s.kind) ? 0 : s.strand === -1 ? -1 : 1;
    return { id: newId("f"), name, type: s.kind, start: s.start, end: s.end, strand, notes: {}, raw: {} };
  });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;

/** What the document should send with a detection request. */
export function existingFrom(features: { type: string; start: number; end: number; strand: number }[]): ExistingFeature[] {
  return features.map(f => ({ kind: f.type, start: f.start, end: f.end, strand: f.strand }));
}
