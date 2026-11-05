// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The construct library behind Home: the folders of plasmid files it lists, what was read
// from each file (so only new or changed files are read again), and the short notes typed
// on Home. Kept in this app's local storage, like the settings and the primer library;
// the files themselves stay where they are.

import type { ConstructInfo } from "./lib/constructs.ts";

const FOLDERS_KEY = "strandivo.libraryFolders";
const CACHE_KEY = "strandivo.constructCache";
const NOTES_KEY = "strandivo.constructNotes";
/** Raise when what is read from a file changes, so every file is read again. */
const CACHE_VERSION = 1;

function read<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: the library still works, it just reads files again */
  }
}

export function libraryFolders(): string[] {
  const v = read<unknown>(FOLDERS_KEY, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function setLibraryFolders(folders: string[]) {
  write(FOLDERS_KEY, Array.from(new Set(folders)));
}

/**
 * What was read from the file last time, if nothing has changed since. `catalog` is the
 * parts catalog's current fingerprint: a construct whose contents came from detection is
 * read again when the catalog has moved on, since a newer catalog may find more. Raising
 * CACHE_VERSION alone would only do that once.
 */
export function cachedConstruct(path: string, size: number, modified: number, catalog = ""): ConstructInfo | null {
  const cache = read<{ v?: number; items?: Record<string, ConstructInfo> }>(CACHE_KEY, {});
  const hit = cache.v === CACHE_VERSION ? cache.items?.[path] : undefined;
  if (!hit || hit.size !== size || hit.modified !== modified) return null;
  if (hit.detected && hit.catalogVersion !== catalog) return null;
  return hit;
}

/** Keeps exactly these (files no longer in a library folder drop out). */
export function cacheConstructs(infos: ConstructInfo[]) {
  write(CACHE_KEY, { v: CACHE_VERSION, items: Object.fromEntries(infos.map(i => [i.path, i])) });
}

export function constructNote(path: string): string | undefined {
  return read<Record<string, string>>(NOTES_KEY, {})[path];
}

export function setConstructNote(path: string, note: string) {
  const notes = read<Record<string, string>>(NOTES_KEY, {});
  if (note.trim()) notes[path] = note.trim();
  else delete notes[path];
  write(NOTES_KEY, notes);
}
