// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The welcome window (part 3 of docs/updates-feedback-usage-plan.md): on first launch, over
// the main window, which opens as usual behind it so a file that started the app still
// opens. One page, so every choice is in view and closing it any way keeps them as shown.
// Nothing goes online while it is open: the main window holds the first update check back
// until it closes. Which parts show is decided in src/lib/welcome.ts.

import { h, toast } from "./ui/dom.ts";
import { openDialog } from "./ui/modal.ts";
import { canKeepFolders, openUsagePage, pickFiles } from "./platform.ts";
import { shownPath } from "./webFiles.ts";
import { basename } from "./lib/files.ts";
import { WELCOME_VERSION, welcomeParts, type WelcomePart } from "./lib/welcome.ts";
import { loadSettings, saveSettings } from "./settings.ts";

export interface WelcomeHost {
  /** Home's own folder picker: adds the folder and says which, or null. */
  chooseFolder(): Promise<string | null>;
}

/**
 * Opens the welcome window: all of it when `reopened` (Help → Welcome…), else only what this
 * user hasn't been asked. Resolves when it closes; at once if there is nothing to ask.
 */
export function openWelcome(host: WelcomeHost, reopened = false): Promise<void> {
  const parts = welcomeParts(loadSettings().welcomeSeen, reopened);
  if (!parts.length) return Promise.resolve();
  return new Promise(resolve => {
    const updates = h("input", { type: "checkbox", checked: loadSettings().checkForUpdates !== false }) as HTMLInputElement;
    // Off unless chosen: nothing is sent without a yes.
    const usage = h("input", { type: "checkbox", checked: loadSettings().shareUsage === true }) as HTMLInputElement;
    // Someone who saw an older window is only asked what is new.
    const upgrade = !reopened && loadSettings().welcomeSeen > 0;
    // Only offered while the library is empty: a lab's own list shouldn't get extra entries.
    const commonPrimers = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;
    const folders = h("ul", { class: "sv-welcome-list" });
    const primerNote = h("p", { class: "sv-small sv-dim sv-welcome-done" });
    let libraryEmpty = true;

    const finish = async () => {
      const s = loadSettings();
      await saveSettings({
        ...s,
        welcomeSeen: Math.max(s.welcomeSeen, WELCOME_VERSION),
        ...(parts.includes("updates") ? { checkForUpdates: updates.checked } : {}),
        ...(parts.includes("usage") ? { shareUsage: usage.checked } : {})
      });
      if (parts.includes("primers") && libraryEmpty && commonPrimers.checked) {
        const { addCommonPrimers } = await import("./libraryWindow.ts");
        addCommonPrimers();
      }
      resolve();
    };
    const dlg = openDialog({
      title: upgrade ? "Something new to choose" : "Welcome to Strandivo",
      note: upgrade
        ? "This version of Strandivo asks about something it didn't before. Nothing changes until you choose."
        : "Plan, build and check your plasmids. Everything runs on your computer: your files and sequences never leave it.",
      width: 560,
      onClose: () => void finish()
    });

    const section = (title: string, ...children: (Node | string)[]) => h("section", { class: "sv-welcome-part" }, h("h3", { class: "sv-section-title" }, title), ...children);
    const option = (box: HTMLInputElement, label: string, note: string) =>
      h("label", { class: "sv-welcome-option" }, box, h("span", null, h("span", { class: "sv-welcome-label" }, label), h("span", { class: "sv-small sv-dim" }, note)));

    const addFolder = async () => {
      const folder = await host.chooseFolder();
      if (folder) folders.appendChild(h("li", { class: "sv-small", title: shownPath(folder) }, basename(folder) || folder));
    };
    const importList = async () => {
      const files = await pickFiles("Primer list", ["txt", "tsv", "csv", "fasta", "fa"]);
      if (!files.length) return;
      const { importPrimerList } = await import("./libraryWindow.ts");
      const r = importPrimerList(files.map(f => new TextDecoder().decode(f.bytes)).join("\n"));
      toast(r.message, r.ok ? "success" : "error", 6000);
      if (r.ok) primerNote.textContent = r.message;
    };

    const build: Record<WelcomePart, () => HTMLElement> = {
      updates: () =>
        section(
          "Updates",
          option(updates, "Check for updates automatically", "Once a day, Strandivo asks its server for the latest version. An update installs only when you choose.")
        ),
      usage: () =>
        section(
          "Usage statistics",
          option(
            usage,
            "Share anonymous usage statistics",
            "Which features are used, and on which systems, so work goes where it helps most. Never your files, sequences or names, and nothing that tells you apart."
          ),
          h("div", { class: "sv-welcome-actions" }, h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: () => void openUsagePage() }, "What is sent"))
        ),
      constructs: () =>
        section(
          "Your constructs",
          h("p", { class: "sv-small" }, "Home lists the plasmid files in folders you choose, with what each one carries. The files stay where they are."),
          // Safari and Firefox can't keep a folder (src/home.ts).
          canKeepFolders()
            ? h("div", { class: "sv-welcome-actions" }, h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: () => void addFolder() }, "Add a folder…"))
            : h("p", { class: "sv-small sv-dim" }, "This browser can't keep folders: Home lists the files you open until you close the page. Chrome, Edge or the desktop app can list whole folders."),
          folders
        ),
      primers: () => {
        void import("./primerLibrary.ts").then(({ primerLibrary }) => {
          libraryEmpty = primerLibrary.all.length === 0;
          commonOption.hidden = !libraryEmpty;
        });
        const commonOption = option(commonPrimers, "Start with common sequencing primers", "M13, T7, T3, SP6, CMV, BGH and others, as university sequencing cores list them.");
        return section(
          "Primer library",
          h("p", { class: "sv-small" }, "Each plasmid you open shows which of your lab's primers bind it."),
          commonOption,
          h("div", { class: "sv-welcome-actions" }, h("button", { type: "button", class: "sv-btn sv-btn-small", onclick: () => void importList() }, "Import a list…")),
          primerNote
        );
      }
    };

    dlg.body.classList.add("sv-welcome");
    dlg.body.replaceChildren(...parts.map(p => build[p]()), h("p", { class: "sv-small sv-dim" }, "You can change all of this in Settings."));
    dlg.footer.replaceChildren(h("button", { type: "button", class: "sv-btn sv-btn-primary", onclick: () => dlg.close() }, upgrade ? "Done" : "Start using Strandivo"));
  });
}
