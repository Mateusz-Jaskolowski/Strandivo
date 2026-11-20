// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Pure fold-state helpers for the PCR product dialog's collapsible sections (product map,
// simulated gel, cycling program). Each defaults to open until the user folds it, matching
// the inspector's remembered folds (`src/lib/inspectorFolds.ts`).

export const PCR_DIALOG_SECTIONS = ["map", "gel", "program"] as const;
export type PcrDialogSection = (typeof PCR_DIALOG_SECTIONS)[number];
export type PcrDialogFoldState = Partial<Record<PcrDialogSection, boolean>>;

const KNOWN: ReadonlySet<string> = new Set(PCR_DIALOG_SECTIONS);

export function readPcrDialogFolds(raw: unknown): PcrDialogFoldState {
  if (!raw || typeof raw !== "object") return {};
  const out: PcrDialogFoldState = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (KNOWN.has(k) && typeof v === "boolean") out[k as PcrDialogSection] = v;
  }
  return out;
}

export function pcrDialogFoldedIn(state: PcrDialogFoldState, id: PcrDialogSection, defaultFolded = false): boolean {
  return state[id] ?? defaultFolded;
}

export function withPcrDialogFold(state: PcrDialogFoldState, id: PcrDialogSection, folded: boolean): PcrDialogFoldState {
  return { ...state, [id]: folded };
}
