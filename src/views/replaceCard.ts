// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The card that typing or pasting over selected bases opens above them (AGENTS.md,
// "Typing over a selection"): the bases selected and those typed so far, how many for how
// many, the change to each protein and what happens to the annotations there
// (`describeReplacement`). Nothing changes until Replace. The Sequence tab owns it: it
// sends it keys and pastes, places it and closes it.

import { describeReplacement } from "../lib/replacement.ts";
import { basesIn, type Range, type SeqData } from "../lib/seqdata.ts";
import { h } from "../ui/dom.ts";
import { fmt, fmtRange } from "../ui/format.ts";

/** Bases a row shows before the rest is left out. */
const SHOWN = 18;

/** "A", "A and B", "A, B and C", "A, B, C and 2 more". */
function names(list: string[]): string {
  const shown = list.length > 4 ? [...list.slice(0, 3), `${list.length - 3} more`] : list;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown[0];
}

export interface ReplaceActions {
  replace(): void;
  cancel(): void;
}

export class ReplaceCard {
  readonly el: HTMLElement;
  /** What was selected, in the sequence as it was when the card opened. */
  readonly data: SeqData;
  readonly range: Range;
  private typed = "";
  private pasted = false;
  private readonly body: HTMLElement;
  private readonly go: HTMLButtonElement;
  private readonly caseOf: (bases: string) => string;

  constructor(data: SeqData, range: Range, caseOf: (bases: string) => string, actions: ReplaceActions) {
    this.data = data;
    this.range = range;
    this.caseOf = caseOf;
    this.body = h("div", { class: "sv-replace-body", "aria-live": "polite" });
    this.go = h("button", { type: "button", class: "sv-replace-go", title: "Replace the selected bases (Enter)", onclick: () => actions.replace() }, "Replace ↵") as HTMLButtonElement;
    const esc = h("button", { type: "button", class: "sv-replace-esc", title: "Keep the selected bases (Esc)", onclick: () => actions.cancel() }, "Esc");
    this.el = h("div", { class: "sv-replace", role: "dialog", "aria-label": "Replace bases" }, this.body, h("div", { class: "sv-replace-foot" }, esc, this.go));
    // The sequence keeps the keyboard, and nothing under the card gets the click.
    this.el.addEventListener("pointerdown", e => e.stopPropagation());
    this.el.addEventListener("mousedown", e => e.preventDefault());
    this.el.addEventListener("dblclick", e => e.stopPropagation());
    this.el.addEventListener("contextmenu", e => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  /** The bases to put in, as typed or pasted. */
  get bases(): string {
    return this.typed;
  }

  add(bases: string, pasted: boolean) {
    this.typed += bases;
    if (pasted) this.pasted = true;
    this.draw();
  }

  /** Backspace: takes back the last base typed. */
  back() {
    this.typed = this.typed.slice(0, -1);
    this.draw();
  }

  private draw() {
    const r = describeReplacement(this.data, this.range, this.typed, !this.pasted);
    const was = this.caseOf(basesIn(this.data.sequence, this.range));
    const now = this.caseOf(this.typed);
    const head = h("div", { class: "sv-replace-head" }, "Replace ", h("b", {}, fmtRange(this.range.start + 1, this.range.end + 1)), r.selected > SHOWN ? ` · ${fmt(r.selected)} bp` : "");

    const wasRow = h("span", { class: "sv-replace-was" }, was.length > SHOWN ? `${was.slice(0, SHOWN - 2)}…` : was);
    // What is typed, its changed bases marked, and dots for those still to type; a long
    // one shows its end, where the caret is.
    const nowRow = h("span", { class: "sv-replace-now" });
    const from = now.length > SHOWN ? now.length - (SHOWN - 2) : 0;
    if (from) nowRow.append("…");
    let run = "";
    let changed = false;
    const flush = () => {
      if (run) nowRow.append(changed ? h("span", { class: "sv-replace-changed" }, run) : run);
      run = "";
    };
    for (let i = from; i < now.length; i++) {
      const c = now[i].toUpperCase() !== (was[i] ?? "").toUpperCase();
      if (c !== changed) flush();
      changed = c;
      run += now[i];
    }
    flush();
    nowRow.append(h("span", { class: "sv-replace-caret" }));
    if (!this.pasted && now.length < was.length && was.length <= SHOWN) nowRow.append(h("span", { class: "sv-replace-dots" }, "·".repeat(was.length - now.length)));

    const notes: HTMLElement[] = r.effects.map(e => h("div", { class: "sv-replace-note" }, `${e.name} · `, h("b", { class: "sv-mono" }, e.change)));
    if (r.removed.length) notes.push(h("div", { class: "sv-replace-note sv-replace-warn" }, `Removes ${names(r.removed)}`));
    if (r.outside.length) notes.push(h("div", { class: "sv-replace-note sv-replace-warn" }, `New bases fall outside ${names(r.outside)}`));
    if (r.holds.length) notes.push(h("div", { class: "sv-replace-note" }, `${names(r.holds)} ${r.holds.length === 1 ? "takes" : "take"} the new bases`));

    this.body.replaceChildren(
      head,
      h("div", { class: "sv-replace-row" }, h("span", { class: "sv-replace-key" }, "was"), wasRow),
      h("div", { class: "sv-replace-row" }, h("span", { class: "sv-replace-key" }, "now"), nowRow),
      h("div", { class: `sv-replace-status sv-replace-${r.kind}` }, r.status),
      ...notes
    );
    this.go.disabled = !this.typed;
    this.go.classList.toggle("sv-replace-go-ok", r.kind === "ok");
  }
}
