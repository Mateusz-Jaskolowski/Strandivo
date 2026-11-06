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

/**
 * The selection after the sites shown change (the lab's stock was edited): picked enzymes
 * that no longer have a site shown are dropped, and the selected site moves to one of an
 * enzyme still picked. Undefined when nothing needs to change; `site` null clears it.
 */
export function prunePick<S extends { id: string; enzyme: string }>(sel: PickSource, sites: readonly S[]): { site: S | null; enzymes: string[] } | undefined {
  if (sel.focus?.kind !== "cutsite") return undefined;
  const focusId = sel.focus.id;
  const picked = pickedEnzymes(sel);
  const shown = new Set(sites.map(s => s.enzyme));
  const kept = picked.filter(e => shown.has(e));
  const focused = sites.find(s => s.id === focusId);
  if (focused && kept.length === picked.length) return undefined;
  if (!kept.length) return { site: null, enzymes: [] };
  const site = focused && kept.includes(focused.enzyme) ? focused : sites.find(s => s.enzyme === kept[kept.length - 1]) ?? null;
  return { site, enzymes: kept };
}

/** "EcoRI", "EcoRI and BamHI", "EcoRI, BamHI and XbaI", then "4 enzymes". */
export function enzymesText(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "no enzymes";
  if (names.length > 3) return `${names.length} enzymes`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
