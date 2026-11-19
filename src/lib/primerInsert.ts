// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Building blocks inserted into a primer in the Primer Dialog: restriction sites (with an
// optional 5′ clamp for cleavage), codons by amino acid, and common short cloning tags or
// motifs. Pure data and string helpers, unit-tested in Node.

import { TAIL_ENZYMES } from "./enzymes.ts";
import { threeLetter, translateCodon } from "./genetics.ts";
import { reverseComplement } from "./seqdata.ts";

/** Neutral 6 bp 5′ clamp bases commonly placed upstream of a restriction site for efficient cleavage. */
export const DEFAULT_CLAMP = "GCATAG";

export interface EnzymeInsert {
  name: string;
  site: string;
}

/** 6+ bp palindromic/non-degenerate restriction sites suitable for 5′ primer tails. */
export const INSERT_ENZYMES: readonly EnzymeInsert[] = TAIL_ENZYMES;

export interface AminoCodons {
  /** Single-letter code ("A", "M", "*"). */
  aa: string;
  /** Three-letter label ("Ala", "Met", "Stop"). */
  label: string;
  /** Sense codons (5′→3′), common E. coli choice first. */
  codons: readonly string[];
}

// High-frequency E. coli codons listed first when multiple synonymous codons exist.
const ECOLI_FIRST: Record<string, string> = {
  A: "GCG", C: "TGC", D: "GAT", E: "GAA", F: "TTT",
  G: "GGC", H: "CAT", I: "ATT", K: "AAA", L: "CTG",
  M: "ATG", N: "AAC", P: "CCG", Q: "CAG", R: "CGT",
  S: "AGC", T: "ACC", V: "GTG", W: "TGG", Y: "TAT",
  "*": "TAA"
};

function buildCodonGroups(): AminoCodons[] {
  const byAa = new Map<string, string[]>();
  const bases = ["A", "C", "G", "T"];
  for (const a of bases) {
    for (const b of bases) {
      for (const c of bases) {
        const codon = a + b + c;
        const aa = translateCodon(codon);
        const list = byAa.get(aa) ?? [];
        list.push(codon);
        byAa.set(aa, list);
      }
    }
  }
  return [...byAa.entries()]
    .map(([aa, codons]) => {
      const pref = ECOLI_FIRST[aa];
      codons.sort((x, y) => (x === pref ? -1 : y === pref ? 1 : x.localeCompare(y)));
      return { aa, label: aa === "*" ? "Stop" : threeLetter(aa), codons };
    })
    .sort((a, b) => (a.aa === "*" ? 1 : b.aa === "*" ? -1 : a.label.localeCompare(b.label)));
}

export const CODON_GROUPS: readonly AminoCodons[] = buildCodonGroups();

export interface ShortTag {
  id: string;
  name: string;
  /** DNA sequence 5′→3′ (coding / sense strand). */
  bases: string;
  note: string;
}

export const SHORT_TAGS: readonly ShortTag[] = [
  { id: "6xhis", name: "6×His", bases: "CATCATCATCATCATCAT", note: "Hexahistidine affinity tag" },
  { id: "flag", name: "FLAG", bases: "GATTACAAGGATGACGACGATAAG", note: "DYKDDDDK epitope tag" },
  { id: "ha", name: "HA", bases: "TACCCATACGATGTTCCAGATTACGCT", note: "YPYDVPDYA epitope tag" },
  { id: "myc", name: "Myc", bases: "GAACAGAAACTGATCTCTGAAGAAGACCTG", note: "EQKLISEEDL epitope tag" },
  { id: "strep2", name: "Strep-II", bases: "TGGAGCCACCCGCAGTTCGAAAAA", note: "WSHPQFEK affinity tag" },
  { id: "v5", name: "V5", bases: "GGTAAGCCTATCCCTAACCCTCTCCTCGGTCTCGATTCTACG", note: "GKPIPNPLLGLDST epitope tag" },
  { id: "tev", name: "TEV site", bases: "GAAAACCTGTATTTTCAGGGC", note: "ENLYFQG protease site" },
  { id: "gsg", name: "GSG linker", bases: "GGTAGCGGC", note: "Short flexible linker" },
  { id: "ggggs", name: "GGGGS linker", bases: "GGTGGCGGTGGCAGC", note: "5-aa flexible linker" },
  { id: "kozak", name: "Kozak", bases: "GCCACC", note: "Mammalian translation initiation" },
  { id: "rbs", name: "RBS (Shine-Dalgarno)", bases: "AGGAGG", note: "Bacterial ribosome binding site" }
];

/** Formats an enzyme site snippet, optionally prepending a 5′ clamp and/or taking the reverse complement. */
export function enzymeSnippet(site: string, opts: { clamp?: boolean; clampBases?: string; revComp?: boolean } = {}): string {
  const core = site.toUpperCase();
  const base = opts.revComp ? reverseComplement(core) : core;
  return opts.clamp ? `${(opts.clampBases ?? DEFAULT_CLAMP).toUpperCase()}${base}` : base;
}

/**
 * Inserts `snippet` (or its reverse complement when `revComp` is true) into `bases` across
 * `[start, end]`, returning the updated uppercase sequence and the caret position right
 * after the inserted stretch.
 */
export function insertIntoPrimer(
  bases: string,
  start: number,
  end: number,
  snippet: string,
  revComp = false
): { bases: string; caret: number } {
  const clean = bases.toUpperCase();
  const lo = Math.max(0, Math.min(clean.length, Math.min(start, end)));
  const hi = Math.max(0, Math.min(clean.length, Math.max(start, end)));
  const ins = (revComp ? reverseComplement(snippet) : snippet).toUpperCase();
  const next = clean.slice(0, lo) + ins + clean.slice(hi);
  return { bases: next, caret: lo + ins.length };
}
