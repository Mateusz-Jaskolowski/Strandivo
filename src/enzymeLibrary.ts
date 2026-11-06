// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// One saved stock list for all windows. The shell saves a JSON file in app data; a
// browser uses local storage. Publish a change only once it has been saved successfully.

import { loadEnzymeLibrary, onEnzymeLibraryChanged, saveEnzymeLibrary } from "./platform.ts";
import { formatEnzymeLibrary, newEnzymeStocks, parseEnzymeLibrary, type EnzymeStock, type LabEnzyme } from "./lib/enzymeLibrary.ts";
import { newId } from "./lib/seqdata.ts";

class EnzymeLibrary {
  private items: LabEnzyme[] = [];
  private enzymeNames: string[] = [];
  private raw: string | null = null;
  private revision = 0;
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  error = "";
  readonly ready = this.start();

  get all(): readonly LabEnzyme[] { return this.items; }
  get names(): readonly string[] { return this.enzymeNames; }

  private async start() {
    // Pure analysis is also imported by Node tests, without a browser or saved stock.
    if (typeof window === "undefined") return;
    try {
      await onEnzymeLibraryChanged(() => void this.reload());
    } catch {
      // Reloading on focus still works if the desktop event listener is unavailable.
    }
    await this.reload();
  }

  async reload() {
    const revision = ++this.revision;
    try {
      const raw = await loadEnzymeLibrary();
      if (revision !== this.revision) return;
      if (raw === this.raw && !this.error) return;
      const entries = raw === null ? [] : parseEnzymeLibrary(raw);
      this.replace(entries, raw);
    } catch (e) {
      if (revision !== this.revision) return;
      this.error = `Couldn't load the enzyme library: ${e instanceof Error ? e.message : String(e)}`;
      this.emit();
    }
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async add(incoming: readonly EnzymeStock[]): Promise<number> {
    let count = 0;
    await this.change(items => {
      const fresh = newEnzymeStocks(items, incoming).map(e => ({ ...e, id: newId("enzyme") }));
      count = fresh.length;
      return fresh.length ? [...items, ...fresh] : items;
    });
    return count;
  }

  update(id: string, patch: Partial<EnzymeStock>): Promise<void> {
    return this.change(items => items.map(e => e.id === id ? { ...e, ...patch } : e));
  }

  remove(id: string): Promise<void> {
    return this.change(items => items.filter(e => e.id !== id));
  }

  private change(edit: (items: LabEnzyme[]) => LabEnzyme[]): Promise<void> {
    const run = async () => {
      await this.ready;
      if (this.error) throw new Error(this.error);
      const next = edit(this.items);
      if (next === this.items) return;
      const raw = formatEnzymeLibrary(next);
      const checked = parseEnzymeLibrary(raw);
      await saveEnzymeLibrary(raw);
      ++this.revision;
      this.replace(checked, raw);
    };
    const task = this.queue.then(run, run);
    this.queue = task.catch(() => undefined);
    return task;
  }

  private replace(items: LabEnzyme[], raw: string | null) {
    if (this.raw === raw && !this.error) return;
    this.items = items;
    this.enzymeNames = [...new Set(items.map(e => e.enzyme))].sort();
    this.raw = raw;
    this.error = "";
    this.emit();
  }

  private emit() { for (const fn of this.listeners) fn(); }
}

export const enzymeLibrary = new EnzymeLibrary();
