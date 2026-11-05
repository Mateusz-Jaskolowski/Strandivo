// Selecting several reads and clones in the Reads tab's list. Items are the list's rows in
// order, by read id and clone key, so a selection outlives realigning, which changes read
// indices. Picking itself is in picks.ts, shared with the Primers tab's list; here it is
// given the rows of this list. No DOM here, so it is unit-tested.

import { extendPick as extendRows, prunePicks as pruneRows, type Picks } from "./picks.ts";

export { NO_PICKS, togglePick } from "./picks.ts";

export interface ListItem {
  /** A read's id, or `clone:<key>` for a clone of several reads. */
  id: string;
  /** Ids of the reads it stands for. */
  reads: string[];
}

export type ReadPicks = Picks;

export const cloneItem = (key: string) => `clone:${key}`;

/** The list's rows: a clone of several reads, then each of its reads; a lone read as itself. */
export function listItems(groups: { key: string; reads: string[] }[]): ListItem[] {
  return groups.flatMap(g => [...(g.reads.length > 1 ? [{ id: cloneItem(g.key), reads: g.reads }] : []), ...g.reads.map(id => ({ id, reads: [id] }))]);
}

/** Shift-click: every row from the anchor to this one. */
export function extendPick(p: ReadPicks, id: string, items: ListItem[]): ReadPicks {
  return extendRows(p, id, items.map(x => x.id));
}

/** Leaves out rows that are gone (removed, or a clone that was split). */
export function prunePicks(p: ReadPicks, items: ListItem[]): ReadPicks {
  return pruneRows(p, items.map(x => x.id));
}

/** Ids of the reads picked, each once, in list order. A read in a clone is only that read. */
export function pickedReads(p: ReadPicks, items: ListItem[]): string[] {
  const out = new Set<string>();
  for (const x of items) if (p.ids.includes(x.id)) for (const r of x.reads) out.add(r);
  return [...out];
}
