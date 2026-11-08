// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The reads the app remembers for each file, so a check isn't lost when its tab is closed:
// their paths, how they were grouped into clones and when. Kept in this app's local
// storage, like Home's notes, so the sequence file itself never changes. Check files
// (src/lib/readCheck.ts) are the way to share a check or move it to another computer, and
// to keep one in a browser that holds files only for the visit (Safari and Firefox).

import type { ReadCheck } from "./lib/readCheck.ts";

const KEY = "strandivo.readChecks";
/** Files remembered at most; the longest unused go first. */
const LIMIT = 300;

type Stored = Record<string, ReadCheck & { at: number }>;

function load(): Stored {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** The reads last checked against the file at `path`, if any. */
export function rememberedReads(path: string): ReadCheck | null {
  const hit = load()[path];
  return hit && Array.isArray(hit.reads) && hit.reads.length ? hit : null;
}

/** A browser's key for a file held only for the visit (src/webFiles.ts) leads nowhere later. */
const lasts = (path: string) => !path.startsWith("upload:");

/** Remembers the file's reads; none forgets them. */
export function rememberReads(path: string, check: ReadCheck | null) {
  if (!lasts(path)) return;
  const reads = check?.reads.filter(r => lasts(r.path)) ?? [];
  const all = load();
  if (check && reads.length) all[path] = { ...check, reads, at: Date.now() };
  else delete all[path];
  const kept = Object.entries(all)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* storage full or unavailable: the reads just aren't remembered */
  }
}
