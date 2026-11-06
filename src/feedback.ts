// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The recent errors a bug report may carry: the last 20 uncaught errors, rejected promises
// and failed shell commands of any of the app's windows, from the past week. They are kept
// in local storage, so a report after a crash still has the errors that led up to it, and
// go nowhere unless the user ticks "Recent errors" in Help → Send Feedback…, which shows
// them first with paths removed.

import { addError, errorLines, parseErrorLog, type LoggedError } from "./lib/crash.ts";

const KEY = "strandivo.recentErrors";
/** Where errors are kept if local storage can't be used. */
let memory: LoggedError[] = [];

function load(): LoggedError[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) return parseErrorLog(raw);
  } catch {
    /* no storage: this window's own errors */
  }
  return memory;
}

/** What failed: a script error, a promise nobody caught or a shell command. */
export type ErrorKind = "uncaught" | "rejection" | "command";
let counted: ((kind: ErrorKind) => void) | null = null;
/** Usage statistics count errors by kind (src/usage.ts); the message stays here. */
export function countErrors(fn: (kind: ErrorKind) => void) {
  counted = fn;
}

export function recordError(message: string, kind: ErrorKind = "command") {
  if (!message.trim()) return;
  counted?.(kind);
  // Read again each time, as other windows add theirs to the same list.
  memory = addError(load(), message);
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
  } catch {
    /* kept in memory only */
  }
}

/** "2026-11-06 09:30:12 TypeError: …", oldest first. */
export const recentErrors = (): string[] => errorLines(load());

const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : typeof e === "string" ? e : (() => { try { return JSON.stringify(e); } catch { return String(e); } })());

let started = false;
/** Starts keeping errors; each window calls it once. */
export function startErrorLog() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("error", e => recordError(e.error ? describe(e.error) : e.message, "uncaught"));
  window.addEventListener("unhandledrejection", e => recordError(`Unhandled: ${describe(e.reason)}`, "rejection"));
}
