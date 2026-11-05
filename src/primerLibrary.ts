// The lab's primer library, shared by every window. Kept in the app's local storage like
// the settings, and edited in its own window (src/libraryWindow.ts); Export and Import make
// copies for backup and for sharing with the lab.

import { isDesktop } from "./platform.ts";
import { newEntries, type LibraryEntry, type LibraryPrimer } from "./lib/library.ts";
import { newId } from "./lib/seqdata.ts";

const KEY = "strandivo.primerLibrary";
const EVENT = "primer-library-changed";

function readRaw(): string {
  try {
    return localStorage.getItem(KEY) || "[]";
  } catch {
    return "[]";
  }
}

function parse(raw: string): LibraryPrimer[] {
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .filter(p => p && typeof p.name === "string" && typeof p.bases === "string")
      .map(p => ({ id: String(p.id || newId("lib")), name: p.name, bases: p.bases.toUpperCase(), notes: typeof p.notes === "string" ? p.notes : "" }));
  } catch {
    return [];
  }
}

export class PrimerLibrary {
  private raw = readRaw();
  private items: LibraryPrimer[] = parse(this.raw);
  private listeners = new Set<() => void>();

  constructor() {
    // Another window changed it: the storage event in a browser, an app event in the app,
    // and a check on focus in case neither arrived.
    const reload = () => {
      const raw = readRaw();
      if (raw === this.raw) return;
      this.raw = raw;
      this.items = parse(raw);
      this.emit();
    };
    window.addEventListener("storage", e => e.key === KEY && reload());
    window.addEventListener("focus", reload);
    if (isDesktop) void import("@tauri-apps/api/event").then(({ listen }) => listen(EVENT, reload)).catch(() => undefined);
  }

  get all(): LibraryPrimer[] {
    return this.items;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Adds the entries that aren't already there; returns how many were added. */
  add(entries: LibraryEntry[]): number {
    const fresh = newEntries(this.items, entries).map(e => ({ ...e, id: newId("lib"), bases: e.bases.toUpperCase() }));
    if (!fresh.length) return 0;
    this.set([...this.items, ...fresh]);
    return fresh.length;
  }

  update(id: string, patch: Partial<LibraryEntry>) {
    this.set(this.items.map(p => (p.id === id ? { ...p, ...patch, bases: (patch.bases ?? p.bases).toUpperCase() } : p)));
  }

  remove(id: string) {
    this.set(this.items.filter(p => p.id !== id));
  }

  private set(next: LibraryPrimer[]) {
    // A new list each time, so views can tell it changed.
    this.items = next;
    this.raw = JSON.stringify(next);
    try {
      localStorage.setItem(KEY, this.raw);
    } catch {
      /* storage unavailable: kept for this window only */
    }
    this.emit();
    if (isDesktop) void import("@tauri-apps/api/event").then(({ emit }) => emit(EVENT)).catch(() => undefined);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }
}

export const primerLibrary = new PrimerLibrary();
