// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What a crash left behind: the file the shell's panic hook writes
// (src-tauri/src/crash.rs) as the app goes down, read on the next launch, and the recent
// errors of the app's windows, kept for a week across a crash. Neither goes anywhere
// unless the user puts it in a bug report, which shows it first. No DOM.

import { LIMITS, type CrashReport } from "./feedback.ts";

/** The crash file's layout this version reads. */
export const CRASH_FORMAT = 1;

/**
 * The crash as a report holds it, from the shell's file; null for anything else. Paths
 * are still in the message: `buildReport` takes them out, as for recent errors.
 */
export function parseCrash(text: string | null): CrashReport | null {
  if (!text) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object" || o.format !== CRASH_FORMAT) return null;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const time = typeof o.time === "number" && Number.isFinite(o.time) && o.time > 0 ? new Date(o.time * 1000) : null;
  const message = str(o.message, LIMITS.crashMessage);
  if (!message.trim() || !time || Number.isNaN(time.getTime())) return null;
  return {
    version: str(o.version, 40) || "unknown",
    at: time.toISOString(),
    thread: str(o.thread, 60) || "unknown",
    location: str(o.location, 200) || "unknown",
    message
  };
}

/** A recent error as it is kept: when, and what. */
export interface LoggedError {
  at: string;
  text: string;
}

/** Errors older than this are dropped: they say nothing about what just happened. */
export const ERROR_DAYS = 7;

/** The kept errors, from what was stored; anything unreadable or too old is dropped. */
export function parseErrorLog(raw: string | null, now = Date.now()): LoggedError[] {
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const since = now - ERROR_DAYS * 86_400_000;
  return list
    .filter((e): e is LoggedError => !!e && typeof e === "object" && typeof e.at === "string" && typeof e.text === "string" && Date.parse(e.at) >= since)
    .map(e => ({ at: e.at, text: e.text.slice(0, LIMITS.error) }))
    .slice(-LIMITS.errors);
}

/** The list with one more error: at most the last 20, each cut to what a report takes. */
export function addError(list: LoggedError[], text: string, now = new Date()): LoggedError[] {
  const line = text.trim();
  if (!line) return list;
  return [...list, { at: now.toISOString(), text: line.slice(0, LIMITS.error) }].slice(-LIMITS.errors);
}

/** "2026-11-06 09:30:12 TypeError: …", in UTC, as a report shows them. */
export const errorLines = (list: LoggedError[]): string[] => list.map(e => `${e.at.slice(0, 10)} ${e.at.slice(11, 19)} ${e.text}`);
