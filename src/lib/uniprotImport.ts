// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What Get from UniProt offers and does, with one entry or several: a chimera's domains
// come from more than one protein, so each entry looked up gives rows, each row a region
// of that entry as placed on the CDS. This decides what each row is to the CDS (new, there
// already, edited there, placed elsewhere now), which rows of different entries claim the
// same residues, which start ticked, and what adding the ticked ones does. Pure, so it is
// unit-tested; `src/views/uniprotDialog.ts` shows it.

import { nextRegionColor, regionColor, regionsOf, type ProteinRegion } from "./regions.ts";
import { newId } from "./seqdata.ts";
import { accessionsOf, regionIdentity, regionKey, wellSupported, withAccession, type PlacedFeature } from "./uniprot.ts";

/** An entry looked up and placed on the CDS. */
export interface LookedUp {
  accession: string;
  reviewed: boolean;
  placed: PlacedFeature[];
}

/**
 * What a row is to the CDS. New: not there. Same: there as placed now. Moved: there, but
 * placed elsewhere now, so ticking it moves it. Edited: changed on this CDS, so kept as it
 * is. Absent: not in this CDS (or not in the residues the user limited the entry to).
 */
export type RowState = "new" | "same" | "moved" | "edited" | "absent";

/** A placement of the same kind over the same residues from somewhere else. */
export interface Rival {
  /** The entry it is from; empty for a region the user made. */
  accession: string;
  name: string;
  start: number;
  end: number;
  /** For another entry's row, its identity; a region on the CDS has none to give. */
  identity?: number;
  strong: boolean;
  /** A region already on the CDS, rather than another entry's row. */
  onCds: boolean;
}

export interface ImportRow {
  /** The entry and the region's key there: the same row however the entry is placed. */
  id: string;
  accession: string;
  placed: PlacedFeature;
  state: RowState;
  /** The region on the CDS this row is, if it was imported before. */
  existing?: ProteinRegion;
  strong: boolean;
  rivals: Rival[];
}

export const rowId = (accession: string, key: string) => `${accession} ${key}`;

/**
 * Two placements claim the same stretch: they share at least half of the longer one. A
 * region inside a much larger one of its kind (a linker in a loop) is another annotation.
 */
function rivalling(a: { start: number; end: number }, b: { start: number; end: number }) {
  const overlap = Math.min(a.end, b.end) - Math.max(a.start, b.start) + 1;
  return overlap > 0 && overlap * 2 >= Math.max(a.end - a.start, b.end - b.start) + 1;
}

/**
 * The entries' regions as rows, against the regions the CDS has now. An earlier import is
 * found by its entry and key, or, for one whose numbers UniProt has since changed, by its
 * entry, kind and name over the same residues of the entry, so it is never added twice.
 */
export function importRows(previous: readonly ProteinRegion[], entries: readonly LookedUp[]): ImportRow[] {
  const rows: ImportRow[] = [];
  for (const { accession, placed } of entries) {
    const theirs = previous.filter(r => r.accession === accession);
    const taken = new Set<ProteinRegion>();
    const found = new Map<PlacedFeature, ProteinRegion>();
    for (const p of placed) {
      const hit = theirs.find(r => !taken.has(r) && regionKey(r) === p.key);
      if (hit) taken.add(hit), found.set(p, hit);
    }
    for (const p of placed) {
      if (found.has(p)) continue;
      const hit = theirs.find(r => !taken.has(r) && r.kind === p.feature.kind && r.name === p.feature.name && r.sourceStart <= p.feature.end && r.sourceEnd >= p.feature.start);
      if (hit) taken.add(hit), found.set(p, hit);
    }
    for (const p of placed) {
      const existing = found.get(p);
      const r = p.region;
      const state: RowState = existing?.edited ? "edited" : !r ? "absent" : !existing ? "new" : existing.start === r.start && existing.end === r.end && existing.sourceStart === r.sourceStart && existing.sourceEnd === r.sourceEnd ? "same" : "moved";
      rows.push({ id: rowId(accession, p.key), accession, placed: p, state, ...(existing ? { existing } : {}), strong: !!r && wellSupported(p), rivals: [] });
    }
  }
  for (const row of rows) {
    const r = row.placed.region;
    if (!r || row.state === "edited") continue;
    for (const other of rows) {
      const o = other.placed.region;
      if (other.accession === row.accession || !o || o.kind !== r.kind || !rivalling(r, o)) continue;
      row.rivals.push({ accession: other.accession, name: o.name, start: o.start, end: o.end, identity: regionIdentity(other.placed.match), strong: other.strong, onCds: false });
    }
    // What is on the CDS from elsewhere: another entry's region, or one the user made.
    for (const p of previous) {
      if (p.accession === row.accession || p.kind !== r.kind || !rivalling(r, p)) continue;
      if (row.rivals.some(x => x.accession === p.accession && x.start === p.start && x.end === p.end && x.name === p.name)) continue;
      row.rivals.push({ accession: p.accession, name: p.name, start: p.start, end: p.end, strong: true, onCds: true });
    }
  }
  return rows;
}

/** Rows that can be ticked: what adding them would change. */
export const tickable = (row: ImportRow) => row.state === "new" || row.state === "moved";

/**
 * Whether a row starts ticked: only a new region, well supported, from an entry not
 * imported to this CDS before (whose regions left out then were left out on purpose), and
 * with nothing of its kind over the same residues on the CDS or well supported from
 * another entry. Which of two homologues a stretch came from is the user's to say.
 */
export function startsTicked(row: ImportRow, previous: readonly ProteinRegion[]): boolean {
  return row.state === "new" && row.strong && !previous.some(r => r.accession === row.accession) && !row.rivals.some(x => x.strong);
}

export interface ImportResult {
  regions: ProteinRegion[];
  added: number;
  moved: number;
  /** The entries that gave something, in the order they were looked up. */
  from: string[];
}

/**
 * The CDS's regions with the ticked rows in: new ones added, with colours of their own;
 * moved ones placed anew, keeping their id, colour and the rest. Nothing else changes: the
 * user's own regions, edited imports, regions of entries not looked up and those of rows
 * left unticked all stay as they are.
 */
export function applyImport(previous: readonly ProteinRegion[], rows: readonly ImportRow[], ticked: ReadonlySet<string>, cdsColor?: string): ImportResult {
  const regions = [...previous];
  let added = 0;
  let moved = 0;
  const from: string[] = [];
  for (const row of rows) {
    const r = row.placed.region;
    if (!r || !ticked.has(row.id) || !tickable(row)) continue;
    if (!from.includes(row.accession)) from.push(row.accession);
    if (row.state === "moved" && row.existing) {
      const at = regions.indexOf(row.existing);
      if (at < 0) continue;
      const { codingBases: _exact, ...kept } = row.existing;
      regions[at] = { ...kept, ...r, id: kept.id ?? newId("r"), color: regionColor(kept) };
      moved++;
    } else {
      regions.push({ ...r, id: newId("r"), color: nextRegionColor(regions, cdsColor) });
      added++;
    }
  }
  return { regions: regions.sort((a, b) => a.start - b.start || a.end - b.end), added, moved, from };
}

/**
 * The CDS's qualifiers after an import. Its UniProt cross-reference says which protein it
 * is, so an entry becomes one only as before: the one entry looked up, giving every region
 * of an entry on the CDS, which had none. An entry that gave part of a chimera is named by
 * its regions alone. Cross-references already there are kept.
 */
export function importNotes(notes: Record<string, unknown>, regions: ProteinRegion[], lookedUp: readonly { accession: string; reviewed: boolean }[], from: readonly string[]): Record<string, unknown> {
  let out = notes;
  const had = accessionsOf(notes);
  // An entry already named keeps its name, with Swiss-Prot or TrEMBL as it is now.
  for (const e of lookedUp) if (had.includes(e.accession)) out = withAccession(out, e.accession, e.reviewed);
  const only = lookedUp.length === 1 ? lookedUp[0] : null;
  if (only && !had.length && from.includes(only.accession) && regions.every(r => !r.accession || r.accession === only.accession)) out = withAccession(out, only.accession, only.reviewed);
  return out;
}

/** The entries a CDS has used: its UniProt cross-references, then its regions' sources. */
export function rememberedEntries(f: { notes?: Record<string, unknown> }): string[] {
  const out = accessionsOf(f.notes);
  for (const r of regionsOf(f)) if (r.accession && !out.includes(r.accession)) out.push(r.accession);
  return out;
}
