// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Picking several rows of a list with ⌘ or Ctrl, or Shift. Rows are ids in the order the
// list shows them, never indices, so a selection outlives the list being worked out again
// (realigning reads changes their indices; sorting or filtering primers changes their rows).
// The Reads tab's list builds on this in readSelection.ts, the Primers tab's uses it as it
// is. No DOM here, so it is unit-tested.

export interface Picks {
  ids: string[];
  /** Where Shift-click extends from. */
  anchor: string | null;
}

export const NO_PICKS: Picks = { ids: [], anchor: null };

/** ⌘-click or Ctrl-click: adds a row, or takes it out. */
export function togglePick(p: Picks, id: string): Picks {
  return { ids: p.ids.includes(id) ? p.ids.filter(x => x !== id) : [...p.ids, id], anchor: id };
}

/** Shift-click: every row from the anchor to this one, in the list's order. */
export function extendPick(p: Picks, id: string, rows: string[]): Picks {
  const to = rows.indexOf(id);
  if (to < 0) return p;
  const found = p.anchor === null ? -1 : rows.indexOf(p.anchor);
  const from = found < 0 ? to : found;
  return { ids: rows.slice(Math.min(from, to), Math.max(from, to) + 1), anchor: rows[from] };
}

/** Leaves out rows that are gone (removed, or no longer in the list). */
export function prunePicks(p: Picks, rows: string[]): Picks {
  const ids = p.ids.filter(id => rows.includes(id));
  if (ids.length === p.ids.length) return p;
  return { ids, anchor: p.anchor !== null && ids.includes(p.anchor) ? p.anchor : null };
}
