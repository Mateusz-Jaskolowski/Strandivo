// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Lab stock refers to enzymes TeselaGen knows by name. Product names are free text: an HF
// version or a different supplier still maps to the enzyme explicitly chosen by the user.

import { enzymeName } from "./enzymes.ts";

export interface LabEnzyme {
  id: string;
  enzyme: string;
  product: string;
  location: string;
  notes: string;
}

export type EnzymeStock = Omit<LabEnzyme, "id">;

/**
 * Reads a saved list or a JSON export. Its structure must be right as a whole, but an enzyme
 * this version doesn't know is kept as written (`unknownEnzymes` finds them): a list saved by
 * another version must still open, with nothing in it lost.
 */
export function parseEnzymeLibrary(text: string): LabEnzyme[] {
  const file = JSON.parse(text);
  if (!file || file.version !== 1 || !Array.isArray(file.entries)) throw new Error("This isn't a supported Strandivo enzyme library.");
  const ids = new Set<string>();
  return file.entries.map((entry: unknown, i: number) => {
    const e = entry as Partial<LabEnzyme> | null;
    if (!e || ![e.id, e.enzyme, e.product, e.location, e.notes].every(v => typeof v === "string")) throw new Error(`Enzyme ${i + 1} has missing or invalid fields.`);
    const written = e.enzyme!.trim();
    if (!written) throw new Error(`Enzyme ${i + 1} has no enzyme name.`);
    const enzyme = enzymeName(written) ?? written;
    const id = e.id!.trim();
    if (!id || ids.has(id)) throw new Error(`Enzyme ${i + 1} has a missing or repeated ID.`);
    ids.add(id);
    return { id, enzyme, product: e.product!.trim() || enzyme, location: e.location!.trim(), notes: e.notes!.trim() };
  });
}

export function formatEnzymeLibrary(entries: readonly LabEnzyme[]): string {
  return JSON.stringify({ version: 1, entries }, null, 2) + "\n";
}

/** Names in the list this version doesn't know, each once. */
export function unknownEnzymes(entries: readonly EnzymeStock[]): string[] {
  return [...new Set(entries.filter(e => !enzymeName(e.enzyme)).map(e => e.enzyme))];
}

/** An import adds only enzymes Strandivo can find, or nothing at all, so no name vanishes. */
export function checkImport(entries: readonly EnzymeStock[]): void {
  const unknown = unknownEnzymes(entries);
  if (!unknown.length) return;
  const shown = unknown.slice(0, 5).map(n => `“${n}”`).join(", ") + (unknown.length > 5 ? ` and ${unknown.length - 5} more` : "");
  throw new Error(`Strandivo doesn't know ${shown}. Correct the ${unknown.length === 1 ? "name" : "names"} and import again; nothing was added.`);
}

// ---------- spreadsheets ----------

/** Which column holds what, by its header. "Enzyme" is required for a row to be a header. */
const COLUMNS: { key: keyof EnzymeStock; header: RegExp }[] = [
  { key: "enzyme", header: /^(restriction )?enzymes?( name)?$/i },
  { key: "product", header: /product|supplier|catalog|cat\.? ?(no|#)/i },
  { key: "location", header: /location|freezer|box|where/i },
  { key: "notes", header: /notes?|comments?/i }
];

/** Rows of a tab-, comma- or semicolon-separated table, with spreadsheet quoting. */
function tableRows(text: string): string[][] {
  text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const first = text.split("\n").find(l => l.trim()) ?? "";
  const count = (c: string) => first.split(c).length;
  const delimiter = count("\t") > 1 ? "\t" : count(";") > count(",") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && !cell) quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

/**
 * Stock from a spreadsheet (saved as tab-separated or CSV text, or copied out of one). With
 * a header row its columns are found by name; without one they are enzyme, product,
 * freezer location and notes, in that order.
 */
export function parseEnzymeTable(text: string): EnzymeStock[] {
  const rows = tableRows(text);
  if (!rows.length) return [];
  const isHeader = rows[0].some(c => COLUMNS[0].header.test(c.trim()));
  const index = new Map<keyof EnzymeStock, number>(
    isHeader
      ? COLUMNS.map(({ key, header }) => [key, rows[0].findIndex(c => header.test(c.trim()))])
      : COLUMNS.map(({ key }, i) => [key, i])
  );
  const body = isHeader ? rows.slice(1) : rows;
  return body.map((row, i) => {
    const get = (key: keyof EnzymeStock) => (row[index.get(key)!] ?? "").trim();
    const written = get("enzyme");
    if (!written) throw new Error(`Row ${i + (isHeader ? 2 : 1)} has no enzyme name.`);
    const enzyme = enzymeName(written) ?? written;
    return { enzyme, product: get("product") || enzyme, location: get("location"), notes: get("notes") };
  });
}

/** A tab-separated table with a header, which spreadsheets open and `parseEnzymeTable` reads. */
export function formatEnzymeTable(entries: readonly EnzymeStock[]): string {
  const cell = (v: string) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const rows = [["Enzyme", "Product", "Freezer location", "Notes"], ...entries.map(e => [e.enzyme, e.product, e.location, e.notes])];
  return rows.map(r => r.map(cell).join("\t")).join("\n") + "\n";
}

/** Import merges identical stock records; two products or two freezer locations stay separate. */
export function newEnzymeStocks(existing: readonly EnzymeStock[], incoming: readonly EnzymeStock[]): EnzymeStock[] {
  const key = (e: EnzymeStock) => JSON.stringify([e.enzyme, e.product, e.location, e.notes]);
  const seen = new Set(existing.map(key));
  return incoming.filter(e => {
    const k = key(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).map(({ enzyme, product, location, notes }) => ({ enzyme, product, location, notes }));
}
