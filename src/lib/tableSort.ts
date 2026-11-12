// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Sorting a table by a clicked column heading, for every table that offers it: which way a
// column sorts first, what a second click does, and the rows in that order. No DOM here,
// so it is unit-tested; the heading itself is `sortHeader` in src/ui/sortHead.ts.

export interface TableSort<K extends string> {
  key: K;
  descending: boolean;
}

export interface SortRules<K extends string> {
  /** Columns that sort high to low first, such as the newest date or the most clones. */
  firstDescending?: readonly K[];
  /** A third click on a column goes back to the table's own order (no sort). */
  canClear?: boolean;
}

/** "Primer 4" before "Primer 10", and case doesn't matter. */
export const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * The sort after clicking a column: another column starts its own way round, the same one
 * turns round, and where a table can go back to its own order, a third click does that.
 */
export function nextTableSort<K extends string>(current: TableSort<K> | null, key: K, rules: SortRules<K> = {}): TableSort<K> | null {
  const first = rules.firstDescending?.includes(key) ?? false;
  if (!current || current.key !== key) return { key, descending: first };
  if (rules.canClear && current.descending !== first) return null;
  return { key, descending: !current.descending };
}

/** A sort read back from storage, or `fallback` if it isn't one of the table's columns. */
export function parseTableSort<K extends string>(raw: unknown, keys: readonly K[], fallback: TableSort<K> | null): TableSort<K> | null {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as { key?: unknown; descending?: unknown };
  const key = keys.find(k => k === o.key);
  return key ? { key, descending: o.descending === true } : fallback;
}

/**
 * The rows in the order asked for, or as they came with no sort. Ties are broken by `tie`,
 * turned round with the sort; rows for which `last` holds go last either way, in their
 * own order.
 */
export function sortedBy<T, K extends string>(
  rows: readonly T[],
  sort: TableSort<K> | null,
  compare: (key: K, a: T, b: T) => number,
  tie: (a: T, b: T) => number = () => 0,
  last: (key: K, row: T) => boolean = () => false
): T[] {
  if (!sort) return [...rows];
  const sign = sort.descending ? -1 : 1;
  return [...rows].sort((a, b) => {
    const la = last(sort.key, a);
    if (la !== last(sort.key, b)) return la ? 1 : -1;
    return sign * compare(sort.key, a, b) || sign * tie(a, b);
  });
}
