// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Read names as the alignment shows them. Reads from one plate tend to share a long start
// (a date, an order number) and differ only after it, so the shared start is left out
// where room is short, and long names may break after the characters that separate
// their parts.

/** Characters that separate the parts of a read's name. */
const SEPARATORS = "_-. ";

/** The shared start must be at least this long to be worth leaving out. */
const MIN_PREFIX = 4;

/** What must be left of each name once the shared start is left out. */
const MIN_REST = 3;

/**
 * The start every name shares, ending just after a separator, so it never cuts a part of
 * a name in two. Empty when fewer than two different names share one worth leaving out.
 */
export function sharedPrefix(names: readonly string[]): string {
  const distinct = [...new Set(names)];
  if (distinct.length < 2) return "";
  let n = Math.min(...distinct.map(s => s.length));
  for (const s of distinct) {
    let i = 0;
    while (i < n && s[i] === distinct[0][i]) i++;
    n = i;
  }
  while (n > 0 && !SEPARATORS.includes(distinct[0][n - 1])) n--;
  if (n < MIN_PREFIX || distinct.some(s => s.length - n < MIN_REST)) return "";
  return distinct[0].slice(0, n);
}

/** A name in pieces, each ending in a separator where there is one, so it can break between them. */
export function nameParts(name: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < name.length - 1; i++) {
    if (SEPARATORS.includes(name[i]) && !SEPARATORS.includes(name[i + 1])) {
      parts.push(name.slice(start, i + 1));
      start = i + 1;
    }
  }
  parts.push(name.slice(start));
  return parts.filter(Boolean);
}
