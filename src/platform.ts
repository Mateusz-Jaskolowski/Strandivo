// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Everything that talks to the desktop shell lives here, with a plain-browser fallback
// so the interface can also be developed with `npm run dev` in a normal browser.

import type { AlignResponse } from "./lib/types.ts";
import type { DetectRequest, DetectResponse } from "./lib/detect.ts";
import { changesUrl } from "./lib/changelog.ts";
import type { FeedbackReport, SystemInfo } from "./lib/feedback.ts";
import { recordError } from "./feedback.ts";
import type { UsageEvent } from "./lib/usage.ts";

export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let invokeFn: Invoke | null = null;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop) throw new Error(`"${cmd}" is only available in the desktop app.`);
  if (!invokeFn) invokeFn = (await import("@tauri-apps/api/core")).invoke as Invoke;
  try {
    return await invokeFn<T>(cmd, args);
  } catch (e) {
    // Kept for a bug report's "Recent errors", which the user sees before sending.
    recordError(`${cmd} failed: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }
}

export interface WindowInfo {
  kind: "main" | "settings" | "library" | "enzymes";
  /** For the main window: files to open as tabs (null = a new sequence). */
  paths: (string | null)[];
}

type OpenHandler = (paths: (string | null)[]) => void;
let openHandler: OpenHandler | null = null;
let openQueue: (string | null)[] = [];

// In a plain browser (development and UI tests): `?settings`, `?library` and `?enzymes` show those
// windows on their own (the main window shows them over its tabs), `?open=<url>` opens that URL in a tab of the main window, `?new` a new sequence.
export async function windowInfo(): Promise<WindowInfo> {
  if (!isDesktop) {
    const params = new URLSearchParams(location.search);
    if (params.get("settings") !== null) return { kind: "settings", paths: [] };
    if (params.get("library") !== null) return { kind: "library", paths: [] };
    if (params.get("enzymes") !== null) return { kind: "enzymes", paths: [] };
    return { kind: "main", paths: [...params.getAll("open"), ...(params.get("new") !== null ? [null] : [])] };
  }
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const win = getCurrentWebviewWindow();
  if (win.label === "main") {
    // Listen before asking: from then on the shell sends files here instead of queueing them.
    await win.listen<(string | null)[]>("open-files", e => {
      if (openHandler) openHandler(e.payload);
      else openQueue.push(...e.payload);
    });
  }
  return invoke<WindowInfo>("window_info");
}

/** Files the app is asked to open while the main window is up (menu, Finder, a second launch). */
export function onOpenRequests(handler: OpenHandler) {
  openHandler = handler;
  if (openQueue.length) handler(openQueue.splice(0));
}

export interface ListedFile {
  path: string;
  size: number;
  /** Milliseconds since 1970. */
  modified: number;
}

/** Sequence files in a folder and its subfolders (the construct library). */
export async function listSequenceFiles(folder: string): Promise<ListedFile[]> {
  // In a browser, UI tests can supply a listing.
  const testList = (window as unknown as { __strandivoListFolder?: (f: string) => Promise<ListedFile[]> }).__strandivoListFolder;
  if (!isDesktop && testList) return testList(folder);
  return invoke<ListedFile[]>("list_sequence_files", { folder });
}

/** Lets the user pick a folder; null if cancelled. */
export async function pickFolder(title: string): Promise<string | null> {
  if (!isDesktop) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ title, directory: true, multiple: false });
  return typeof picked === "string" ? picked : null;
}

export async function readFile(path: string): Promise<Uint8Array> {
  if (!isDesktop) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Could not read ${path}: HTTP ${res.status}`);
    // A dev server answers a missing file with its page.
    if (res.headers.get("content-type")?.includes("text/html") && !/\.html?$/i.test(path)) throw new Error(`Could not find ${path}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  const buf = await invoke<ArrayBuffer | number[]>("read_file", { path });
  return buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf);
}

const UNIPROT_FIELDS = "ft_transmem,ft_intramem,ft_topo_dom,ft_signal,ft_transit,protein_name,gene_names,sequence";

/**
 * An entry from UniProt's REST API, the one thing the app fetches from the internet, and
 * only when asked to. Errors are sentences for the dialog. In a browser, UI tests can
 * supply the entry.
 */
export async function fetchUniprotEntry(accession: string): Promise<unknown> {
  const testEntry = (window as unknown as { __strandivoUniprot?: (a: string) => Promise<unknown> }).__strandivoUniprot;
  if (testEntry) return testEntry(accession);
  let res: Response;
  try {
    res = await fetch(`https://rest.uniprot.org/uniprotkb/${encodeURIComponent(accession)}.json?fields=${UNIPROT_FIELDS}`);
  } catch {
    throw new Error("Couldn't reach UniProt. Check your internet connection and try again.");
  }
  if (res.status === 400 || res.status === 404) throw new Error(`UniProt has no entry ${accession}.`);
  if (!res.ok) throw new Error(`UniProt didn't answer (error ${res.status}). Try again later.`);
  return res.json();
}

export const writeFile = (path: string, contents: string) => invoke<void>("write_file", { path, contents });
export const openFiles = (paths: string[]) => invoke<void>("open_files", { paths });
export const cancelQuit = () => invoke<void>("cancel_quit").catch(() => undefined);

export async function showOpenDialog(): Promise<void> {
  if (!isDesktop) return;
  return invoke<void>("show_open_dialog");
}

export interface AlignReadInput {
  name: string;
  sequence: string;
  qualities: number[];
  peakPositions: number[];
  traces: { a: number[]; c: number[]; g: number[]; t: number[] } | null;
  /** Reads with the same key are reads of one clone and get a consensus. */
  clone: string;
  /** From a trace file, so a Sanger read, whatever its length. */
  hasTrace: boolean;
}

interface AlignRequest {
  reference: string;
  circular: boolean;
  reads: AlignReadInput[];
  minQuality: number;
  trimCutoff: number;
  /** Variable regions as half-open ranges that never wrap, aligned as N. */
  variable: [number, number][];
}

export function alignReads(request: AlignRequest) {
  // Alignment runs in the desktop app's Rust core. UI tests in a browser can supply one.
  const testAlign = (window as unknown as { __strandivoAlign?: (r: AlignRequest) => Promise<AlignResponse> }).__strandivoAlign;
  if (!isDesktop && testAlign) return testAlign(request);
  return invoke<AlignResponse>("align_reads", { request });
}

const detectHook = () => (window as unknown as { __strandivoDetect?: (r: DetectRequest) => Promise<DetectResponse> }).__strandivoDetect;

/** Whether this build can detect features at all: the core does the search. */
export const canDetectFeatures = () => isDesktop || !!detectHook();

/** Fingerprint of the parts catalog this build carries; "" where detection isn't available. */
export async function catalogVersion(): Promise<string> {
  if (!isDesktop) return "";
  try {
    return await invoke<string>("catalog_version");
  } catch {
    return "";
  }
}

export function detectFeatures(request: DetectRequest) {
  // Detection runs in the desktop app's Rust core, like alignment. A browser has none
  // unless the page supplies one, which is how a test can drive it.
  const testDetect = detectHook();
  if (!isDesktop && testDetect) return testDetect(request);
  if (!isDesktop) return Promise.resolve<DetectResponse>({ suggestions: [] });
  return invoke<DetectResponse>("detect_features", { request });
}

// ---------- updates (src-tauri/src/updates.rs) ----------

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  /** latest.json's notes: a link to the release page. */
  notes: string | null;
  /** Already downloaded, so Restart needs no wait. */
  ready: boolean;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

/** What a test supplies in place of the update server, so e2e never reaches it. */
export interface UpdateHook {
  check(): Promise<UpdateInfo | null>;
  download(onProgress: (p: UpdateProgress) => void): Promise<void>;
  restart(): Promise<void>;
  /** Stands in for opening a version's notes on strandivo.com. */
  whatsNew?(version: string): Promise<void>;
}

const updateHook = () => (window as unknown as { __strandivoUpdate?: UpdateHook }).__strandivoUpdate;

/** Whether this window can update the app: only the desktop app can, or a test's hook. */
export const canUpdate = () => isDesktop || !!updateHook();

/** Asks updates.strandivo.com for a newer version; null when this one is the latest. */
export function checkForUpdate(): Promise<UpdateInfo | null> {
  const hook = updateHook();
  if (hook) return hook.check();
  return invoke<UpdateInfo | null>("check_update");
}

/** Downloads the update the last check found; the shell checks its signature. */
export async function downloadUpdate(onProgress: (p: UpdateProgress) => void): Promise<void> {
  const hook = updateHook();
  if (hook) return hook.download(onProgress);
  const { Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<UpdateProgress>();
  channel.onmessage = onProgress;
  return invoke<void>("download_update", { onProgress: channel });
}

/** Quits as ⌘Q does (unsaved tabs are asked about) and installs the downloaded update. */
export function restartToUpdate(): Promise<void> {
  const hook = updateHook();
  if (hook) return hook.restart();
  return invoke<void>("restart_to_update");
}

/** Opens a version's notes on strandivo.com in the browser (the shell checks the version). */
export async function openWhatsNew(version: string): Promise<void> {
  const hook = updateHook();
  if (hook) return hook.whatsNew?.(version);
  if (isDesktop) return invoke<void>("open_whats_new", { version });
  window.open(changesUrl(version), "_blank", "noopener");
}

/** This copy's version; null in a browser, which has none. */
export async function appVersion(): Promise<string | null> {
  if (!isDesktop) return null;
  try {
    return await (await import("@tauri-apps/api/app")).getVersion();
  } catch {
    return null;
  }
}

/** Why the last install failed, if it did; asked once when the main window opens. */
export async function takeUpdateFailure(): Promise<string | null> {
  if (!isDesktop || updateHook()) return null;
  return invoke<string | null>("take_update_failure").catch(() => null);
}

// ---------- feedback (services/feedback/) ----------

/** The service that files a report as a GitHub issue; `connect-src` names it. */
export const FEEDBACK_URL = "https://feedback.strandivo.com/report";

export interface FeedbackSent {
  /** The issue's number in the repository. */
  number: number;
  /** Whether the email address and file reached the maintainer (when there were any). */
  emailed: boolean;
}

/** What a test supplies in place of the service and the browser, so e2e reaches neither. */
export interface FeedbackHook {
  send(report: FeedbackReport): Promise<FeedbackSent>;
  openIssue?(number: number): void;
  email?(subject: string, body: string): void;
}

const feedbackHook = () => (window as unknown as { __strandivoFeedback?: FeedbackHook }).__strandivoFeedback;

/** Sends a report. Errors are sentences for the dialog; the text stays in it. */
export async function sendFeedback(report: FeedbackReport): Promise<FeedbackSent> {
  const hook = feedbackHook();
  if (hook) return hook.send(report);
  let res: Response;
  try {
    res = await fetch(FEEDBACK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(report) });
  } catch {
    throw new Error("Couldn't reach Strandivo's feedback service. Check your internet connection, or copy the report or email it instead.");
  }
  const answer = (await res.json().catch(() => null)) as { number?: unknown; emailed?: unknown; error?: unknown } | null;
  if (res.ok && typeof answer?.number === "number") return { number: answer.number, emailed: answer.emailed !== false };
  if (res.status === 429) throw new Error("Too many reports from this network just now. Wait a minute and send again, or email it instead.");
  // The service's own reason is shown as text, cut short.
  const why = typeof answer?.error === "string" ? answer.error.slice(0, 200) : `error ${res.status}`;
  throw new Error(`The feedback service didn't take the report (${why}). Copy it or email it instead.`);
}

/** This copy's version, system and processor; in a browser only what it can tell. */
export async function systemInfo(): Promise<SystemInfo> {
  if (isDesktop) {
    try {
      return await invoke<SystemInfo>("system_info");
    } catch {
      // Falls through to the browser's guess.
    }
  }
  const ua = navigator.userAgent;
  const os = /Mac/.test(ua) ? "macos" : /Windows/.test(ua) ? "windows" : /Linux/.test(ua) ? "linux" : "unknown";
  return { version: "development", os, osVersion: "unknown", arch: "unknown" };
}

/** Opens a report's issue on GitHub; the shell builds the address from the number. */
export async function openIssue(number: number): Promise<void> {
  const hook = feedbackHook();
  if (hook) return hook.openIssue?.(number);
  if (isDesktop) return invoke<void>("open_issue", { number });
  window.open(`https://github.com/Mateusz-Jaskolowski/Strandivo/issues/${number}`, "_blank", "noopener");
}

/** The usage statistics' list on the website's Privacy page (Settings' "What is sent"). */
export const USAGE_PAGE = "https://strandivo.com/privacy#usage-statistics";

export async function openUsagePage(): Promise<void> {
  if (isDesktop) return invoke<void>("open_project_page", { which: "privacy-usage" });
  window.open(USAGE_PAGE, "_blank", "noopener");
}

/** e2e receives usage events here instead of the shell. */
type UsageHook = (events: UsageEvent[]) => void;
const usageHook = () => (window as unknown as { __strandivoTrack?: UsageHook }).__strandivoTrack;

/**
 * Hands queued events (src/usage.ts) to the shell, which sends them to Aptabase if this
 * copy is a release build with the key built in. Not through `invoke`, whose failures are
 * kept as recent errors: a failed send must not become an error event of its own.
 */
export async function sendUsage(events: UsageEvent[]): Promise<void> {
  const hook = usageHook();
  if (hook) return hook(events);
  if (!isDesktop) return;
  try {
    const { invoke: raw } = await import("@tauri-apps/api/core");
    await raw("send_usage", { events });
  } catch {
    // Statistics are dropped rather than retried.
  }
}

/** Starts an email to feedback@strandivo.com in the user's mail app, with the report in it. */
export async function emailFeedback(subject: string, body: string): Promise<void> {
  const hook = feedbackHook();
  if (hook) return hook.email?.(subject, body);
  if (isDesktop) return invoke<void>("email_feedback", { subject, body });
  window.location.href = `mailto:feedback@strandivo.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.slice(0, 1800))}`;
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

export type PageWindow = "settings" | "library" | "enzymes";
let showInPage: ((w: PageWindow) => void) | null = null;

/**
 * In a browser, pages can't reliably open windows (blocked, or loaded over the app), so the
 * main window shows Settings and the library windows itself.
 */
export function showWindowsInPage(show: (w: PageWindow) => void) {
  showInPage = show;
}

export async function openSettings(): Promise<void> {
  if (!isDesktop) {
    if (showInPage) showInPage("settings");
    else window.open(`${location.pathname}?settings`, "_blank");
    return;
  }
  return invoke<void>("open_settings");
}

/** The lab's primer library, in its own window. */
export async function openLibrary(): Promise<void> {
  if (!isDesktop) {
    if (showInPage) showInPage("library");
    else window.open(`${location.pathname}?library`, "_blank");
    return;
  }
  return invoke<void>("open_library");
}

/** The lab's enzyme stock, shared by all documents. */
export async function openEnzymeLibrary(): Promise<void> {
  if (!isDesktop) {
    if (showInPage) showInPage("enzymes");
    else window.open(`${location.pathname}?enzymes`, "_blank");
    return;
  }
  return invoke<void>("open_enzyme_library");
}

/**
 * Lists the app keeps for the user (`src-tauri/src/app_data.rs` names them): JSON files in
 * app data on the desktop, local storage in a browser.
 */
export type AppData = "enzyme-library";
const appDataKey = (name: AppData) => `strandivo.data.${name}`;

export async function loadAppData(name: AppData): Promise<string | null> {
  return isDesktop ? invoke<string | null>("load_app_data", { name }) : localStorage.getItem(appDataKey(name));
}

export async function saveAppData(name: AppData, contents: string): Promise<void> {
  if (isDesktop) return invoke<void>("save_app_data", { name, contents });
  localStorage.setItem(appDataKey(name), contents);
}

/** Moves a list that can't be read out of the way, keeping it; returns where it went, if anywhere. */
export async function setAsideAppData(name: AppData): Promise<string | null> {
  if (isDesktop) return invoke<string | null>("set_aside_app_data", { name });
  const old = localStorage.getItem(appDataKey(name));
  if (old === null) return null;
  const aside = `${appDataKey(name)}.unreadable-${Date.now()}`;
  localStorage.setItem(aside, old);
  localStorage.removeItem(appDataKey(name));
  return `local storage, as ${aside}`;
}

/** Calls `fn` when another window (or browser tab) saves the list. */
export async function onAppDataChanged(name: AppData, fn: () => void): Promise<() => void> {
  if (isDesktop) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<string>("app-data-changed", e => { if (e.payload === name) fn(); });
  }
  const storage = (e: StorageEvent) => { if (e.key === appDataKey(name) || e.key === null) fn(); };
  window.addEventListener("storage", storage);
  return () => window.removeEventListener("storage", storage);
}

export interface PickedFile {
  name: string;
  /** Full path in the desktop app; absent in a browser. */
  path?: string;
  bytes: Uint8Array;
}

/** Lets the user pick files to read (sequencing reads). */
export async function pickFiles(title: string, extensions: string[]): Promise<PickedFile[]> {
  if (isDesktop) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ title, multiple: true, directory: false, filters: [{ name: title, extensions }] });
    if (!picked) return [];
    const paths = Array.isArray(picked) ? picked : [picked];
    const out: PickedFile[] = [];
    for (const p of paths) {
      const path = String(p);
      out.push({ name: path.split(/[\\/]/).pop() || path, path, bytes: await readFile(path) });
    }
    return out;
  }
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = extensions.map(e => "." + e).join(",");
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      resolve(
        await Promise.all(files.map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })))
      );
    };
    input.click();
  });
}

/** Asks where to save; returns null if cancelled. */
export async function chooseSavePath(defaultPath: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  if (!isDesktop) return defaultPath.split(/[\\/]/).pop() || defaultPath;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const p = await save({ defaultPath, filters });
  return p ? String(p) : null;
}

/** Saves text: to disk in the app, as a download in a browser. */
export async function saveText(path: string, contents: string): Promise<void> {
  if (isDesktop) return writeFile(path, contents);
  const blob = new Blob([contents], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = path.split(/[\\/]/).pop() || "sequence.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function confirmDialog(message: string, opts: { title?: string; okLabel?: string; cancelLabel?: string; kind?: "info" | "warning" | "error" } = {}): Promise<boolean> {
  if (!isDesktop) return window.confirm(message);
  const { ask } = await import("@tauri-apps/plugin-dialog");
  return ask(message, { title: opts.title, okLabel: opts.okLabel, cancelLabel: opts.cancelLabel, kind: opts.kind ?? "warning" });
}

export async function alertDialog(message: string, title = "Strandivo"): Promise<void> {
  if (!isDesktop) {
    window.alert(message);
    return;
  }
  const { message: show } = await import("@tauri-apps/plugin-dialog");
  await show(message, { title, kind: "error" });
}

export async function setWindowTitle(title: string): Promise<void> {
  document.title = title;
  if (!isDesktop) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTitle(title);
}

/** Closes this window (it still asks `onCloseRequested` first). */
export async function closeWindow(): Promise<void> {
  if (!isDesktop) {
    window.close();
    return;
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}

/** Runs `check` when the window is about to close; returning false keeps it open. */
export async function onCloseRequested(check: () => Promise<boolean>): Promise<void> {
  if (!isDesktop) {
    window.addEventListener("beforeunload", e => {
      // Browsers only allow a generic prompt.
      void check;
      e.preventDefault();
    });
    return;
  }
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().onCloseRequested(async event => {
    const ok = await check();
    if (!ok) {
      event.preventDefault();
      await cancelQuit();
    }
  });
}

/** Native menu commands routed to this window. */
export async function onMenu(handler: (id: string) => void): Promise<void> {
  if (!isDesktop) return;
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  await getCurrentWebviewWindow().listen<string>("menu", e => handler(e.payload));
}

export type DropState = "over" | "leave";

/** Files dropped on the window (paths are only available in the desktop app). */
export async function onFileDrop(onDrop: (paths: string[]) => void, onHover?: (state: DropState) => void): Promise<void> {
  if (!isDesktop) return;
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  await getCurrentWebview().onDragDropEvent(event => {
    const p = event.payload;
    if (p.type === "drop") {
      onHover?.("leave");
      onDrop(p.paths);
    } else if (p.type === "leave") {
      onHover?.("leave");
    } else {
      onHover?.("over");
    }
  });
}

export type ContextMenuEntry =
  | { label: string; enabled?: boolean; /** Shown as a swatch. */ color?: string; run: () => void }
  | { label: string; items: ContextMenuEntry[] }
  | "separator";

let shownMenu: { close(): Promise<void> } | null = null;
let pageMenu: HTMLElement | null = null;

/** A 16 × 16 rounded square of a colour, with a darker edge, as RGBA pixels for a menu icon. */
function swatchPixels(hex: string): Uint8Array {
  const v = parseInt(hex.replace("#", ""), 16);
  const rgb = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const px = new Uint8Array(16 * 16 * 4);
  for (let y = 1; y < 15; y++) {
    for (let x = 1; x < 15; x++) {
      const corner = (x === 1 || x === 14) && (y === 1 || y === 14);
      if (corner) continue;
      const edge = x === 1 || x === 14 || y === 1 || y === 14;
      const i = (y * 16 + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = edge ? Math.round(rgb[c] * 0.7) : rgb[c];
      px[i + 3] = 255;
    }
  }
  return px;
}

/**
 * Shows a right-click menu at the pointer: a native one in the app, one drawn in the page
 * in a browser. End-to-end tests can catch it instead with `window.__strandivoMenu`.
 */
export async function showContextMenu(entries: ContextMenuEntry[], at: { x: number; y: number }): Promise<void> {
  if (!entries.length) return;
  const testMenu = (window as unknown as { __strandivoMenu?: (e: ContextMenuEntry[]) => void }).__strandivoMenu;
  if (testMenu) return testMenu(entries);
  if (isDesktop) {
    const { Menu } = await import("@tauri-apps/api/menu");
    const { Image } = await import("@tauri-apps/api/image");
    type Items = NonNullable<import("@tauri-apps/api/menu").MenuOptions["items"]>;
    const native = async (list: ContextMenuEntry[]): Promise<Items> =>
      Promise.all(
        list.map(async e => {
          if (e === "separator") return { item: "Separator" as const };
          if ("items" in e) return { text: e.label, items: await native(e.items) };
          const item = { text: e.label, enabled: e.enabled ?? true, action: () => e.run() };
          return e.color ? { ...item, icon: await Image.new(swatchPixels(e.color), 16, 16) } : item;
        })
      );
    // The menu before is gone from the screen by now; let go of it.
    void shownMenu?.close().catch(() => undefined);
    const menu = await Menu.new({ items: await native(entries) });
    shownMenu = menu;
    await menu.popup();
    return;
  }
  closePageMenu();
  const menu = document.createElement("div");
  menu.className = "ps-context-menu";
  menu.setAttribute("role", "menu");
  // A submenu opens beside its item on hover, as native ones do, so the menu stays short.
  let openSub: { item: HTMLElement; sub: HTMLElement } | null = null;
  const closeSub = (within: HTMLElement) => {
    if (openSub && openSub.item.parentElement === within) {
      openSub.sub.remove();
      openSub.item.classList.remove("ps-context-open");
      openSub = null;
    }
  };
  const add = (list: ContextMenuEntry[], into: HTMLElement) => {
    for (const e of list) {
      if (e === "separator") {
        into.appendChild(document.createElement("hr"));
      } else if ("items" in e) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ps-context-parent";
        b.setAttribute("role", "menuitem");
        b.setAttribute("aria-haspopup", "menu");
        b.append(e.label);
        const show = () => {
          if (openSub?.item === b) return;
          closeSub(into);
          const sub = document.createElement("div");
          sub.className = "ps-context-menu ps-context-sub";
          sub.setAttribute("role", "menu");
          sub.setAttribute("aria-label", e.label);
          add(e.items, sub);
          menu.appendChild(sub);
          const r = b.getBoundingClientRect();
          const box = sub.getBoundingClientRect();
          // To the right, or to the left where the window ends.
          const left = r.right + box.width + 4 <= innerWidth ? r.right - 2 : r.left - box.width + 2;
          sub.style.left = `${Math.max(4, left)}px`;
          sub.style.top = `${Math.max(4, Math.min(r.top - 5, innerHeight - box.height - 4))}px`;
          b.classList.add("ps-context-open");
          openSub = { item: b, sub };
          return sub;
        };
        b.addEventListener("pointerenter", () => void show());
        b.addEventListener("click", () => void show());
        b.addEventListener("keydown", ev => {
          if (ev.key === "ArrowRight" || ev.key === "Enter") {
            ev.preventDefault();
            (show() ?? openSub?.sub)?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
          }
        });
        into.appendChild(b);
      } else {
        const b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "menuitem");
        if (e.color) {
          const sw = document.createElement("span");
          sw.className = "ps-context-swatch";
          sw.style.background = e.color;
          b.appendChild(sw);
        }
        b.append(e.label);
        b.disabled = e.enabled === false;
        // Moving onto another item of this menu closes a submenu that was open from it.
        b.addEventListener("pointerenter", () => closeSub(into));
        b.addEventListener("click", () => {
          closePageMenu();
          e.run();
        });
        into.appendChild(b);
      }
    }
  };
  add(entries, menu);
  document.body.appendChild(menu);
  // Kept inside the window.
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(at.x, innerWidth - box.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(at.y, innerHeight - box.height - 4))}px`;
  pageMenu = menu;
  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  const away = (ev: Event) => {
    if (ev.type === "keydown" && (ev as KeyboardEvent).key !== "Escape") return;
    if (ev.type === "pointerdown" && menu.contains(ev.target as Node)) return;
    // Only the window losing focus closes it, not focus moving between its items.
    if (ev.type === "blur" && ev.target !== window) return;
    closePageMenu();
  };
  for (const type of ["pointerdown", "keydown", "blur", "resize"]) window.addEventListener(type, away, { capture: true });
  menu.addEventListener("ps-close", () => {
    for (const type of ["pointerdown", "keydown", "blur", "resize"]) window.removeEventListener(type, away, { capture: true });
  });
}

function closePageMenu() {
  pageMenu?.dispatchEvent(new Event("ps-close"));
  pageMenu?.remove();
  pageMenu = null;
}

/**
 * Turns off the web view's own right-click menu (Reload, Look Up, Services…) outside text
 * fields, which keep Cut, Copy and Paste. Views that have a menu show theirs instead.
 */
export function replaceContextMenus() {
  document.addEventListener("contextmenu", e => {
    const t = e.target as HTMLElement | null;
    const field = t?.closest("input, textarea, select, [contenteditable='true']");
    // The sequence's hidden clipboard field is not a text field for the user.
    if (field && !field.classList.contains("sv-clipboard")) return;
    // In a browser, the page's own menu stays where we have none (handy for development).
    if (isDesktop) e.preventDefault();
  });
}
