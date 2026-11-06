// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// One saved stock list for all windows. The shell saves a JSON file in app data; a
// browser uses local storage. Publish a change only once it has been saved successfully.

import { loadAppData, onAppDataChanged, saveAppData, setAsideAppData } from "./platform.ts";
import { formatEnzymeLibrary, newEnzymeStocks, parseEnzymeLibrary, type EnzymeStock, type LabEnzyme } from "./lib/enzymeLibrary.ts";
import { enzymeName } from "./lib/enzymes.ts";
import { newId } from "./lib/seqdata.ts";

const NAME = "enzyme-library";

class EnzymeLibrary {
  private items: LabEnzyme[] = [];
  private enzymeNames: readonly string[] = [];
  private raw: string | null = null;
  private revision = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  /** False until the saved list has been read (or failed to be). */
  loaded = false;
  error = "";
  readonly ready = this.start();

  get all(): readonly LabEnzyme[] { return this.items; }
  /** The stocked enzymes Strandivo knows, sorted: the same array until they change, so notes don't redraw maps. */
  get names(): readonly string[] { return this.enzymeNames; }

  private async start() {
    try {
      await onAppDataChanged(NAME, () => void this.reload());
    } catch {
      // Without the event, a window sees other windows' changes when it next saves.
    }
    await this.reload();
    this.loaded = true;
    this.emit();
  }

  async reload() {
    const revision = ++this.revision;
    try {
      const raw = await loadAppData(NAME);
      if (revision !== this.revision) return;
      if (raw === this.raw && !this.error) return;
      this.replace(raw === null ? [] : parseEnzymeLibrary(raw), raw);
    } catch (e) {
      if (revision !== this.revision) return;
      this.fail(e);
    }
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Adds stock records not already in the list; returns how many were new. */
  async add(incoming: readonly EnzymeStock[]): Promise<number> {
    let count = 0;
    await this.change(items => {
      const fresh = newEnzymeStocks(items, incoming).map(e => ({ ...e, id: newId("enzyme") }));
      count = fresh.length;
      return fresh.length ? [...items, ...fresh] : items;
    });
    return count;
  }

  /** Makes the list exactly `incoming` (an imported backup), identical records once. */
  replaceAll(incoming: readonly EnzymeStock[]): Promise<void> {
    return this.change(() => newEnzymeStocks([], incoming).map(e => ({ ...e, id: newId("enzyme") })));
  }

  update(id: string, patch: Partial<EnzymeStock>): Promise<void> {
    return this.change(items => items.map(e => e.id === id ? { ...e, ...patch } : e));
  }

  remove(id: string): Promise<void> {
    return this.change(items => items.filter(e => e.id !== id));
  }

  /** After a list couldn't be read: keeps it aside (returns where) and starts an empty one. */
  startNew(): Promise<string | null> {
    return this.enqueue(async () => {
      await this.ready;
      const aside = await setAsideAppData(NAME);
      ++this.revision;
      this.error = "";
      this.raw = null;
      this.set([]);
      this.emit();
      return aside;
    });
  }

  private change(edit: (items: LabEnzyme[]) => LabEnzyme[]): Promise<void> {
    return this.enqueue(async () => {
      await this.ready;
      // Another window or browser tab may have saved since this one last read: edit what is
      // saved now, not an older copy, or its change would be lost.
      const current = await loadAppData(NAME);
      if (current !== this.raw || this.error) {
        try {
          this.replace(current === null ? [] : parseEnzymeLibrary(current), current);
        } catch (e) {
          this.fail(e);
          throw new Error(this.error);
        }
      }
      const next = edit(this.items);
      if (next === this.items) return;
      const raw = formatEnzymeLibrary(next);
      const checked = parseEnzymeLibrary(raw);
      await saveAppData(NAME, raw);
      ++this.revision;
      this.replace(checked, raw);
    });
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const task = this.queue.then(run, run);
    this.queue = task.catch(() => undefined);
    return task;
  }

  private fail(e: unknown) {
    this.error = `Couldn't read the enzyme library: ${e instanceof Error ? e.message : String(e)}`;
    this.emit();
  }

  private replace(items: LabEnzyme[], raw: string | null) {
    if (this.raw === raw && !this.error) return;
    this.set(items);
    this.raw = raw;
    this.error = "";
    this.emit();
  }

  private set(items: LabEnzyme[]) {
    this.items = items;
    const names = [...new Set(items.map(e => enzymeName(e.enzyme)).filter((n): n is string => !!n))].sort();
    if (names.join(" ") !== this.enzymeNames.join(" ")) this.enzymeNames = names;
  }

  private emit() { for (const fn of this.listeners) fn(); }
}

export const enzymeLibrary = new EnzymeLibrary();
