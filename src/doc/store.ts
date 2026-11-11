// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Per-window document state: the sequence data, the selection and undo history. Views
// subscribe to changes and redraw what they need.

import type { Range, SeqData } from "../lib/seqdata.ts";
import { mergeRanges } from "../lib/selection.ts";
import type { CodonSelection } from "../lib/codonSelection.ts";

export type FocusKind = "feature" | "primer" | "cutsite" | "orf";

/** The annotation a selection came from, so the inspector can describe it. */
export interface Focus {
  kind: FocusKind;
  id: string;
  /** Which of a CDS's regions (`src/lib/regions.ts`), when one of them was picked. */
  region?: number;
}

export interface Selection {
  /** One continuous stretch, or null for a caret or separate stretches. */
  range: Range | null;
  /** Non-contiguous selected bases. `range` is null while more than one stretch is picked. */
  ranges?: Range[];
  /** Whole amino acids picked in either sequence panel, with a shared Shift anchor. */
  codons?: CodonSelection;
  /** Insertion point between bases (0…n). With a range, it sits after the range's end. */
  caret: number;
  /** Fixed end of a mouse or shift selection (a boundary 0…n). */
  anchor: number | null;
  focus: Focus | null;
  /**
   * Enzymes picked for a digest with ⌘/Ctrl-click (`src/lib/enzymePick.ts`), two or more;
   * the range and focus are then the site clicked last. Any other selection drops them.
   */
  enzymes?: string[];
}

export interface Change {
  data: boolean;
  selection: boolean;
  /** Which view made the change, so it can skip scrolling to itself. */
  source?: string;
  /** The data before an edit (not an undo or redo), to tell what it changed. */
  before?: SeqData;
  /** The edit joined the last undo step (typing on), so one undo still takes both back. */
  merged?: boolean;
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

  /** Marks `data` (by default the current data) as what the file holds. */
  markSaved(data: SeqData = this.data) {
    this.saved = data;
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
    this.selection = fitSelection(sel, this.length, this.selection.caret, this.data.circular);
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
    const before = this.data;
    this.data = next;
    if (selection) {
      this.selection = fitSelection(selection, next.sequence.length, 0, next.circular);
    } else {
      const sel = before.sequence === next.sequence ? this.selection : { ...this.selection, ranges: undefined, codons: undefined };
      this.selection = fitSelection(sel, next.sequence.length, 0, next.circular);
    }
    this.emit({ data: true, selection: true, before, ...(merge ? { merged: true } : {}) });
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

function fitSelection(s: Partial<Selection>, n: number, fallbackCaret = 0, circular = true): Selection {
  const ranges = mergeRanges(s.ranges ?? (s.range ? [s.range] : []), n, circular);
  const range = ranges.length === 1 ? ranges[0] : null;
  return {
    range,
    caret: Math.max(0, Math.min(n, s.caret ?? (range ? range.end + 1 : fallbackCaret))),
    anchor: s.anchor == null ? null : Math.max(0, Math.min(n, s.anchor)),
    focus: range ? s.focus ?? null : null,
    ...(ranges.length > 1 ? { ranges } : {}),
    ...(ranges.length && s.codons ? { codons: s.codons } : {}),
    ...(range && s.enzymes && s.enzymes.length > 1 ? { enzymes: s.enzymes } : {})
  };
}
