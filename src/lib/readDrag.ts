// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What dropping reads in the Reads tab's list means. The list is groups of reads (a clone,
// or one read alone), and the view only says where the pointer is. No DOM here, so every
// case is unit-tested.

export interface ListGroup {
  key: string;
  /** Read ids. */
  reads: string[];
}

export type DropTarget =
  /** On a clone or a lone read: the reads join it. */
  | { kind: "join"; key: string }
  /** Between two rows of the list: `before` is the next group's key, null for the end. */
  | { kind: "between"; before: string | null }
  /** Between the reads of a clone: `before` is the next read, null for its end. */
  | { kind: "inside"; key: string; before: string | null };

export interface Drop {
  /** Every read id, in the new order. */
  order: string[];
  /** Reads that change clone, and the clone (null: each on its own). */
  moved: { ids: string[]; key: string | null } | null;
}

/** Puts `ids` before `before` (or at the end, for null) among the other reads. */
function place(all: string[], ids: string[], before: string | null): string[] {
  const rest = all.filter(id => !ids.includes(id));
  const at = before === null ? rest.length : rest.indexOf(before);
  return [...rest.slice(0, at), ...ids, ...rest.slice(at)];
}

/**
 * What a drop does, or null if it changes nothing. `whole`: a whole clone is among what is
 * dragged. That only ever reorders whole clones: they don't merge by dragging, as that is
 * easy to do by accident and aligns everything again.
 */
export function applyDrop(groups: ListGroup[], dragged: string[], whole: boolean, target: DropTarget): Drop | null {
  const all = groups.flatMap(g => g.reads);
  const inOrder = (ids: string[]) => all.filter(id => ids.includes(id));
  const whollyDragged = (g: ListGroup) => g.reads.every(id => dragged.includes(id));
  const ids = inOrder(whole ? groups.filter(whollyDragged).flatMap(g => g.reads) : dragged);
  if (!ids.length) return null;
  const finish = (order: string[], moved: Drop["moved"]): Drop | null => (!moved && order.every((id, i) => id === all[i]) ? null : { order, moved });

  // The first group from `key` on that stays where it is.
  const nextStaying = (key: string | null): string | null => {
    if (key === null) return null;
    const from = groups.findIndex(g => g.key === key);
    for (const g of groups.slice(from)) {
      const stays = g.reads.find(id => !ids.includes(id));
      if (stays !== undefined) return stays;
    }
    return null;
  };
  // Reads dragged out of a clone that keeps other reads leave it.
  const leaving = groups.filter(g => g.reads.length > 1 && !whollyDragged(g)).flatMap(g => g.reads.filter(id => ids.includes(id)));

  if (target.kind === "between" || whole) {
    const before = target.kind === "between" ? target.before : target.key;
    return finish(place(all, ids, nextStaying(before)), leaving.length && !whole ? { ids: leaving, key: null } : null);
  }
  const group = groups.find(g => g.key === target.key);
  if (!group) return null;
  const joining = ids.filter(id => !group.reads.includes(id));
  const moved = joining.length ? { ids: joining, key: target.key } : null;
  const next = target.kind === "inside" && target.before !== null ? group.reads.slice(group.reads.indexOf(target.before)).find(id => !ids.includes(id)) : undefined;
  // At the clone's end: before whatever stays after it.
  const after = all.slice(all.indexOf(group.reads[group.reads.length - 1]) + 1).find(id => !ids.includes(id));
  return finish(place(all, ids, next ?? after ?? null), moved);
}
