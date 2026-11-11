// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { loadAppData, onAppDataChanged, saveAppData, setAsideAppData } from "./platform.ts";
import { PersonalEnzymes } from "./lib/personalEnzymes.ts";

export const personalEnzymes = new PersonalEnzymes({
  load: () => loadAppData("personal-enzymes"),
  save: raw => saveAppData("personal-enzymes", raw),
  setAside: () => setAsideAppData("personal-enzymes"),
  listen: fn => onAppDataChanged("personal-enzymes", fn)
});
