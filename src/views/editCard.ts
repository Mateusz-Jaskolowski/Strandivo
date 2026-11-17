// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The card that every edit to bases made from the keyboard waits in (AGENTS.md, "Edits to
// bases from the keyboard"): bases typed or pasted at the cursor or over a selection, and
// bases Backspace, Delete or Cut take out. It shows the bases, how many, the change to
// each protein and what happens to the annotations there (`describeEdit`), and at an edge
// asks which side takes new bases. Nothing changes until it is applied. The Sequence tab
// owns it: it sends it keys and pastes, places it and closes it.

import { describeEdit, names, verbOf, type EditSummary, type PendingEdit } from "../lib/baseEdit.ts";
import { basesIn, rangeLength, type EdgeSide, type SeqData } from "../lib/seqdata.ts";
import { h } from "../ui/dom.ts";
import { fmt, fmtRange } from "../ui/format.ts";

/** Bases a row shows before the rest is left out. */
const SHOWN = 18;

export interface EditCardActions {
  apply(): void;
  cancel(): void;
  /** Its size or place changed other than by a key, as by a click on a side. */
  changed(): void;
}

export class EditCard {
  readonly el: HTMLElement;
  /** The sequence as it was when the card opened. */
  readonly data: SeqData;
  /** Opened on selected bases: their range stays, and Delete again may apply a deletion. */
  readonly fixed: boolean;
  private edit: PendingEdit;
  private pasted = false;
  /** Bases were typed or pasted into it, so Backspace takes them back rather than deleting. */
  private everTyped = false;
  private summary: EditSummary;
  private readonly body: HTMLElement;
  private readonly go: HTMLButtonElement;
  private readonly hint: HTMLElement;
  private readonly caseOf: (bases: string) => string;
  private readonly actions: EditCardActions;

  constructor(data: SeqData, edit: PendingEdit, fixed: boolean, caseOf: (bases: string) => string, actions: EditCardActions) {
    this.data = data;
    this.edit = edit;
    this.fixed = fixed;
    this.caseOf = caseOf;
    this.actions = actions;
    this.body = h("div", { class: "sv-edit-body", "aria-live": "polite" });
    this.go = h("button", { type: "button", class: "sv-edit-go", onclick: () => actions.apply() }) as HTMLButtonElement;
    this.hint = h("span", { class: "sv-edit-hint" });
    const esc = h("button", { type: "button", class: "sv-edit-esc", title: "Keep the sequence as it is (Esc)", onclick: () => actions.cancel() }, "Esc");
    this.el = h("div", { class: "sv-edit", role: "dialog", "aria-label": "Edit bases" }, this.body, h("div", { class: "sv-edit-foot" }, this.hint, esc, this.go));
    // The sequence keeps the keyboard, and nothing under the card gets the click.
    this.el.addEventListener("pointerdown", e => e.stopPropagation());
    this.el.addEventListener("mousedown", e => e.preventDefault());
    this.el.addEventListener("dblclick", e => e.stopPropagation());
    this.el.addEventListener("contextmenu", e => {
      e.preventDefault();
      e.stopPropagation();
    });
    this.summary = this.draw();
  }

  get pending(): PendingEdit {
    return this.edit;
  }

  /** Something to apply: bases to put in, or bases to take out. */
  get ready(): boolean {
    return !!this.edit.range || !!this.edit.bases;
  }

  /** Selected bases waiting to go, and nothing typed since: Delete again applies it. */
  get confirmsWithDelete(): boolean {
    return this.fixed && !this.everTyped && !this.edit.bases;
  }

  add(bases: string, pasted: boolean) {
    if (pasted) this.pasted = true;
    if (bases) this.everTyped = true;
    this.set({ ...this.edit, bases: this.edit.bases + bases });
  }

  /** Backspace: takes back the last base typed; false when none was. */
  back(): boolean {
    if (!this.edit.bases) return false;
    this.set({ ...this.edit, bases: this.edit.bases.slice(0, -1) });
    return true;
  }

  /** Takes one more base out, before (-1) or after (1) those already going; false if it can't. */
  grow(dir: -1 | 1): boolean {
    const n = this.data.sequence.length;
    const circular = this.data.circular;
    const e = this.edit;
    if (this.fixed || !n) return false;
    let range = e.range;
    if (!range) {
      const p = dir < 0 ? e.at - 1 : e.at;
      if (!circular && (p < 0 || p >= n)) return false;
      const q = (p + n) % n;
      range = { start: q, end: q };
    } else if (rangeLength(range, n) >= n) return false;
    else if (dir < 0) {
      if (!circular && range.start === 0) return false;
      range = { start: (range.start - 1 + n) % n, end: range.end };
    } else {
      if (!circular && range.end === n - 1) return false;
      range = { start: range.start, end: (range.end + 1) % n };
    }
    this.set({ ...e, range });
    return true;
  }

  /** Tab: the next side offered for new bases at an edge; false when none is offered. */
  cycle(dir: -1 | 1): boolean {
    const offered = this.offered();
    if (offered.length < 2) return false;
    const i = offered.indexOf(this.edit.side);
    this.set({ ...this.edit, side: offered[(i + dir + offered.length) % offered.length] });
    return true;
  }

  private offered(): EdgeSide[] {
    const { before, after } = this.summary.sides;
    if (!before.length && !after.length) return [];
    return [...(before.length ? ["before" as const] : []), ...(after.length ? ["after" as const] : []), "neither"];
  }

  private set(edit: PendingEdit) {
    this.edit = edit;
    this.summary = this.draw();
  }

  private draw(): EditSummary {
    let s = describeEdit(this.data, this.edit, !this.pasted);
    // A side no longer offered, as the edit changed, goes back to neither.
    const { before, after } = s.sides;
    if ((this.edit.side === "before" && !before.length) || (this.edit.side === "after" && !after.length)) {
      this.edit = { ...this.edit, side: "neither" };
      s = describeEdit(this.data, this.edit, !this.pasted);
    }
    const e = this.edit;
    const verb = verbOf(e);
    const b = (text: string) => h("b", {}, text);
    const long = (k: number) => (k > SHOWN ? ` · ${fmt(k)} bp` : "");
    const head =
      verb === "Insert"
        ? h("div", { class: "sv-edit-head" }, ...(e.at ? ["Insert after ", b(fmt(e.at))] : ["Insert at the start"]), s.sides.before.length && s.sides.after.length ? ` · between ${names(s.sides.before)} and ${names(s.sides.after)}` : "")
        : h("div", { class: "sv-edit-head" }, `${verb} `, b(fmtRange(e.range!.start + 1, e.range!.end + 1)), long(s.taken));
    const row = (key: string, ...content: (Node | string)[]) => h("div", { class: "sv-edit-row" }, h("span", { class: "sv-edit-key" }, key), h("span", {}, ...content));
    const cut = (t: string) => (t.length > SHOWN ? `${t.slice(0, SHOWN - 2)}…` : t);
    const was = e.range ? this.caseOf(basesIn(this.data.sequence, e.range)) : "";
    const rows: HTMLElement[] = [];
    if (verb === "Delete") rows.push(row("del", h("span", { class: "sv-edit-del" }, cut(was))));
    else {
      if (verb === "Replace") rows.push(row("was", h("span", { class: "sv-edit-was" }, cut(was))));
      rows.push(row(verb === "Insert" ? "add" : "now", ...this.typed(verb === "Insert" ? "" : was)));
    }
    const offered = verb === "Delete" ? [] : this.offeredFrom(s);
    const choice = offered.length
      ? h(
          "div",
          { class: "sv-edit-choice" },
          h("div", { class: "sv-edit-choice-head" }, h("span", {}, "New bases go in"), h("span", {}, h("span", { class: "sv-edit-kbd" }, "Tab"), " to change")),
          h(
            "div",
            { class: "sv-edit-seg", role: "radiogroup", "aria-label": "New bases go in" },
            ...offered.map(([side, label]) =>
              h(
                "button",
                {
                  type: "button",
                  role: "radio",
                  "aria-checked": String(side === e.side),
                  class: side === e.side ? "sv-edit-side sv-edit-side-on" : "sv-edit-side",
                  title: label,
                  onclick: () => {
                    this.set({ ...this.edit, side });
                    this.actions.changed();
                  }
                },
                label
              )
            )
          )
        )
      : null;
    this.body.replaceChildren(
      head,
      ...rows,
      h("div", { class: `sv-edit-status sv-edit-${s.tone}` }, s.status),
      ...(choice ? [choice] : []),
      ...s.effects.map(x => h("div", { class: "sv-edit-note" }, `${x.name} · `, h("b", { class: "sv-mono" }, x.change))),
      ...s.notes.map(x => h("div", { class: x.warn ? "sv-edit-note sv-edit-warn" : "sv-edit-note" }, x.text))
    );
    this.go.textContent = `${verb} ↵`;
    this.go.title = `${verb} (Enter)`;
    this.go.disabled = !this.ready;
    this.go.className = `sv-edit-go${verb === "Delete" ? " sv-edit-go-danger" : s.tone === "ok" || (verb === "Insert" && s.tone === "plain") ? " sv-edit-go-ok" : ""}`;
    this.hint.textContent = this.confirmsWithDelete ? "or Delete again" : "";
    return s;
  }

  private offeredFrom(s: EditSummary): [EdgeSide, string][] {
    const { before, after } = s.sides;
    if (!before.length && !after.length) return [];
    return [...(before.length ? [["before", names(before)] as [EdgeSide, string]] : []), ...(after.length ? [["after", names(after)] as [EdgeSide, string]] : []), ["neither", "Neither"]];
  }

  /**
   * The bases typed, those differing from `was` marked, a caret after them and dots for
   * those still to type over a selection; a long run shows its end, where the caret is.
   */
  private typed(was: string): (Node | string)[] {
    const now = this.caseOf(this.edit.bases);
    const out: (Node | string)[] = [];
    const from = now.length > SHOWN ? now.length - (SHOWN - 2) : 0;
    if (from) out.push("…");
    let run = "";
    let changed = false;
    const flush = () => {
      if (run) out.push(changed ? h("span", { class: "sv-edit-changed" }, run) : run);
      run = "";
    };
    for (let i = from; i < now.length; i++) {
      const c = now[i].toUpperCase() !== (was[i] ?? "").toUpperCase();
      if (c !== changed) flush();
      changed = c;
      run += now[i];
    }
    flush();
    out.push(h("span", { class: "sv-edit-caret" }));
    if (!this.pasted && now.length < was.length && was.length <= SHOWN) out.push(h("span", { class: "sv-edit-dots" }, "·".repeat(was.length - now.length)));
    return out;
  }
}
