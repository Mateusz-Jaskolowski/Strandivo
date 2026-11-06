// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The recent errors a bug report may carry: the last 20 uncaught errors, rejected promises
// and failed shell commands, in memory only, so they go nowhere unless the user ticks
// "Recent errors" in Help → Send Feedback…, which shows them first with paths removed.

import { LIMITS } from "./lib/feedback.ts";

const errors: string[] = [];

export function recordError(message: string) {
  const line = message.trim();
  if (!line) return;
  errors.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
  if (errors.length > LIMITS.errors) errors.splice(0, errors.length - LIMITS.errors);
}

export const recentErrors = (): string[] => [...errors];

const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : typeof e === "string" ? e : (() => { try { return JSON.stringify(e); } catch { return String(e); } })());

let started = false;
/** Starts keeping errors; each window calls it once. */
export function startErrorLog() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("error", e => recordError(e.error ? describe(e.error) : e.message));
  window.addEventListener("unhandledrejection", e => recordError(`Unhandled: ${describe(e.reason)}`));
}
