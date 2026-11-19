// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The inspector's folded sections (`src/lib/inspectorFolds.ts`), one choice per kind of
// section for the whole app, kept in local storage. Every open file reads the same state,
// and each inspector shows it when it next draws.

import { foldedIn, readFolds, withFold, type FoldState, type InspectorFold } from "./lib/inspectorFolds.ts";

const KEY = "strandivo.inspectorFolds";

let state: FoldState = load();

function load(): FoldState {
  try {
    return readFolds(JSON.parse(localStorage.getItem(KEY) || "{}"));
  } catch {
    return {};
  }
}

export function sectionFolded(id: InspectorFold, defaultFolded?: boolean): boolean {
  return foldedIn(state, id, defaultFolded);
}

export function setSectionFolded(id: InspectorFold, folded: boolean) {
  state = withFold(state, id, folded);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: the choice lasts until the window closes */
  }
}
