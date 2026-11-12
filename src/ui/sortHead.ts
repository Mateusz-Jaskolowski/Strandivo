// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// A table heading that sorts by its column when clicked, with an arrow for the way it
// sorts. What a click does is `nextTableSort` (src/lib/tableSort.ts).

import { h } from "./dom.ts";
import type { TableSort } from "../lib/tableSort.ts";

export interface SortHeaderOptions<K extends string> {
  label: string;
  key: K;
  sort: TableSort<K> | null;
  onSort(key: K): void;
  /** Classes for the cell, such as `sv-num` for a column of numbers. */
  cls?: string;
  /** What the column holds, where its label doesn't say. */
  title?: string;
}

export function sortHeader<K extends string>(o: SortHeaderOptions<K>): HTMLTableCellElement {
  const on = o.sort?.key === o.key;
  const descending = on && o.sort!.descending;
  return h(
    "th",
    { scope: "col", class: `${o.cls ?? ""} sv-th-sort`, "aria-sort": on ? (descending ? "descending" : "ascending") : null },
    h(
      "button",
      {
        type: "button",
        class: `sv-sort${on ? " sv-sort-on" : ""}`,
        title: o.title ? `${o.title}. Click to sort` : `Sort by ${o.label.toLowerCase()}`,
        onclick: () => o.onSort(o.key)
      },
      o.label,
      h("span", { class: "sv-sort-mark", "aria-hidden": "true" }, on ? (descending ? "↓" : "↑") : "")
    )
  );
}
