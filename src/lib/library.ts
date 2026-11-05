// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The lab's primer library: reading and writing primer lists, a starter set of common
// sequencing primers, and finding which library primers bind a sequence. Pure functions.

import { alignPrimer } from "./primerAlign.ts";
import { bindingTm, findBindingSites, type BindingSite } from "./primers.ts";

export interface LibraryPrimer {
  id: string;
  name: string;
  /** 5′→3′, upper case. */
  bases: string;
  notes: string;
  /** The colour the primer gets in a file it is added to. */
  color?: string;
}

export type LibraryEntry = Omit<LibraryPrimer, "id">;

/**
 * Common sequencing primers, as listed by university sequencing cores (UC Davis and
 * University of Utah). Check them against your own provider's list.
 */
export const COMMON_SEQUENCING_PRIMERS: LibraryEntry[] = [
  ["M13 fwd (-21)", "GTAAAACGACGGCCAGT"],
  ["M13 rev", "CAGGAAACAGCTATGAC"],
  ["T7 promoter", "TAATACGACTCACTATAGGG"],
  ["T7 terminator", "GCTAGTTATTGCTCAGCGG"],
  ["T3 promoter", "ATTAACCCTCACTAAAGGG"],
  ["SP6", "GATTTAGGTGACACTATAG"],
  ["CMV fwd", "CGCAAATGGGCGGTAGGCGTG"],
  ["CMV rev", "AGTAGGAAAGTCCCGTAAGG"],
  ["BGH rev", "TAGAAGGCACAGTCGAGG"],
  ["pBAD fwd", "ATGCCATAGCATTTTTATCC"],
  ["pBAD rev", "GATTTAATCTGTATCAGG"],
  ["pGEX 5′", "GGGCTGGCAAGCCACGTTTGGTG"],
  ["pGEX 3′", "CCGGGAGCTGCATGTGTCAGAGG"],
  ["EGFP-C", "CATGGTCCTGCTGGAGTTCGTG"],
  ["EGFP-N", "CGTCGCCGTCCAGCTCGACCAG"]
].map(([name, bases]) => ({ name, bases, notes: "Common sequencing primer" }));

const BASES = /^[ACGTURYSWKMBDHVN]+$/i;

export interface ParsedList {
  entries: LibraryEntry[];
  /** Lines that couldn't be read, with their line numbers. */
  skipped: { line: number; text: string }[];
}

/**
 * Reads a primer list: FASTA (">name" then the sequence), or one primer per line as
 * name and sequence separated by a tab, comma or semicolon, optionally followed by notes.
 * A header line such as "Name,Sequence" is ignored.
 */
export function parsePrimerList(text: string): ParsedList {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const entries: LibraryEntry[] = [];
  const skipped: ParsedList["skipped"] = [];
  if (lines.some(l => l.trimStart().startsWith(">"))) {
    let current: LibraryEntry | null = null;
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      if (line.startsWith(">")) {
        current = { name: line.slice(1).trim() || `Primer ${entries.length + 1}`, bases: "", notes: "" };
        entries.push(current);
      } else if (current && BASES.test(line.replace(/\s+/g, ""))) current.bases += line.replace(/\s+/g, "").toUpperCase();
      else skipped.push({ line: i + 1, text: raw });
    });
    return { entries: entries.filter(e => e.bases.length), skipped };
  }
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parts = splitCells(line, line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",");
    // Name first, then the sequence; tolerate "sequence, name" too.
    let name = parts[0] ?? "";
    let bases = (parts[1] ?? "").replace(/\s+/g, "");
    let rest = parts.slice(2);
    if (!BASES.test(bases) && BASES.test(name.replace(/\s+/g, "")) && parts.length >= 2) {
      bases = name.replace(/\s+/g, "");
      name = parts[1];
      rest = parts.slice(2);
    }
    if (!bases || !BASES.test(bases) || bases.length < 6) {
      // A header row is expected; anything else is reported.
      if (!(i === 0 && /seq/i.test(line))) skipped.push({ line: i + 1, text: raw });
      return;
    }
    // Our own export ends with a colour column.
    const color = /^#[0-9a-f]{6}$/i.test(rest[rest.length - 1] ?? "") ? rest.pop() : undefined;
    entries.push({ name: name || `Primer ${entries.length + 1}`, bases: bases.toUpperCase(), notes: rest.filter(Boolean).join(", "), ...(color ? { color } : {}) });
  });
  return { entries, skipped };
}

/** Splits a line of a delimited file; quoted cells may contain the delimiter. */
function splitCells(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === delimiter && !quoted) {
      out.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  out.push(cell.trim());
  return out;
}

/** Tab-separated list (name, sequence, notes, colour) with a header row, for spreadsheets and re-import. */
export function formatPrimerList(primers: LibraryEntry[]): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();
  return ["Name\tSequence\tNotes\tColour", ...primers.map(p => `${clean(p.name)}\t${p.bases}\t${clean(p.notes)}\t${p.color ?? ""}`)].join("\n");
}

/** Entries that aren't already in the library (same name and sequence). */
export function newEntries(existing: LibraryEntry[], incoming: LibraryEntry[]): LibraryEntry[] {
  const key = (e: LibraryEntry) => `${e.name.trim().toLowerCase()}\u0000${e.bases.toUpperCase()}`;
  const seen = new Set(existing.map(key));
  const out: LibraryEntry[] = [];
  for (const e of incoming) {
    if (seen.has(key(e))) continue;
    seen.add(key(e));
    out.push(e);
  }
  return out;
}

export interface LibraryHit {
  primer: LibraryPrimer;
  sites: BindingSite[];
  /** Tm of the part that binds at the first site. */
  tm: number | null;
}

/** Library primers that bind a sequence, in order along it. */
export function libraryHits(library: LibraryPrimer[], sequence: string, circular: boolean): LibraryHit[] {
  if (!sequence.length) return [];
  const out: LibraryHit[] = [];
  for (const primer of library) {
    const sites = findBindingSites(primer.bases, sequence, circular);
    if (!sites.length) continue;
    out.push({ primer, sites, tm: bindingTm(alignPrimer({ ...sites[0], bases: primer.bases }, sequence)) });
  }
  return out.sort((a, b) => a.sites[0].start - b.sites[0].start || a.primer.name.localeCompare(b.primer.name));
}
