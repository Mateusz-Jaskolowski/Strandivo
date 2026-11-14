// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The sequence's own name (a plasmid's, not its file's): what a rename keeps of what was
// typed, and how a name with spaces survives GenBank. Renaming on the map and in the Info
// tab both go through it. No DOM here, so it is unit-tested.
//
// GenBank keeps the name on its LOCUS line, which is split on spaces, so the writer puts
// underscores in their place: "pUC19 K45A" would come back as "pUC19_K45A". The exact name
// is kept in the app's block of COMMENT lines too (`NAME_KEY` in `src/lib/labinfo.ts`),
// and read back only while the LOCUS line still holds it, so a rename made elsewhere, which
// changes only that line, wins. Underscores the user typed stay, as nothing is kept then.

/**
 * A typed name as the sequence keeps it, or null to keep the old one: trimmed, with runs of
 * spaces, tabs and line breaks made one space, as a name is one line wherever it is shown
 * or saved.
 */
export function tidyName(typed: string): string | null {
  const name = typed.replace(/\s+/g, " ").trim();
  return name || null;
}

/** The name as GenBank's LOCUS line holds it: spaces as underscores, as the writer puts them. */
export const locusName = (name: string) => name.replace(/ /g, "_");

/** The name to keep beside the LOCUS line, when that line can't hold it; else null. */
export const nameToKeep = (name: string): string | null => (locusName(name) === name ? null : name);

/**
 * A file's name for its sequence: the one kept beside its LOCUS line while that line still
 * holds it, else the line's own (renamed elsewhere since; the stale one goes on the next save).
 */
export function nameFromFile(locus: string, kept: string | undefined): string {
  return kept && locusName(kept) === locus ? kept : locus;
}
