// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Usage statistics, in the main window: `track` queues an event from the list in
// src/lib/usage.ts if the user chose to share, and the queue goes to the shell every 30
// seconds (src-tauri/src/usage.rs sends it on to Aptabase). Nothing is queued before the
// welcome window has closed, and turning sharing off empties the queue at once, so what
// was queued is never sent. Turning it off sends nothing either, not even that.

import { countErrors } from "./feedback.ts";
import { sendUsage, systemInfo } from "./platform.ts";
import { libraryFolders } from "./constructLibrary.ts";
import { loadSettings, onSettingsChanged } from "./settings.ts";
import { usageEvent, type UsageEvent, type UsageEventName, type UsageProps } from "./lib/usage.ts";

const FLUSH_MS = 30_000;
/** Aptabase takes 25 in one request. */
const BATCH = 25;
/** Per launch, so a loop that throws or a busy afternoon can't flood anything. */
const MAX_EACH = 200;
const MAX_ERRORS = 10;

let queue: UsageEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let announced = false;
const sent = new Map<string, number>();
const once = new Set<string>();
/** When this copy first counted a start; kept on this computer, only its bucket is sent. */
const FIRST_START_KEY = "strandivo.firstStart";

const sharing = () => loadSettings().shareUsage === true;

function forget() {
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
}

/** Queues an event, if the user shares statistics; anything not on the list is dropped. */
export function track<E extends UsageEventName>(name: E, props?: UsageProps<E>) {
  if (!started || !sharing()) return;
  const n = sent.get(name) ?? 0;
  if (n >= (name === "error_caught" ? MAX_ERRORS : MAX_EACH)) return;
  const e = usageEvent(name, props as Record<string, unknown>);
  if (!e) return;
  sent.set(name, n + 1);
  queue.push(e);
  if (queue.length >= BATCH) void flushUsage();
  else timer ??= setTimeout(() => void flushUsage(), FLUSH_MS);
}

/** Queues an event once a launch for the same properties (a view used, not every switch). */
export function trackOnce<E extends UsageEventName>(name: E, props?: UsageProps<E>) {
  if (!started || !sharing()) return;
  const key = `${name} ${JSON.stringify(props ?? {})}`;
  if (once.has(key)) return;
  once.add(key);
  track(name, props);
}

/** Days since this copy first counted a start; the first start is today. */
function daysInstalled(now = Date.now()): number {
  try {
    const first = Number(localStorage.getItem(FIRST_START_KEY));
    if (first > 0 && first <= now) return (now - first) / 86_400_000;
    localStorage.setItem(FIRST_START_KEY, String(now));
  } catch {
    // Without storage every start is a first one, which only undercounts.
  }
  return 0;
}

/** Sends what is queued now; also when the window closes. */
export async function flushUsage(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!sharing()) return forget();
  while (queue.length) await sendUsage(queue.splice(0, BATCH));
}

async function announce() {
  if (announced || !sharing()) return;
  announced = true;
  const { arch } = await systemInfo();
  track("app_started", { arch: arch === "aarch64" || arch === "x86_64" ? arch : "other", installed: daysInstalled(), folders: libraryFolders().length });
  const st = loadSettings();
  track("settings_chosen", {
    tm: st.tm.method,
    amber: st.amberAsQ ? "on" : "off",
    bases: st.sequenceCase === "uppercase" ? "upper" : st.sequenceCase === "lowercase" ? "lower" : "as_file"
  });
}

/** Starts counting once `until` (the welcome window, which asks) has settled. */
export function startUsage(until: Promise<unknown>) {
  void until.finally(() => {
    started = true;
    void announce();
  });
  // Turned on in Settings: this launch counts from then. Turned off: nothing more goes.
  onSettingsChanged(s => (s.shareUsage ? started && void announce() : forget()));
  countErrors(kind => track("error_caught", { kind }));
}
