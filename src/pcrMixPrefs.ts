// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What the PCR product dialog's reaction mix keeps between windows (`src/lib/pcrMix.ts`):
// the reaction volume, how much over the mix is made, the primer stock and the template
// volume, in local storage. They are habits of the bench, not of one file, so every window
// reads the same ones. How many reactions are set up is not among them: that belongs to the
// experiment and lasts only while the window stays open.

import { MIX_DEFAULTS, readMixPrefs, type MixPrefs } from "./lib/pcrMix.ts";

const KEY = "strandivo.pcrMix";

let prefs: MixPrefs = load();

function load(): MixPrefs {
  try {
    return readMixPrefs(JSON.parse(localStorage.getItem(KEY) || "{}"));
  } catch {
    return { ...MIX_DEFAULTS };
  }
}

export function mixPrefs(): MixPrefs {
  return prefs;
}

export function saveMixPrefs(next: Partial<MixPrefs>) {
  prefs = readMixPrefs({ ...prefs, ...next });
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable: the choice lasts until the window closes */
  }
}
