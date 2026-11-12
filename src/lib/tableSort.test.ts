// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Sorting tables by a column. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { nextTableSort, parseTableSort, sortedBy, naturalOrder, type TableSort } from "./tableSort.ts";

type Key = "name" | "size" | "date";

test("a column starts its own way round and turns round on a second click", () => {
  const rules = { firstDescending: ["date"] as Key[] };
  assert.deepEqual(nextTableSort<Key>(null, "name", rules), { key: "name", descending: false });
  assert.deepEqual(nextTableSort<Key>(null, "date", rules), { key: "date", descending: true });
  assert.deepEqual(nextTableSort<Key>({ key: "date", descending: true }, "date", rules), { key: "date", descending: false });
  // Without a way back to the table's own order, clicks go round and round.
  assert.deepEqual(nextTableSort<Key>({ key: "date", descending: false }, "date", rules), { key: "date", descending: true });
  // Another column starts afresh.
  assert.deepEqual(nextTableSort<Key>({ key: "date", descending: false }, "size", rules), { key: "size", descending: false });
});

test("a table with its own order goes back to it on a third click", () => {
  const rules = { firstDescending: ["size"] as Key[], canClear: true };
  let s: TableSort<Key> | null = null;
  s = nextTableSort(s, "size", rules);
  assert.deepEqual(s, { key: "size", descending: true });
  s = nextTableSort(s, "size", rules);
  assert.deepEqual(s, { key: "size", descending: false });
  assert.equal(nextTableSort(s, "size", rules), null);
  assert.deepEqual(nextTableSort(nextTableSort(null, "name", rules), "name", rules), { key: "name", descending: true });
  assert.equal(nextTableSort({ key: "name", descending: true }, "name", rules), null);
});

test("a stored sort is used only if it names one of the table's columns", () => {
  const keys: Key[] = ["name", "size", "date"];
  const fallback: TableSort<Key> = { key: "name", descending: false };
  assert.deepEqual(parseTableSort({ key: "date", descending: true }, keys, fallback), { key: "date", descending: true });
  assert.deepEqual(parseTableSort({ key: "date", descending: "yes" }, keys, fallback), { key: "date", descending: false });
  assert.deepEqual(parseTableSort({ key: "colour" }, keys, fallback), fallback);
  assert.deepEqual(parseTableSort(undefined, keys, fallback), fallback);
  assert.equal(parseTableSort("name", keys, null), null);
});

test("rows sort by the column, with ties broken the same way round and some rows always last", () => {
  const rows = [
    { name: "pUC19", size: 2686, date: 3 },
    { name: "pET-28a", size: 5369, date: 1 },
    { name: "unreadable", size: 0, date: 2 },
    { name: "pUC18", size: 2686, date: 4 }
  ];
  const compare = (key: Key, a: (typeof rows)[number], b: (typeof rows)[number]) =>
    key === "name" ? naturalOrder.compare(a.name, b.name) : a[key] - b[key];
  const tie = (a: (typeof rows)[number], b: (typeof rows)[number]) => naturalOrder.compare(a.name, b.name);
  const last = (key: Key, r: (typeof rows)[number]) => key === "size" && r.size === 0;
  const names = (s: TableSort<Key> | null) => sortedBy(rows, s, compare, tie, last).map(r => r.name);
  assert.deepEqual(names({ key: "size", descending: false }), ["pUC18", "pUC19", "pET-28a", "unreadable"]);
  assert.deepEqual(names({ key: "size", descending: true }), ["pET-28a", "pUC19", "pUC18", "unreadable"]);
  assert.deepEqual(names({ key: "date", descending: true }), ["pUC18", "pUC19", "unreadable", "pET-28a"]);
  // No sort keeps the rows as they came, and never changes the array it was given.
  assert.deepEqual(names(null), ["pUC19", "pET-28a", "unreadable", "pUC18"]);
  assert.equal(rows[0].name, "pUC19");
});

test("names sort as people read them", () => {
  assert.deepEqual(["Primer 10", "primer 4", "Primer 2"].sort(naturalOrder.compare), ["Primer 2", "primer 4", "Primer 10"]);
});
