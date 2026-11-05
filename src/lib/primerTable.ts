// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The Primers tab's table: sorting its rows and the text "Copy for ordering" makes. No DOM
// here, so it is unit-tested.

import type { SeqPrimer } from "./seqdata.ts";

/** A row as the table shows it: the primer and what its report says. */
export interface PrimerRow {
  primer: SeqPrimer;
  length: number;
  tm: number | null;
  gc: number;
  /** Warnings first, then by how many. */
  warnings: number;
}

export type SortKey = "name" | "direction" | "length" | "tm" | "gc" | "binds" | "checks";
export interface Sort {
  key: SortKey;
  descending: boolean;
}

/** By where they bind, as the binding map reads. */
export const DEFAULT_SORT: Sort = { key: "binds", descending: false };

export const SORT_KEYS: SortKey[] = ["name", "direction", "length", "tm", "gc", "binds", "checks"];

/** A sort read back from storage, or the default if it isn't one of the table's columns. */
export function parseSort(raw: unknown): Sort {
  if (!raw || typeof raw !== "object") return DEFAULT_SORT;
  const o = raw as { key?: unknown; descending?: unknown };
  const key = SORT_KEYS.find(k => k === o.key);
  return key ? { key, descending: o.descending === true } : DEFAULT_SORT;
}

// "Primer 4" before "Primer 10", and case doesn't matter.
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The rows in the order asked for. Ties fall back to the binding position, so the order is
 * always the same; a primer without a Tm goes last either way.
 */
export function sortRows(rows: PrimerRow[], sort: Sort): PrimerRow[] {
  const sign = sort.descending ? -1 : 1;
  const byPosition = (a: PrimerRow, b: PrimerRow) => a.primer.start - b.primer.start || a.primer.end - b.primer.end;
  const compare = (a: PrimerRow, b: PrimerRow): number => {
    switch (sort.key) {
      case "name":
        return names.compare(a.primer.name, b.primer.name);
      case "direction":
        // Forward first.
        return b.primer.strand - a.primer.strand;
      case "length":
        return a.length - b.length;
      case "tm":
        return (a.tm ?? 0) - (b.tm ?? 0);
      case "gc":
        return a.gc - b.gc;
      case "binds":
        return 0;
      case "checks":
        // Primers with warnings first.
        return b.warnings - a.warnings;
    }
  };
  return [...rows].sort((a, b) => {
    if (sort.key === "tm" && (a.tm === null) !== (b.tm === null)) return a.tm === null ? 1 : -1;
    return sign * compare(a, b) || sign * byPosition(a, b);
  });
}

/** The next sort after clicking a column: the same column turns round, another starts ascending. */
export function nextSort(current: Sort, key: SortKey): Sort {
  return current.key === key ? { key, descending: !current.descending } : { key, descending: false };
}

/** A primer's note, as a file's /note qualifier or the lab library wrote it; "" if it has none. */
export function primerNote(p: Pick<SeqPrimer, "notes">): string {
  const raw = (p.notes ?? {})["note"];
  const values = raw === undefined || raw === null ? [] : Array.isArray(raw) ? raw : [raw];
  return values
    .map(v => String(v).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("; ");
}

/**
 * Whether a primer matches what was typed in the filter: every word must appear in its name,
 * its note or its bases. A word of one or two letters is matched against the name and the
 * note only, since a single base would otherwise match nearly every primer.
 */
export function matchesFilter(p: Pick<SeqPrimer, "name" | "bases" | "notes">, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = `${p.name}\n${primerNote(p)}`.toLowerCase();
  const bases = p.bases.toLowerCase();
  return words.every(w => text.includes(w) || (w.length >= 3 && bases.includes(w)));
}

export type OrderFormat = "tsv" | "fasta";

/** Primers as text for an order form: tab-separated (one per line) or FASTA. */
export function orderText(primers: Pick<SeqPrimer, "name" | "bases">[], format: OrderFormat): string {
  const bases = (p: Pick<SeqPrimer, "bases">) => p.bases.replace(/\s+/g, "");
  return primers.map(p => (format === "fasta" ? `>${p.name}\n${bases(p)}` : `${p.name}\t${bases(p)}`)).join("\n");
}

/** A row of the exported list: the primer and the Tm the table shows for it. */
export interface ExportRow {
  primer: Pick<SeqPrimer, "name" | "bases" | "strand" | "start" | "end" | "notes">;
  tm: number | null;
}

/**
 * The list as a tab-separated file, with a header row, for a spreadsheet or an order form.
 * Positions are 1-based as the interface shows them but written plainly, and the Tm is a
 * bare number, so a spreadsheet reads both as it should; a note's tabs and newlines would
 * break the row, so they become spaces.
 */
export function primerListText(rows: ExportRow[]): string {
  const clean = (s: string) => s.replace(/[\t\r\n]+/g, " ").trim();
  const lines = rows.map(({ primer: p, tm }) =>
    [clean(p.name), p.bases.replace(/\s+/g, "").toUpperCase(), p.strand === 1 ? "Forward" : "Reverse", `${p.start + 1}-${p.end + 1}`, tm === null ? "" : tm.toFixed(1), clean(primerNote(p))].join("\t")
  );
  return ["Name\tSequence\tDirection\tBinds\tTm (°C)\tNotes", ...lines].join("\n");
}

/**
 * How the table shows a 5′ tail: whole while short, otherwise its first and last bases
 * either side of an ellipsis, so a long tail doesn't stretch the table.
 */
export function shortTail(tail: string, keep = 6): string {
  return tail.length <= keep * 2 + 3 ? tail : `${tail.slice(0, keep)}…${tail.slice(-keep)}`;
}
