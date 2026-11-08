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
// - `upload:<n>/<name>`: a file without a handle (a file input, a drop in Safari or
//   Firefox) or a download. Its bytes are kept in memory, for this visit only.
//
// Anything else is a URL (`?open=<url>`), which src/platform.ts fetches.

import { basename } from "./lib/files.ts";
import { toast } from "./ui/dom.ts";

export const isBrowserKey = (path: string) => path.startsWith("web:") || path.startsWith("upload:");

/** A key whose file can be written where it is: only a handle allows that. */
export const isHandleKey = (path: string) => path.startsWith("web:");

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
}
interface HandleItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}
const pickers = () => window as unknown as Pickers;

/** Whether this browser can save over a file it opened (Chrome and Edge). */
export const canPickFiles = () => !!pickers().showOpenFilePicker;

const types = (filters: { name: string; extensions: string[] }[]): PickerType[] =>
  filters.map(f => ({ description: f.name, accept: { "application/octet-stream": f.extensions.map(e => `.${e}`) } }));

const aborted = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

// ---------- handles, kept in IndexedDB ----------

interface Stored {
  id: string;
  handle: FileSystemFileHandle;
  used: number;
}

/** Handles kept, the most recently used first; older ones are let go. */
const KEEP = 200;
/** This visit's handles, also where IndexedDB can't keep them. */
const live = new Map<string, FileSystemFileHandle>();
let database: Promise<IDBDatabase> | null = null;

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

function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, "0")).join("");
}

/** A handle's key: the same file keeps the same key, however it was picked or dropped. */
async function keyFor(handle: FileSystemFileHandle): Promise<string> {
  let stored: Stored[] = [];
  try {
    stored = await answer((await handles("readonly")).getAll() as IDBRequest<Stored[]>);
  } catch {
    /* kept for this visit only */
  }
  let id: string | null = null;
  for (const [known, h] of [...live, ...stored.map(s => [s.id, s.handle] as const)]) {
    if (await h.isSameEntry(handle).catch(() => false)) {
      id = known;
      break;
    }
  }
  id ??= newId();
  live.set(id, handle);
  try {
    const store = await handles("readwrite");
    store.put({ id, handle, used: Date.now() } satisfies Stored);
    for (const old of stored.filter(s => s.id !== id).sort((a, b) => b.used - a.used).slice(KEEP - 1)) store.delete(old.id);
  } catch {
    /* kept for this visit only */
  }
  return `web:${id}/${handle.name}`;
}

async function handleOf(key: string): Promise<FileSystemFileHandle | null> {
  const id = key.slice(4, key.indexOf("/"));
  const known = live.get(id);
  if (known) return known;
  try {
    const stored = (await answer((await handles("readonly")).get(id))) as Stored | undefined;
    if (stored) live.set(id, stored.handle);
    return stored?.handle ?? null;
  } catch {
    return null;
  }
}

/** Asks the browser for access if it wants to be asked; false if it was refused. */
async function allowed(handle: FileSystemFileHandle, mode: "read" | "readwrite"): Promise<boolean> {
  const h = handle as unknown as PermissionHandle;
  if (!h.queryPermission || !h.requestPermission) return true;
  if ((await h.queryPermission({ mode })) === "granted") return true;
  try {
    return (await h.requestPermission({ mode })) === "granted";
  } catch {
    // Asked without a click or key press to answer.
    return false;
  }
}

// ---------- files without a handle ----------

const uploads = new Map<string, Uint8Array>();
let uploadCount = 0;

function uploadKey(name: string, bytes: Uint8Array): string {
  const key = `upload:${++uploadCount}/${name}`;
  uploads.set(key, bytes);
  return key;
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
    return Promise.all(files.map(async f => uploadKey(f.name, await bytesOf(f))));
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
    const bytes = uploads.get(key);
    if (!bytes) throw new Error(`${name} was opened in an earlier visit. Open it again.`);
    return bytes;
  }
  const handle = await handleOf(key);
  if (!handle) throw new Error(`Strandivo no longer has access to ${name}. Open it again.`);
  if (!(await allowed(handle, "read"))) throw new Error(`Strandivo wasn't allowed to read ${name}.`);
  try {
    return await bytesOf(await handle.getFile());
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") throw new Error(`${name} was moved or deleted.`);
    throw e;
  }
}

let toldAboutDownloads = false;

/** Writes over a handle's file; anything else is downloaded. Says which it did. */
export async function saveKey(key: string, contents: string): Promise<"file" | "download"> {
  const name = basename(key);
  if (isHandleKey(key)) {
    const handle = await handleOf(key);
    if (!handle) throw new Error(`Strandivo no longer has access to ${name}. Choose where to save it again.`);
    if (!(await allowed(handle, "readwrite"))) throw new Error(`Strandivo wasn't allowed to save ${name}.`);
    const out = await handle.createWritable();
    await out.write(contents);
    await out.close();
    return "file";
  }
  const bytes = new TextEncoder().encode(contents);
  // Kept, so the saved file can be opened again during this visit.
  if (key.startsWith("upload:")) uploads.set(key, bytes);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
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
        return uploadKey(file.name, await bytesOf(file));
      } catch {
        return null; // a folder, where the browser has no handles
      }
    })
  ).then(keys => keys.filter((k): k is string => !!k));
}
