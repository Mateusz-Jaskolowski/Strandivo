// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Lab stock refers to the map's enzyme definitions. Product names are free text: an HF
// version or a different supplier still maps to the enzyme explicitly chosen by the user.

import { COMMON_ENZYMES } from "./enzymes.ts";

export interface LabEnzyme {
  id: string;
  enzyme: string;
  product: string;
  location: string;
  notes: string;
}

export type EnzymeStock = Omit<LabEnzyme, "id">;
const names = new Map(COMMON_ENZYMES.map(n => [n.toLowerCase(), n]));

/** Validates the whole file before importing anything; unknown enzymes must not vanish. */
export function parseEnzymeLibrary(text: string): LabEnzyme[] {
  const file = JSON.parse(text);
  if (!file || file.version !== 1 || !Array.isArray(file.entries)) throw new Error("This isn't a supported Strandivo enzyme library.");
  const ids = new Set<string>();
  return file.entries.map((entry: unknown, i: number) => {
    const e = entry as Partial<LabEnzyme> | null;
    if (!e || ![e.id, e.enzyme, e.product, e.location, e.notes].every(v => typeof v === "string")) throw new Error(`Enzyme ${i + 1} has missing or invalid fields.`);
    const enzyme = names.get(e.enzyme!.trim().toLowerCase());
    if (!enzyme) throw new Error(`Enzyme ${i + 1}: “${e.enzyme}” isn't in Strandivo's enzyme list.`);
    const id = e.id!.trim();
    if (!id || ids.has(id)) throw new Error(`Enzyme ${i + 1} has a missing or repeated ID.`);
    ids.add(id);
    return { id, enzyme, product: e.product!.trim() || enzyme, location: e.location!.trim(), notes: e.notes!.trim() };
  });
}

export function formatEnzymeLibrary(entries: readonly LabEnzyme[]): string {
  return JSON.stringify({ version: 1, entries }, null, 2) + "\n";
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
