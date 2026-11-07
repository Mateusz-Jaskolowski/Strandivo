// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// How far each file's map is turned, so a plasmid opens the way it was last shown. Kept in
// this app's local storage by path, like the reads remembered for a file
// (src/readChecks.ts), so the file itself never changes. Label size is a setting, the
// same for every file, and zoom isn't kept: every map opens fitted to the window.

const KEY = "strandivo.mapRotations";
/** Files remembered at most; the longest unused go first. */
const LIMIT = 300;

type Stored = Record<string, { rotation: number; at: number }>;

function load(): Stored {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** The rotation last given to the map of the file at `path`, in degrees; 0 if none. */
export function rememberedRotation(path: string): number {
  const r = load()[path]?.rotation;
  return typeof r === "number" && Number.isFinite(r) ? ((Math.round(r) % 360) + 360) % 360 : 0;
}

/** Remembers the map's rotation for the file; 0 forgets it. */
export function rememberRotation(path: string, rotation: number) {
  const all = load();
  if (rotation) all[path] = { rotation, at: Date.now() };
  else if (all[path]) delete all[path];
  else return;
  const kept = Object.entries(all)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* storage full or unavailable: the rotation just isn't remembered */
  }
}
