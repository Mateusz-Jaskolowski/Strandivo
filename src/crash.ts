// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// After a crash: the main window takes what the shell's panic hook wrote
// (src-tauri/src/crash.rs) and offers it in a quiet strip under the app bar, never a
// dialog. Report it… opens Report a Bug with the crash in it, shown in full; nothing is
// sent until the user clicks Send there. With usage statistics on, the crash is counted
// as an `error` of kind `crash`, without its message.

import { h } from "./ui/dom.ts";
import { iconSvg } from "./ui/icons.ts";
import { takeCrashReport } from "./platform.ts";
import { parseCrash } from "./lib/crash.ts";
import type { CrashReport } from "./lib/feedback.ts";
import { track } from "./usage.ts";

export interface CrashOffer {
  /** The strip, to place under the app bar. */
  el: HTMLElement;
  /** Takes the crash file, if there is one, and offers it (run once at start). */
  check(): Promise<void>;
}

/**
 * `report` opens the bug report with the crash in it and calls `sent` once it has gone;
 * `until`: counting waits for it (the welcome window, which asks about statistics).
 */
export function startCrashOffer(report: (crash: CrashReport, sent: () => void) => void, until: Promise<unknown> = Promise.resolve()): CrashOffer {
  const el = h("div", { class: "sv-crash", role: "status", hidden: true });
  const hide = () => {
    el.hidden = true;
    el.replaceChildren();
  };
  const button = (label: string, onclick: () => void, primary = false) =>
    h("button", { type: "button", class: `sv-btn sv-btn-small${primary ? " sv-btn-primary" : ""}`, onclick }, label);

  async function check() {
    const crash = parseCrash(await takeCrashReport());
    if (!crash) return;
    el.replaceChildren(
      iconSvg("warn", 16),
      h("span", { class: "sv-offer-text" }, "Strandivo quit unexpectedly last time."),
      button("Report it…", () => report(crash, hide), true),
      button("Dismiss", hide)
    );
    el.hidden = false;
    await until.catch(() => {});
    track("error", { kind: "crash" });
  }

  return { el, check };
}
