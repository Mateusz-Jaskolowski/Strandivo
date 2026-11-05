// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Which files the user has waved away the "look for features" offer on, kept in this
// app's local storage like the remembered read checks (src/readChecks.ts). Without this a
// sparsely annotated plasmid would ask again every time it was opened.

const KEY = "strandivo.detectDismissed";

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function offerDismissed(path: string | null): boolean {
  return !!path && read().includes(path);
}

/** Remembers that this file's offer was waved away. Detection is still in the Tools menu. */
export function dismissOffer(path: string | null) {
  if (!path) return;
  const all = read();
  if (all.includes(path)) return;
  try {
    // Keep the list from growing without end; the oldest ones matter least.
    localStorage.setItem(KEY, JSON.stringify([...all, path].slice(-500)));
  } catch {
    /* storage full or unavailable: the offer just shows again next time */
  }
}
