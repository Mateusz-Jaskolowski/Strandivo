// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The sidebar's sections (left of a file): their order and which are folded, as kept in
// Settings. Dragging a heading and the Settings list both go through `moveSection`.

export type SidebarSection = "primers" | "enzymes" | "features";

export const SIDEBAR_SECTIONS: { id: SidebarSection; label: string }[] = [
  { id: "primers", label: "Primers" },
  { id: "enzymes", label: "Enzymes" },
  { id: "features", label: "Features" }
];

export const DEFAULT_SIDEBAR_ORDER: SidebarSection[] = SIDEBAR_SECTIONS.map(s => s.id);

const known = new Set<string>(DEFAULT_SIDEBAR_ORDER);

/** A stored order made whole: unknown and repeated names dropped, missing ones added in default order. */
export function sidebarOrder(raw: unknown): SidebarSection[] {
  const listed = Array.isArray(raw) ? raw.filter((x): x is SidebarSection => typeof x === "string" && known.has(x)) : [];
  const order = Array.from(new Set(listed));
  for (const id of DEFAULT_SIDEBAR_ORDER) if (!order.includes(id)) order.push(id);
  return order;
}

/** Stored folded sections, keeping only known names. */
export function foldedSections(raw: unknown): SidebarSection[] {
  return Array.isArray(raw) ? Array.from(new Set(raw.filter((x): x is SidebarSection => typeof x === "string" && known.has(x)))) : [];
}

/**
 * Moves `id` to the gap `gap` (0 = before the first section, `order.length` = after the
 * last), as counted in the order before the move. Returns the same array if nothing moves.
 */
export function moveSection(order: SidebarSection[], id: SidebarSection, gap: number): SidebarSection[] {
  const from = order.indexOf(id);
  if (from < 0) return order;
  const to = Math.max(0, Math.min(order.length, gap));
  if (to === from || to === from + 1) return order;
  const next = order.filter(x => x !== id);
  next.splice(to > from ? to - 1 : to, 0, id);
  return next;
}

/** The gap a pointer at `y` points to, given each section's top and bottom on screen, in order. */
export function dropGap(sections: { top: number; bottom: number }[], y: number): number {
  let gap = 0;
  for (const s of sections) if (y > (s.top + s.bottom) / 2) gap++;
  return gap;
}
