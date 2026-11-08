// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Delete with something clicked, and what an edit to bases takes with it.
//
// Clicking a feature or primer selects its bases, so Delete used to delete them, and the
// feature with them, when the user meant only the feature. Now the first press deletes what
// was clicked and leaves its bases selected; the next press deletes the bases. Cut sites and
// ORFs are found from the sequence, so their first press only makes them plain bases.

import { regionsOf, withRegions } from "./regions.ts";
import type { Range, SeqData, SeqFeature, SeqPrimer } from "./seqdata.ts";

/** The parts of a selection that decide what Delete does. */
export interface PickedSelection {
  range: Range | null;
  focus: { kind: "feature" | "primer" | "cutsite" | "orf"; id: string; region?: number } | null;
}

/** The first press of Delete on something clicked. */
export interface FirstDelete {
  /** The data afterwards: the same object when only the selection changes. */
  data: SeqData;
  /** The undo step's name, when the data changes. */
  label?: string;
  /** Left selected as plain bases, so the next press deletes them. */
  range: Range;
  message: string;
}

const AGAIN = "Press Delete again to delete them too.";

/** What the first press of Delete does, or null when it deletes the selected bases. */
export function firstDelete(d: SeqData, sel: PickedSelection): FirstDelete | null {
  const { range, focus } = sel;
  if (!range || !focus) return null;
  switch (focus.kind) {
    case "feature": {
      const f = d.features.find(x => x.id === focus.id);
      if (!f) return null;
      const name = f.name.trim() || "the feature";
      if (focus.region !== undefined) {
        const regions = regionsOf(f);
        const r = regions[focus.region];
        if (!r) return null;
        const notes = withRegions(f.notes, regions.filter(x => x !== r));
        return {
          data: { ...d, features: d.features.map(x => (x.id === f.id ? { ...x, notes } : x)) },
          label: "Remove region",
          range,
          message: `Removed ${r.name} from ${name}; its bases are still selected. ${AGAIN}`
        };
      }
      return {
        data: { ...d, features: d.features.filter(x => x.id !== f.id) },
        label: "Delete feature",
        range,
        message: `Deleted ${name}; its bases are still selected. ${AGAIN}`
      };
    }
    case "primer": {
      const p = d.primers.find(x => x.id === focus.id);
      if (!p) return null;
      return {
        data: { ...d, primers: d.primers.filter(x => x.id !== p.id) },
        label: "Delete primer",
        range,
        message: `Deleted ${p.name.trim() || "the primer"}; the bases it binds are still selected. ${AGAIN}`
      };
    }
    case "cutsite":
      return { data: d, range, message: "Cut sites come from the sequence, so only their bases can be deleted. Press Delete again to delete them." };
    case "orf":
      return { data: d, range, message: "ORFs come from the sequence, so only their bases can be deleted. Press Delete again to delete them." };
  }
}

/** Features and primers an edit to the bases took with it. */
export interface Lost {
  features: SeqFeature[];
  primers: SeqPrimer[];
}

/**
 * The features and primers gone after an edit that changed the bases, or null if none
 * are. Edits that leave the bases alone (deleting a feature) remove things on purpose.
 */
export function lostWith(before: SeqData, after: SeqData): Lost | null {
  if (before.sequence === after.sequence) return null;
  const features = gone(before.features, after.features);
  const primers = gone(before.primers, after.primers);
  return features.length || primers.length ? { features, primers } : null;
}

function gone<T extends { id: string }>(before: T[], after: T[]): T[] {
  if (before.length === 0) return [];
  const kept = new Set(after.map(x => x.id));
  return before.filter(x => !kept.has(x.id));
}

/** "The feature lacZ was inside the deleted bases, so it was deleted too." */
export function describeLost(lost: Lost): string {
  const { features, primers } = lost;
  const both = features.length > 0 && primers.length > 0;
  const parts = [group(features, "feature", both), group(primers, "primer", both)].filter(Boolean);
  const many = features.length + primers.length > 1;
  const text = `${parts.join(" and ")} ${many ? "were" : "was"} inside the deleted bases, so ${many ? "they were" : "it was"} deleted too.`;
  return text[0].toUpperCase() + text.slice(1);
}

/**
 * "the feature lacZ", "the primers F and R", "5 features". Names are given for up to three,
 * or only for one when features and primers are both named, so the sentence stays readable.
 */
function group(items: { name: string }[], noun: string, both: boolean): string {
  if (!items.length) return "";
  if (items.length > (both ? 1 : 3)) return `${items.length} ${noun}s`;
  const names = items.map(x => x.name.trim() || "(unnamed)");
  return `the ${noun}${items.length > 1 ? "s" : ""} ${listed(names)}`;
}

/** "a", "a and b", "a, b and c". */
function listed(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
