// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The Primers tab: where this plasmid's primers bind and a table with Tm and checks. Adding
// primers, the PCR product and primer design open as dialogs (primerDialogs.ts).

import { h, toast } from "../ui/dom.ts";
import { track } from "../usage.ts";
import { iconSvg, primerIcon } from "../ui/icons.ts";
import { fmt } from "../ui/format.ts";
import { featureStyles, primerAlignment, primerColors } from "../doc/analysis.ts";
import type { DocContext } from "../doc/context.ts";
import { primerReport, tmLabel, type PrimerReport } from "../lib/primers.ts";
import { DEFAULT_SORT, matchesFilter, nextSort, parseSort, primerNote, shortTail, sortRows, type ExportRow, type PrimerRow, type Sort, type SortKey } from "../lib/primerTable.ts";
import { primerPairs, TM_APART, type PrimerPair } from "../lib/primerPairs.ts";
import { extendPick, NO_PICKS, prunePicks, togglePick, type Picks } from "../lib/picks.ts";
import { primerLibrary } from "../primerLibrary.ts";
import { confirmDialog, showContextMenu } from "../platform.ts";
import type { Range, SeqData, SeqPrimer } from "../lib/seqdata.ts";
import { exportPrimerList, openAddBySequence, openDesignDialog, openLibraryPicker, openOrderDialog, openPcrDialog, where } from "./primerDialogs.ts";
import { openMutagenesisDialog } from "./mutagenesisDialog.ts";
import { PrimerContextView } from "./primerContext.ts";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** What the tab remembers between sessions, like the other views' options. */
const OPTIONS_KEY = "strandivo.primers";

function loadSort(): Sort {
  try {
    return parseSort(JSON.parse(localStorage.getItem(OPTIONS_KEY) || "{}").sort);
  } catch {
    return DEFAULT_SORT;
  }
}

function saveSort(sort: Sort) {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify({ sort }));
  } catch {
    // Storage can be full or turned off; the sort is then just not remembered.
  }
}

/** A primer's note in the table: cut short with an ellipsis, the whole of it on hover. */
function noteCell(note: string): HTMLElement {
  if (!note) return h("td", { class: "sv-td-notes sv-dim" }, "—");
  return h("td", { class: "sv-td-notes", title: note }, h("div", { class: "sv-td-notes-text" }, note));
}

export class PrimersView {
  readonly el: HTMLElement;
  private ctx: DocContext;
  private visible = false;
  private stale = true;

  private strip = h("div", { class: "sv-bind-strip" });
  private table = h("div", { class: "sv-table-wrap" });
  /** What the rows picked with ⌘/Ctrl or Shift can be done with; empty while one row is selected. */
  private picked = h("div", { class: "sv-primers-picked", hidden: true });
  private picks: Picks = NO_PICKS;
  /** Set while picking clears the store's selection, so that change doesn't clear the picks. */
  private picking = false;
  private reportCache: { data: SeqData; map: Map<string, PrimerReport> } | null = null;
  private pairCache: { data: SeqData; pairs: PrimerPair[] } | null = null;
  private foot = h("p", { class: "sv-small sv-dim sv-primers-foot" });
  private listNote = h("span", { class: "sv-pane-note" });
  private filterBox: HTMLElement;
  private switcher = h("div", { class: "sv-segmented", role: "group", "aria-label": "Show" });
  /** What the middle of the section shows: the primers, or the pairs they make. */
  private listView: "list" | "pairs" = "list";
  /** What was typed in the filter box; "" shows every primer. */
  private filter = "";
  private sort: Sort = loadSort();
  /** The rows in the order shown, for Copy for ordering. */
  private shownOrder: SeqPrimer[] = [];
  private context: PrimerContextView;
  /** The stretch shown in the sequence panel, marked on the binding map. */
  private shown: Range | null = null;

  constructor(ctx: DocContext) {
    this.ctx = ctx;
    this.context = new PrimerContextView(ctx, { rows: 1 });
    this.context.onWindow = r => {
      this.shown = r;
      this.renderWindowBox();
    };
    const button = (label: string, icon: Parameters<typeof iconSvg>[0] | null, onclick: () => void, extra = "") =>
      h("button", { type: "button", class: `sv-btn sv-btn-small${extra}`, onclick }, icon ? iconSvg(icon, 14) : "", label);
    const filter = h("input", { type: "search", class: "sv-input sv-input-filter", placeholder: "Filter primers", "aria-label": "Filter primers by name, note or sequence" }) as HTMLInputElement;
    filter.addEventListener("input", () => {
      this.filter = filter.value.trim();
      this.renderTable();
      this.markSelected();
    });
    this.filterBox = h("div", { class: "sv-primers-filter" }, iconSvg("filter", 14), filter);
    const head = h(
      "div",
      { class: "sv-pane-head sv-primers-head" },
      h("h2", { class: "sv-pane-title" }, "Primers"),
      button("Add from library…", "library", () => openLibraryPicker(ctx)),
      button("Add by sequence…", "plus", () => openAddBySequence(ctx)),
      button("Design primers…", "pcr", () => openDesignDialog(ctx)),
      button("Mutagenesis…", null, () => openMutagenesisDialog(ctx)),
      button("PCR product…", null, () => openPcrDialog(ctx)),
      h("span", { class: "sv-push" }),
      button("Copy for ordering…", "copy", () => openOrderDialog(ctx, this.shownOrder)),
      button("Export list…", null, () => {
        track("primer_pairs_exported");
        void exportPrimerList(ctx, this.exportRows());
      })
    );
    this.el = h(
      "div",
      { class: "sv-primers" },
      head,
      h(
        "div",
        { class: "sv-primers-body" },
        h("section", { class: "sv-card-section" }, h("div", { class: "sv-section-head sv-primers-section-head" }, h("h3", { class: "sv-section-title" }, "Binding sites"), h("span", { class: "sv-pane-note" }, "Forward primers above the line, reverse below")), this.strip),
        h("section", { class: "sv-card-section sv-ctx-section" }, this.context.el),
        h(
          "section",
          { class: "sv-card-section" },
          h("div", { class: "sv-section-head sv-primers-section-head" }, this.switcher, this.listNote, h("span", { class: "sv-push" }), this.filterBox),
          this.table,
          this.picked,
          this.foot
        )
      )
    );
    ctx.store.subscribe(c => {
      if (c.data) {
        // Primers deleted elsewhere leave the selection; the rest of it stays.
        this.picks = prunePicks(this.picks, ctx.store.data.primers.map(p => p.id));
        this.invalidate();
      } else if (c.selection) {
        // Any other selection replaces a selection of several, this tab's binding map and
        // sequence panel included; only the empty one picking makes keeps it.
        if (!this.picking) this.picks = NO_PICKS;
        this.markSelected();
      }
    });
    // Options change with Settings too (the Tm method). The document is the same, so both
    // caches have to be dropped by hand or the table would keep the Tms of the old method.
    ctx.onOptions(() => {
      this.reportCache = null;
      this.pairCache = null;
      this.invalidate();
    });
  }

  setVisible(v: boolean) {
    this.visible = v;
    if (v && this.stale) this.render();
    this.context.setVisible(v);
  }

  private invalidate() {
    this.stale = true;
    if (this.visible) this.render();
  }

  private select(p: SeqPrimer) {
    this.ctx.store.selectRange({ start: p.start, end: p.end }, { kind: "primer", id: p.id }, "primers");
  }

  // ---------- several rows ----------

  /** What is selected, as rows: the picks, or the one selected primer Shift extends from. */
  private currentPicks(): Picks {
    if (this.picks.ids.length) return this.picks;
    const f = this.ctx.store.selection.focus;
    return f?.kind === "primer" ? { ids: [f.id], anchor: f.id } : NO_PICKS;
  }

  private pickedPrimers(): SeqPrimer[] {
    const d = this.ctx.store.data;
    return this.picks.ids.map(id => d.primers.find(p => p.id === id)).filter((p): p is SeqPrimer => !!p);
  }

  /** Clicking a row: with ⌘ or Ctrl, or Shift, it adds to the selection instead of selecting. */
  private clickRow(e: MouseEvent, p: SeqPrimer) {
    const add = isMac ? e.metaKey : e.ctrlKey;
    if (!add && !e.shiftKey) {
      this.picks = NO_PICKS;
      this.select(p);
      return;
    }
    const rows = this.shownOrder.map(x => x.id);
    this.pick(e.shiftKey ? extendPick(this.currentPicks(), p.id, rows) : togglePick(this.currentPicks(), p.id));
  }

  /** One row left is an ordinary selection; several are the store's rows, which hold none. */
  private pick(p: Picks) {
    this.picks = p;
    const d = this.ctx.store.data;
    const one = p.ids.length === 1 ? d.primers.find(x => x.id === p.ids[0]) : undefined;
    if (one) {
      this.picks = NO_PICKS;
      this.select(one);
    } else if (p.ids.length) {
      // No one primer is selected now, so the inspector shouldn't claim there is one.
      this.picking = true;
      try {
        this.ctx.store.select({ range: null, focus: null }, "primers");
      } finally {
        this.picking = false;
      }
      this.markSelected();
    } else this.markSelected();
  }

  /** Copy, save or delete what is picked, under the list and in a picked row's menu. */
  private pickedActions(): { label: string; run: () => void }[] {
    const list = this.pickedPrimers();
    return [
      { label: "Copy for ordering…", run: () => openOrderDialog(this.ctx, list) },
      { label: "Save to library", run: () => this.saveToLibrary(list) },
      { label: `Delete ${list.length} primers`, run: () => void this.deletePicked(list) }
    ];
  }

  private saveToLibrary(list: SeqPrimer[]) {
    const added = primerLibrary.add(list.map(p => ({ name: p.name, bases: p.bases, notes: "", color: p.color })));
    if (added) toast(`Saved ${added === 1 ? "1 primer" : `${added} primers`} to the lab library.`, "success", 2500);
    else toast("Every one of them is in the lab library already.", "info", 2500);
  }

  private async deletePicked(list: SeqPrimer[]) {
    if (!list.length) return;
    const ok = await confirmDialog(`Delete ${list.length} primers from this file?`, { title: "Delete primers", okLabel: "Delete", kind: "warning" });
    if (!ok) return;
    const d = this.ctx.store.data;
    const ids = new Set(list.map(p => p.id));
    this.picks = NO_PICKS;
    this.ctx.store.apply({ ...d, primers: d.primers.filter(p => !ids.has(p.id)) }, `Delete ${list.length} primers`, { range: null, focus: null });
    toast(`Deleted ${list.length} primers. Undo to bring them back.`, "info", 3000);
  }

  private renderPicked() {
    const n = this.picks.ids.length;
    // Rows are picked in the list, so the bar belongs to it.
    this.picked.hidden = n < 2 || this.listView !== "list";
    if (this.picked.hidden) {
      this.picked.replaceChildren();
      return;
    }
    const shown = new Set(this.shownOrder.map(p => p.id));
    const hidden = this.picks.ids.filter(id => !shown.has(id)).length;
    this.picked.replaceChildren(
      h("span", { class: "sv-small" }, `${n} primers selected${hidden ? ` · ${hidden} hidden by the filter` : ""}`),
      h("span", { class: "sv-push" }),
      ...this.pickedActions().map(a =>
        h("button", { type: "button", class: `sv-btn sv-btn-small${a.label.startsWith("Delete") ? " sv-btn-danger" : ""}`, onclick: a.run }, a.label)
      )
    );
  }

  render() {
    this.stale = false;
    this.renderStrip();
    this.renderBody();
    this.markSelected();
  }

  /** The switch above the table, and whichever of the two tables it chooses. */
  private renderBody() {
    const d = this.ctx.store.data;
    const pairs = this.pairs();
    const button = (v: "list" | "pairs", label: string) =>
      h(
        "button",
        {
          type: "button",
          "aria-pressed": String(this.listView === v),
          onclick: () => {
            if (this.listView === v) return;
            this.listView = v;
            if (v === "pairs") track("primer_pairs_shown");
            this.renderBody();
            this.markSelected();
          }
        },
        label
      );
    this.switcher.replaceChildren(button("list", "List"), button("pairs", pairs.length ? `Pairs ${pairs.length}` : "Pairs"));
    this.filterBox.hidden = !d.primers.length || this.listView !== "list";
    if (this.listView === "pairs") {
      // Copy for ordering and Export list follow the list, which isn't drawn here: keep its
      // order up to date, without the filter, whose box this view hides.
      this.shownOrder = this.listRows(false).map(x => x.primer);
      this.renderPairs(pairs);
    } else this.renderTable();
    this.foot.textContent =
      this.listView === "pairs"
        ? `Forward and reverse primers that face each other. Tm: ${tmLabel()}.`
        : `Lower-case bases are 5′ tails that don't bind. Tm: ${tmLabel()}.`;
  }

  /**
   * Each primer's report, worked out once per document: both tables and the filter read it,
   * and filtering then costs nothing. The alignments behind it are cached in analysis.ts.
   */
  private reports(): Map<string, PrimerReport> {
    const d = this.ctx.store.data;
    if (this.reportCache?.data !== d) {
      this.reportCache = { data: d, map: new Map(d.primers.map(p => [p.id, primerReport(p.bases, primerAlignment(d, p), d.sequence, d.circular, null, p)])) };
    }
    return this.reportCache.map;
  }

  /** What Export list… saves: the rows the list shows, in the order it shows them. */
  private exportRows(): ExportRow[] {
    const reports = this.reports();
    return this.shownOrder.map(p => ({ primer: p, tm: reports.get(p.id)?.tm ?? null }));
  }

  /**
   * The pairs this file's primers make, worked out once per document: the switch needs their
   * number while the list shows, so without this they would be worked out on every render.
   */
  private pairs(): PrimerPair[] {
    const d = this.ctx.store.data;
    if (this.pairCache?.data !== d) {
      this.pairCache = { data: d, pairs: d.primers.length ? primerPairs(this.rows(), d.sequence, d.circular) : [] };
    }
    return this.pairCache.pairs;
  }

  /** Each primer with the Tm the list shows, which the pairs are worked out from. */
  private rows(): { primer: SeqPrimer; tm: number | null }[] {
    const reports = this.reports();
    return this.ctx.store.data.primers.map(p => ({ primer: p, tm: reports.get(p.id)?.tm ?? null }));
  }

  private renderPairs(pairs: PrimerPair[]) {
    const d = this.ctx.store.data;
    this.listNote.textContent = pairs.length ? `${pairs.length === 1 ? "1 pair" : `${pairs.length} pairs`} · click one to see its PCR product` : "";
    if (!pairs.length) {
      this.table.replaceChildren(
        h(
          "div",
          { class: "sv-empty" },
          d.primers.length < 2
            ? "Add at least one forward and one reverse primer to see pairs."
            : "No forward and reverse primers face each other to form a PCR product."
        )
      );
      return;
    }
    const cell = (p: SeqPrimer) => h("td", { class: "sv-td-name" }, primerIcon(p.strand, primerColors(p).color), p.name);
    const body = pairs.map(pair => {
      const apart = pair.tmApart;
      return h(
        "tr",
        {
          title: `${pair.forward.name} and ${pair.reverse.name}: ${fmt(pair.length)} bp`,
          onclick: () => openPcrDialog(this.ctx, { forward: `p:${pair.forward.id}`, reverse: `p:${pair.reverse.id}` })
        },
        cell(pair.forward),
        cell(pair.reverse),
        h("td", { class: "sv-num" }, `${fmt(pair.length)} bp`),
        h(
          "td",
          { class: `sv-num${apart !== null && apart > TM_APART ? " sv-text-warn" : ""}`, title: apart !== null && apart > TM_APART ? `Aim for under ${TM_APART} °C apart` : null },
          apart === null ? "—" : `${apart.toFixed(1)} °C`
        ),
        h("td", { class: "sv-dim sv-mono sv-td-binds" }, `${pair.tmForward === null ? "—" : pair.tmForward.toFixed(1)} / ${pair.tmReverse === null ? "—" : pair.tmReverse.toFixed(1)} °C`)
      );
    });
    const head = [
      h("th", { scope: "col" }, "Forward"),
      h("th", { scope: "col" }, "Reverse"),
      h("th", { scope: "col", class: "sv-num" }, "Product"),
      h("th", { scope: "col", class: "sv-num" }, "Tm apart"),
      h("th", { scope: "col" }, "Tm each")
    ];
    this.table.replaceChildren(h("table", { class: "sv-table sv-primer-table" }, h("thead", null, h("tr", null, head)), h("tbody", null, body)));
  }

  private renderStrip() {
    const d = this.ctx.store.data;
    const n = d.sequence.length || 1;
    const styles = featureStyles(d);
    const pct = (p: number) => `${(p / n) * 100}%`;
    const primers = [...d.primers].sort((a, b) => a.start - b.start);
    const items: HTMLElement[] = [h("div", { class: "sv-bind-line" })];
    for (const f of d.features) {
      const s0 = f.start <= f.end ? f.start : 0;
      const e0 = f.start <= f.end ? f.end : n - 1;
      items.push(h("div", { class: "sv-bind-feature", title: f.name, style: { left: pct(s0), width: pct(e0 - s0 + 1), background: styles.get(f.id)?.fill || "#999" } }));
    }
    // Rows of labels above (forward) and below (reverse) the line, as spans in % of its width.
    const rowsUp: [number, number][][] = [];
    const rowsDown: [number, number][][] = [];
    const labels: { el: HTMLElement; row: number; up: boolean }[] = [];
    for (const p of primers) {
      const x = (p.start / n) * 100;
      // A primer across the origin is labelled where it starts, at the right-hand end.
      const xEnd = p.start <= p.end ? ((p.end + 1) / n) * 100 : 100;
      const w = Math.max(8, p.name.length * 0.9);
      // Near the right end a label is drawn leftwards from the primer's end so it stays inside.
      const leftwards = x + w > 99;
      const [lo, hi] = leftwards ? [xEnd - w, xEnd] : [x, x + w];
      const rows = p.strand === 1 ? rowsUp : rowsDown;
      let r = 0;
      while (rows[r]?.some(([a, b]) => a < hi && lo < b)) r++;
      (rows[r] ??= []).push([lo, hi]);
      const el = h(
        "button",
        {
          type: "button",
          class: `sv-bind-primer sv-bind-${p.strand === 1 ? "up" : "down"}`,
          "data-id": p.id,
          style: leftwards ? { right: `${100 - xEnd}%` } : { left: pct(p.start) },
          title: `${p.name} · ${fmt(p.start + 1)}..${fmt(p.end + 1)}`,
          onclick: () => this.select(p)
        },
        primerIcon(p.strand, primerColors(p).color),
        p.name
      );
      items.push(el);
      labels.push({ el, row: r, up: p.strand === 1 });
    }
    // The line sits below the forward rows; reverse rows go under it.
    const mid = 10 + Math.max(rowsUp.length, 1) * 20;
    for (const { el, row, up } of labels) el.style.top = `${up ? mid - 26 - row * 20 : mid + 8 + row * 20}px`;
    this.strip.style.height = `${mid + 22 + Math.max(rowsDown.length, 1) * 20}px`;
    this.strip.style.setProperty("--mid", `${mid}px`);
    this.strip.replaceChildren(...items, h("div", { class: "sv-bind-ends sv-mono" }, h("span", null, "1"), h("span", null, fmt(n))));
    this.renderWindowBox();
  }

  private renderWindowBox() {
    for (const el of Array.from(this.strip.querySelectorAll(".sv-bind-window"))) el.remove();
    const r = this.shown;
    const n = this.ctx.store.data.sequence.length;
    if (!r || !n) return;
    const pct = (p: number) => `${(p / n) * 100}%`;
    const parts = r.start <= r.end ? [[r.start, r.end]] : [[r.start, n - 1], [0, r.end]];
    for (const [a, b] of parts) this.strip.prepend(h("div", { class: "sv-bind-window", style: { left: pct(a), width: pct(b - a + 1) } }));
  }

  /** The list's rows in the order chosen, through the filter when it is showing. */
  private listRows(filtered: boolean): PrimerRow[] {
    const d = this.ctx.store.data;
    const reports = this.reports();
    const shown = filtered && this.filter ? d.primers.filter(p => matchesFilter(p, this.filter)) : d.primers;
    const rows = shown.map(p => {
      const r = reports.get(p.id)!;
      return { primer: p, length: r.length, tm: r.tm, gc: r.gc, warnings: r.checks.filter(c => c.level === "warn").length };
    });
    return sortRows(rows, this.sort);
  }

  private renderTable() {
    const d = this.ctx.store.data;
    const n = d.primers.length;
    this.filterBox.hidden = !n;
    if (!n) {
      this.listNote.textContent = "";
      this.shownOrder = [];
      this.table.replaceChildren(h("div", { class: "sv-empty" }, "No primers yet. Add primers using the buttons above, or select bases on the map or sequence."));
      return;
    }
    const sorted = this.listRows(true);
    this.shownOrder = sorted.map(x => x.primer);
    this.listNote.textContent = this.filter
      ? `${sorted.length} of ${n} ${n === 1 ? "primer" : "primers"}`
      : `${n === 1 ? "1 primer" : `${n} primers`} · click a heading to sort, right-click a primer for more`;
    if (!sorted.length) {
      this.table.replaceChildren(h("div", { class: "sv-empty" }, `No primer matches “${this.filter}”.`));
      return;
    }
    const reports = this.reports();
    // The Notes column goes by the whole document, not what the filter leaves, so it doesn't
    // come and go as the user types; most files have no notes at all.
    const notes = d.primers.some(p => primerNote(p));
    const body = sorted.map(({ primer: p }) => {
      const r = reports.get(p.id)!;
      const warn = r.checks.find(c => c.level === "warn");
      const tail = r.tail;
      const shown = shortTail(tail.toLowerCase());
      return h(
        "tr",
        {
          "data-id": p.id,
          onclick: (e: MouseEvent) => this.clickRow(e, p),
          oncontextmenu: (e: MouseEvent) => {
            e.preventDefault();
            // Right-clicking one of several picked rows offers what the selection can do;
            // any other row becomes the selection and gets the primer's own menu.
            if (this.picks.ids.length > 1 && this.picks.ids.includes(p.id)) {
              void showContextMenu(this.pickedActions(), { x: e.clientX, y: e.clientY });
              return;
            }
            this.picks = NO_PICKS;
            this.select(p);
            this.ctx.contextMenu({ kind: "primer", id: p.id }, { x: e.clientX, y: e.clientY });
          }
        },
        h(
          "td",
          { class: "sv-td-name" },
          h(
            "button",
            {
              type: "button",
              class: "sv-link-plain",
              onclick: (e: MouseEvent) => {
                e.stopPropagation();
                this.clickRow(e, p);
              }
            },
            primerIcon(p.strand, primerColors(p).color),
            p.name
          )
        ),
        h("td", { class: "sv-dim" }, p.strand === 1 ? "Forward" : "Reverse"),
        h(
          "td",
          { class: "sv-mono sv-td-seq", title: shown !== tail.toLowerCase() ? `${tail.toLowerCase()}${p.bases.slice(tail.length)}` : null },
          h("div", { class: "sv-td-seq-text" }, tail ? h("span", { class: "sv-dim" }, shown) : null, p.bases.slice(tail.length))
        ),
        h("td", { class: "sv-num" }, String(r.length)),
        h("td", { class: `sv-num${warn && /Tm/.test(warn.short) ? " sv-text-warn" : ""}` }, r.tm === null ? "—" : `${r.tm.toFixed(1)} °C`),
        h("td", { class: "sv-num sv-col-gc" }, `${r.gc.toFixed(0)}%`),
        h("td", { class: "sv-mono sv-dim sv-td-binds" }, where(p)),
        h("td", null, warn ? h("span", { class: "sv-pill sv-pill-warn", title: warn.text }, warn.short) : h("span", { class: "sv-text-ok" }, "All good")),
        notes ? noteCell(primerNote(p)) : null
      );
    });
    const columns: { label: string; key?: SortKey; cls?: string }[] = [
      { label: "Name", key: "name" },
      { label: "Direction", key: "direction" },
      { label: "Sequence 5′→3′" },
      { label: "Length", key: "length", cls: "sv-num" },
      { label: "Tm", key: "tm", cls: "sv-num" },
      { label: "GC", key: "gc", cls: "sv-num sv-col-gc" },
      { label: "Binds", key: "binds" },
      { label: "Checks", key: "checks" },
      ...(notes ? [{ label: "Notes", cls: "sv-td-notes" }] : [])
    ];
    const head = columns.map(c => {
      if (!c.key) return h("th", { scope: "col", class: c.cls }, c.label);
      const key = c.key;
      const on = this.sort.key === key;
      return h(
        "th",
        { scope: "col", class: `${c.cls ?? ""} sv-th-sort`, "aria-sort": on ? (this.sort.descending ? "descending" : "ascending") : null },
        h(
          "button",
          {
            type: "button",
            class: `sv-sort${on ? " sv-sort-on" : ""}`,
            title: `Sort by ${c.label.toLowerCase()}`,
            onclick: () => {
              this.sort = nextSort(this.sort, key);
              saveSort(this.sort);
              this.renderTable();
              this.markSelected();
            }
          },
          c.label,
          h("span", { class: "sv-sort-mark", "aria-hidden": "true" }, on ? (this.sort.descending ? "↓" : "↑") : "")
        )
      );
    });
    this.table.replaceChildren(h("table", { class: "sv-table sv-primer-table" }, h("thead", null, h("tr", null, head)), h("tbody", null, body)));
  }

  private markSelected() {
    const f = this.ctx.store.selection.focus;
    const many = this.picks.ids.length > 1;
    for (const el of Array.from(this.el.querySelectorAll<HTMLElement>("tr[data-id], .sv-bind-primer"))) {
      const id = el.dataset.id || "";
      el.classList.toggle("sv-selected", many ? this.picks.ids.includes(id) : f?.kind === "primer" && id === f.id);
    }
    this.renderPicked();
  }
}
