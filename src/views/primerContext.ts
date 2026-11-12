// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The bases around the selected primer, in the Primers tab: both strands with the primer
// drawn over the bases it pairs with (its tail hanging off the 5′ end, mismatches marked),
// other primers and features nearby. Either end of the part that binds can be dragged, or
// moved with the arrow keys and the − / + buttons, to extend or trim the primer. Bases are
// selected as in the Sequence tab: drag across both strands, click for the cursor.

import { h } from "../ui/dom.ts";
import { fmt, fmtRange } from "../ui/format.ts";
import { checkIcon } from "../ui/icons.ts";
import { codons, featureStyles, gcValues, isCds, primerAlignment, primerColors, primerTitle, primerTm } from "../doc/analysis.ts";
import { GC_WINDOW } from "../lib/gc.ts";
import { drawGcStrip, GC_STRIP_HEIGHT } from "./gcStrip.ts";
import { primerPiece, type PrimerPiece } from "../lib/primerAlign.ts";
import { boxTop, drawPrimer, laneHeight, pieceExtent } from "./primerDraw.ts";
import type { DocContext } from "../doc/context.ts";
import { changesText, gcContent } from "../lib/primers.ts";
import { resizePrimer } from "../lib/primerEdit.ts";
import { aminoGroup } from "../lib/aminoAcids.ts";
import { codonHit, markCodonSelection, TranslationDrag } from "./translationHit.ts";
import { selectedRanges } from "../lib/selection.ts";
import { complement, inRange, rangeLength, type Range, type SeqFeature, type SeqPrimer } from "../lib/seqdata.ts";
import { menuTargetAt } from "../doc/contextMenu.ts";
import type { Focus } from "../doc/store.ts";
import { layoutRegions, regionRange, regionSpans, regionsOf } from "../lib/regions.ts";
import { drawRegionTracks, layoutRegionTracks, markRegionSelection, REGION_TRACK_HEIGHT, type RegionTrack, type RegionTrackPiece } from "./regionTracks.ts";

const GUTTER = 64;
const SOURCE = "primer-context";
const isMac = /Mac/.test(navigator.platform || navigator.userAgent);

interface Run<T> {
  item: T;
  /** Window indices, inclusive. */
  a: number;
  b: number;
  lane: number;
}

/** Contiguous stretches of window indices that a range covers. */
function runsIn(covers: (pos: number) => boolean, positions: number[]): [number, number][] {
  const out: [number, number][] = [];
  let from = -1;
  positions.forEach((p, i) => {
    if (covers(p)) {
      if (from < 0) from = i;
    } else if (from >= 0) {
      out.push([from, i - 1]);
      from = -1;
    }
  });
  if (from >= 0) out.push([from, positions.length - 1]);
  return out;
}

function lanes<T>(items: { item: T; a: number; b: number; w: number }[]): Run<T>[] {
  const ends: number[] = [];
  return [...items]
    .sort((x, y) => x.a - y.a)
    .map(x => {
      let lane = 0;
      while (ends[lane] !== undefined && ends[lane] >= x.a) lane++;
      ends[lane] = x.a + x.w;
      return { item: x.item, a: x.a, b: x.b, lane };
    });
}

export class PrimerContextView {
  readonly el: HTMLElement;
  private ctx: DocContext;
  private rowCount: number;
  private visible = false;
  private stale = true;
  private title = h("span", { class: "sv-pane-note sv-ctx-name" });
  private readout = h("span", { class: "sv-ctx-readout" });
  private controls = h("span", { class: "sv-ctx-controls" });
  private body = h("div", { class: "sv-ctx-body" });
  private regionsToggle: HTMLButtonElement;
  private gcToggle: HTMLButtonElement;
  private chPx = 7.8;
  /** The primer shown, and the first position of the window it is shown in. */
  private primerId: string | null = null;
  private windowStart = 0;
  private dragging: { side: "left" | "right"; from: SeqPrimer; last: string } | null = null;
  /** Number of bases in the window, and each drawn row (for drawing the selection). */
  private total = 0;
  private rowParts: { sel: HTMLElement; positions: number[]; offset: number; yTop: number; strandsH: number }[] = [];
  /** Told which stretch is on screen, so the binding map can mark it. */
  onWindow?: (r: Range | null) => void;

  constructor(ctx: DocContext, opts: { rows: number }) {
    this.ctx = ctx;
    this.rowCount = opts.rows;
    this.regionsToggle = h("button", { type: "button", class: "sv-chip", onclick: () => ctx.setOptions({ sequenceRegions: !ctx.options.sequenceRegions }) }, checkIcon(), "Regions");
    this.gcToggle = h("button", { type: "button", class: "sv-chip", onclick: () => ctx.setOptions({ primerGc: !ctx.options.primerGc }) }, checkIcon(), "GC");
    this.el = h(
      "section",
      { class: "sv-ctx", "aria-label": "Sequence around the selected primer" },
      h("div", { class: "sv-ctx-head" }, h("h3", { class: "sv-section-title" }, "Sequence"), this.title, this.regionsToggle, this.gcToggle, this.readout, this.controls),
      this.body,
      h("p", { class: "sv-small sv-dim sv-ctx-hint" }, "Drag an end of the primer, or use the arrow keys on it, to extend or trim it. Tm and checks update as you go; the tail stays as it is.")
    );
    ctx.store.subscribe(c => {
      if (c.data) this.invalidate();
      else if (c.selection) {
        const f = ctx.store.selection.focus;
        // Another primer, wherever it was clicked (here too): the panel moves to it.
        if (f?.kind === "primer" && f.id !== this.primerId) this.invalidate();
        else this.renderSelection();
      }
    });
    this.installMouse();
    ctx.onOptions(() => this.invalidate());
    new ResizeObserver(() => this.invalidate()).observe(this.body);
  }

  setVisible(v: boolean) {
    this.visible = v;
    if (v && this.stale) this.render();
  }

  private invalidate() {
    this.stale = true;
    if (this.visible) this.render();
  }

  /** The selected primer, else the one shown before, else the first. */
  private primer(): SeqPrimer | null {
    const d = this.ctx.store.data;
    const f = this.ctx.store.selection.focus;
    const byId = (id: string | null) => (id ? d.primers.find(p => p.id === id) ?? null : null);
    return (f?.kind === "primer" ? byId(f.id) : null) ?? byId(this.primerId) ?? [...d.primers].sort((a, b) => a.start - b.start)[0] ?? null;
  }

  private measure() {
    const probe = h("span", { class: "sv-seq-probe" }, "0123456789".repeat(10));
    this.body.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 100;
    probe.remove();
    if (w > 2) this.chPx = w;
  }

  render() {
    this.stale = false;
    const showRegions = this.ctx.options.sequenceRegions;
    this.regionsToggle.setAttribute("aria-pressed", String(showRegions));
    this.regionsToggle.classList.toggle("sv-chip-off", !showRegions);
    this.gcToggle.setAttribute("aria-pressed", String(this.ctx.options.primerGc));
    this.gcToggle.classList.toggle("sv-chip-off", !this.ctx.options.primerGc);
    const d = this.ctx.store.data;
    const n = d.sequence.length;
    const p = this.primer();
    if (!p || !n) {
      this.title.textContent = "";
      this.onWindow?.(null);
      this.readout.textContent = "";
      this.controls.replaceChildren();
      this.body.replaceChildren(h("p", { class: "sv-small sv-dim" }, "Select a primer to see the bases around it."));
      return;
    }
    this.measure();
    const width = this.body.clientWidth || 900;
    const bpr = Math.max(30, Math.floor((width - GUTTER - 16) / this.chPx / 10) * 10);
    const total = Math.min(n, bpr * this.rowCount);
    this.total = total;
    const bind = rangeLength(p, n);
    const tail = primerAlignment(d, p).tail.length;
    // Keep the window while the same primer stays inside it (so dragging doesn't scroll).
    const index = (pos: number) => (d.circular ? (((pos - this.windowStart) % n) + n) % n : pos - this.windowStart);
    const inside = (pos: number) => index(pos) >= 0 && index(pos) < total;
    if (p.id !== this.primerId || !inside(p.start) || !inside(p.end)) {
      // Centre on the primer and its tail.
      const lo = p.strand === 1 ? p.start - tail : p.start;
      let start = lo + Math.floor((bind + tail) / 2) - Math.floor(total / 2);
      if (d.circular) start = ((start % n) + n) % n;
      else start = Math.max(0, Math.min(n - total, start));
      this.windowStart = start;
    }
    this.primerId = p.id;
    const positions = Array.from({ length: total }, (_, i) => (d.circular ? (this.windowStart + i) % n : this.windowStart + i));
    const first = positions[0];
    const last = positions[total - 1];
    this.title.textContent = `around ${p.name}`;
    this.onWindow?.({ start: first, end: last });
    const al = primerAlignment(d, p);
    const bindBases = al.binding;
    const tm = primerTm(d, p);
    const tmText = tm === null ? "—" : `${tm.toFixed(1)} °C`;
    const changes = changesText({ mismatches: al.substitutions, insertions: al.insertions, deletions: al.deletions });
    this.readout.replaceChildren(
      h("span", { class: "sv-mono sv-dim" }, `${fmt(first + 1)}–${fmt(last + 1)}`),
      h("strong", null, changes ? `3′ arm ${tmText}` : `${bindBases.length} nt bind · ${tmText}`),
      ...(changes ? [h("span", { class: "sv-text-bad" }, changes)] : []),
      ...(tail ? [h("span", null, `${tail} nt 5′ tail`)] : []),
      h("span", null, `GC ${gcContent(bindBases).toFixed(0)}%`)
    );
    // Steps that can't be taken (too short, too long, the end of a linear sequence) are off.
    const step = (label: string, d5: number, d3: number, text: string) =>
      h("button", { type: "button", class: "sv-ctx-step", "aria-label": label, title: label, disabled: !resizePrimer(p, d.sequence, d.circular, d5, d3), onclick: () => this.resize(p, d5, d3, label) }, text);
    this.controls.replaceChildren(
      h("span", { class: "sv-ctx-step-group" }, "3′ end", step("Trim the 3′ end by one base", 0, -1, "−"), step("Extend the 3′ end by one base", 0, 1, "+")),
      h("span", { class: "sv-ctx-step-group" }, "5′ end", step("Trim the 5′ end by one base", -1, 0, "−"), step("Extend the 5′ end by one base", 1, 0, "+"))
    );

    const rows: HTMLElement[] = [];
    this.rowParts = [];
    for (let r = 0; r * bpr < total; r++) rows.push(this.buildRow(p, positions.slice(r * bpr, Math.min(total, (r + 1) * bpr)), r * bpr, bpr, index));
    this.body.replaceChildren(...rows);
    this.renderSelection();
  }

  // ---------- selecting bases ----------

  /** Where a boundary (0…n) falls in the window, as an index 0…total. */
  private windowIndex(boundary: number): number {
    const d = this.ctx.store.data;
    const n = d.sequence.length;
    return d.circular ? (((boundary - this.windowStart) % n) + n) % n : boundary - this.windowStart;
  }

  /** The boundary (0…n) at a window index 0…total. */
  private boundaryOf(i: number): number {
    const d = this.ctx.store.data;
    const n = d.sequence.length;
    return d.circular ? (this.windowStart + i) % n : this.windowStart + i;
  }

  /** Selects the bases between two window indices, `from` staying fixed. */
  private selectBetween(from: number, to: number) {
    const store = this.ctx.store;
    const anchor = this.boundaryOf(from);
    const caret = this.boundaryOf(to);
    if (from === to) store.select({ range: null, caret, anchor }, SOURCE);
    else {
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);
      store.select({ range: { start: this.boundaryOf(lo), end: this.boundaryOf(hi - 1) }, caret, anchor }, SOURCE);
    }
  }

  private renderSelection() {
    const { caret } = this.ctx.store.selection;
    const ranges = selectedRanges(this.ctx.store.selection);
    const caretAt = ranges.length ? -1 : this.windowIndex(caret);
    for (const row of this.rowParts) {
      const parts: HTMLElement[] = [];
      const px = (v: number) => `${Math.round(v * this.chPx * 100) / 100}px`;
      for (const range of ranges) {
        for (const [a, b] of runsIn(pos => inRange(range, pos), row.positions)) {
          const el = h("div", { class: "sv-sel-band" });
          el.setAttribute("style", `left:${px(a)};width:${px(b - a + 1)};top:${row.yTop - 1}px;height:${row.strandsH + 2}px`);
          parts.push(el);
        }
      }
      const at = caretAt - row.offset;
      // The cursor shows in the row it starts, or at the end of the last one.
      if (caretAt >= 0 && (at >= 0 && (at < row.positions.length || (at === row.positions.length && caretAt === this.total)))) {
        const el = h("div", { class: "sv-caret" });
        el.setAttribute("style", `left:${px(at)};top:${row.yTop - 3}px;height:${row.strandsH + 6}px`);
        parts.push(el);
      }
      row.sel.replaceChildren(...parts);
    }
    markRegionSelection(this.body, this.ctx.store.selection.focus);
    markCodonSelection(this.body, this.ctx.store.selection);
  }

  private installMouse() {
    const store = this.ctx.store;
    let anchor: number | null = null;
    let moved = false;
    let target: Focus | null = null;
    const translation = new TranslationDrag(this.ctx, SOURCE);
    const index = (e: MouseEvent) => Math.max(0, Math.min(this.total, this.boundaryAt(e) ?? 0));
    const hitOf = (e: Event): Focus | null => {
      const el = (e.target as Element).closest<HTMLElement>("[data-kind]");
      return el ? { kind: el.dataset.kind as Focus["kind"], id: el.dataset.id || "", ...(el.dataset.region === undefined ? {} : { region: Number(el.dataset.region) }) } : null;
    };
    this.body.addEventListener("pointerdown", e => {
      // Control-click is a right-click on a Mac; the primer's handles and buttons do their own thing.
      if (e.button !== 0 || (e.ctrlKey && isMac) || (e.target as Element).closest("button")) return;
      if (!this.rowParts.length) return;
      e.preventDefault();
      target = hitOf(e);
      const onCodon = translation.begin((e.target as Element).closest<HTMLElement>("[data-kind]"), e);
      const i = index(e);
      const sel = store.selection;
      const from = sel.anchor ?? (sel.range ? sel.range.start : sel.caret);
      const fromIndex = this.windowIndex(from);
      if (e.shiftKey && !onCodon && fromIndex >= 0 && fromIndex <= this.total) {
        this.selectBetween(fromIndex, i);
        anchor = fromIndex;
        moved = true;
      } else {
        anchor = i;
        moved = false;
      }
      this.body.setPointerCapture(e.pointerId);
    });
    this.body.addEventListener("pointermove", e => {
      if (anchor === null) return;
      const i = index(e);
      if (!moved && i === anchor) return;
      moved = true;
      if (!translation.move(e.clientX, e.clientY, this.boundaryOf(Math.max(0, i - 1)))) this.selectBetween(anchor, i);
    });
    const end = (e: PointerEvent) => {
      if (anchor === null) return;
      if (!moved && !translation.active) {
        if (target) this.selectAnnotation(target);
        else this.selectBetween(anchor, anchor);
      }
      anchor = null;
      translation.end();
      try {
        this.body.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };
    this.body.addEventListener("pointerup", end);
    this.body.addEventListener("pointercancel", end);
    this.body.addEventListener("dblclick", e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || (e.target as Element).closest("button")) return;
      // Pointer capture can send the double-click to the body instead of the hit area.
      const hit = hitOf(e) ?? target;
      if (hit) this.selectAnnotation(hit);
    });
    this.body.addEventListener("contextmenu", e => {
      if (!this.rowParts.length) return;
      e.preventDefault();
      const hit = hitOf(e);
      const t = menuTargetAt(this.ctx, hit, this.boundaryOf(index(e)), f => this.selectAnnotation(f), SOURCE);
      if (t) this.ctx.contextMenu(t, { x: e.clientX, y: e.clientY });
    });
  }

  private selectAnnotation(f: Focus) {
    const d = this.ctx.store.data;
    const r = f.kind === "feature" ? d.features.find(x => x.id === f.id) : f.kind === "primer" ? d.primers.find(x => x.id === f.id) : undefined;
    const region = r && f.kind === "feature" && f.region !== undefined ? regionsOf(r)[f.region] : undefined;
    const range = r && region ? regionRange(r, region, d.sequence.length) : r;
    if (range) this.ctx.store.selectRange({ start: range.start, end: range.end }, f, SOURCE);
  }

  /** One row: `positions` are its bases, `offset` its first index in the window, `index` maps a position to its window index. */
  private buildRow(p: SeqPrimer, positions: number[], offset: number, bpr: number, index: (pos: number) => number): HTMLElement {
    const d = this.ctx.store.data;
    const o = this.ctx.options;
    const n = d.sequence.length;
    const len = positions.length;
    const styles = featureStyles(d);
    // In pixels from the measured base width: a `ch` would follow each element's own font.
    const ch = (v: number) => `${Math.round(v * this.chPx * 100) / 100}px`;
    const abs = (style: string, cls: string, text = "") => {
      const el = document.createElement("div");
      el.setAttribute("style", "position:absolute;" + style);
      if (cls) el.className = cls;
      if (text) el.textContent = text;
      return el;
    };
    const at = (pos: number) => d.sequence[pos] ?? "";
    const caseOf = (s: string) => (o.caseMode === "uppercase" ? s.toUpperCase() : o.caseMode === "lowercase" ? s.toLowerCase() : s);

    // The selected primer's site starts at `ls` in this row and ends at `le` (either may be outside it).
    const siteLen = rangeLength(p, n);
    const ls = index(p.start) - offset;
    const le = ls + siteLen - 1;
    const shows = le >= 0 && ls < len;

    // Every primer, drawn as in the Sequence tab, in lanes against its strand.
    const colOf = (pos: number) => {
      const i = index(pos) - offset;
      return i >= 0 && i < len ? i : -1;
    };
    const primerLanes = (strand: 1 | -1) => {
      const pieces = d.primers.flatMap(q => {
        if (q.strand !== strand) return [];
        const piece = primerPiece(primerAlignment(d, q), q, n, d.circular, colOf);
        if (!piece) return [];
        const [a, b] = pieceExtent(piece, q.name, strand === 1, this.chPx, len);
        return [{ item: { q, piece }, a, b, w: b - a + 2 }];
      });
      const out: { band: boolean; pieces: { q: SeqPrimer; piece: PrimerPiece }[] }[] = [];
      for (const r of lanes(pieces)) {
        const lane = (out[r.lane] ??= { band: false, pieces: [] });
        lane.pieces.push(r.item);
        if (r.item.piece.raised) lane.band = true;
      }
      return out;
    };
    const feats = o.features || o.sequenceRegions
      ? lanes(
          d.features.filter(f => o.features || (isCds(f) && regionsOf(f).length > 0)).flatMap(f =>
            runsIn(pos => (f.locations ?? [f]).some(part => inRange(part, pos)), positions).map(([a, b]) => ({ item: f, a, b, w: b - a + 1 }))
          )
        )
      : [];
    // Show every region in the visible template window, including nearby boundaries.
    const regionPieces: RegionTrackPiece[] = o.sequenceRegions ? d.features.flatMap(f => {
      if (!isCds(f)) return [];
      return layoutRegions(regionsOf(f)).flatMap(({ region, index }) => {
        const spans = regionSpans(f, region, n);
        const columns = runsIn(pos => spans.some(span => inRange(span, pos)), positions);
        return columns.length ? [{ f, region, index, spans: columns }] : [];
      });
    }) : [];

    // Vertical layout, as in the Sequence tab: forward primers above the top strand, the
    // first lane nearest it; the ruler between the strands; reverse primers below.
    let y = 4;
    const fwdLanes = primerLanes(1);
    const fwdH = fwdLanes.reduce((sum, l) => sum + laneHeight(l.band), 0);
    let ly = y + fwdH;
    const fwdY = fwdLanes.map(l => (ly -= laneHeight(l.band)));
    y += fwdH;
    const yTop = y;
    y += 18;
    const yRuler = y;
    y += 12;
    const yBot = y;
    y += 18;
    const strandsH = yBot + 18 - yTop;
    const revLanes = primerLanes(-1);
    const revY = revLanes.map(l => {
      const top = y;
      y += laneHeight(l.band);
      return top;
    });
    y += 4;
    // GC content, after the reverse primers so they stay beside their strand.
    const yGc = o.primerGc ? y : null;
    if (o.primerGc) y += GC_STRIP_HEIGHT + 4;
    const featLanes = feats.length ? Math.max(...feats.map(x => x.lane)) + 1 : 0;
    // A name goes under its bar when the bar shows amino acids or is too short for it.
    const fitsInside = (r: Run<SeqFeature>) => (r.b - r.a + 1) * this.chPx > r.item.name.length * 7 + 10;
    const captioned = (r: Run<SeqFeature>) => (isCds(r.item) && o.translations) || !fitsInside(r);
    const laneY: number[] = [];
    const regionTracks: (RegionTrack & { y: number })[] = [];
    for (let l = 0; l < featLanes; l++) {
      laneY.push(y);
      y += o.features ? 22 + (feats.some(r => r.lane === l && captioned(r)) ? 13 : 0) : 0;
      const inLane = feats.filter(r => r.lane === l);
      const bars = layoutRegionTracks(regionPieces.flatMap(piece => {
        const spans = piece.spans.flatMap(([a, b]) => inLane.filter(run => run.item === piece.f)
          .flatMap(run => Math.max(a, run.a) <= Math.min(b, run.b) ? [[Math.max(a, run.a), Math.min(b, run.b)] as [number, number]] : []));
        return spans.length ? [{ ...piece, spans }] : [];
      }), bpr, this.chPx);
      if (bars.length) {
        y += 4;
        regionTracks.push(...bars.map(bar => ({ ...bar, y: y + bar.lane * REGION_TRACK_HEIGHT })));
        y += (Math.max(...bars.map(bar => bar.lane)) + 1) * REGION_TRACK_HEIGHT;
      }
    }
    y += 6;

    const track = h("div", { class: "sv-row-track", style: { width: ch(bpr), height: `${y}px` } });
    const gutter = h("div", { class: "sv-row-gutter", style: { height: `${y}px` } });
    // 10-base stripes, by position in the sequence.
    for (let i = 0; i < len; i++) if (Math.floor(positions[i] / 10) % 2 === 0 && (i === 0 || positions[i] % 10 === 0)) {
      let j = i;
      while (j + 1 < len && Math.floor(positions[j + 1] / 10) === Math.floor(positions[i] / 10)) j++;
      track.appendChild(abs(`left:${ch(i)};width:${ch(j - i + 1)};top:${yTop - 1}px;height:${strandsH + 1}px`, "sv-stripe"));
    }
    // The selection, under the bases.
    const sel = h("div", { class: "sv-row-sel" });
    track.appendChild(sel);
    this.rowParts.push({ sel, positions, offset, yTop, strandsH });
    // Where the primer pairs, on both strands.
    const a0 = Math.max(0, ls);
    const b0 = Math.min(len - 1, le);
    if (shows) track.appendChild(abs(`left:${ch(a0)};width:${ch(b0 - a0 + 1)};top:${yTop - 1}px;height:${strandsH + 1}px`, "sv-ctx-site"));

    const top = positions.map(at).join("");
    track.appendChild(abs(`left:0;top:${yTop}px`, "sv-bases", caseOf(top)));
    track.appendChild(abs(`left:0;top:${yBot}px`, "sv-bases sv-bases-bottom", caseOf(complement(top))));
    positions.forEach((pos, i) => {
      if ((pos + 1) % 10 === 0) {
        const label = fmt(pos + 1);
        track.appendChild(abs(`left:${ch(i + 1)};top:${yRuler}px;transform:translateX(-100%)`, "sv-ruler", label));
      }
    });

    // GC around each base.
    if (yGc !== null) {
      const strip = abs(`left:0;top:${yGc}px;width:${ch(len)};height:${GC_STRIP_HEIGHT}px`, "sv-gc-strip");
      strip.append(...drawGcStrip(gcValues(d, GC_WINDOW), len, i => positions[i], ch));
      track.appendChild(strip);
    }

    // Primers, the selected one outlined, with handles at both ends of its site.
    const x = (c: number) => Math.round(c * this.chPx * 100) / 100;
    let handleTop: number | null = null;
    const strands: [typeof fwdLanes, number[], number][] = [
      [fwdLanes, fwdY, yTop + 9],
      [revLanes, revY, yBot + 9]
    ];
    for (const [laneList, ys, strandY] of strands) {
      laneList.forEach((lane, k) => {
        for (const { q, piece } of lane.pieces) {
          const selected = q.id === p.id;
          track.appendChild(drawPrimer({ piece, id: q.id, name: q.name, title: primerTitle(d, q), strand: q.strand, ...primerColors(q), selected, x, cw: this.chPx, cols: len, y: ys[k], band: lane.band, caseOf, strandY, className: selected ? "sv-ctx-primer" : undefined }));
          if (selected) handleTop = boxTop(ys[k], lane.band, q.strand === 1);
        }
      });
    }
    if (shows && handleTop !== null) {
      const yy = handleTop;
      // Handles at both ends of the site.
      const handle = (side: "left" | "right", at: number) => {
        const is3 = (side === "right") === (p.strand === 1);
        const b = h("button", {
          type: "button",
          class: "sv-ctx-handle",
          "aria-label": is3 ? "Move the 3′ end (arrow keys)" : "Move the 5′ end of the binding part (arrow keys)",
          title: is3 ? "Drag to move the 3′ end" : "Drag to move the 5′ end of the part that binds",
          style: { left: `calc(${ch(at)} - 6px)`, top: `${yy - 4}px` }
        }) as HTMLButtonElement;
        b.addEventListener("pointerdown", e => this.startDrag(e, side, p));
        b.addEventListener("keydown", e => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          // Moving the left end left, or the right end right, makes the primer longer.
          const grow = (side === "left") === (e.key === "ArrowLeft") ? 1 : -1;
          this.resize(p, is3 ? 0 : grow, is3 ? grow : 0, b.getAttribute("aria-label") ?? "");
        });
        track.appendChild(b);
      };
      if (ls >= 0 && ls < len) handle("left", ls);
      if (le + 1 > 0 && le + 1 <= len) handle("right", le + 1);
    }

    // Features, with amino acids on coding ones.
    for (const r of o.features ? feats : []) {
      const f: SeqFeature = r.item;
      const st = styles.get(f.id);
      const coding = isCds(f) && o.translations;
      const yy = laneY[r.lane];
      // An arrowhead where the feature ends in this row.
      const headRight = f.strand === 1 && positions[r.b] === f.end;
      const headLeft = f.strand === -1 && positions[r.a] === f.start;
      const clip = headRight ? "clip-path:polygon(0 0,calc(100% - 6px) 0,100% 50%,calc(100% - 6px) 100%,0 100%);" : headLeft ? "clip-path:polygon(6px 0,100% 0,100% 100%,6px 100%,0 50%);" : "";
      const bar = abs(`left:${ch(r.a)};width:${ch(r.b - r.a + 1)};top:${yy}px;height:18px;background:${st?.fill ?? "#999"};${clip}`, "sv-feature-bar");
      bar.title = `${f.name} · ${f.type} · ${fmtRange(f.start + 1, f.end + 1)}`;
      bar.dataset.kind = "feature";
      bar.dataset.id = f.id;
      track.appendChild(bar);
      if (coding && o.aaColors) {
        // Each amino acid in a box over its codon, tinted and lettered by its chemistry.
        for (const c of codons(f, d.sequence)) {
          const i = index(c.mid) - offset;
          if (i < r.a || i > r.b) continue;
          const a = Math.max(r.a, i - 1);
          const b = Math.min(r.b, i + 1);
          const group = aminoGroup(c.aa);
          const box = abs(`left:calc(${ch(a)} + 0.5px);width:calc(${ch(b - a + 1)} - 1px);top:${yy + 1}px;height:14px;pointer-events:none`, `sv-aa-box${group ? ` sv-aa-${group}` : ""}`);
          const letter = abs(`left:calc(${ch(i - a)} - 0.5px);width:${ch(1)}`, "sv-aa-letter", c.aa);
          box.appendChild(letter);
          track.appendChild(box);
        }
      } else if (coding) {
        const line = new Array(r.b + 1).fill(" ");
        for (const c of codons(f, d.sequence)) {
          const i = index(c.mid) - offset;
          if (i >= r.a && i <= r.b) line[i] = c.aa;
        }
        track.appendChild(abs(`left:0;top:${yy}px;line-height:18px;color:${st?.text ?? "#000"}`, "sv-aa", line.join("").replace(/\s+$/, "")));
      } else if (fitsInside(r)) {
        const t = document.createElement("span");
        t.className = "sv-feature-name";
        t.textContent = f.name;
        t.style.color = st?.text ?? "";
        bar.style.paddingLeft = "4px";
        bar.appendChild(t);
      }
      if (coding) for (const c of codons(f, d.sequence)) {
        const i = index(c.mid) - offset;
        if (i < r.a || i > r.b) continue;
        const a = Math.max(r.a, i - 1);
        const b = Math.min(r.b, i + 1);
        track.appendChild(codonHit(f.id, c, a * this.chPx, (b - a + 1) * this.chPx, yy, 18));
      }
      if (captioned(r)) {
        // Under the bar, where it starts in this row, cut short before the next one.
        const next = Math.min(positions.length, ...feats.filter(x => x.lane === r.lane && x.a > r.b).map(x => x.a));
        const arrow = f.strand === 1 ? " →" : f.strand === -1 ? " ←" : "";
        const cap = abs(`left:${ch(r.a)};top:${yy + 19}px;max-width:calc(${ch(next - r.a)} - 4px);color:color-mix(in srgb, ${st?.fill ?? "#999"} 72%, var(--text))`, "sv-feature-caption", `${f.name}${arrow}`);
        cap.title = bar.title;
        cap.dataset.kind = "feature";
        cap.dataset.id = f.id;
        track.appendChild(cap);
      }
    }
    track.append(...drawRegionTracks(regionTracks, this.chPx));

    gutter.appendChild(abs(`right:0;top:${yTop}px;line-height:18px`, "sv-row-number", fmt(positions[0] + 1)));
    const row = h("div", { class: "sv-ctx-row" }, gutter, track);
    row.dataset.offset = String(offset);
    return row;
  }

  private resize(p: SeqPrimer, d5: number, d3: number, label: string) {
    const d = this.ctx.store.data;
    const next = resizePrimer(p, d.sequence, d.circular, d5, d3);
    if (!next) return;
    this.apply(next, label);
  }

  private apply(next: SeqPrimer, label: string) {
    const d = this.ctx.store.data;
    // The view is drawn again by the change: keep the keyboard on the handle that was used.
    const active = document.activeElement?.getAttribute("aria-label");
    // One undo step per primer while the changes keep coming.
    this.ctx.store.apply({ ...d, primers: d.primers.map(q => (q.id === next.id ? next : q)) }, label.startsWith("Move") || label.startsWith("Drag") ? "Change primer" : label, { range: { start: next.start, end: next.end }, focus: { kind: "primer", id: next.id } }, `primer-ends:${next.id}`);
    if (active) requestAnimationFrame(() => (this.el.querySelector(`[aria-label="${CSS.escape(active)}"]`) as HTMLElement | null)?.focus());
  }

  private startDrag(e: PointerEvent, side: "left" | "right", p: SeqPrimer) {
    e.preventDefault();
    this.dragging = { side, from: p, last: `${p.start}:${p.end}` };
    const move = (ev: PointerEvent) => this.dragTo(ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.dragging = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** The base boundary under the pointer, as a position in the sequence. */
  private boundaryAt(ev: MouseEvent): number | null {
    const rows = Array.from(this.body.querySelectorAll<HTMLElement>(".sv-ctx-row"));
    if (!rows.length) return null;
    const row = rows.find(r => {
      const b = r.getBoundingClientRect();
      return ev.clientY >= b.top && ev.clientY <= b.bottom;
    }) ?? (ev.clientY < rows[0].getBoundingClientRect().top ? rows[0] : rows[rows.length - 1]);
    const track = row.querySelector<HTMLElement>(".sv-row-track")!;
    const x = ev.clientX - track.getBoundingClientRect().left;
    return Number(row.dataset.offset) + Math.round(x / this.chPx);
  }

  private dragTo(ev: PointerEvent) {
    const drag = this.dragging;
    if (!drag) return;
    const idx = this.boundaryAt(ev);
    if (idx === null) return;
    const d = this.ctx.store.data;
    const n = d.sequence.length;
    const p0 = drag.from;
    const index = (pos: number) => (d.circular ? (((pos - this.windowStart) % n) + n) % n : pos - this.windowStart);
    // How far the dragged end moved outwards (longer) from where the drag began.
    const grow = drag.side === "left" ? index(p0.start) - idx : idx - (index(p0.end) + 1);
    const fwd = p0.strand === 1;
    const on5 = (drag.side === "left") === fwd;
    const next = resizePrimer(p0, d.sequence, d.circular, on5 ? grow : 0, on5 ? 0 : grow);
    if (!next) return;
    const key = `${next.start}:${next.end}`;
    if (key === drag.last) return;
    drag.last = key;
    this.apply(next, "Drag primer end");
  }
}
