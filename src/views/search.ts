// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Toolbar search: finds bases (on both strands, across the origin) or features, primers
// and enzymes by name, and selects the result.

import { h } from "../ui/dom.ts";
import { iconSvg } from "../ui/icons.ts";
import { cutSites } from "../doc/analysis.ts";
import type { DocContext } from "../doc/context.ts";
import type { Focus } from "../doc/store.ts";
import { reverseComplement, type Range } from "../lib/seqdata.ts";
import { fmt } from "../ui/format.ts";

const MAX_HITS = 200;

interface Hit {
  label: string;
  meta: string;
  range: Range;
  focus: Focus | null;
  kind: "bases" | "feature" | "primer" | "cutsite";
}

const IUPAC: Record<string, string> = { R: "[AG]", Y: "[CT]", S: "[GC]", W: "[AT]", K: "[GT]", M: "[AC]", B: "[CGT]", D: "[AGT]", H: "[ACT]", V: "[ACG]", N: "[ACGT]" };

function baseRegex(q: string): RegExp {
  return new RegExp(
    q
      .toUpperCase()
      .split("")
      .map(c => IUPAC[c] ?? c)
      .join(""),
    "g"
  );
}

export class Search {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private hits: Hit[] = [];
  private active = -1;
  private ctx: DocContext;

  constructor(ctx: DocContext) {
    this.ctx = ctx;
    this.input = h("input", {
      type: "search",
      class: "sv-input sv-search-input",
      placeholder: "Find bases, features, primers",
      "aria-label": "Find bases, features, primers or enzymes",
      spellcheck: "false",
      autocomplete: "off"
    }) as HTMLInputElement;
    this.list = h("div", { class: "sv-search-list", role: "listbox", hidden: true });
    const isMac = /Mac/.test(navigator.platform || navigator.userAgent);
    this.el = h("div", { class: "sv-search", "data-tauri-drag-region": "false" }, iconSvg("search", 15), this.input, h("kbd", { class: "sv-kbd", "aria-hidden": "true" }, isMac ? "⌘F" : "Ctrl+F"), this.list);
    this.input.addEventListener("input", () => this.update());
    this.input.addEventListener("focus", () => this.update());
    this.input.addEventListener("blur", () => setTimeout(() => (this.list.hidden = true), 150));
    this.input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!this.hits.length) return;
        this.active = (this.active + (e.key === "ArrowDown" ? 1 : -1) + this.hits.length) % this.hits.length;
        this.renderList();
        this.go(this.hits[this.active], false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!this.hits.length) return;
        this.active = (this.active + 1) % this.hits.length;
        this.renderList();
        this.go(this.hits[this.active], false);
      } else if (e.key === "Escape") {
        this.input.value = "";
        this.update();
        this.input.blur();
      }
    });
  }

  focus() {
    this.input.focus();
    this.input.select();
  }

  private update() {
    const q = this.input.value.trim();
    this.hits = q ? this.find(q) : [];
    this.active = -1;
    this.renderList();
  }

  private find(q: string): Hit[] {
    const d = this.ctx.store.data;
    const n = d.sequence.length;
    const hits: Hit[] = [];
    const lower = q.toLowerCase();
    const named = (name: string) => name.toLowerCase().includes(lower);
    for (const f of d.features) if (named(f.name) || f.type.toLowerCase() === lower) hits.push({ label: f.name, meta: `${f.type} · ${fmt(f.start + 1)}..${fmt(f.end + 1)}`, range: { start: f.start, end: f.end }, focus: { kind: "feature", id: f.id }, kind: "feature" });
    for (const p of d.primers) if (named(p.name)) hits.push({ label: p.name, meta: `primer · ${fmt(p.start + 1)}..${fmt(p.end + 1)}`, range: { start: p.start, end: p.end }, focus: { kind: "primer", id: p.id }, kind: "primer" });
    for (const c of cutSites(d, this.ctx.options.enzymeSet)) if (named(c.enzyme)) hits.push({ label: c.enzyme, meta: `cut site · ${fmt(c.start + 1)}`, range: { start: c.start, end: c.end }, focus: { kind: "cutsite", id: c.id }, kind: "cutsite" });
    const dna = q.replace(/\s+/g, "");
    if (dna.length >= 3 && /^[ACGTURYSWKMBDHVN]+$/i.test(dna)) {
      const text = d.circular ? d.sequence + d.sequence.slice(0, dna.length - 1) : d.sequence;
      const upper = text.toUpperCase();
      const add = (re: RegExp, strand: string) => {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(upper)) && hits.length < MAX_HITS) {
          const start = m.index;
          if (start >= n) break;
          const end = (start + dna.length - 1) % n;
          hits.push({ label: `${fmt(start + 1)}..${fmt(end + 1)}`, meta: strand, range: { start, end }, focus: null, kind: "bases" });
          re.lastIndex = m.index + 1;
        }
      };
      add(baseRegex(dna), "bases · top strand");
      const rc = reverseComplement(dna.toUpperCase());
      if (rc !== dna.toUpperCase()) add(baseRegex(rc), "bases · bottom strand");
    }
    return hits;
  }

  private renderList() {
    const q = this.input.value.trim();
    if (!q || document.activeElement !== this.input) {
      this.list.hidden = true;
      return;
    }
    const items = this.hits.slice(0, 60).map((hit, i) =>
      h(
        "button",
        {
          type: "button",
          role: "option",
          class: `sv-search-item${i === this.active ? " sv-active" : ""}`,
          "aria-selected": String(i === this.active),
          onmousedown: (e: Event) => e.preventDefault(),
          onclick: () => {
            this.active = i;
            this.go(hit, true);
          }
        },
        h("span", { class: "sv-search-label" }, hit.label),
        h("span", { class: "sv-search-meta" }, hit.meta)
      )
    );
    const count = this.hits.length >= MAX_HITS ? `${MAX_HITS}+ matches` : `${this.hits.length} match${this.hits.length === 1 ? "" : "es"}`;
    this.list.replaceChildren(h("div", { class: "sv-search-count" }, this.hits.length ? `${count} · Enter for next` : "No matches"), ...items);
    this.list.hidden = false;
  }

  private go(hit: Hit, close: boolean) {
    const tab = this.ctx.tab;
    if (tab !== "map" && tab !== "sequence") this.ctx.showTab(hit.kind === "bases" ? "sequence" : "map");
    this.ctx.store.selectRange(hit.range, hit.focus, "search");
    if (close) {
      this.list.hidden = true;
      this.input.blur();
    }
  }
}
