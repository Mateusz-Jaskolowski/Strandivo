// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Files in the browser version. A page never learns a file's path, so each file it opens or
// saves gets a key written like a path, and the rest of the code keeps working on strings
// as it does with paths on the desktop (decision 7 in docs/web-version-plan.md):
//
// - `web:<id>/<name>`: a file the browser gave a handle to (Chrome's and Edge's file
//   pickers, and drops there). The handle is kept in IndexedDB, so the key lasts between
//   visits; the browser may ask again before it is read or written, which it only does
//   after a click or a key press.
// - `web:<id>/<folder>`: a folder added to Home (Chrome and Edge), kept the same way, and
//   `web:<id>/<folder>/<path in it>` a file in it, reached through the folder's handle. A
//   file picked or dropped from inside one of Home's folders gets this key too, so it is
//   one file wherever it was opened from: one tab, one note, one set of remembered reads.
//   Its folder's permission covers it, so the browser asks once for a folder of reads.
// - `upload:<n>/<name>`: a file without a handle (a file input, a drop in Safari or
//   Firefox) or a download. Its bytes are kept in memory, for this visit only.
//
// Anything else is a URL (`?open=<url>`), which src/platform.ts fetches.

import { basename, extension, LIBRARY_EXTENSIONS } from "./lib/files.ts";
import { libraryFolders } from "./constructLibrary.ts";
import { toast } from "./ui/dom.ts";

export const isBrowserKey = (path: string) => path.startsWith("web:") || path.startsWith("upload:");

/** A key whose file can be written where it is: only a handle allows that. */
export const isHandleKey = (path: string) => path.startsWith("web:");

/** Whether a path still leads to its file on a later visit: all but `upload:` keys do. */
export const keyLasts = (path: string) => !path.startsWith("upload:");

/** What to show of a path: a key's place in its folder, or its name; never the key. */
export function shownPath(path: string): string {
  if (path.startsWith("upload:")) return basename(path);
  if (path.startsWith("web:")) return path.slice(path.indexOf("/") + 1);
  return path;
}

// The File System Access API's parts that TypeScript's DOM types leave out.
interface PermissionHandle {
  queryPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}
interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}
interface Pickers {
  showOpenFilePicker?(o: { multiple?: boolean; types?: PickerType[] }): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?(o: { suggestedName?: string; types?: PickerType[] }): Promise<FileSystemFileHandle>;
  showDirectoryPicker?(o: { id?: string; mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle>;
}
interface HandleItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}
interface Listing {
  values(): AsyncIterable<FileSystemHandle>;
}
const pickers = () => window as unknown as Pickers;

/** Whether this browser can save over a file it opened (Chrome and Edge). */
export const canPickFiles = () => !!pickers().showOpenFilePicker;

/** Whether this browser can keep a folder for Home (Chrome and Edge). */
export const canPickFolders = () => !!pickers().showDirectoryPicker;

const types = (filters: { name: string; extensions: string[] }[]): PickerType[] =>
  filters.map(f => ({ description: f.name, accept: { "application/octet-stream": f.extensions.map(e => `.${e}`) } }));

const aborted = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
const missing = (e: unknown) => e instanceof DOMException && (e.name === "NotFoundError" || e.name === "TypeMismatchError");
const movedError = (name: string) => new Error(`${name} was moved or deleted.`);

// ---------- handles, kept in IndexedDB ----------

interface Stored {
  id: string;
  handle: FileSystemHandle;
  used: number;
}

/** Files' handles kept, the most recently used first; older ones are let go. Folders stay. */
const KEEP = 2000;
let database: Promise<IDBDatabase> | null = null;
/** Every kept handle by id, read once a visit; also where IndexedDB can't keep them. */
let known: Promise<Map<string, Stored>> | null = null;
/** Files in folders as their handles were met this visit, so they are reached without a walk. */
const metFiles = new Map<string, FileSystemFileHandle>();

function handles(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  database ??= new Promise((resolve, reject) => {
    const open = indexedDB.open("strandivo-files", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("handles", { keyPath: "id" });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => {
      database = null;
      reject(open.error);
    };
  });
  return database.then(db => db.transaction("handles", mode).objectStore("handles"));
}

function answer<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function keptHandles(): Promise<Map<string, Stored>> {
  known ??= handles("readonly")
    .then(store => answer(store.getAll() as IDBRequest<Stored[]>))
    .then(
      all => new Map(all.map(s => [s.id, s])),
      () => new Map<string, Stored>()
    );
  return known;
}

async function keep(s: Stored) {
  const all = await keptHandles();
  all.set(s.id, s);
  try {
    const store = await handles("readwrite");
    store.put(s);
    const files = [...all.values()].filter(x => x.handle.kind === "file");
    for (const old of files.sort((a, b) => b.used - a.used).slice(KEEP)) {
      store.delete(old.id);
      all.delete(old.id);
    }
  } catch {
    /* kept for this visit only */
  }
}

function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, "0")).join("");
}

const idOf = (key: string) => key.slice(4, key.includes("/") ? key.indexOf("/") : undefined);
const partsOf = (key: string) => (key.includes("/") ? key.slice(key.indexOf("/") + 1).split("/") : []);

/** The handle a key starts from: its file's, or its folder's. */
async function rootOf(key: string): Promise<FileSystemHandle | null> {
  const all = await keptHandles();
  const id = idOf(key);
  const hit = all.get(id);
  if (hit) return hit.handle;
  try {
    // Kept by another of the app's tabs since this one loaded.
    const stored = (await answer((await handles("readonly")).get(id))) as Stored | undefined;
    if (stored) all.set(id, stored);
    return stored?.handle ?? null;
  } catch {
    return null;
  }
}

/** Notes that a key was used, so its handle is let go last. */
async function touch(key: string) {
  const s = (await keptHandles()).get(idOf(key));
  if (s && Date.now() - s.used > 60000) await keep({ ...s, used: Date.now() });
}

/** The same entry among the kept handles of its kind, by name first, as comparing is slow. */
async function keptIdOf(handle: FileSystemHandle): Promise<string | null> {
  for (const s of (await keptHandles()).values()) {
    if (s.handle.kind === handle.kind && s.handle.name === handle.name && (await s.handle.isSameEntry(handle).catch(() => false))) return s.id;
  }
  return null;
}

/** A handle's key: the same file keeps the same key, however it was picked or dropped. */
async function keyFor(handle: FileSystemFileHandle): Promise<string> {
  const all = await keptHandles();
  for (const folder of libraryFolders()) {
    const dir = isHandleKey(folder) ? all.get(idOf(folder))?.handle : undefined;
    if (dir?.kind !== "directory") continue;
    const inside = await (dir as FileSystemDirectoryHandle).resolve(handle).catch(() => null);
    if (inside?.length) {
      const key = `${folder}/${inside.join("/")}`;
      metFiles.set(key, handle);
      return key;
    }
  }
  const id = (await keptIdOf(handle)) ?? newId();
  await keep({ id, handle, used: Date.now() });
  return `web:${id}/${handle.name}`;
}

async function permission(handle: FileSystemHandle, mode: "read" | "readwrite"): Promise<PermissionState> {
  const h = handle as unknown as PermissionHandle;
  if (!h.queryPermission) return "granted";
  return h.queryPermission({ mode }).catch(() => "prompt" as const);
}

/** Asks the browser for access if it wants to be asked; false if it was refused. */
async function allowed(handle: FileSystemHandle, mode: "read" | "readwrite"): Promise<boolean> {
  const h = handle as unknown as PermissionHandle;
  if ((await permission(handle, mode)) === "granted") return true;
  try {
    return (await h.requestPermission?.({ mode })) === "granted";
  } catch {
    // Asked without a click or key press to answer.
    return false;
  }
}

/** A key's file, reached through its folder if it is in one, after the folder's permission. */
async function fileOf(key: string): Promise<FileSystemFileHandle> {
  const name = basename(key);
  const met = metFiles.get(key);
  if (met) return met;
  const root = await rootOf(key);
  if (!root) throw new Error(`Strandivo no longer has access to ${name}. Open it again.`);
  const [first, ...rest] = partsOf(key);
  if (first !== root.name || (root.kind === "file") !== !rest.length) throw movedError(name);
  if (root.kind === "file") return root as FileSystemFileHandle;
  if (!(await allowed(root, "read"))) throw new Error(`Strandivo wasn't allowed to read the folder ${root.name}.`);
  try {
    let dir = root as FileSystemDirectoryHandle;
    for (const part of rest.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    const file = await dir.getFileHandle(rest[rest.length - 1]);
    metFiles.set(key, file);
    return file;
  } catch (e) {
    if (missing(e)) throw movedError(name);
    throw e;
  }
}

// ---------- folders (Chrome and Edge) ----------

/** Lets the user pick a folder for Home; its key, or null if cancelled. */
export async function pickFolderKey(): Promise<string | null> {
  const { showDirectoryPicker } = pickers();
  if (!showDirectoryPicker) return null;
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await showDirectoryPicker.call(window, { id: "strandivo-folders", mode: "read" });
  } catch (e) {
    if (aborted(e)) return null;
    throw e;
  }
  const id = (await keptIdOf(dir)) ?? newId();
  await keep({ id, handle: dir, used: Date.now() });
  return `web:${id}/${dir.name}`;
}

/**
 * Whether Home can read a folder now, or the browser wants to be asked first, which it
 * allows only after a click: on a later visit, unless the user chose to allow every visit.
 */
export async function folderAccess(folder: string): Promise<"granted" | "ask" | "gone"> {
  const root = await rootOf(folder);
  if (root?.kind !== "directory") return "gone";
  return (await permission(root, "read")) === "granted" ? "granted" : "ask";
}

/** Asks for a folder's access, from a click; whether it was given. */
export async function allowFolder(folder: string): Promise<boolean> {
  const root = await rootOf(folder);
  return root?.kind === "directory" && allowed(root, "read");
}

/** At most this many files are listed from one folder, at most this deep: the shell's limits. */
const MAX_LISTED = 5000;
const MAX_DEPTH = 8;

/** The sequence files in a folder and its subfolders, as the shell lists them. */
export async function listFolderKey(folder: string): Promise<{ path: string; size: number; modified: number }[]> {
  const name = basename(folder);
  const root = await rootOf(folder);
  if (root?.kind !== "directory") throw new Error(`Strandivo no longer has access to ${name}. Add it again.`);
  if ((await permission(root, "read")) !== "granted") throw new Error(`Your browser asks before Strandivo reads ${name} again.`);
  const out: { path: string; size: number; modified: number }[] = [];
  async function walk(dir: FileSystemDirectoryHandle, path: string, depth: number) {
    const subfolders: [FileSystemDirectoryHandle, string][] = [];
    const files: Promise<void>[] = [];
    for await (const entry of (dir as unknown as Listing).values()) {
      if (entry.name.startsWith(".")) continue;
      const at = `${path}/${entry.name}`;
      if (entry.kind === "directory") subfolders.push([entry as FileSystemDirectoryHandle, at]);
      else if (LIBRARY_EXTENSIONS.includes(extension(entry.name)) && out.length + files.length < MAX_LISTED) {
        const handle = entry as FileSystemFileHandle;
        files.push(
          handle.getFile().then(
            f => {
              metFiles.set(at, handle);
              out.push({ path: at, size: f.size, modified: f.lastModified });
            },
            () => undefined
          )
        );
      }
    }
    await Promise.all(files);
    if (depth < MAX_DEPTH) for (const [sub, at] of subfolders) await walk(sub, at, depth + 1);
  }
  try {
    await walk(root as FileSystemDirectoryHandle, folder, 0);
  } catch (e) {
    if (missing(e)) throw movedError(name);
    throw e;
  }
  return out.slice(0, MAX_LISTED).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Of these paths, those the browser wants to ask about before they are read. It asks only
 * after a click, so a file's remembered reads wait for one (src/doc/document.ts).
 */
export async function needingAccess(paths: string[]): Promise<string[]> {
  const asks = new Map<string, boolean>();
  const out: string[] = [];
  for (const p of paths) {
    if (!isHandleKey(p) || metFiles.has(p)) continue;
    const id = idOf(p);
    if (!asks.has(id)) {
      const root = await rootOf(p);
      asks.set(id, !!root && (await permission(root, "read")) !== "granted");
    }
    if (asks.get(id)) out.push(p);
  }
  return out;
}

/**
 * Asks for access to these paths' files, from a click: once per file or folder, and not at
 * all for one already allowed (Chrome's "Allow on every visit" covers them all). The paths
 * still not allowed.
 */
export async function requestAccess(paths: string[]): Promise<string[]> {
  const given = new Map<string, boolean>();
  const out: string[] = [];
  for (const p of paths) {
    if (!isHandleKey(p) || metFiles.has(p)) continue;
    const id = idOf(p);
    if (!given.has(id)) {
      const root = await rootOf(p);
      given.set(id, !root || (await allowed(root, "read")));
    }
    if (!given.get(id)) out.push(p);
  }
  return out;
}

// ---------- files without a handle ----------

const uploads = new Map<string, { bytes: Uint8Array; modified: number }>();
let uploadCount = 0;

function uploadKey(name: string, bytes: Uint8Array, modified = Date.now()): string {
  const key = `upload:${++uploadCount}/${name}`;
  uploads.set(key, { bytes, modified });
  return key;
}

/** A file held for the visit: its size and when it was last changed, as Home lists it. */
export function uploadInfo(key: string): { size: number; modified: number } | null {
  const u = uploads.get(key);
  return u ? { size: u.bytes.length, modified: u.modified } : null;
}

const bytesOf = async (file: File) => new Uint8Array(await file.arrayBuffer());

/**
 * Lets the user pick files with a file input. It is in the page while it waits, so a
 * WebDriver test can hand it a file (`.sv-file-input`).
 */
export function pickWithInput(extensions: string[], multiple: boolean): Promise<File[]> {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = multiple;
  input.accept = extensions.map(e => `.${e}`).join(",");
  input.className = "sv-file-input";
  input.hidden = true;
  document.body.appendChild(input);
  return new Promise(resolve => {
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => done([]));
    input.click();
  });
}

// ---------- opening, reading and saving ----------

/** Lets the user pick files to open; their keys, or none if cancelled. */
export async function pickToOpen(description: string, extensions: string[]): Promise<string[]> {
  const { showOpenFilePicker } = pickers();
  if (!showOpenFilePicker) {
    const files = await pickWithInput(extensions, true);
    return Promise.all(files.map(async f => uploadKey(f.name, await bytesOf(f), f.lastModified)));
  }
  try {
    const picked = await showOpenFilePicker.call(window, { multiple: true, types: types([{ name: description, extensions }]) });
    return Promise.all(picked.map(keyFor));
  } catch (e) {
    if (aborted(e)) return [];
    throw e;
  }
}

/**
 * Asks where to save: a file chosen in the browser's save dialog where it has one, or
 * else a download of that name. Null if cancelled.
 */
export async function pickToSave(suggestedName: string, filters: { name: string; extensions: string[] }[]): Promise<string | null> {
  const { showSaveFilePicker } = pickers();
  if (!showSaveFilePicker) return uploadKey(suggestedName, new Uint8Array());
  try {
    return await keyFor(await showSaveFilePicker.call(window, { suggestedName, types: types(filters) }));
  } catch (e) {
    if (aborted(e)) return null;
    throw e;
  }
}

export async function readKey(key: string): Promise<Uint8Array> {
  const name = basename(key);
  if (!isHandleKey(key)) {
    const held = uploads.get(key);
    if (!held) throw new Error(`${name} was opened in an earlier visit. Open it again.`);
    return held.bytes;
  }
  const file = await fileOf(key);
  if (!(await allowed(file, "read"))) throw new Error(`Strandivo wasn't allowed to read ${name}.`);
  try {
    const bytes = await bytesOf(await file.getFile());
    void touch(key);
    return bytes;
  } catch (e) {
    if (missing(e)) throw movedError(name);
    throw e;
  }
}

let toldAboutDownloads = false;

/** Writes over a handle's file; anything else is downloaded. Says which it did. */
export async function saveKey(key: string, contents: string | Uint8Array): Promise<"file" | "download"> {
  const name = basename(key);
  if (isHandleKey(key)) {
    const file = await fileOf(key).catch(e => {
      throw new Error(`${e instanceof Error ? e.message : e} Choose where to save it again.`);
    });
    if (!(await allowed(file, "readwrite"))) throw new Error(`Strandivo wasn't allowed to save ${name}.`);
    const out = await file.createWritable();
    await out.write(contents as string | BufferSource);
    await out.close();
    return "file";
  }
  const bytes = typeof contents === "string" ? new TextEncoder().encode(contents) : contents;
  // Kept, so the saved file can be opened again during this visit.
  if (key.startsWith("upload:")) uploads.set(key, { bytes, modified: Date.now() });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/octet-stream" }));
  a.download = name;
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  // A download can't tell whether it was kept; it counts as saved once it starts.
  if (!toldAboutDownloads) {
    toldAboutDownloads = true;
    toast("Saved as a download. This browser can't save over a file, so each save is a new download.", "info", 8000);
  }
  return "download";
}

/**
 * The files of a drop, as keys. Called during the drop event, as its items can only be
 * read then; folders are left out.
 */
export function droppedKeys(data: DataTransfer): Promise<string[]> {
  const items = Array.from(data.items).filter(i => i.kind === "file");
  const taken = items.map(item => ({ handle: (item as unknown as HandleItem).getAsFileSystemHandle?.(), file: item.getAsFile() }));
  return Promise.all(
    taken.map(async ({ handle, file }) => {
      const h = await handle?.catch(() => null);
      if (h?.kind === "file") return keyFor(h as FileSystemFileHandle);
      if (h?.kind === "directory" || !file) return null;
      try {
        return uploadKey(file.name, await bytesOf(file), file.lastModified);
      } catch {
        return null; // a folder, where the browser has no handles
      }
    })
  ).then(keys => keys.filter((k): k is string => !!k));
}
