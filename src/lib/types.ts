// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Shapes shared between the editor, the Rust core and the Sanger view.

/**
 * A read's chromatogram, kept light: bio-parsers' ab1ToJson output with the four traces as
 * 16-bit arrays (as stored in .ab1 files) and without its per-base copies of them
 * (`compactChromatogram`), so a plate of reads fits in memory.
 */
export interface Chromatogram {
  aTrace: Int16Array;
  cTrace: Int16Array;
  gTrace: Int16Array;
  tTrace: Int16Array;
  /** Peak position of each base call in the traces. */
  basePos: number[];
  baseCalls: string[];
  qualNums?: number[];
}

export type TraceKey = "aTrace" | "cTrace" | "gTrace" | "tTrace";

/** A feature as stored by the editor (0-based, inclusive coordinates). */
export interface Feature {
  id?: string;
  name?: string;
  type?: string;
  start: number;
  end: number;
  forward?: boolean;
  strand?: number;
  locations?: { start: number; end: number }[];
  /** GenBank's /codon_start: the first whole codon starts this many bases in (1 to 3). */
  codonStart?: number;
  /** Set when the feature is a variable region (`src/lib/variable.ts`). */
  variable?: VariableDesign;
}

/**
 * What a library puts in a variable region: anything (`any`, as for CDRs that replace a
 * stuffer), bases an IUPAC pattern allows (NNK, repeated over the region), or one of a
 * few known versions. Patterns and versions are written in the direction the region is
 * read (its CDS's, if it is in one).
 */
export type VariableDesign =
  | { kind: "any" }
  | { kind: "pattern"; pattern: string }
  | { kind: "alternatives"; options: { name: string; bases: string }[] };

export type Strand = "forward" | "reverse";
export type ReadStatus = "aligned" | "noMatch" | "lowQuality";
export type DiffKind = "substitution" | "insertion" | "deletion";

export interface Difference {
  kind: DiffKind;
  /** 0-based. Substitution/deletion: first affected base. Insertion: base the insert precedes. */
  refPos: number;
  refBases: string;
  readBases: string;
  readPos: number;
  quality: number | null;
  confident: boolean;
  /** A long read's indel in a run of one base: likely the sequencer's, so never confident. */
  homopolymer?: boolean;
}

export interface Segment {
  readFrom: number;
  readTo: number;
  refFrom: number;
  refTo: number;
  gappedReference: string;
  gappedRead: string;
}

export interface ReadResult {
  name: string;
  status: ReadStatus;
  message: string | null;
  strand: Strand;
  readLength: number;
  qualityEstimated: boolean;
  trimStart: number;
  trimEnd: number;
  refStart: number;
  refSpan: number;
  wrapsOrigin: boolean;
  matches: number;
  mismatches: number;
  insertedBases: number;
  deletedBases: number;
  ambiguous: number;
  identity: number;
  score: number;
  differences: Difference[];
  /** Differences in variable regions, set apart from `differences` by the read set. */
  variable?: Difference[];
  segments: Segment[];
  /** A nanopore read, aligned along seeds and not quality-trimmed. */
  longRead?: boolean;
  /** A long read of a whole circular plasmid, turned to start at the reference's origin. */
  wholePlasmid?: boolean;
}

/** A difference of a clone's consensus, with the reads (indices) that show it. */
export interface CloneDifference extends Difference {
  reads: number[];
}

/** A stretch of the reference covered by a clone's reads, with their consensus over it. */
export interface ConsensusPiece {
  /** Half-open range on the reference (never wraps). */
  refFrom: number;
  refTo: number;
  /** The reference over the range, with `-` where the consensus has inserted bases. */
  gappedReference: string;
  /** The consensus, as long as `gappedReference`, with `-` where bases are missing. */
  gappedConsensus: string;
  /** Quality of each column; 0 where good reads disagree. */
  qualities: number[];
  /** Reads covering each column. */
  depth: number[];
}

/** A place where good reads of one clone disagree: a question for the traces. */
export interface Conflict {
  /** Different bases at `refPos`, or different bases inserted before it. */
  kind: "base" | "insertion";
  refPos: number;
  refBases: string;
  calls: { read: number; bases: string; quality: number | null }[];
}

/** Reads of one clone (indices into the reads) and their consensus. */
export interface CloneResult {
  key: string;
  reads: number[];
  /** In reference order; empty when no read aligned. */
  pieces: ConsensusPiece[];
  differences: CloneDifference[];
  /**
   * Differences in variable regions: the clone's contents there, not mutations. The read
   * set moves them out of `differences`, so counts of changes leave them out.
   */
  variable?: CloneDifference[];
  conflicts: Conflict[];
}

export interface AlignResponse {
  reads: ReadResult[];
  clones: CloneResult[];
}
