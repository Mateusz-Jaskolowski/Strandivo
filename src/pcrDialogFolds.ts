// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Remembered folded sections for the PCR product dialog (`src/lib/pcrDialogFolds.ts`), kept
// in local storage so hiding the product map, simulated gel or cycling program carries across
// dialogs.

import { pcrDialogFoldedIn, readPcrDialogFolds, withPcrDialogFold, type PcrDialogFoldState, type PcrDialogSection } from "./lib/pcrDialogFolds.ts";

const KEY = "strandivo.pcrDialogFolds";

let state: PcrDialogFoldState = load();

function load(): PcrDialogFoldState {
  try {
    return readPcrDialogFolds(JSON.parse(localStorage.getItem(KEY) || "{}"));
  } catch {
    return {};
  }
}

export function pcrSectionFolded(id: PcrDialogSection): boolean {
  return pcrDialogFoldedIn(state, id, false);
}

export function setPcrSectionFolded(id: PcrDialogSection, folded: boolean) {
  state = withPcrDialogFold(state, id, folded);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: choice lasts until the window closes */
  }
}
