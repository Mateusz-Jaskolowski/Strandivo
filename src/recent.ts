// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Recently opened files (shared by all windows: they use the same storage).

const KEY = "ps.recentFiles";
const MAX = 12;

export function recentFiles(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(v) ? v.filter(x => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function addRecentFile(path: string) {
  try {
    const list = [path, ...recentFiles().filter(p => p !== path)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable */
  }
}

export function removeRecentFile(path: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(recentFiles().filter(p => p !== path)));
  } catch {
    /* storage unavailable */
  }
}
