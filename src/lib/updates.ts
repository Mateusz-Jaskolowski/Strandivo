// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// When the app checks for updates and what the strip says (src/updates.ts runs it). No DOM,
// so it is unit-tested.

/** At most one automatic check a day. */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;

/** What the app remembers between launches, in its local storage. */
export interface UpdateMemory {
  /** When a check last got an answer (ms since 1970). */
  lastCheck?: number;
  /** A version the user chose to skip: automatic checks don't offer it again. */
  skipped?: string;
  /** The version this copy last started as, to say when it has been updated. */
  shownVersion?: string;
}

/** Whether an automatic check is due. A clock set back counts as due, or it could wait for weeks. */
export function dueForCheck(memory: UpdateMemory, now: number, auto: boolean): boolean {
  if (!auto) return false;
  const last = memory.lastCheck;
  return last === undefined || !Number.isFinite(last) || now - last >= CHECK_EVERY_MS || last > now;
}

/** Whether to show an update that was found: always when the user asked, else unless skipped. */
export const shouldOffer = (version: string, memory: UpdateMemory, asked: boolean) => asked || memory.skipped !== version;

/** "Downloading… 45%", or the amount so far when the server didn't say how big it is. */
export function progressText(downloaded: number, total: number | null | undefined): string {
  if (total && total > 0) return `Downloading… ${Math.min(100, Math.floor((downloaded / total) * 100))}%`;
  return `Downloading… ${(downloaded / 1e6).toFixed(1)} MB`;
}

/**
 * Whether to say "Strandivo was updated to …" on this start: only when an earlier version
 * started here before, so a first install says nothing.
 */
export const wasUpdated = (memory: UpdateMemory, current: string) => memory.shownVersion !== undefined && memory.shownVersion !== current;

/** Reads what was remembered, ignoring anything malformed. */
export function parseMemory(text: string | null): UpdateMemory {
  try {
    const v = JSON.parse(text || "{}");
    const m: UpdateMemory = {};
    if (typeof v?.lastCheck === "number") m.lastCheck = v.lastCheck;
    if (typeof v?.skipped === "string") m.skipped = v.skipped;
    if (typeof v?.shownVersion === "string") m.shownVersion = v.shownVersion;
    return m;
  } catch {
    return {};
  }
}
