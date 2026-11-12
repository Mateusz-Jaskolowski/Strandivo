// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The Reads tab's alignment: ruler, features, translation and reference on top, then each
// read with its trace, quality bars and bases. Drawn on canvases, and only the columns in
// view, so long alignments scroll smoothly. The top part has its own canvas and stays in
// place while the reads scroll under it, unless it would take too much of a short pane.

import { h } from "../ui/dom.ts";
import { codons, featureStyles, isCds, orfFeature, orfs } from "../doc/analysis.ts";
import type { DocContext } from "../doc/context.ts";
import { selectedRanges } from "../lib/selection.ts";
import { firstAtOrAfter, refPosAtColumn, stackInLanes, type AlignedTrack, type AlignmentLayout } from "../lib/alignLayout.ts";
import { peakRatios } from "../lib/chromatogram.ts";
import { continuesFrame, frameChains } from "../lib/genetics.ts";
import { DOUBLE_PEAK } from "../lib/mixes.ts";
import { indelColumns, translateTrack, type ReadFrame, type ReadTranslation } from "../lib/readTranslation.ts";
import type { SeqFeature } from "../lib/seqdata.ts";
import type { Chromatogram, Difference, ReadResult } from "../lib/types.ts";
import { designOf } from "../lib/variable.ts";
import { fmt } from "../ui/format.ts";

/** Column width in px. */
export const COLUMN = 12;
const RULER_H = 22;
const LANE_H = 18;
const AA_H = 18;
const REF_H = 20;
const TRACE_H = 64;
const QUAL_H = 12;
const BASES_H = 18;
const GAP = 12;
const MIN_TRACK_H = 38;
/** Pixels in a line of wheel scrolling, for browsers that count in lines. */
const WHEEL_LINE = 16;
/** The reference stays at the top while it takes no more than this share of the pane. */
const PIN_SHARE = 0.4;

const TRACE_KEYS = [
  ["A", "aTrace"],
  ["C", "cTrace"],
  ["G", "gTrace"],
  ["T", "tTrace"]
] as const;

export interface TrackLabel {
  title: string;
  sub: string;
}

export interface TraceOptions {
  traces: boolean;
  quality: boolean;
  translation: boolean;
}

/** What a read's clone says about translating it. */
export interface CloneCalls {
  /** Its confident insertions and deletions. */
  indels: Difference[];
  /** Its frameshifts, one per frame at most. */
  frameshifts: { feature: string | null; refPos: number; label: string }[];
}

/** A frame of the translation, with the features it reads through. */
interface LaidOutFrame {
  names: string[];
  lane: number;
  frame: ReadFrame;
}

interface TrackRow {
  track: AlignedTrack;
  top: number;
  traceY: number;
  qualY: number;
  baseY: number;
  bottom: number;
  hasTrace: boolean;
  hasQual: boolean;
  /** The read's translation in each frame that reaches it, a line each. */
  translations: { y: number; forward: boolean; translation: ReadTranslation }[];
  /** Per column of the track's span: 0 = same as reference, 1 = uncertain difference, 2 = difference. */
  flags: Uint8Array;
}

interface FeatureBar {
  name: string;
  c0: number;
  c1: number;
  lane: number;
  fill: string;
  text: string;
  /** Arrow at the right (1) or left (-1) end of this piece, or none. */
  arrow: 1 | -1 | 0;
}

interface CodonMark {
  c0: number;
  c1: number;
  cm: number;
  aa: string;
  odd: boolean;
  /** Line of the translation: overlapping frames take one each. */
  lane: number;
}

export interface TraceViewCallbacks {
  /** Clicking a read's row or name. */
  activate(result: number): void;
  /** Right-clicking a read's name. */
  menu(result: number, e: MouseEvent): void;
  /** `orf`: a selected ORF being read, which isn't one of the file's features. */
  cloneCalls(result: number, orf: SeqFeature | null): CloneCalls;
  /** Tells whether reference positions are in variable regions. */
  variableCheck(): (position: number) => boolean;
  active(): number | null;
  minQuality(): number;
  /** The visible columns changed (scrolling or resizing). */
  viewChanged(): void;
}


export class TraceView {
  readonly el: HTMLElement;
  private body: HTMLElement;
  /** Ruler, features, translation and reference: their names and their canvas. */
  private head: HTMLElement;
  private headNames: HTMLElement;
  private headCanvas: HTMLCanvasElement;
  private names: HTMLElement;
  private scroller: HTMLElement;
  private spacer: HTMLElement;
  /** Scroll bar kept in view under the rows, standing in for the scroller's own. */
  private foot: HTMLElement;
  private bar: HTMLElement;
  private barSpacer: HTMLElement;
  private canvas: HTMLCanvasElement;
  private note: HTMLElement;
  private ctx: DocContext;
  private cb: TraceViewCallbacks;
  private layout: AlignmentLayout | null = null;
  private results: ReadResult[] = [];
  private labels: TrackLabel[] = [];
  private options: TraceOptions;
  private rows: TrackRow[] = [];
  private bars: FeatureBar[] = [];
  /** The ORF last built for, to tell when another gets selected. */
  private orfId: string | undefined;
  private codonMarks: CodonMark[] = [];
  private aaLanes = 0;
  private lanes = 0;
  private yFeatures = 0;
  private yAa = -1;
  private yRef = 0;
  /** Height of the top part; the reads' canvas and names start below it. */
  private headH = 0;
  private height = 0;
  private frame = 0;
  private visible = false;
  /** Columns outlined as the current difference. */
  private mark: { c0: number; c1: number } | null = null;
  private ratioCache = new WeakMap<Chromatogram, Float32Array>();

  constructor(ctx: DocContext, options: TraceOptions, cb: TraceViewCallbacks) {
    this.ctx = ctx;
    this.cb = cb;
    this.options = options;
    this.headNames = h("div", { class: "sv-aln-names sv-aln-head-names" });
    this.headCanvas = h("canvas", { class: "sv-aln-head-canvas" }) as HTMLCanvasElement;
    this.head = h("div", { class: "sv-aln-head" }, this.headNames, h("div", { class: "sv-aln-head-track" }, this.headCanvas));
    this.names = h("div", { class: "sv-aln-names" });
    this.canvas = h("canvas", { class: "sv-aln-canvas" }) as HTMLCanvasElement;
    this.spacer = h("div", { class: "sv-aln-spacer" }, this.canvas);
    this.scroller = h("div", { class: "sv-aln-scroll" }, this.spacer);
    this.note = h("div", { class: "sv-empty sv-aln-note", hidden: true });
    this.body = h("div", { class: "sv-aln-body" }, this.head, h("div", { class: "sv-aln-inner" }, this.names, this.scroller));
    this.barSpacer = h("div", { class: "sv-aln-bar-spacer" });
    this.bar = h("div", { class: "sv-aln-bar" }, this.barSpacer);
    this.foot = h("div", { class: "sv-aln-foot", hidden: true }, this.bar);
    this.el = h("div", { class: "sv-aln" }, this.note, this.body, this.foot);

    this.scroller.addEventListener("scroll", () => {
      this.bar.scrollLeft = this.scroller.scrollLeft;
      this.requestDraw();
      this.cb.viewChanged();
    });
    this.bar.addEventListener("scroll", () => {
      this.scroller.scrollLeft = this.bar.scrollLeft;
    });
    new ResizeObserver(() => {
      this.fitBar();
      this.requestDraw();
      this.cb.viewChanged();
    }).observe(this.scroller);
    // The whole view, not the part that scrolls: showing the scroll bar under the rows
    // (in the observer above) changes that part's height while observers run, which
    // WebKit reports as an error.
    new ResizeObserver(() => this.pin()).observe(this.el);
    // A shadow under the reference once reads pass under it.
    this.body.addEventListener("scroll", () => this.head.classList.toggle("sv-aln-head-over", this.body.scrollTop > 0), { passive: true });
    ctx.store.subscribe(c => {
      if (!c.selection) return;
      if (this.visible && this.layout && this.selectedOrf()?.id !== this.orfId) this.build();
      this.requestDraw();
    });
    this.installPointer();
    this.installWheel();
  }

  setVisible(v: boolean) {
    this.visible = v;
    if (v && this.layout && this.selectedOrf()?.id !== this.orfId) this.build();
    if (v) this.requestDraw();
  }

  setOptions(o: TraceOptions) {
    this.options = o;
    this.build();
  }

  /** New alignment (or none, with an optional message). */
  setData(layout: AlignmentLayout | null, results: ReadResult[], labels: TrackLabel[], message = "") {
    this.layout = layout;
    this.results = results;
    this.labels = labels;
    this.mark = null;
    this.note.hidden = !!layout || !message;
    this.note.textContent = message;
    this.body.hidden = !layout;
    this.el.dataset.columns = String(layout?.length ?? 0);
    this.build();
  }

  /** Re-labels the read rows (e.g. the active read changed). */
  setLabels(labels: TrackLabel[]) {
    this.labels = labels;
    this.buildNames();
    this.requestDraw();
  }

  get columns() {
    return this.layout?.length ?? 0;
  }

  /** First and last column in view. */
  visibleColumns(): [number, number] {
    const w = this.scroller.clientWidth;
    const sx = this.scroller.scrollLeft;
    const n = this.layout?.length ?? 0;
    return [Math.max(0, Math.floor(sx / COLUMN)), Math.max(0, Math.min(n - 1, Math.ceil((sx + w) / COLUMN) - 1))];
  }

  /** Scrolls so `column` is near the left edge, or in the middle. */
  scrollToColumn(column: number, mode: "start" | "center" = "start") {
    const w = this.scroller.clientWidth;
    const x = column * COLUMN - (mode === "center" ? w / 2 : Math.min(48, w * 0.1));
    this.scroller.scrollLeft = Math.max(0, x);
    this.requestDraw();
  }

  /** Scrolls to a range of columns and outlines it. */
  showColumns(c0: number, c1: number, result?: number) {
    this.mark = { c0, c1 };
    const w = this.scroller.clientWidth;
    const mid = ((c0 + c1 + 1) / 2) * COLUMN;
    this.scroller.scrollLeft = Math.max(0, mid - w / 2);
    if (result !== undefined) this.revealTrack(result);
    this.requestDraw();
  }

  /** Scrolls a read's row into view vertically. */
  revealTrack(result: number) {
    const row = this.rows.find(r => r.track.result === result);
    if (!row) return;
    const b = this.body;
    // Rows pass under the reference while it is pinned.
    const top = row.top - (this.pinned() ? this.headH : 0);
    if (top < b.scrollTop) b.scrollTop = Math.max(0, top - 8);
    else if (row.bottom > b.scrollTop + b.clientHeight) b.scrollTop = row.bottom - b.clientHeight + 8;
  }

  /** Column range of reference positions [start, end]. */
  columnsOf(start: number, end: number): [number, number] | null {
    const L = this.layout;
    if (!L) return null;
    return [L.columnOf[start], L.columnOf[Math.min(end, L.columnOf.length - 2)]];
  }

  // ---------- layout ----------

  /** An ORF selected on the map or in the sequence, as a coding feature. */
  private selectedOrf(): SeqFeature | null {
    const focus = this.ctx.store.selection.focus;
    if (focus?.kind !== "orf") return null;
    const orf = orfs(this.ctx.store.data, this.ctx.options.orfOptions).find(o => o.id === focus.id);
    return orf ? orfFeature(orf) : null;
  }

  /**
   * Coding features, and variable regions that carry on their frame. Features that run on
   * into one another are one frame, as a read's indel at their seam or a frameshift in one
   * of them doesn't stop at its end. Only frames that overlap take a line each.
   */
  private frames(): LaidOutFrame[] {
    const L = this.layout!;
    const d = this.ctx.store.data;
    const orf = this.selectedOrf();
    this.orfId = orf?.id;
    this.codonMarks = [];
    this.aaLanes = 0;
    if (d.sequence.length !== L.columnOf.length - 1) return [];
    const coding = d.features.filter(isCds);
    const regions = d.features.filter(f => !isCds(f) && designOf(f.notes) && continuesFrame(f, coding));
    const found = [...frameChains([...coding, ...regions], d.sequence, d.circular), ...(orf ? [[orf]] : [])]
      .map(chain => {
        const lists = chain.map(f => codons(f, d.sequence));
        return { chain, lists, marks: lists.flat().filter(c => c.lo <= c.hi) }; // those across the origin aren't drawn
      })
      .filter(x => x.marks.length);
    const { lanes, count } = stackInLanes(found.map(({ marks }) => ({ c0: Math.min(...marks.map(c => L.columnOf[c.lo])), c1: Math.max(...marks.map(c => L.columnOf[c.hi])) })));
    this.aaLanes = count;
    const out = found.map(({ chain, lists }, i) => {
      const forward = chain[0].strand !== -1;
      const lane = lanes[i];
      let before = 0;
      for (const list of lists) {
        for (const c of list) if (c.lo <= c.hi) this.codonMarks.push({ c0: L.columnOf[c.lo], c1: L.columnOf[c.hi], cm: L.columnOf[c.mid], aa: c.aa, odd: (before + c.index) % 2 === 1, lane });
        before += list.length;
      }
      const positions = lists.flat().flatMap(c => (forward ? [c.lo, c.mid, c.hi] : [c.hi, c.mid, c.lo]));
      return { names: chain.map(f => f.name || "CDS"), lane, frame: { name: chain[0].name || "CDS", forward, positions } };
    });
    this.codonMarks.sort((a, b) => a.c0 - b.c0);
    return out;
  }

  /** The read's line for each frame that has something to show for it. */
  private translationsOf(track: AlignedTrack, frames: LaidOutFrame[], y: number): TrackRow["translations"] {
    const L = this.layout!;
    if (!this.options.translation) return [];
    const calls = this.cb.cloneCalls(track.result, this.selectedOrf());
    const confirmed = indelColumns(calls.indels, L);
    const variable = this.cb.variableCheck();
    const out: { lane: number; forward: boolean; translation: ReadTranslation }[] = [];
    for (const { names, lane, frame } of frames) {
      const shift = calls.frameshifts.find(m => m.feature !== null && names.includes(m.feature) && frame.positions.includes(m.refPos));
      const t = translateTrack(track, L, frame, { minQuality: this.cb.minQuality(), confirmed, frameshift: shift ? { refPos: shift.refPos, label: shift.label } : null, variable });
      if (t.codons.length || t.stop || t.uncertain.length) out.push({ lane, forward: frame.forward, translation: t });
    }
    const lanes = [...new Set(out.map(x => x.lane))].sort((a, b) => a - b);
    return out.map(x => ({ y: y + lanes.indexOf(x.lane) * AA_H, forward: x.forward, translation: x.translation }));
  }

  private build() {
    const L = this.layout;
    this.rows = [];
    this.bars = [];
    this.codonMarks = [];
    if (!L) {
      this.names.replaceChildren();
      this.headNames.replaceChildren();
      return;
    }
    const d = this.ctx.store.data;
    const n = d.sequence.length;
    const styles = featureStyles(d);

    // Features, split at the origin, stacked in lanes.
    const pieces: Omit<FeatureBar, "lane">[] = [];
    for (const f of d.features) {
      const st = styles.get(f.id);
      const base = { name: f.name, fill: st?.fill || "#A3A9B4", text: st?.text || "#1A1D23" };
      const endArrow = f.strand === 1 ? 1 : 0;
      const startArrow = f.strand === -1 ? -1 : 0;
      if (f.start <= f.end) {
        pieces.push({ ...base, c0: L.columnOf[f.start], c1: L.columnOf[f.end], arrow: (endArrow || startArrow) as 1 | -1 | 0 });
      } else {
        pieces.push({ ...base, c0: L.columnOf[f.start], c1: L.columnOf[n] - 1, arrow: startArrow as -1 | 0 });
        pieces.push({ ...base, c0: 0, c1: L.columnOf[f.end], arrow: endArrow as 1 | 0 });
      }
    }
    const { lanes, count } = stackInLanes(pieces);
    pieces.forEach((p, i) => this.bars.push({ ...p, lane: lanes[i] }));
    this.lanes = count;

    // Codons of coding features.
    const frames = this.frames();

    // Rows.
    let y = RULER_H;
    this.yFeatures = y;
    y += this.lanes * LANE_H + (this.lanes ? 4 : 0);
    this.yAa = this.codonMarks.length ? y : -1;
    y += this.aaLanes * AA_H;
    this.yRef = y;
    y += REF_H;
    // Its last pixel is the line under the reference.
    this.headH = y + 1;
    const minQ = this.cb.minQuality();
    for (const track of L.tracks) {
      const top = y + GAP;
      const hasTrace = this.options.traces && !!track.chromatogram;
      const hasQual = this.options.quality && !!track.qualities;
      const traceY = top;
      const qualY = traceY + (hasTrace ? TRACE_H : 0);
      // Rows without a trace still need room for the read's name.
      const baseY = Math.max(qualY + (hasQual ? QUAL_H + 2 : 0), top + MIN_TRACK_H - BASES_H);
      const translations = this.translationsOf(track, frames, baseY + BASES_H);
      const bottom = baseY + BASES_H + Math.max(0, ...translations.map(x => x.y - baseY - BASES_H + AA_H));
      this.rows.push({ track, top, traceY, qualY, baseY, bottom, hasTrace, hasQual, translations, flags: this.flagsFor(track, minQ) });
      y = bottom;
    }
    this.height = y + 14;
    this.spacer.style.width = `${L.length * COLUMN}px`;
    this.spacer.style.height = `${this.height - this.headH}px`;
    this.names.style.height = `${this.height - this.headH}px`;
    this.headNames.style.height = `${this.headH}px`;
    this.buildNames();
    this.pin();
    this.fitBar();
    this.requestDraw();
  }

  /** Keeps the reference at the top while the reads scroll, if the pane has room for both. */
  private pin() {
    this.head.classList.toggle("sv-aln-head-pinned", this.headH <= this.body.clientHeight * PIN_SHARE);
  }

  private pinned() {
    return this.head.classList.contains("sv-aln-head-pinned");
  }

  /** Shows the bar when the alignment is wider than its pane, lined up with the traces. */
  private fitBar() {
    const s = this.scroller;
    this.foot.hidden = !this.layout || s.scrollWidth <= s.clientWidth;
    this.foot.style.paddingRight = `${this.body.offsetWidth - this.body.clientWidth}px`;
    this.barSpacer.style.width = `${s.scrollWidth}px`;
    this.bar.scrollLeft = s.scrollLeft;
    // The bar takes room from the rows. Pinning changes no size, so no observer runs again.
    this.pin();
  }

  /** Marks the columns where the read differs from the reference. */
  private flagsFor(track: AlignedTrack, minQ: number): Uint8Array {
    const L = this.layout!;
    const flags = new Uint8Array(L.length);
    const r = this.results[track.result];
    const inSpan = (c: number) => c >= track.firstColumn && c <= track.lastColumn;
    for (const d of r?.differences ?? []) {
      const level = d.confident || (d.quality ?? 99) >= minQ ? 2 : 1;
      let c0: number;
      let c1: number;
      if (d.kind === "insertion") {
        c0 = d.refPos > 0 ? L.columnOf[d.refPos - 1] + 1 : 0;
        c1 = L.columnOf[d.refPos] - 1;
      } else {
        c0 = L.columnOf[d.refPos];
        c1 = L.columnOf[Math.min(d.refPos + d.refBases.length - 1, L.columnOf.length - 2)];
      }
      for (let c = c0; c <= c1; c++) if (inSpan(c) && (track.row[c] !== "-" || L.reference[c] !== "-")) flags[c] = Math.max(flags[c], level);
    }
    return flags;
  }

  private buildNames() {
    const label = (top: number, height: number, ...children: (Node | string)[]) =>
      h("div", { class: "sv-aln-name", style: { top: `${top}px`, height: `${height}px` } }, ...children);
    const heads: Node[] = [];
    if (this.lanes) heads.push(label(this.yFeatures, this.lanes * LANE_H, h("span", { class: "sv-aln-name-sub" }, "Features")));
    if (this.yAa >= 0) heads.push(label(this.yAa, this.aaLanes * AA_H, h("span", { class: "sv-aln-name-sub" }, "Translation")));
    heads.push(label(this.yRef, REF_H, h("span", { class: "sv-aln-name-title" }, this.ctx.store.data.name || "Reference")));
    this.headNames.replaceChildren(...heads);
    const items: Node[] = [];
    const active = this.cb.active();
    this.rows.forEach((row, i) => {
      const l = this.labels[i] || { title: "", sub: "" };
      const el = h(
        "button",
        {
          type: "button",
          class: `sv-aln-name sv-aln-read${row.track.result === active ? " sv-active" : ""}`,
          style: { top: `${row.top - this.headH}px`, height: `${row.bottom - row.top}px` },
          title: "Show this read's details",
          onclick: () => this.cb.activate(row.track.result),
          oncontextmenu: (e: MouseEvent) => this.cb.menu(row.track.result, e)
        },
        h("span", { class: "sv-aln-name-title" }, l.title),
        h("span", { class: "sv-aln-name-sub" }, l.sub)
      );
      items.push(el);
    });
    this.names.replaceChildren(...items);
  }

  // ---------- drawing ----------

  private requestDraw() {
    if (this.frame || !this.visible) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private colors() {
    const cs = getComputedStyle(this.el);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    return {
      text: v("--text", "#15181e"),
      text2: v("--text-2", "#485060"),
      text3: v("--text-3", "#5f6776"),
      line: v("--line", "#e1e4e9"),
      line2: v("--line-2", "#d2d6dd"),
      stripe: v("--stripe", "rgba(21,24,30,.045)"),
      accent: v("--accent", "#3557d6"),
      accentSoft: v("--accent-soft", "rgba(53,87,214,.12)"),
      diff: v("--diff", "#b4410e"),
      diffSoft: v("--diff-soft", "rgba(234,88,12,.15)"),
      warn: v("--warn", "#a85b00"),
      warnSoft: v("--warn-soft", "rgba(217,119,6,.13)"),
      bad: v("--bad", "#c33b32"),
      badSoft: v("--bad-soft", "rgba(195,59,50,.1)"),
      mono: v("--mono", "monospace"),
      sans: v("--sans", "sans-serif"),
      trace: { A: "#1f9d55", C: "#2563eb", G: v("--text", "#15181e"), T: "#dc2626" } as Record<string, string>
    };
  }

  private draw() {
    const L = this.layout;
    const w = this.scroller.clientWidth;
    if (!L || w < 10) return;
    const col = this.colors();
    const sx = this.scroller.scrollLeft;
    const c0 = Math.max(0, Math.floor(sx / COLUMN) - 1);
    const c1 = Math.min(L.length - 1, Math.ceil((sx + w) / COLUMN) + 1);
    const X = (c: number) => c * COLUMN - sx;
    const head = this.canvasFor(this.headCanvas, w, 0, this.headH);
    if (head) {
      this.drawSelection(head, L, X, w, col);
      this.drawHead(head, L, c0, c1, X, w, col);
      this.drawMark(head, c0, c1, X, col);
    }
    const g = this.canvasFor(this.canvas, w, this.headH, this.height);
    if (!g) return;
    this.drawSelection(g, L, X, w, col);

    // Reads.
    const minQ = this.cb.minQuality();
    const active = this.cb.active();
    let tracesDrawn = 0;
    let doublePeaks = 0;
    let readCodons = 0;
    for (const row of this.rows) {
      const t = row.track;
      const a = Math.max(c0, t.firstColumn);
      const z = Math.min(c1, t.lastColumn);
      if (row.track.result === active) {
        g.fillStyle = col.stripe;
        g.fillRect(0, row.top - GAP / 2, w, row.bottom - row.top + GAP / 2 + 4);
      }
      if (a > z) continue;
      // Differences.
      for (let c = a; c <= z; c++) {
        if (!row.flags[c]) continue;
        g.fillStyle = row.flags[c] === 2 ? col.diffSoft : col.warnSoft;
        g.fillRect(X(c), row.top - 2, COLUMN, row.bottom - row.top + 4);
      }
      if (row.hasTrace && t.chromatogram) {
        if (this.drawTrace(g, row, t.chromatogram, c0, c1, X, col.trace)) tracesDrawn++;
        // Double peaks: a tick above each, where two plasmids (or a noisy read) differ.
        const ratios = this.ratios(t.chromatogram);
        const k0 = firstAtOrAfter(t.baseColumns, a);
        const k1 = firstAtOrAfter(t.baseColumns, z + 1);
        g.fillStyle = col.warn;
        for (let k = k0; k < k1; k++) {
          if (ratios[t.baseIndex[k]] < DOUBLE_PEAK) continue;
          g.fillRect(X(t.baseColumns[k]) + 3, row.traceY - 4, COLUMN - 6, 3);
          doublePeaks++;
        }
      }
      if (row.hasQual && t.qualities) {
        const k0 = firstAtOrAfter(t.baseColumns, a);
        const k1 = firstAtOrAfter(t.baseColumns, z + 1);
        for (let k = k0; k < k1; k++) {
          const q = t.qualities[t.baseIndex[k]] ?? 0;
          const bh = (Math.min(q, 60) / 60) * QUAL_H;
          g.fillStyle = q < minQ ? col.warn : col.line2;
          g.fillRect(X(t.baseColumns[k]) + 2, row.qualY + QUAL_H - bh, COLUMN - 4, bh);
        }
      }
      g.font = `500 12px ${col.mono}`;
      for (let c = a; c <= z; c++) {
        const b = t.row[c];
        const ref = L.reference[c];
        const differs = b.toUpperCase() !== ref.toUpperCase();
        g.fillStyle = b === "-" ? col.text3 : differs ? col.diff : col.text2;
        g.fillText(b === "-" ? "-" : b.toUpperCase(), X(c) + COLUMN / 2, row.baseY + BASES_H / 2 + 0.5);
      }
      for (const line of row.translations) {
        this.drawTranslation(g, line, c0, c1, X, col);
        readCodons += line.translation.codons.length;
      }
    }

    this.drawMark(g, c0, c1, X, col);
    this.el.dataset.traces = String(tracesDrawn);
    this.el.dataset.doublePeaks = String(doublePeaks);
    this.el.dataset.readCodons = String(readCodons);
  }

  /**
   * Sizes a canvas to rows `top` to `bottom` of the layout and sets it up so the same
   * coordinates work in both canvases.
   */
  private canvasFor(canvas: HTMLCanvasElement, w: number, top: number, bottom: number): CanvasRenderingContext2D | null {
    const height = bottom - top;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(w * dpr);
    const ch = Math.round(height * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${height}px`;
    }
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.setTransform(dpr, 0, 0, dpr, 0, -top * dpr);
    g.clearRect(0, top, w, height);
    g.textAlign = "center";
    g.textBaseline = "middle";
    return g;
  }

  /** Selection from the document (shared with the map and sequence). */
  private drawSelection(g: CanvasRenderingContext2D, L: AlignmentLayout, X: (c: number) => number, w: number, col: ReturnType<TraceView["colors"]>) {
    const n = this.ctx.store.data.sequence.length;
    const { caret } = this.ctx.store.selection;
    const ranges = selectedRanges(this.ctx.store.selection);
    for (const range of n === L.columnOf.length - 1 ? ranges : []) {
      const parts = range.start <= range.end ? [[range.start, range.end]] : [[range.start, n - 1], [0, range.end]];
      g.fillStyle = col.accentSoft;
      for (const [a, b] of parts) {
        const x0 = X(L.columnOf[a]);
        const x1 = X(L.columnOf[b] + 1);
        if (x1 > 0 && x0 < w) g.fillRect(x0, 0, x1 - x0, this.height);
      }
    }
    if (!ranges.length && caret >= 0 && caret <= n && n === L.columnOf.length - 1) {
      const x = Math.round(X(L.columnOf[caret])) + 0.5;
      g.strokeStyle = col.accent;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, this.height);
      g.stroke();
    }

  }

  /** Ruler, features, translation and reference. */
  private drawHead(g: CanvasRenderingContext2D, L: AlignmentLayout, c0: number, c1: number, X: (c: number) => number, w: number, col: ReturnType<TraceView["colors"]>) {
    // Ruler: a number every ten reference bases.
    g.font = `10px ${col.mono}`;
    g.fillStyle = col.text3;
    g.lineWidth = 1;
    g.beginPath();
    for (let c = c0; c <= c1; c++) {
      const p = L.refAt[c];
      if (p < 0 || (p + 1) % 10 !== 0) continue;
      const x = Math.round(X(c) + COLUMN / 2) + 0.5;
      g.moveTo(x, RULER_H - 6);
      g.lineTo(x, RULER_H - 1);
      g.fillText(fmt(p + 1), x, 8);
    }
    g.strokeStyle = col.line2;
    g.stroke();

    // Features.
    g.font = `500 10.5px ${col.sans}`;
    for (const b of this.bars) {
      if (b.c1 < c0 || b.c0 > c1) continue;
      const y = this.yFeatures + b.lane * LANE_H + 3;
      const x0 = X(b.c0) + 0.5;
      const x1 = X(b.c1 + 1) - 0.5;
      const bh = LANE_H - 6;
      g.fillStyle = b.fill;
      g.beginPath();
      const tip = 5;
      if (b.arrow === 1) {
        g.moveTo(x0, y);
        g.lineTo(Math.max(x0, x1 - tip), y);
        g.lineTo(x1, y + bh / 2);
        g.lineTo(Math.max(x0, x1 - tip), y + bh);
        g.lineTo(x0, y + bh);
      } else if (b.arrow === -1) {
        g.moveTo(x1, y);
        g.lineTo(Math.min(x1, x0 + tip), y);
        g.lineTo(x0, y + bh / 2);
        g.lineTo(Math.min(x1, x0 + tip), y + bh);
        g.lineTo(x1, y + bh);
      } else g.rect(x0, y, x1 - x0, bh);
      g.closePath();
      g.fill();
      // The name stays readable while the bar scrolls past.
      const left = Math.max(x0 + 6, 6);
      const room = x1 - left - 8;
      if (room > 24) {
        g.save();
        g.beginPath();
        g.rect(x0, y, x1 - x0, bh);
        g.clip();
        g.fillStyle = b.text;
        g.textAlign = "left";
        g.fillText(b.name, left, y + bh / 2 + 0.5);
        g.restore();
      }
    }
    g.textAlign = "center";

    // Translation.
    if (this.yAa >= 0) {
      g.font = `600 11px ${col.mono}`;
      let k = 0;
      while (k < this.codonMarks.length && this.codonMarks[k].c1 < c0) k++;
      for (; k < this.codonMarks.length && this.codonMarks[k].c0 <= c1; k++) {
        const m = this.codonMarks[k];
        const y = this.yAa + m.lane * AA_H;
        if (m.odd) {
          g.fillStyle = col.stripe;
          g.fillRect(X(m.c0), y + 2, X(m.c1 + 1) - X(m.c0), AA_H - 4);
        }
        g.fillStyle = col.text2;
        g.fillText(m.aa, X(m.cm) + COLUMN / 2, y + AA_H / 2 + 0.5);
      }
    }

    // Reference.
    g.font = `500 12px ${col.mono}`;
    for (let c = c0; c <= c1; c++) {
      const b = L.reference[c];
      g.fillStyle = b === "-" ? col.text3 : col.text;
      g.fillText(b === "-" ? "-" : b.toUpperCase(), X(c) + COLUMN / 2, this.yRef + REF_H / 2 + 0.5);
    }
    g.strokeStyle = col.line;
    g.beginPath();
    g.moveTo(0, this.yRef + REF_H + 0.5);
    g.lineTo(w, this.yRef + REF_H + 0.5);
    g.stroke();

  }

  /** The difference being looked at. */
  private drawMark(g: CanvasRenderingContext2D, c0: number, c1: number, X: (c: number) => number, col: ReturnType<TraceView["colors"]>) {
    if (this.mark && this.mark.c1 >= c0 && this.mark.c0 <= c1) {
      g.strokeStyle = col.diff;
      g.lineWidth = 1.5;
      const x0 = X(this.mark.c0) - 1;
      g.strokeRect(Math.round(x0) + 0.5, this.yRef - 1.5, (this.mark.c1 - this.mark.c0 + 1) * COLUMN + 2, this.height - this.yRef - 10);
    }
  }

  /** A read's line of amino acids, and the mark where its frame is lost. */
  private drawTranslation(g: CanvasRenderingContext2D, line: TrackRow["translations"][number], c0: number, c1: number, X: (c: number) => number, col: ReturnType<TraceView["colors"]>) {
    const { y, translation } = line;
    g.font = `600 11px ${col.mono}`;
    for (const m of translation.codons) {
      if (m.c1 < c0 || m.c0 > c1) continue;
      if (m.state === "differs") {
        g.fillStyle = col.diffSoft;
        g.fillRect(X(m.c0), y + 2, X(m.c1 + 1) - X(m.c0), AA_H - 4);
      } else if (m.odd) {
        g.fillStyle = col.stripe;
        g.fillRect(X(m.c0), y + 2, X(m.c1 + 1) - X(m.c0), AA_H - 4);
      }
      g.fillStyle = m.state === "differs" ? col.diff : m.state === "same" ? col.text2 : col.text3;
      g.globalAlpha = m.state === "afterStop" ? 0.5 : 1;
      g.fillText(m.aa, X(m.cm) + COLUMN / 2, y + AA_H / 2 + 0.5);
      g.globalAlpha = 1;
    }
    g.fillStyle = col.warn;
    for (const c of translation.uncertain) if (c >= c0 && c <= c1) g.fillRect(X(c) + 3, y + AA_H - 3, COLUMN - 6, 2);
    const stop = translation.stop;
    if (!stop) return;
    const text = stop.past ? `After ${stop.label}` : stop.label;
    g.font = `600 10.5px ${col.sans}`;
    const w = g.measureText(text).width + 12;
    // The mark sits where translation would have gone on.
    const x = line.forward || stop.past ? X(stop.column) : X(stop.column + 1) - w;
    g.fillStyle = stop.past ? col.badSoft : col.bad;
    g.fillRect(x, y + 1, w, AA_H - 2);
    g.fillStyle = stop.past ? col.bad : "#fff";
    g.textAlign = "left";
    g.fillText(text, x + 6, y + AA_H / 2 + 0.5);
    g.textAlign = "center";
  }

  /** Second peak over first at each base of an (oriented) chromatogram, worked out once. */
  private ratios(c: Chromatogram): Float32Array {
    let r = this.ratioCache.get(c);
    if (!r) {
      r = peakRatios(c);
      this.ratioCache.set(c, r);
    }
    return r;
  }

  /** Draws the four trace curves of a read, stretched so each peak sits on its column. */
  private drawTrace(
    g: CanvasRenderingContext2D,
    row: TrackRow,
    c: Chromatogram,
    c0: number,
    c1: number,
    X: (c: number) => number,
    colors: Record<string, string>
  ): boolean {
    const t = row.track;
    const cols = t.baseColumns;
    if (cols.length < 2) return false;
    let k0 = firstAtOrAfter(cols, c0) - 1;
    let k1 = firstAtOrAfter(cols, c1 + 1);
    k0 = Math.max(0, k0);
    k1 = Math.min(cols.length - 1, k1);
    if (k0 >= k1) return false;
    const pos = (k: number) => c.basePos[t.baseIndex[k]];
    const xs = (k: number) => X(cols[k]) + COLUMN / 2;
    const top = row.traceY;
    const scale = (TRACE_H - 3) / t.traceMax;
    g.save();
    g.beginPath();
    g.rect(X(t.firstColumn), top - 2, (t.lastColumn - t.firstColumn + 1) * COLUMN, TRACE_H + 2);
    g.clip();
    g.lineWidth = 1.15;
    g.lineJoin = "round";
    for (const [base, key] of TRACE_KEYS) {
      const trace = c[key];
      if (!trace?.length) continue;
      g.strokeStyle = colors[base];
      g.beginPath();
      let started = false;
      const point = (x: number, s: number) => {
        const v = trace[Math.max(0, Math.min(trace.length - 1, Math.round(s)))] || 0;
        const y = top + TRACE_H - Math.min(TRACE_H - 1, v * scale);
        if (started) g.lineTo(x, y);
        else {
          g.moveTo(x, y);
          started = true;
        }
      };
      // Half a column before the first base and after the last one.
      const edge = (k: number, toward: number, dir: -1 | 1) => {
        const span = Math.abs(pos(toward) - pos(k)) / Math.max(1, Math.abs(cols[toward] - cols[k])) / 2;
        return { s: pos(k) + dir * span, x: xs(k) + (dir * COLUMN) / 2 };
      };
      if (k0 === 0) {
        const e = edge(0, 1, -1);
        for (let s = e.s; s < pos(0); s++) point(e.x + ((s - e.s) / Math.max(1, pos(0) - e.s)) * (xs(0) - e.x), s);
      }
      for (let k = k0; k < k1; k++) {
        const s0 = pos(k);
        const s1 = pos(k + 1);
        const x0 = xs(k);
        const x1 = xs(k + 1);
        if (!(s1 > s0)) {
          point(x0, s0);
          continue;
        }
        const step = Math.max(1, (s1 - s0) / Math.max(4, (x1 - x0) * 1.5));
        for (let s = s0; s < s1; s += step) point(x0 + ((s - s0) / (s1 - s0)) * (x1 - x0), s);
      }
      point(xs(k1), pos(k1));
      if (k1 === cols.length - 1) {
        const e = edge(k1, k1 - 1, 1);
        for (let s = pos(k1) + 1; s <= e.s; s++) point(xs(k1) + ((s - pos(k1)) / Math.max(1, e.s - pos(k1))) * (e.x - xs(k1)), s);
      }
      g.stroke();
    }
    g.restore();
    return true;
  }

  // ---------- wheel ----------

  /**
   * An up-and-down wheel moves the rows wherever the pointer is, and never moves along the
   * alignment: that is for sideways scrolling, Shift or the scroll bar, which the browser
   * handles under the reads. A wheel that turned sideways at the last row proved confusing.
   */
  private installWheel() {
    const b = this.body;
    b.addEventListener(
      "wheel",
      e => {
        if (e.ctrlKey) return;
        const scale = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE : 1;
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
          // The top part is outside the sideways scroller, so it is moved by hand there.
          if (!this.head.contains(e.target as Node)) return;
          e.preventDefault();
          this.scroller.scrollLeft += (e.deltaX || (e.shiftKey ? e.deltaY : 0)) * scale;
          return;
        }
        e.preventDefault();
        b.scrollTop += e.deltaY * scale;
      },
      { passive: false }
    );
  }

  // ---------- pointer ----------

  private columnAt(e: PointerEvent): number {
    const r = this.canvas.getBoundingClientRect();
    return Math.floor((e.clientX - r.left + this.scroller.scrollLeft) / COLUMN);
  }

  private trackAt(e: PointerEvent): number | null {
    const r = this.canvas.getBoundingClientRect();
    const y = e.clientY - r.top + this.headH;
    const row = this.rows.find(x => y >= x.top - GAP / 2 && y <= x.bottom + 4);
    return row ? row.track.result : null;
  }

  private installPointer() {
    for (const canvas of [this.headCanvas, this.canvas]) this.installPointerOn(canvas);
  }

  /** Dragging along either canvas selects bases; a click on a read's row also makes it the active read. */
  private installPointerOn(canvas: HTMLCanvasElement) {
    canvas.addEventListener("pointerdown", e => {
      const L = this.layout;
      if (!L || e.button !== 0) return;
      e.preventDefault();
      const store = this.ctx.store;
      const n = store.data.sequence.length;
      if (n !== L.columnOf.length - 1) return; // edited since alignment
      const at = (ev: PointerEvent) => refPosAtColumn(L, this.columnAt(ev), n);
      // Shift-click extends from the fixed end of the current selection.
      const sel = store.selection;
      let anchor = at(e);
      if (e.shiftKey && sel.range) anchor = sel.caret === sel.range.end + 1 ? sel.range.start : sel.range.end;
      else if (e.shiftKey) anchor = Math.min(sel.caret, n - 1);
      const startX = e.clientX;
      let moved = e.shiftKey;
      const apply = (p: number) => {
        const lo = Math.min(anchor, p);
        const hi = Math.max(anchor, p);
        const forward = p >= anchor;
        store.select({ range: { start: lo, end: hi }, caret: forward ? hi + 1 : lo, anchor: forward ? lo : hi + 1, focus: null }, "reads");
      };
      apply(at(e));
      canvas.setPointerCapture(e.pointerId);
      const move = (ev: PointerEvent) => {
        if (Math.abs(ev.clientX - startX) > 3) moved = true;
        if (moved) apply(at(ev));
      };
      const up = (ev: PointerEvent) => {
        canvas.removeEventListener("pointermove", move);
        canvas.removeEventListener("pointerup", up);
        canvas.removeEventListener("pointercancel", up);
        if (!moved && canvas === this.canvas) {
          const t = this.trackAt(ev);
          if (t !== null && t !== this.cb.active()) this.cb.activate(t);
        }
      };
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", up);
      canvas.addEventListener("pointercancel", up);
    });
  }
}
