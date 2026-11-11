// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { enzymeName } from "./enzymes.ts";

/** Normalise recognised names; keep future names, each once, for saved lists. */
function normalise(names: readonly string[]): string[] {
  const found = new Map<string, string>();
  for (const written of names) {
    const name = enzymeName(written) ?? written.trim();
    if (name) found.set(name.toLowerCase(), name);
  }
  return [...found.values()].sort((a, b) => a.localeCompare(b));
}

export function parsePersonalEnzymes(text: string): string[] {
  const file = JSON.parse(text);
  if (!file || file.version !== 1 || !Array.isArray(file.enzymes) || file.enzymes.some((n: unknown) => typeof n !== "string" || !n.trim()))
    throw new Error("This isn't a supported Strandivo personal enzyme list.");
  return normalise(file.enzymes);
}

export function formatPersonalEnzymes(names: readonly string[]): string {
  return JSON.stringify({ version: 1, enzymes: normalise(names) }, null, 2) + "\n";
}

export interface PersonalEnzymeStorage {
  load(): Promise<string | null>;
  save(contents: string): Promise<void>;
  setAside(): Promise<string | null>;
  listen(changed: () => void): Promise<() => void>;
}

/** One saved list. Changes become visible only after saving succeeds. */
export class PersonalEnzymes {
  private storage: PersonalEnzymeStorage;
  private items: readonly string[] = [];
  private known: readonly string[] = [];
  private raw: string | null = null;
  private revision = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  loaded = false;
  error = "";
  readonly ready: Promise<void>;

  constructor(storage: PersonalEnzymeStorage) {
    this.storage = storage;
    this.ready = this.start();
  }

  get all(): readonly string[] { return this.items; }
  get names(): readonly string[] { return this.known; }

  private async start() {
    try { await this.storage.listen(() => void this.reload()); } catch { /* Reads before writes still see other windows' changes. */ }
    await this.reload();
    this.loaded = true;
    this.emit();
  }

  async reload() {
    const revision = ++this.revision;
    try {
      const raw = await this.storage.load();
      if (revision === this.revision) this.replace(raw);
    } catch (e) { if (revision === this.revision) this.fail(e); }
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  set(written: string, selected: boolean): Promise<void> {
    return this.enqueue(async () => {
      await this.ready;
      const name = enzymeName(written) ?? (!selected ? written.trim() : null);
      if (!name) throw new Error(`Unknown enzyme “${written.trim()}”. Choose a standard enzyme name.`);
      // Read again so an edit made in another window isn't replaced by an older copy.
      try { this.replace(await this.storage.load()); } catch (e) { this.fail(e); throw new Error(this.error); }
      const has = this.items.some(n => n.toLowerCase() === name.toLowerCase());
      if (has === selected) return;
      const next = selected ? [...this.items, name] : this.items.filter(n => n.toLowerCase() !== name.toLowerCase());
      const raw = formatPersonalEnzymes(next);
      await this.storage.save(raw);
      ++this.revision;
      this.replace(raw);
    });
  }

  startNew(): Promise<string | null> {
    return this.enqueue(async () => {
      await this.ready;
      const aside = await this.storage.setAside();
      ++this.revision;
      this.replace(null);
      return aside;
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.queue.then(fn);
    this.queue = task.catch(() => undefined);
    return task;
  }

  private replace(raw: string | null) {
    if (raw === this.raw && !this.error) return;
    const items = raw === null ? [] : parsePersonalEnzymes(raw);
    const known = items.map(enzymeName).filter((n): n is string => !!n);
    if (JSON.stringify(items) !== JSON.stringify(this.items)) this.items = items;
    if (JSON.stringify(known) !== JSON.stringify(this.known)) this.known = known;
    this.raw = raw;
    this.error = "";
    this.emit();
  }

  private fail(e: unknown) {
    this.error = `Couldn't read My enzymes: ${e instanceof Error ? e.message : String(e)}`;
    this.emit();
  }

  private emit() { for (const fn of this.listeners) fn(); }
}
