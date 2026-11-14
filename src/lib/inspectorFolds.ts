// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Which of the inspector's sections are folded to their heading: one choice per kind of
// section for the whole app (a CDS's translation folds in every file), kept in local
// storage by `src/inspectorFolds.ts`. A section nobody has folded or opened follows its
// default, so a default can change later without undoing anyone's choice.

export type InspectorFold =
  | "note"
  | "qualifiers"
  | "protein"
  | "regions"
  | "region-list"
  | "translation"
  | "variable"
  | "inside"
  | "sequencing"
  | "binding"
  | "checks"
  | "frame-translation"
  | "locations";

/** Folded until opened: long, and seldom what a click on the thing was for. */
const FOLDED_FIRST: ReadonlySet<InspectorFold> = new Set(["qualifiers", "region-list", "translation", "inside"]);

const KNOWN: ReadonlySet<string> = new Set<InspectorFold>([
  "note",
  "qualifiers",
  "protein",
  "regions",
  "region-list",
  "translation",
  "variable",
  "inside",
  "sequencing",
  "binding",
  "checks",
  "frame-translation",
  "locations"
]);

/** The sections someone folded (true) or opened (false); the rest follow their default. */
export type FoldState = Partial<Record<InspectorFold, boolean>>;

/** A stored state, keeping only known sections with a yes or no. */
export function readFolds(raw: unknown): FoldState {
  const out: FoldState = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [id, folded] of Object.entries(raw)) if (KNOWN.has(id) && typeof folded === "boolean") out[id as InspectorFold] = folded;
  return out;
}

export function foldedIn(state: FoldState, id: InspectorFold): boolean {
  return state[id] ?? FOLDED_FIRST.has(id);
}

export function withFold(state: FoldState, id: InspectorFold, folded: boolean): FoldState {
  return { ...state, [id]: folded };
}
