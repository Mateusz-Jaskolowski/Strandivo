// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The main window: an app bar with Home and a tab for each open file, and the current tab
// below it. Only one file shows at a time; each keeps its own views, selection and undo.
// This module owns the window itself (title, keys, native menu, dropped files, closing)
// and hands each document what is meant for it.

import "./doc/document.css";
import "./mainWindow.css";

import { h, icon, toast } from "./ui/dom.ts";
import { choose } from "./ui/modal.ts";
import { iconSvg, type IconName } from "./ui/icons.ts";
import {
  closeWindow,
  isDesktop,
  keepStorage,
  onCloseRequested,
  onFileDrop,
  onMenu,
  onOpenRequests,
  openEnzymeLibrary,
  openLibrary,
  openProjectPage,
  openSettings,
  pickFileKeys,
  readFile,
  setWindowTitle,
  showOpenDialog,
  showWindowsInPage,
  trapWebCore,
  type PageWindow
} from "./platform.ts";
import { shownPath } from "./webFiles.ts";
import { browserShortcut, shortcutHint } from "./lib/shortcuts.ts";
import { appMenuButton } from "./views/appMenu.ts";
import { basename, extension, SEQUENCE_EXTENSIONS, TEXT_READ_EXTENSIONS, TRACE_EXTENSIONS } from "./lib/files.ts";
import { CHECK_EXTENSION, matchByName, parseCheckFile, type ReadCheck } from "./lib/readCheck.ts";
import type { SeqData } from "./lib/seqdata.ts";
import { openDocument, type DocTab, type OpenSequence } from "./doc/document.ts";
import { Home } from "./home.ts";
import { loadSettings, saveSettings, type Settings } from "./settings.ts";
import { startUpdates } from "./updates.ts";
import { startCrashOffer } from "./crash.ts";
import { flushUsage, startUsage, track } from "./usage.ts";
import { fileFormat } from "./lib/usage.ts";
import { openWelcome } from "./welcome.ts";
import { needsWelcome } from "./lib/welcome.ts";
import type { CrashReport, FeedbackKind } from "./lib/feedback.ts";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Where keys are pressed, for the shortcuts tooltips show (src/lib/shortcuts.ts). */
const where = { mac: isMac, browser: !isDesktop };

/** Home, a drop on the window, or anything else (Open…, the system, a check file). */
type OpenedFrom = "home" | "drop" | "other";

interface Tab {
  /** The file asked for (null = a new sequence); the document's own path once loaded. */
  path: string | null;
  /** A new sequence made in the app (a cloning product), not yet saved. */
  data?: SeqData;
  /** A check file's reads, to add once the file is open. */
  check?: ReadCheck;
  /** Where it was opened from, for usage statistics. */
  from?: OpenedFrom;
  doc: DocTab | null;
  el: HTMLElement;
  main: HTMLButtonElement;
  name: HTMLElement;
}

const samePath = (a: string | null, b: string | null) => !!a && !!b && a.replace(/\\/g, "/") === b.replace(/\\/g, "/");

export function mountMain(root: HTMLElement, initial: (string | null)[]) {
  document.body.classList.add("ps-doc-body", "sv-doc-body");
  if (isMac && isDesktop) document.documentElement.classList.add("sv-mac-titlebar");

  const tabs: Tab[] = [];
  /** The tab shown; null is Home. */
  let active: Tab | null = null;

  const home = new Home({ open: paths => open(paths, "home") });
  const homeButton = h(
    "button",
    { type: "button", role: "tab", class: "sv-apptab sv-apptab-home", title: `Home: your constructs${shortcutHint("home", where)}`, onclick: () => activate(null) },
    iconSvg("home", 16),
    h("span", null, "Home")
  );
  const tabList = h("div", { class: "sv-doctabs", role: "tablist", "aria-label": "Open files" }, homeButton);
  const appButton = (name: IconName, label: string, onclick: () => void) =>
    h("button", { type: "button", class: "sv-icon-btn", "aria-label": label, title: label, onclick }, iconSvg(name, 17));
  const appButtons: Record<PageWindow, HTMLElement> = {
    library: appButton("library", "Primer library", () => void openLibrary()),
    enzymes: appButton("scissors", "Enzyme library", () => void openEnzymeLibrary()),
    settings: appButton("settings", "Settings", () => void openSettings())
  };
  const appBar = h(
    "header",
    // "deep": empty space in the bar moves the window (buttons don't).
    { class: "sv-appbar", "data-tauri-drag-region": "deep" },
    tabList,
    h(
      "div",
      { class: "sv-appbar-tools" },
      appButtons.library,
      appButtons.enzymes,
      appButtons.settings,
      // A browser has no menu bar: its items are here instead.
      isDesktop ? "" : appMenuButton(id => runMenu(id), () => !!active)
    )
  );
  const content = h("div", { class: "sv-shell-body" });
  // The welcome window opens over everything on first launch; the update check waits for it.
  const welcome = needsWelcome(loadSettings().welcomeSeen) ? openWelcome(home) : Promise.resolve();
  void welcome.then(keepStorage);
  // Counting starts once the welcome window, which asks about it, has closed.
  startUsage(welcome);
  const updates = startUpdates(welcome);
  // A page left open across a deployment of the browser version asks for files the new one
  // doesn't have (each name carries its contents' hash); Vite says so with this event.
  if (!isDesktop) window.addEventListener("vite:preloadError", () => updates.offerReload());
  // If the app crashed last time, a strip offers to report it (src/crash.ts).
  const crashes = startCrashOffer((crash, sent) => void feedback("bug", { crash, sent }), welcome);
  void crashes.check();
  const dropText = h("span");
  const dropOverlay = h("div", { class: "ps-drop-overlay" }, h("div", null, icon("reads"), dropText));
  root.replaceChildren(h("div", { class: "sv-shell" }, appBar, updates.el, crashes.el, content, dropOverlay));

  // ---------- Settings and libraries over the tabs (browser only) ----------
  // The desktop app opens them as windows. Home, a tab, the same button, × or Esc close them.
  let panel: { kind: PageWindow; el: HTMLElement; dispose?: () => void } | null = null;
  function closePanel() {
    if (!panel) return;
    panel.dispose?.();
    panel.el.remove();
    appButtons[panel.kind].classList.remove("sv-on");
    panel = null;
  }
  async function showPanel(kind: PageWindow) {
    const same = panel?.kind === kind;
    closePanel();
    if (same) return;
    const body = h("div", { class: `sv-panel-body sv-panel-${kind}` });
    const el = h(
      "div",
      { class: "sv-panel", role: "dialog", "aria-label": { settings: "Settings", library: "Primer library", enzymes: "Enzyme library" }[kind] },
      h("button", { type: "button", class: "sv-icon-btn sv-panel-close", "aria-label": "Close", title: "Close (Esc)", onclick: closePanel }, iconSvg("x", 16)),
      body
    );
    panel = { kind, el };
    appButtons[kind].classList.add("sv-on");
    content.appendChild(el);
    if (kind === "settings") {
      const { mountSettings } = await import("./settingsWindow.ts");
      if (panel?.el === el) mountSettings(body, true);
    } else if (kind === "enzymes") {
      const { mountEnzymeLibrary } = await import("./enzymeLibraryWindow.ts");
      if (panel?.el === el) panel.dispose = mountEnzymeLibrary(body, true);
    } else {
      const { mountLibrary } = await import("./libraryWindow.ts");
      if (panel?.el === el) mountLibrary(body, true);
    }
  }
  showWindowsInPage(kind => void showPanel(kind));

  // ---------- tabs ----------
  function newTab(path: string | null, data?: SeqData): Tab {
    const name = h("span", { class: "sv-doctab-name" }, path ? basename(path) : data?.name || "Untitled");
    const main = h("button", { type: "button", role: "tab", class: "sv-doctab-main", onclick: () => activate(tab) }, name) as HTMLButtonElement;
    const close = h("button", { type: "button", class: "sv-doctab-close", "aria-label": "Close tab", title: `Close${shortcutHint("close", where)}`, onclick: () => void closeTab(tab) }, iconSvg("x", 12));
    const el = h("div", { class: "sv-doctab", "data-tauri-drag-region": "false" }, main, close);
    // Middle-click closes, as in browsers.
    el.addEventListener("auxclick", e => e.button === 1 && void closeTab(tab));
    const tab: Tab = { path, data, doc: null, el, main, name };
    return tab;
  }

  function refreshTab(t: Tab) {
    const path = t.doc ? t.doc.path : t.path;
    t.name.textContent = t.doc ? t.doc.title : path ? basename(path) : "Untitled";
    // A browser's key (src/webFiles.ts) means nothing to the user: only its name and folder do.
    t.el.title = path ? shownPath(path) : "Not saved yet";
    t.el.classList.toggle("sv-doctab-dirty", !!t.doc?.isDirty());
    if (t === active) refreshTitle();
  }

  function refreshTitle() {
    const doc = active?.doc;
    if (!doc) {
      void setWindowTitle("Strandivo");
      return;
    }
    const dirty = doc.isDirty();
    void setWindowTitle(isMac ? `${doc.title}${dirty ? " — Edited" : ""}` : `${dirty ? "• " : ""}${doc.title} — Strandivo`);
  }

  /** Opens files in tabs (null = a new sequence); a file that is already open is shown. */
  function open(paths: (string | null)[], from: OpenedFrom = "other") {
    let last: Tab | null = null;
    for (const path of paths) {
      if (path && extension(path) === CHECK_EXTENSION) {
        void openCheck(path);
        continue;
      }
      const existing = tabs.find(t => samePath(t.doc ? t.doc.path : t.path, path));
      if (existing) {
        last = existing;
        continue;
      }
      const t = newTab(path);
      t.from = from;
      tabs.push(t);
      tabList.appendChild(t.el);
      last = t;
      void load(t);
    }
    if (last) activate(last);
  }

  /** A check file: its sequence in a tab (the open one, if it is), with the check's reads. */
  async function openCheck(path: string) {
    let check: ReadCheck | null;
    try {
      check = parseCheckFile(new TextDecoder().decode(await readFile(path)), path);
    } catch (e) {
      toast(`Couldn't open ${basename(path)}: ${e instanceof Error ? e.message : e}`, "error", 8000);
      return;
    }
    if (!isDesktop) check = await findCheckFiles(path, check);
    if (!check) return;
    const existing = tabs.find(t => samePath(t.doc ? t.doc.path : t.path, check.reference));
    if (existing) {
      activate(existing);
      if (existing.doc?.openCheck) await existing.doc.openCheck(check);
      else existing.check = check;
      return;
    }
    const t = newTab(check.reference);
    t.check = check;
    tabs.push(t);
    tabList.appendChild(t.el);
    activate(t);
    await load(t);
  }

  /**
   * In a browser, a check's paths lead somewhere only inside one of Home's folders. Its
   * sequence is otherwise the open tab of that name, or chosen with its reads and matched
   * by name; reads still missing are asked for by the file's Reads tab. Null if cancelled.
   */
  async function findCheckFiles(path: string, check: ReadCheck): Promise<ReadCheck | null> {
    if (await readFile(check.reference).then(() => true, () => false)) return check;
    const name = basename(check.reference);
    const named = tabs.find(t => {
      const p = t.doc ? t.doc.path : t.path;
      return !!p && basename(p) === name;
    });
    const namedPath = named && (named.doc ? named.doc.path : named.path);
    if (namedPath) return { ...check, reference: namedPath };
    const n = check.reads.length;
    const go = await choose(
      `Open “${basename(path)}”`,
      `Choose ${name}${n ? ` and the ${n === 1 ? "read" : `${n} reads`} this check lists` : ""}. Your browser opens only files you choose; Strandivo matches them by name.`,
      [
        { label: "Cancel", value: false },
        { label: "Choose files…", value: true, primary: true }
      ],
      false
    );
    if (!go) return null;
    let picked: string[];
    try {
      picked = await pickFileKeys("Sequence and reads", [...SEQUENCE_EXTENSIONS, ...TRACE_EXTENSIONS, ...TEXT_READ_EXTENSIONS]);
    } catch (e) {
      toast(`Couldn't open: ${e instanceof Error ? e.message : e}`, "error", 6000);
      return null;
    }
    if (!picked.length) return null;
    const matched = matchByName(check, picked);
    if (!picked.includes(matched.reference)) {
      toast(`${name} wasn't among the files chosen, so the check can't be opened.`, "error", 8000);
      return null;
    }
    return matched;
  }

  /** Opens a sequence made in the app in a new tab, unsaved. */
  function openNew(data: SeqData) {
    const t = newTab(null, data);
    tabs.push(t);
    tabList.appendChild(t.el);
    void load(t);
    activate(t);
  }

  /** The other open files, for dialogs that combine sequences (cloning). */
  const sequences = (except: Tab): OpenSequence[] => tabs.flatMap(t => (t !== except && t.doc?.sequence ? [t.doc.sequence()] : []));

  async function load(t: Tab) {
    let doc: DocTab;
    try {
      doc = await openDocument(t.path, { open, openNew, sequences: () => sequences(t), changed: () => refreshTab(t) }, t.data, t.check);
    } catch (e) {
      toast(`Couldn't open ${t.path ? basename(t.path) : "a new sequence"}: ${e instanceof Error ? e.message : e}`, "error", 6000);
      removeTab(t);
      return;
    }
    if (!tabs.includes(t)) {
      doc.dispose(); // closed while it was loading
      return;
    }
    t.doc = doc;
    if (doc.path) home.noteOpened(doc.path);
    // Its format, from the name; never the name itself. A product made in the app isn't counted.
    const data = doc.sequence?.().data;
    if (t.path) track("file_opened", { format: fileFormat(t.path), from: t.from, length: data && data.sequence.length / 1000, topology: data && (data.circular ? "circular" : "linear") });
    refreshTab(t);
    if (t === active) show();
  }

  function activate(t: Tab | null) {
    closePanel();
    if (active !== t && active?.doc && tabs.includes(active)) active.doc.setActive(false);
    active = t;
    homeButton.setAttribute("aria-selected", String(t === null));
    homeButton.classList.toggle("sv-on", t === null);
    for (const x of tabs) {
      x.main.setAttribute("aria-selected", String(x === t));
      x.el.classList.toggle("sv-on", x === t);
    }
    (t ? t.el : homeButton).scrollIntoView({ block: "nearest", inline: "nearest" });
    show();
  }

  function show() {
    if (!active) {
      if (content.firstChild !== home.el) content.replaceChildren(home.el);
      home.show();
    } else if (active.doc) {
      if (content.firstChild !== active.doc.el) content.replaceChildren(active.doc.el);
      active.doc.setActive(true);
    } else {
      content.replaceChildren(h("div", { class: "sv-empty sv-shell-loading" }, "Opening…"));
    }
    refreshTitle();
  }

  function removeTab(t: Tab) {
    const i = tabs.indexOf(t);
    if (i < 0) return;
    tabs.splice(i, 1);
    t.el.remove();
    t.doc?.dispose();
    if (active === t) activate(tabs[i] ?? tabs[i - 1] ?? null);
  }

  async function closeTab(t: Tab) {
    if (t.doc?.isDirty()) {
      activate(t);
      if (!(await t.doc.confirmClose())) return;
    }
    removeTab(t);
  }

  /** Next or previous tab, Home counting as the first. */
  function cycle(step: 1 | -1) {
    const all: (Tab | null)[] = [null, ...tabs];
    const i = all.indexOf(active);
    activate(all[(i + step + all.length) % all.length]);
  }

  // ---------- keys, menu, dropped files, closing ----------
  const inField = () => {
    const a = document.activeElement as HTMLElement | null;
    return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable);
  };
  window.addEventListener("keydown", e => {
    if (panel) {
      // Keys go to the panel's own fields; Esc closes it unless a dialog in it took Esc.
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector(".ps-modal-overlay, .sv-dialog-overlay")) closePanel();
      return;
    }
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Tab") {
      e.preventDefault();
      cycle(e.shiftKey ? -1 : 1);
      return;
    }
    // Ctrl+Page Down/Up too: Linux's webview keeps Ctrl+Tab for itself.
    if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && (e.key === "PageDown" || e.key === "PageUp")) {
      e.preventDefault();
      cycle(e.key === "PageDown" ? 1 : -1);
      return;
    }
    if (isMac && e.metaKey && e.shiftKey && !e.altKey && ["[", "]", "{", "}"].includes(e.key)) {
      e.preventDefault();
      cycle(e.key === "]" || e.key === "}" ? 1 : -1);
      return;
    }
    // Keys a browser leaves to the page in place of ones it keeps (src/lib/shortcuts.ts).
    const own = isDesktop ? null : browserShortcut(e, isMac);
    // Outside a Mac, Ctrl+Alt is AltGr, which types characters in fields.
    if (own && !e.defaultPrevented && !(own === "new" && !isMac && inField())) {
      e.preventDefault();
      runMenu(own);
      return;
    }
    if (active?.doc) active.doc.keydown(e);
    else if (!active && (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      home.focusSearch();
    }
  });

  /**
   * Runs a menu item: from the native menu, which runs some in the shell (New Sequence,
   * Open…, the windows, Help's pages), or from the browser version's menu, which has no shell.
   */
  function runMenu(id: string) {
    if (id === "new") {
      open([null]);
      return;
    }
    if (id === "open") {
      showOpenDialog().catch(e => toast(`Couldn't open: ${e instanceof Error ? e.message : e}`, "error", 6000));
      return;
    }
    if (id === "settings" || id === "library" || id === "enzyme-library") {
      void { settings: openSettings, library: openLibrary, "enzyme-library": openEnzymeLibrary }[id]();
      return;
    }
    if (id === "website" || id === "github") {
      void openProjectPage(id);
      return;
    }
    if (id === "close") {
      if (active) void closeTab(active);
      else if (!tabs.length) void closeWindow();
      return;
    }
    if (id === "home") {
      activate(null);
      return;
    }
    if (id === "check-updates") {
      void updates.check(true);
      return;
    }
    if (id === "welcome") {
      void openWelcome(home, true);
      return;
    }
    if (id === "feedback" || id === "report-bug") {
      void feedback(id === "report-bug" ? "bug" : "idea");
      return;
    }
    if (active?.doc) {
      active.doc.menu(id);
      return;
    }
    // Home has only text fields to act on.
    if (id === "find") home.focusSearch();
    else if ((id === "undo" || id === "redo") && inField()) document.execCommand(id);
    else if (id === "select-all" && inField()) (document.activeElement as HTMLInputElement).select?.();
  }
  void onMenu(runMenu);

  void onFileDrop(
    paths => {
      if (active?.doc) void active.doc.drop(paths);
      else open(paths, "drop");
    },
    state => {
      dropText.textContent = active?.doc ? "Drop .ab1 files to check them against this sequence · other files open in new tabs" : "Drop files to open them";
      dropOverlay.classList.toggle("ps-visible", state === "over");
    }
  );

  void onCloseRequested(async () => {
    for (const t of [...tabs]) {
      if (!t.doc?.isDirty()) continue;
      activate(t);
      if (!(await t.doc.confirmClose())) return false;
    }
    // What is queued goes now, if it can within a second; statistics never hold a quit up.
    await Promise.race([flushUsage(), new Promise(r => setTimeout(r, 1000))]);
    return true;
  }, () => tabs.some(t => t.doc?.isDirty()));
  // A page can't wait as it closes: what is queued is posted with `keepalive`, which outlives it.
  if (!isDesktop) window.addEventListener("pagehide", () => void flushUsage());

  /** Help → Send Feedback… (an idea, unless chosen) and Report a Bug…, about what is open. */
  async function feedback(kind: FeedbackKind, crashed?: { crash: CrashReport; sent(): void }) {
    const { openFeedback } = await import("./views/feedbackDialog.ts");
    await openFeedback(kind, active?.doc?.feedbackContext?.() ?? { view: "Home", file: null }, crashed);
  }

  // Driven by the end-to-end tests (e2e/run.mjs): the window's own actions, plus those of
  // the document in the current tab.
  const shellHook = {
    open: (paths: (string | null)[]) => open(paths),
    openNew: (data: SeqData) => openNew(data),
    tabs: () => tabs.map(t => (t.doc ? t.doc.title : null)),
    activeTab: () => (active ? tabs.indexOf(active) : -1),
    showHome: () => activate(null),
    showTab: (i: number) => tabs[i] && activate(tabs[i]),
    closeTab: () => active && closeTab(active),
    addLibraryFolder: (folder: string) => home.addFolder(folder),
    /** Changes settings as the Settings window would. */
    saveSettings: (patch: Partial<Settings>) => saveSettings({ ...loadSettings(), ...patch }),
    libraryNames: () => home.listedNames(),
    /** Check for Updates…, as the menu does. */
    checkForUpdates: () => updates.check(true),
    /** What the main window does at start after an update. */
    announceUpdate: () => updates.announce(),
    /** Help → Welcome…, as the menu does. */
    openWelcome: () => openWelcome(home, true),
    /** Help → Send Feedback… or Report a Bug…, as the menu does. */
    openFeedback: (kind: FeedbackKind = "idea") => feedback(kind),
    /** Takes a crash again, as at start: from `window.__strandivoCrash` in e2e. */
    checkCrash: () => crashes.check(),
    /** Sends queued usage events now, to `window.__strandivoTrack` in e2e. */
    flushUsage: () => flushUsage(),
    /** Runs a menu item by its id, as the native menu or the browser's menu does. */
    menu: (id: string) => runMenu(id),
    /** Makes the browser version's core panic (e2e/web.mjs); rejects with its message. */
    trapCore: () => trapWebCore()
  };
  Object.defineProperty(window, "__strandivo", { configurable: true, get: () => ({ ...shellHook, ...(active?.doc?.testHook ?? {}) }) });

  activate(null);
  if (initial.length) open(initial);
  onOpenRequests(paths => open(paths));
}
