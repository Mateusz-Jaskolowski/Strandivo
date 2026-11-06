// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Picking enzymes for a digest: ⌘-click on a Mac, Ctrl-click elsewhere, on cut sites in the
// map, the Sequence tab or the outline. What is picked is enzymes, not sites, as a digest
// uses every site of an enzyme; so picking one site of a dual cutter lights up both.

/** The enzyme of a cut site's id ("<enzyme>@<position>"). */
export const enzymeOf = (siteId: string) => siteId.split("@")[0];

/** What a selection says about enzymes: those picked, else the one whose site is selected. */
export interface PickSource {
  focus: { kind: string; id: string } | null;
  enzymes?: string[];
}

/**
 * The enzymes whose sites are marked: the picked ones, or the selected site's enzyme, so a
 * site of an enzyme that cuts more than once shows where else it cuts.
 */
export function pickedEnzymes(sel: PickSource): string[] {
  if (sel.enzymes?.length) return sel.enzymes;
  return sel.focus?.kind === "cutsite" ? [enzymeOf(sel.focus.id)] : [];
}

/** The list after ⌘/Ctrl-clicking a site of `enzyme`: added if it wasn't there, else taken out. */
export function togglePick(picked: string[], enzyme: string): string[] {
  return picked.includes(enzyme) ? picked.filter(e => e !== enzyme) : [...picked, enzyme];
}

/** "EcoRI", "EcoRI and BamHI", "EcoRI, BamHI and XbaI", then "4 enzymes". */
export function enzymesText(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "no enzymes";
  if (names.length > 3) return `${names.length} enzymes`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
