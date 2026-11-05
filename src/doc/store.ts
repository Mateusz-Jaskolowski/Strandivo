// Per-window document state: the sequence data, the selection and undo history. Views
// subscribe to changes and redraw what they need.

import type { Range, SeqData } from "../lib/seqdata.ts";

export type FocusKind = "feature" | "primer" | "cutsite" | "orf";

/** The annotation a selection came from, so the inspector can describe it. */
export interface Focus {
  kind: FocusKind;
  id: string;
  /** Which of a CDS's regions (`src/lib/regions.ts`), when one of them was picked. */
  region?: number;
}

export interface Selection {
  /** Selected bases, or null for just a caret. */
  range: Range | null;
  /** Insertion point between bases (0…n). With a range, it sits after the range's end. */
  caret: number;
  /** Fixed end of a mouse or shift selection (a boundary 0…n). */
  anchor: number | null;
  focus: Focus | null;
}

export interface Change {
  data: boolean;
  selection: boolean;
  /** Which view made the change, so it can skip scrolling to itself. */
  source?: string;
}

interface Snapshot {
  data: SeqData;
  selection: Selection;
  label: string;
  key?: string;
  time: number;
}

const EMPTY_SELECTION: Selection = { range: null, caret: 0, anchor: null, focus: null };
const COALESCE_MS = 1500;
const MAX_HISTORY = 200;

export class DocStore {
  data: SeqData;
  selection: Selection = { ...EMPTY_SELECTION };
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private saved: SeqData;
  private listeners = new Set<(c: Change) => void>();
  private lastKey: string | undefined;
  private lastTime = 0;

  constructor(data: SeqData) {
    this.data = data;
    this.saved = data;
  }

  get length() {
    return this.data.sequence.length;
  }

  get dirty(): boolean {
    return this.data !== this.saved;
  }

  markSaved() {
    this.saved = this.data;
    this.emit({ data: false, selection: false });
  }

  subscribe(fn: (c: Change) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(c: Change) {
    for (const fn of this.listeners) {
      try {
        fn(c);
      } catch (e) {
        console.error(e);
      }
    }
  }

  /** Changes the selection. Unspecified fields are reset (a new selection replaces the old). */
  select(sel: Partial<Selection>, source?: string) {
    const n = this.length;
    const range = sel.range ? clampRange(sel.range, n) : null;
    const caret = Math.max(0, Math.min(n, sel.caret ?? (range ? (range.end + 1) % (n + 1) : this.selection.caret)));
    this.selection = {
      range,
      caret,
      anchor: sel.anchor ?? null,
      focus: range ? sel.focus ?? null : null
    };
    this.emit({ data: false, selection: true, source });
  }

  selectRange(range: Range | null, focus: Focus | null = null, source?: string) {
    this.select({ range, focus, caret: range ? range.end + 1 : this.selection.caret }, source);
  }

  /**
   * Replaces the data as one undoable step. Steps with the same `key` made in quick
   * succession (typing) are merged into one.
   */
  apply(next: SeqData, label: string, selection?: Partial<Selection>, key?: string) {
    if (next === this.data) return;
    const now = Date.now();
    const merge = key !== undefined && key === this.lastKey && now - this.lastTime < COALESCE_MS && this.past.length > 0;
    if (!merge) {
      this.past.push({ data: this.data, selection: this.selection, label, key, time: now });
      if (this.past.length > MAX_HISTORY) this.past.shift();
    }
    this.future = [];
    this.lastKey = key;
    this.lastTime = now;
    this.data = next;
    if (selection) {
      const n = next.sequence.length;
      const range = selection.range ? clampRange(selection.range, n) : null;
      this.selection = {
        range,
        caret: Math.max(0, Math.min(n, selection.caret ?? (range ? range.end + 1 : 0))),
        anchor: selection.anchor ?? null,
        focus: range ? selection.focus ?? null : null
      };
    } else {
      this.selection = fitSelection(this.selection, next.sequence.length);
    }
    this.emit({ data: true, selection: true });
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get undoLabel() {
    return this.past[this.past.length - 1]?.label;
  }
  get redoLabel() {
    return this.future[this.future.length - 1]?.label;
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push({ data: this.data, selection: this.selection, label: prev.label, time: Date.now() });
    this.data = prev.data;
    this.selection = prev.selection;
    this.lastKey = undefined;
    this.emit({ data: true, selection: true });
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push({ data: this.data, selection: this.selection, label: next.label, time: Date.now() });
    this.data = next.data;
    this.selection = next.selection;
    this.lastKey = undefined;
    this.emit({ data: true, selection: true });
    return true;
  }
}

function clampRange(r: Range, n: number): Range | null {
  if (n <= 0) return null;
  const start = Math.max(0, Math.min(n - 1, r.start));
  const end = Math.max(0, Math.min(n - 1, r.end));
  return { start, end };
}

function fitSelection(s: Selection, n: number): Selection {
  return {
    range: s.range ? clampRange(s.range, n) : null,
    caret: Math.max(0, Math.min(n, s.caret)),
    anchor: s.anchor === null ? null : Math.max(0, Math.min(n, s.anchor)),
    focus: s.focus
  };
}
