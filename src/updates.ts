// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Updating from inside the app (part 2 of docs/updates-feedback-usage-plan.md): checks a
// few seconds after the main window opens and then at most once a day, or when the user
// picks Check for Updates…, and offers what it finds in a quiet strip under the app bar,
// never a dialog. Installing goes through the ordinary quit (src-tauri/src/updates.rs),
// so unsaved tabs are asked about first, and it never restarts on its own.

import { h, toast } from "./ui/dom.ts";
import { iconSvg } from "./ui/icons.ts";
import { openDialog } from "./ui/modal.ts";
import { appVersion, canUpdate, checkForUpdate, downloadUpdate, openWhatsNew, restartToUpdate, takeUpdateFailure, type UpdateInfo } from "./platform.ts";
import { dueForCheck, parseMemory, progressText, shouldOffer, wasUpdated, type UpdateMemory } from "./lib/updates.ts";
import { releaseNotesFor, shortNotes } from "./lib/changelog.ts";
import { loadSettings, onSettingsChanged } from "./settings.ts";
import { track } from "./usage.ts";
// The notes of the version this copy is, built in: shown after an update, with no network.
import changelog from "../CHANGELOG.md?raw";

const KEY = "strandivo.updates";
/** The first automatic check waits this long, so it never competes with opening files. */
const FIRST_CHECK_MS = 5000;
/** How often an app left open asks itself whether a day has passed. */
const RECHECK_MS = 60 * 60 * 1000;

function remembered(): UpdateMemory {
  try {
    return parseMemory(localStorage.getItem(KEY));
  } catch {
    return {};
  }
}

function remember(patch: UpdateMemory) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...remembered(), ...patch }));
  } catch {
    /* storage unavailable: the app checks again next time */
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface Updates {
  /** The strip, to place under the app bar. */
  el: HTMLElement;
  /** Check now; `asked` = the user picked Check for Updates…, so say when there is none. */
  check(asked: boolean): Promise<void>;
  /** Says "Strandivo was updated to …" if this start follows an update (run once at start). */
  announce(): Promise<void>;
}

/**
 * A version's short notes in a small dialog, with the full notes a click away on
 * strandivo.com. `lines` are plain text; with none, the dialog only points to the website.
 */
export function showWhatsNew(version: string, lines: string[]) {
  const dlg = openDialog({ title: `What's new in Strandivo ${version}`, width: 480 });
  dlg.body.replaceChildren(...(lines.length ? lines : ["Release notes for this version are on strandivo.com."]).map(l => h("p", { class: "sv-whats-new" }, l)));
  dlg.footer.replaceChildren(
    h("button", { type: "button", class: "sv-btn", onclick: () => void openWhatsNew(version).catch(e => toast(errorText(e), "error", 6000)) }, "More on strandivo.com"),
    h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => dlg.close() }, "Close")
  );
}

/** `until`: nothing is checked on its own before it settles (the welcome window closing). */
export function startUpdates(until: Promise<unknown> = Promise.resolve()): Updates {
  const el = h("div", { class: "sv-update", role: "status", hidden: true });
  let checking = false;
  /** The update on offer, and how far it has got. */
  let found: UpdateInfo | null = null;
  let downloading = false;
  let ready = false;

  const button = (label: string, onclick: () => void, primary = false) =>
    h("button", { type: "button", class: `sv-btn sv-btn-small${primary ? " sv-btn-primary" : ""}`, onclick }, label);

  function hide() {
    el.hidden = true;
    el.replaceChildren();
  }

  function show(icon: "download" | "warn", text: string, ...actions: HTMLElement[]) {
    el.replaceChildren(iconSvg(icon, 16), h("span", { class: "sv-offer-text" }, text), ...actions);
    el.hidden = false;
  }

  function showOffer() {
    if (!found) return;
    const u = found;
    if (ready) {
      show("download", `Strandivo ${u.version} is ready to install.`, button("Restart now", () => void restart(), true), button("Later", hide));
      return;
    }
    show(
      "download",
      `Strandivo ${u.version} is available.`,
      button("What's new…", () => showWhatsNew(u.version, shortNotes(u.notes))),
      button("Install and restart", () => void install(), true),
      button("Skip this version", () => {
        remember({ skipped: u.version });
        hide();
      }),
      button("Later", hide)
    );
  }

  async function install() {
    if (!found || downloading) return;
    const u = found;
    downloading = true;
    const progress = h("span", { class: "sv-offer-text" }, progressText(0, null));
    el.replaceChildren(iconSvg("download", 16), progress);
    el.hidden = false;
    try {
      await downloadUpdate(p => (progress.textContent = progressText(p.downloaded, p.total)));
      downloading = false;
      if (found !== u) return;
      ready = true;
      await restart();
    } catch (e) {
      downloading = false;
      show("warn", errorText(e), button("Try again", () => void install()), button("Later", hide));
    }
  }

  async function restart() {
    try {
      // Quits once unsaved tabs are dealt with; if the user keeps one open, the strip stays.
      await restartToUpdate();
    } catch (e) {
      show("warn", errorText(e), button("Later", hide));
      return;
    }
    showOffer();
  }

  async function check(asked: boolean) {
    if (checking || downloading) return;
    if (!canUpdate()) {
      if (asked) toast("Automatic updates are only in the desktop app.", "info", 5000);
      return;
    }
    checking = true;
    try {
      const u = await checkForUpdate();
      remember({ lastCheck: Date.now() });
      if (!u) {
        if (asked) toast("Strandivo is up to date.", "success", 4000);
        return;
      }
      if (!shouldOffer(u.version, remembered(), asked)) return;
      if (found?.version !== u.version) ready = u.ready;
      else ready ||= u.ready;
      found = u;
      showOffer();
    } catch (e) {
      // Offline, or a build that can't update: only worth saying when asked.
      if (asked) toast(errorText(e), "error", 8000);
    } finally {
      checking = false;
    }
  }

  let held = true;
  const checkIfDue = () => {
    if (!held && dueForCheck(remembered(), Date.now(), loadSettings().checkForUpdates)) void check(false);
  };

  async function announce() {
    const version = await appVersion();
    if (!version) return;
    const memory = remembered();
    remember({ shownVersion: version });
    if (!wasUpdated(memory, version)) return;
    track("update_installed");
    if (!el.hidden) return;
    const notes = releaseNotesFor(changelog, version);
    show(
      "download",
      `Strandivo was updated to ${version}.`,
      button("What's new…", () => {
        hide();
        showWhatsNew(version, notes?.summary ? [notes.summary] : []);
      }),
      button("Close", hide)
    );
  }

  void takeUpdateFailure().then(why => why && show("warn", why, button("Later", hide)));
  void until.finally(() => {
    held = false;
    void announce();
    setTimeout(checkIfDue, FIRST_CHECK_MS);
  });
  setInterval(checkIfDue, RECHECK_MS);
  // Turning checks back on in Settings checks then, if a day has passed.
  onSettingsChanged(s => s.checkForUpdates && checkIfDue());

  return { el, check, announce };
}
