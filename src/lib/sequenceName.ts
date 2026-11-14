// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The sequence's own name (a plasmid's, not its file's): what a rename keeps of what was
// typed. Renaming on the map and in the Info tab both go through it. No DOM here, so it is
// unit-tested.

/**
 * A typed name as the sequence keeps it, or null to keep the old one: trimmed, with runs of
 * spaces, tabs and line breaks made one space, as a name is one line wherever it is shown
 * or saved.
 */
export function tidyName(typed: string): string | null {
  const name = typed.replace(/\s+/g, " ").trim();
  return name || null;
}
