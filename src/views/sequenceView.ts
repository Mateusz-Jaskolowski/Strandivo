// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The Sequence tab: both strands in rows, with cut sites, primers, features and
// translations lined up under the bases. Only the rows on screen are drawn. Supports
// selecting with mouse and keyboard, typing and deleting bases, and the clipboard.

import { h, toast } from "../ui/dom.ts";
import { fontStack, textWidth } from "../ui/svg.ts";
import { checkIcon } from "../ui/icons.ts";
import { codons, cutSites, featureStyles, isCds, orfs, orfTitle, primerAlignment, primerColors, primerTitle } from "../doc/analysis.ts";
import { primerPiece, type PrimerPiece } from "../lib/primerAlign.ts";
import { drawPrimer, laneHeight, pieceExtent } from "./primerDraw.ts";
import { aminoGroup } from "../lib/aminoAcids.ts";
import { codonHit, codonRange } from "./translationHit.ts";
import { layoutRegions, regionRange, regionSpans, regionsOf } from "../lib/regions.ts";
import { drawRegionTracks, layoutRegionTracks, markRegionSelection, REGION_TRACK_HEIGHT, type RegionTrack, type RegionTrackPiece } from "./regionTracks.ts";
import type { DocContext } from "../doc/context.ts";
import type { Focus } from "../doc/store.ts";
import { menuTargetAt } from "../doc/contextMenu.ts";
import { firstDelete } from "../lib/deletion.ts";
import { isPickClick, pickSite } from "../doc/pickEnzyme.ts";
import { enzymeOf, pickedEnzymes } from "../lib/enzymePick.ts";
import type { CutSite } from "../lib/enzymes.ts";
import type { Orf } from "../lib/orfs.ts";
import {
  basesIn,
  cleanBases,
  complement,
  deleteRange,
  DNA_CHARS,
  featureGaps,
  insertBases,
  pieces,
  rangeLength,
  replaceRange,
  type Range,
  type SeqData,
  type SeqFeature,
  type SeqPrimer
} from "../lib/seqdata.ts";
import { fmt } from "../ui/format.ts";

const FONT_PX = 13;
const isMac = /Mac/.test(navigator.platform || navigator.userAgent);
const GUTTER = 64;
/** Height of a feature's bar, coding or not, so amino acids fit in it. */
const FEATURE_H = 19;
/** What a clicked element stands for; a region's bar and caption also say which region. */
function hitOf(el: HTMLElement): Focus {
  const region = el.dataset.region;
  return { kind: el.dataset.kind as Focus["kind"], id: el.dataset.id || "", ...(region === undefined ? {} : { region: Number(region) }) };
}
/** Height of the name under a coding feature's amino acids. */
const CAPTION = 13;
/** Width of a feature's arrowhead, and of the notch a neighbour's arrowhead sits in. */
const HEAD = 6;
/** Height of a lane of ORFs: a thin arrow and the gap under it. */
const ORF_LANE = 9;

interface EnzymeMark {
  site: CutSite;
  /** The top strand's cut, and where its label starts (kept inside the row). */
  x: number;
  labelX: number;
  /** Where the leader runs to on the bottom strand: the bottom cut, or the row's edge when that is in another row. */
  bottomX: number;
  bottomHere: boolean;
  level: number;
}

interface Bar<T> {
  item: T;
  a: number;
  b: number;
  lane: number;
}

interface RowLayout {
  start: number;
  end: number;
  height: number;
  yEnz: number;
  enzymes: EnzymeMark[];
  /** Bottom-strand cuts of sites labelled in the row before or after: a leader from the row's edge. */
  cutTails: { from: number; to: number }[];
  enzLevels: number;
  /** Primer lanes, the one nearest the strand first. */
  fwd: PrimerLane[];
  yTop: number;
  yBot: number;
  yRuler: number;
  rev: PrimerLane[];
  yOrf: number;
  orfs: Bar<Orf>[];
  features: Bar<SeqFeature>[];
  laneY: number[];
  regions: (RegionTrack & { y: number })[];
}

interface PrimerLane {
  /** Top of the lane, and whether it has a raised band (names, tails and changes). */
  y: number;
  band: boolean;
  pieces: { p: SeqPrimer; piece: PrimerPiece }[];
}

/** Pieces of [start, end] (may wrap) that fall in row [r0, r1]. */
function clip(start: number, end: number, r0: number, r1: number, n: number): [number, number][] {
  const parts: [number, number][] = start <= end ? [[start, end]] : [[start, n - 1], [0, end]];
  const out: [number, number][] = [];
  for (const [a, b] of parts) {
    const s = Math.max(a, r0);
    const e = Math.min(b, r1);
    if (s <= e) out.push([s, e]);
  }
  return out;
}

/** The bases a primer covers in the Sequence tab: its binding part and its 5′ tail, as a range. */
function primerFootprint(d: SeqData, p: SeqPrimer): [number, number] {
  const n = d.sequence.length;
  const circular = d.circular;
  const bind = rangeLength(p, n);
  const tail = Math.min(primerAlignment(d, p).tail.length, Math.max(0, n - bind));
  if (p.strand === 1) return circular ? [(((p.start - tail) % n) + n) % n, p.end] : [Math.max(0, p.start - tail), p.end];
  return circular ? [p.start, (p.end + tail) % n] : [p.start, Math.min(n - 1, p.end + tail)];
}

function laneAssign<T>(bars: { item: T; a: number; b: number; w: number }[]): Bar<T>[] {
  const ends: number[] = [];
  return [...bars]
    .sort((x, y) => x.a - y.a || y.b - x.b)
    .map(bar => {
      let lane = 0;
      while (ends[lane] !== undefined && ends[lane] > bar.a) lane++;
      ends[lane] = bar.a + bar.w;
      return { item: bar.item, a: bar.a, b: bar.b, lane };
    });
}

export class SequenceView {
  readonly el: HTMLElement;
  private scroller: HTMLElement;
  private canvas: HTMLElement;
  private strip: HTMLElement;
  private stripView: HTMLElement;
  private stripSel: HTMLElement;
  private rangeLabel: HTMLElement;
  private clipboard: HTMLTextAreaElement;
  private chips: Record<string, HTMLButtonElement> = {};
  private rows: RowLayout[] = [];
  private offsets: number[] = [];
  private bpr = 60;
  private chPx = 7.8;
  private rendered = new Map<number, { el: HTMLElement; sel: HTMLElement }>();
  private visible = false;
  private stale = true;
  private ctx: DocContext;
  private lastWidth = 0;

  constructor(ctx: DocContext) {
    this.ctx = ctx;
    const chip = (key: "complement" | "translations" | "aaColors" | "sequenceRegions" | "orfs" | "cutsites" | "primers", label: string) => {
      const b = h("button", { type: "button", class: "sv-chip", onclick: () => ctx.setOptions({ [key]: !ctx.options[key] }) }, checkIcon(), label);
      this.chips[key] = b;
      return b;
    };
    this.rangeLabel = h("span", { class: "sv-pane-note sv-mono" });
    const header = h(
      "div",
      { class: "sv-pane-head" },
      chip("complement", "Both strands"),
      chip("translations", "Translation"),
      chip("aaColors", "Colour amino acids"),
      chip("sequenceRegions", "Regions"),
      chip("orfs", "ORFs"),
      chip("cutsites", "Cut sites"),
      chip("primers", "Primers"),
      h("span", { class: "sv-push" }),
      this.rangeLabel
    );
    this.stripView = h("div", { class: "sv-strip-view" });
    this.stripSel = h("div", { class: "sv-strip-sel" });
    this.strip = h("div", { class: "sv-strip", title: "Click to jump" });
    const stripWrap = h("div", { class: "sv-strip-wrap" }, this.strip);
    this.canvas = h("div", { class: "sv-seq-canvas" });
    this.clipboard = h("textarea", {
      class: "sv-clipboard",
      "aria-label": "Sequence editor",
      spellcheck: "false",
      autocomplete: "off",
      autocapitalize: "off"
    }) as HTMLTextAreaElement;
    this.scroller = h("div", { class: "sv-seq-scroll", tabindex: "-1" }, this.canvas);
    this.el = h("div", { class: "sv-seq" }, header, stripWrap, this.scroller, this.clipboard);

    this.scroller.addEventListener("scroll", () => {
      this.renderVisible();
      this.updateStripView();
    });
    this.strip.addEventListener("pointerdown", e => this.jumpFromStrip(e));
    new ResizeObserver(() => {
      const w = this.scroller.clientWidth;
      if (w && Math.abs(w - this.lastWidth) > 2) this.invalidate();
    }).observe(this.scroller);
    ctx.store.subscribe(c => {
      if (c.data) this.invalidate();
      else if (c.selection) {
        this.renderSelection();
        if (c.source !== "sequence") this.revealSelection();
      }
      this.syncClipboard();
    });
    ctx.onOptions(() => this.invalidate());
    this.installMouse();
    this.installKeyboard();
  }

  setVisible(v: boolean) {
    this.visible = v;
    if (v && (this.stale || this.scroller.clientWidth !== this.lastWidth)) this.render();
  }

  /** Puts keyboard focus on the sequence (for typing and the clipboard). */
  focus() {
    this.clipboard.focus({ preventScroll: true });
    this.syncClipboard();
  }

  private invalidate() {
    this.stale = true;
    if (this.visible) this.render();
  }

  // ---------- layout ----------

  private measure() {
    const probe = h("span", { class: "sv-seq-probe" }, "0123456789".repeat(10));
    this.canvas.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 100;
    probe.remove();
    if (w > 2) this.chPx = w;
  }

  render() {
    this.stale = false;
    // Options, edits and a new width change the rows' heights, so the same scroll offset
    // would land elsewhere in the sequence: keep the row at the top of the view there.
    const anchor = this.topAnchor();
    const o = this.ctx.options;
    for (const [k, b] of Object.entries(this.chips)) {
      const on = !!o[k as "complement"];
      b.setAttribute("aria-pressed", String(on));
      b.classList.toggle("sv-chip-off", !on);
    }
    // Colours only show on translations.
    this.chips.aaColors.disabled = !o.translations;
    this.chips.aaColors.title = o.translations ? "Colour amino acids by their chemistry (Clustal X colours)" : "Turn on Translation to colour amino acids";
    this.measure();
    const width = this.scroller.clientWidth || 800;
    this.lastWidth = width;
    const avail = width - GUTTER - 12 - 32;
    this.bpr = Math.max(10, Math.floor(avail / this.chPx / 10) * 10);
    this.layout();
    this.canvas.style.height = `${this.offsets[this.rows.length] ?? 0}px`;
    if (anchor) {
      const i = Math.min(this.rows.length - 1, Math.floor(anchor.base / this.bpr));
      this.scroller.scrollTop = this.offsets[i] + Math.min(anchor.dy, this.rows[i].height - 1);
    }
    for (const r of this.rendered.values()) r.el.remove();
    this.rendered.clear();
    this.renderStrip();
    this.renderVisible();
    this.renderSelection();
  }

  /** The first base of the row at the top of the view, and how far down that row the view starts. */
  private topAnchor(): { base: number; dy: number } | null {
    if (!this.rows.length || !this.scroller.clientHeight) return null;
    const top = this.scroller.scrollTop;
    const i = this.rowAt(top);
    return { base: this.rows[i].start, dy: top - this.offsets[i] };
  }

  private layout() {
    const d = this.ctx.store.data;
    const o = this.ctx.options;
    const n = d.sequence.length;
    const W = this.bpr;
    const rowCount = Math.max(1, Math.ceil(n / W));
    const sans = fontStack("sans");
    const enzFont = `500 10px ${sans}`;
    const sites = o.cutsites ? cutSites(d, o) : [];
    // A cut is a boundary between bases; one on a row's edge goes in the row where the other
    // strand's cut is too, so its leader stays in the row.
    const rowOf = (b: number, toward: number) => (b > 0 && b < n && b % W === 0 && toward >= b ? b / W : Math.floor(Math.min(n - 1, Math.max(0, b - 1)) / W));
    const byRowSites: { site: CutSite; dx: number; bottomRow: number }[][] = Array.from({ length: rowCount }, () => []);
    const cutTails: { from: number; to: number }[][] = Array.from({ length: rowCount }, () => []);
    for (const c of sites) {
      // How far the bottom cut lies from the top one, the short way round on a circle.
      let dx = c.bottomCut - c.cut;
      if (d.circular && Math.abs(dx) > n / 2) dx -= Math.sign(dx) * n;
      const bottom = c.cut + dx < 0 ? c.cut + dx + n : c.cut + dx > n ? c.cut + dx - n : c.cut + dx;
      const row = rowOf(c.cut, c.cut + dx);
      const bottomRow = rowOf(bottom, bottom - dx);
      byRowSites[row]?.push({ site: c, dx, bottomRow });
      if (bottomRow !== row) cutTails[bottomRow]?.push({ from: dx > 0 ? 0 : Math.min(W, n - bottomRow * W), to: bottom - bottomRow * W });
    }
    // Each primer's piece in each row it reaches: its site and its 5′ tail, left of a forward
    // primer and right of a reverse one.
    const primerPieces: { p: SeqPrimer; piece: PrimerPiece }[][] = Array.from({ length: rowCount }, () => []);
    if (o.primers) {
      for (const p of d.primers) {
        const al = primerAlignment(d, p);
        const [fs, fe] = primerFootprint(d, p);
        const rows = new Set<number>();
        for (const [a, b] of clip(fs, fe, 0, n - 1, n)) for (let r = Math.floor(a / W); r <= Math.floor(b / W); r++) rows.add(r);
        for (const r of rows) {
          const r0 = r * W;
          const r1 = Math.min(n - 1, r0 + W - 1);
          const piece = primerPiece(al, p, n, d.circular, pos => (pos >= r0 && pos <= r1 ? pos - r0 : -1));
          if (piece) primerPieces[r].push({ p, piece });
        }
      }
    }
    const featPieces: { f: SeqFeature; a: number; b: number }[][] = Array.from({ length: rowCount }, () => []);
    if (o.features || o.sequenceRegions) {
      for (const f of d.features) {
        if (!o.features && (!isCds(f) || !regionsOf(f).length)) continue;
        for (const [a, b] of clip(f.start, f.end, 0, n - 1, n)) {
          for (let r = Math.floor(a / W); r <= Math.floor(b / W); r++) {
            const r0 = r * W;
            const s0 = Math.max(a, r0);
            const e0 = Math.min(b, r0 + W - 1);
            if (s0 <= e0) featPieces[r].push({ f, a: s0, b: e0 });
          }
        }
      }
    }
    const regionPieces: RegionTrackPiece[][] = Array.from({ length: rowCount }, () => []);
    if (o.sequenceRegions) for (const f of d.features) {
      if (!isCds(f)) continue;
      for (const { region, index } of layoutRegions(regionsOf(f))) {
        const byRow = new Map<number, [number, number][]>();
        for (const span of regionSpans(f, region, n)) {
          for (const [a, b] of clip(span.start, span.end, 0, n - 1, n)) {
            for (let r = Math.floor(a / W); r <= Math.floor(b / W); r++) {
              const r0 = r * W;
              const spans = byRow.get(r) ?? [];
              spans.push([Math.max(a, r0) - r0, Math.min(b, r0 + W - 1) - r0]);
              byRow.set(r, spans);
            }
          }
        }
        for (const [r, spans] of byRow) regionPieces[r].push({ f, region, index, spans });
      }
    }
    const orfPieces: { o: Orf; a: number; b: number }[][] = Array.from({ length: rowCount }, () => []);
    if (o.orfs) {
      for (const orf of orfs(d, o.orfOptions)) {
        for (const [a, b] of clip(orf.start, orf.end, 0, n - 1, n)) {
          for (let r = Math.floor(a / W); r <= Math.floor(b / W); r++) {
            const r0 = r * W;
            const s0 = Math.max(a, r0);
            const e0 = Math.min(b, r0 + W - 1);
            if (s0 <= e0) orfPieces[r].push({ o: orf, a: s0, b: e0 });
          }
        }
      }
    }
    const chW = (text: string, font: string) => textWidth(text, font) / this.chPx;

    this.rows = [];
    this.offsets = [0];
    for (let r = 0; r < rowCount; r++) {
      const r0 = r * W;
      const r1 = Math.min(n - 1, r0 + W - 1);
      // Enzyme labels, stacked so they don't overlap.
      const levelsEnd: number[] = [];
      const len = r1 - r0 + 1;
      const enzymes: EnzymeMark[] = byRowSites[r]
        .sort((a, b) => a.site.cut - b.site.cut)
        .map(({ site, dx, bottomRow }) => {
          const x = site.cut - r0;
          const w = chW(site.enzyme, enzFont) + 0.8;
          // A label near the row's end ends at it, its leader under its last letters.
          const labelX = Math.max(0, Math.min(x, W - w));
          let level = 0;
          while (levelsEnd[level] !== undefined && labelX - 0.3 < levelsEnd[level]) level++;
          levelsEnd[level] = labelX + w;
          const bottomHere = bottomRow === r;
          return { site, x, labelX, bottomX: bottomHere ? x + dx : dx > 0 ? len : 0, bottomHere, level };
        });
      const enzLevels = levelsEnd.length;
      // Primers in lanes, a base apart; a lane gets a raised band only where a piece needs one.
      const primerLanes = (strand: 1 | -1) => {
        const bars = laneAssign(
          primerPieces[r]
            .filter(x => x.p.strand === strand)
            .map(x => {
              const [a, b] = pieceExtent(x.piece, x.p.name, strand === 1, this.chPx, W);
              return { item: x, a, b, w: b - a + 2 };
            })
        );
        const lanes: { band: boolean; pieces: PrimerLane["pieces"] }[] = [];
        for (const bar of bars) {
          const lane = (lanes[bar.lane] ??= { band: false, pieces: [] });
          lane.pieces.push(bar.item);
          if (bar.item.piece.raised) lane.band = true;
        }
        return lanes;
      };
      // Features that only touch share a lane; names that don't fit go where there's room.
      const features = laneAssign(featPieces[r].map(x => ({ item: x.f, a: x.a - r0, b: x.b - r0, w: x.b - x.a + 1 })));
      let y = 0;
      const yEnz = y;
      y += enzLevels * 13 + (enzLevels ? 6 : 0);
      // Forward primers above the top strand, the first lane nearest it; the ruler between
      // the strands; reverse primers under the bottom strand.
      const fwdLanes = primerLanes(1);
      let ly = y + fwdLanes.reduce((sum, l) => sum + laneHeight(l.band), 0);
      const fwd: PrimerLane[] = fwdLanes.map(l => ({ ...l, y: (ly -= laneHeight(l.band)) }));
      y += fwdLanes.reduce((sum, l) => sum + laneHeight(l.band), 0);
      const yTop = y;
      y += 18;
      let yBot = y;
      const yRuler = y;
      y += 12;
      if (o.complement) {
        yBot = y;
        y += 18;
      }
      const rev: PrimerLane[] = primerLanes(-1).map(l => {
        const top = y;
        y += laneHeight(l.band);
        return { ...l, y: top };
      });
      y += 4;
      // ORFs, a lane each where they overlap, a base apart so arrowheads don't touch.
      const orfBars = laneAssign(orfPieces[r].map(x => ({ item: x.o, a: x.a - r0, b: x.b - r0, w: x.b - x.a + 2 })));
      const yOrf = y;
      if (orfBars.length) y += (Math.max(...orfBars.map(b => b.lane)) + 1) * ORF_LANE + 2;
      const laneCount = features.length ? Math.max(...features.map(b => b.lane)) + 1 : 0;
      const laneY: number[] = [];
      const regions: RowLayout["regions"] = [];
      for (let l = 0; l < laneCount; l++) {
        const coding = o.translations && features.some(b => b.lane === l && isCds(b.item));
        laneY.push(y);
        y += o.features ? FEATURE_H + (coding ? CAPTION : 0) + 3 : 0;
        // Reserve space for both the bar and its label before packing tracks. Labels near
        // a row's right edge move left, so neither they nor a long name widen the scroller.
        const inLane = features.filter(b => b.lane === l);
        const bars = layoutRegionTracks(regionPieces[r].flatMap(piece => {
          const spans = piece.spans.flatMap(([a, b]) => inLane.filter(bar => bar.item === piece.f)
            .flatMap(bar => Math.max(a, bar.a) <= Math.min(b, bar.b) ? [[Math.max(a, bar.a), Math.min(b, bar.b)] as [number, number]] : []));
          if (!spans.length) return [];
          return [{ ...piece, spans }];
        }), W, this.chPx);
        if (bars.length) {
          y += 4;
          regions.push(...bars.map(bar => ({ ...bar, y: y + bar.lane * REGION_TRACK_HEIGHT })));
          y += (Math.max(...bars.map(b => b.lane)) + 1) * REGION_TRACK_HEIGHT;
        }
      }
      y += 12;
      this.rows.push({ start: r0, end: r1, height: y, yEnz, enzymes, cutTails: cutTails[r], enzLevels, fwd, yTop, yBot, yRuler, rev, yOrf, orfs: orfBars, features, laneY, regions });
      this.offsets.push(this.offsets[r] + y);
    }
  }

  // ---------- drawing ----------

  private rowAt(y: number): number {
    let lo = 0;
    let hi = this.rows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsets[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private renderVisible() {
    if (!this.visible || !this.rows.length) return;
    const top = this.scroller.scrollTop;
    const bottom = top + this.scroller.clientHeight;
    const first = this.rowAt(Math.max(0, top - 600));
    const last = this.rowAt(bottom + 600);
    for (const [i, r] of this.rendered) {
      if (i < first || i > last) {
        r.el.remove();
        this.rendered.delete(i);
      }
    }
    for (let i = first; i <= last; i++) {
      if (this.rendered.has(i)) continue;
      const built = this.buildRow(i);
      this.canvas.appendChild(built.el);
      this.rendered.set(i, built);
      this.renderRowSelection(i);
    }
    const a = this.rows[this.rowAt(top)];
    const b = this.rows[this.rowAt(Math.max(top, bottom - 1))];
    if (a && b) this.rangeLabel.textContent = `${fmt(a.start + 1)}–${fmt(b.end + 1)}`;
  }

  private buildRow(i: number): { el: HTMLElement; sel: HTMLElement } {
    const row = this.rows[i];
    const d = this.ctx.store.data;
    const o = this.ctx.options;
    const styles = featureStyles(d);
    const len = row.end - row.start + 1;
    const ch = (v: number) => `${Math.round(v * 100) / 100}ch`;
    const abs = (style: string, ...children: (Node | string)[]) => {
      const el = document.createElement("div");
      el.setAttribute("style", "position:absolute;" + style);
      for (const c of children) el.append(c);
      return el;
    };
    const span = (cls: string, text: string) => {
      const el = document.createElement("span");
      el.className = cls;
      el.textContent = text;
      return el;
    };
    const track = h("div", { class: "sv-row-track", style: { width: `${this.bpr}ch`, height: `${row.height}px` } });
    const gutter = h("div", { class: "sv-row-gutter", style: { height: `${row.height}px` } });
    const strandsH = o.complement ? row.yBot + 18 - row.yTop : 18;

    // 10-base stripes.
    for (let b = 0; b < len; b += 10) {
      if (((row.start + b) / 10) % 2 === 1) continue;
      track.appendChild(abs(`left:${ch(b)};width:${ch(Math.min(10, len - b))};top:${row.yTop - 1}px;height:${strandsH + 1}px`, "")).classList.add("sv-stripe");
    }
    // Selection overlay sits under the text.
    const sel = h("div", { class: "sv-row-sel" });
    track.appendChild(sel);

    // Cut sites.
    for (const m of row.enzymes) {
      const ly = row.yEnz + (row.enzLevels - 1 - m.level) * 13;
      const label = abs(`left:${ch(m.labelX)};top:${ly}px;margin-left:-2px`, span("sv-cut-label", m.site.enzyme));
      label.dataset.kind = "cutsite";
      label.dataset.id = m.site.id;
      label.title = `${m.site.enzyme} · ${m.site.site.toUpperCase()} · cuts after ${fmt(m.site.cut)}`;
      label.classList.add("sv-hit");
      track.appendChild(label);
      const stemTop = ly + 12;
      track.appendChild(abs(`left:${ch(m.x)};top:${stemTop}px;width:1px;height:${row.yBot - stemTop}px`, "")).classList.add("sv-cut-line");
      if (o.complement) {
        const lo = Math.min(m.x, m.bottomX);
        const hi = Math.max(m.x, m.bottomX);
        if (hi > lo) track.appendChild(abs(`left:${ch(lo)};top:${row.yBot}px;width:${ch(hi - lo)};height:1px`, "")).classList.add("sv-cut-line");
        if (m.bottomHere) track.appendChild(abs(`left:${ch(m.bottomX)};top:${row.yBot}px;width:1px;height:18px`, "")).classList.add("sv-cut-line");
      }
    }
    // Bottom-strand cuts of sites labelled in the next or last row, reached from the row's edge.
    if (o.complement) {
      for (const t of row.cutTails) {
        const lo = Math.min(t.from, t.to);
        const hi = Math.max(t.from, t.to);
        if (hi > lo) track.appendChild(abs(`left:${ch(lo)};top:${row.yBot}px;width:${ch(hi - lo)};height:1px`, "")).classList.add("sv-cut-line");
        track.appendChild(abs(`left:${ch(t.to)};top:${row.yBot}px;width:1px;height:18px`, "")).classList.add("sv-cut-line");
      }
    }

    // Primers: their own bases in a box against the strand they pair with, the name, tail and
    // changes raised off it (src/views/primerDraw.ts).
    const focus = this.ctx.store.selection.focus;
    const caseOf = (t: string) => (o.caseMode === "uppercase" ? t.toUpperCase() : o.caseMode === "lowercase" ? t.toLowerCase() : t);
    const x = (c: number) => Math.round(c * this.chPx * 100) / 100;
    const strands: [PrimerLane[], number][] = [
      [row.fwd, row.yTop + 9],
      [row.rev, (o.complement ? row.yBot : row.yTop) + 9]
    ];
    for (const [lanes, strandY] of strands) {
      for (const lane of lanes) {
        for (const { p, piece } of lane.pieces) {
          const selected = focus?.kind === "primer" && focus.id === p.id;
          track.appendChild(drawPrimer({ piece, id: p.id, name: p.name, title: primerTitle(d, p), strand: p.strand, ...primerColors(p), selected, x, cw: this.chPx, cols: this.bpr, y: lane.y, band: lane.band, caseOf, strandY }));
        }
      }
    }

    // Bases, in the case chosen in Settings.
    const raw = d.sequence.slice(row.start, row.end + 1);
    const top = o.caseMode === "uppercase" ? raw.toUpperCase() : o.caseMode === "lowercase" ? raw.toLowerCase() : raw;
    track.appendChild(abs(`left:0;top:${row.yTop}px`, top)).className = "sv-bases";
    if (o.complement) track.appendChild(abs(`left:0;top:${row.yBot}px`, complement(top))).className = "sv-bases sv-bases-bottom";

    // Ruler: a number under every tenth base.
    const k = FONT_PX / 9;
    for (let p = Math.ceil((row.start + 1) / 10) * 10; p <= row.end + 1; p += 10) {
      const label = String(p);
      const x = (p - 1 - row.start + 0.5) * k - label.length / 2;
      track.appendChild(abs(`left:${ch(x)};top:${row.yRuler}px`, "")).className = "sv-ruler";
      (track.lastChild as HTMLElement).textContent = label;
    }

    // ORFs: thin arrows, coloured by frame.
    for (const bar of row.orfs) {
      const orf = bar.item;
      const headRight = orf.strand === 1 && row.start + bar.b === orf.end;
      const headLeft = orf.strand === -1 && row.start + bar.a === orf.start;
      const corners = [
        headLeft ? "5px 0" : "0 0",
        headRight ? "calc(100% - 5px) 0" : "100% 0",
        ...(headRight ? ["100% 50%"] : []),
        headRight ? "calc(100% - 5px) 100%" : "100% 100%",
        headLeft ? "5px 100%" : "0 100%",
        ...(headLeft ? ["0 50%"] : [])
      ];
      const el = abs(`left:${ch(bar.a)};width:${ch(bar.b - bar.a + 1)};top:${row.yOrf + bar.lane * ORF_LANE}px;height:7px;clip-path:polygon(${corners.join(",")})`);
      el.className = `sv-orf sv-orf-${orf.strand === 1 ? "f" : "r"}${orf.frame + 1} sv-hit`;
      el.dataset.kind = "orf";
      el.dataset.id = orf.id;
      el.title = orfTitle(orf);
      track.appendChild(el);
    }

    // Features. Touching features meet: an arrowhead sits in a notch cut into the feature it
    // points into, and flat ends that touch get a hairline between them.
    const inLane = (bar: Bar<SeqFeature>) => row.features.filter(x => x !== bar && x.lane === bar.lane);
    const shapes = new Map<Bar<SeqFeature>, { headLeft: boolean; headRight: boolean }>();
    for (const bar of o.features ? row.features : []) {
      const f = bar.item;
      shapes.set(bar, { headLeft: f.strand === -1 && row.start + bar.a === f.start, headRight: f.strand === 1 && row.start + bar.b === f.end });
    }
    for (const bar of o.features ? row.features : []) {
      const f = bar.item;
      const st = styles.get(f.id)!;
      const ly = row.laneY[bar.lane];
      const lh = FEATURE_H;
      const absStart = row.start + bar.a;
      const absEnd = row.start + bar.b;
      const { headLeft, headRight } = shapes.get(bar)!;
      const before = inLane(bar).find(x => x.b === bar.a - 1);
      const after = inLane(bar).find(x => x.a === bar.b + 1);
      const notchLeft = !headLeft && !!before && shapes.get(before)!.headRight;
      const notchRight = !headRight && !!after && shapes.get(after)!.headLeft;
      // A notch reaches back under the neighbour's arrowhead.
      const left = notchLeft ? `calc(${ch(bar.a)} - ${HEAD}px)` : ch(bar.a);
      const width = `calc(${ch(bar.b - bar.a + 1)} + ${(notchLeft ? HEAD : 0) + (notchRight ? HEAD : 0)}px)`;
      const corners = [
        headLeft ? `${HEAD}px 0` : "0 0",
        headRight ? `calc(100% - ${HEAD}px) 0` : "100% 0",
        headRight ? "100% 50%" : notchRight ? `calc(100% - ${HEAD}px) 50%` : "",
        headRight ? `calc(100% - ${HEAD}px) 100%` : "100% 100%",
        headLeft ? `${HEAD}px 100%` : "0 100%",
        headLeft ? "0 50%" : notchLeft ? `${HEAD}px 50%` : ""
      ].filter(Boolean);
      const clipPath = headLeft || headRight || notchLeft || notchRight ? `clip-path:polygon(${corners.join(",")});` : "";
      const coding = isCds(f) && o.translations;
      const place = `left:${left};width:${width};top:${ly}px`;
      const barEl = abs(`${place};height:${lh}px;background:${st.fill};${clipPath}`);
      barEl.className = "sv-feature-bar sv-hit";
      barEl.dataset.kind = "feature";
      barEl.dataset.id = f.id;
      barEl.title = `${f.name} · ${f.type} · ${fmt(f.start + 1)}..${fmt(f.end + 1)}`;
      track.appendChild(barEl);
      if (after && !notchRight && !shapes.get(after)!.headLeft && !headRight) {
        track.appendChild(abs(`left:calc(${ch(bar.b + 1)} - 0.5px);width:1px;top:${ly}px;height:${lh}px;pointer-events:none`)).className = "sv-feature-join";
      }
      // Bases a feature in parts skips (introns): a thin line instead of the bar.
      for (const gap of featureGaps(f, d.sequence.length)) {
        for (const g of pieces(gap, d.sequence.length)) {
          const a = Math.max(g.start, absStart) - row.start;
          const b = Math.min(g.end, absEnd) - row.start;
          if (a > b) continue;
          const mask = abs(`left:${ch(a)};width:${ch(b - a + 1)};top:${ly}px;height:${lh}px;z-index:1;pointer-events:none;background:linear-gradient(var(--panel) 0 calc(50% - 1px),${st.fill} calc(50% - 1px) calc(50% + 1px),var(--panel) calc(50% + 1px))`);
          track.appendChild(mask);
        }
      }
      if (coding) {
        const cs = codons(f, d.sequence).filter(c => c.mid >= absStart && c.mid <= absEnd);
        if (o.aaColors) {
          // Each amino acid in a box over its codon, tinted and lettered by its chemistry;
          // the feature's colour shows round them.
          for (const c of cs) {
            const group = aminoGroup(c.aa);
            const a = Math.max(bar.a, c.mid - 1 - row.start);
            const b = Math.min(bar.b, c.mid + 1 - row.start);
            const box = abs(`left:calc(${ch(a)} + 0.5px);width:calc(${ch(b - a + 1)} - 1px);top:${ly + 1}px;height:${lh - 5}px;pointer-events:none`);
            box.className = `sv-aa-box${group ? ` sv-aa-${group}` : ""}`;
            const letter = span("sv-aa-letter", c.aa);
            letter.style.left = `calc(${ch(c.mid - row.start - a)} - 0.5px)`;
            box.appendChild(letter);
            track.appendChild(box);
          }
        } else {
          // Codon shading and amino acids, centred on each codon. Every other codon gets a box
          // of its own, in a layer cut to the bar's shape: a repeating background lost its
          // phase at the bar's left edge, which shaded a part of the first codon.
          const line = new Array(bar.b + 1).fill(" ");
          const shade = abs(`left:${ch(bar.a)};width:${ch(bar.b - bar.a + 1)};top:${ly}px;height:${lh}px;pointer-events:none;${clipPath && !notchLeft && !notchRight ? clipPath : ""}`);
          for (const c of cs) {
            line[c.mid - row.start] = c.aa;
            if (c.index % 2 === 1) continue;
            const a = Math.max(bar.a, c.mid - 1 - row.start);
            const b = Math.min(bar.b, c.mid + 1 - row.start);
            shade.appendChild(abs(`left:${ch(a - bar.a)};width:${ch(b - a + 1)};top:0;height:100%;background:rgba(0,0,0,.09)`));
          }
          track.appendChild(shade);
          const letters = abs(`left:0;top:${ly}px;line-height:${lh}px;color:${st.text}`, line.join("").replace(/\s+$/, ""));
          letters.className = "sv-aa";
          track.appendChild(letters);
        }
        for (const c of cs) {
          const a = Math.max(bar.a, c.mid - 1 - row.start);
          const b = Math.min(bar.b, c.mid + 1 - row.start);
          track.appendChild(codonHit(f.id, c, a * this.chPx, (b - a + 1) * this.chPx, ly, lh));
        }
        // The name under the amino acids, where the feature starts and again at the start of
        // every row it carries on into, so it's always in view; cut short before the next one.
        const next = Math.min(len, ...inLane(bar).filter(x => x.a > bar.b).map(x => x.a));
        const arrow = f.strand === 1 ? " →" : f.strand === -1 ? " ←" : "";
        // Placed by a wrapper in the bases' font: the caption's own font has a narrower `ch`.
        const cap = abs(
          `left:${ch(bar.a)};top:${ly + lh + 1}px;max-width:calc(${ch(next - bar.a)} - 4px);color:color-mix(in srgb, ${st.fill} 72%, var(--text))`,
          span("sv-feature-caption", `${f.name}${arrow}`)
        );
        cap.className = "sv-hit";
        cap.dataset.kind = "feature";
        cap.dataset.id = f.id;
        cap.title = barEl.title;
        track.appendChild(cap);
      } else {
        const barPx = (bar.b - bar.a + 1) * this.chPx;
        const fits = barPx > textWidth(f.name, `600 10px ${fontStack("sans")}`) + 14;
        // A short bar's name goes after it, up to the next feature in its lane or the row's
        // end: past that it would widen the scroller, which then gains a horizontal scroll bar,
        // changes height and loops the resize observer.
        const next = Math.min(this.bpr, ...row.features.filter(x => x.lane === bar.lane && x.a > bar.b).map(x => x.a));
        const roomPx = (next - bar.b - 1) * this.chPx - 8;
        const named = absStart === f.start || bar.a === 0;
        if (fits || (named && roomPx < 24 && barPx >= 24)) {
          // Cut short inside the bar when there's no room after it.
          const t = span("sv-feature-name", f.name);
          t.style.color = st.text;
          barEl.style.paddingLeft = headLeft || notchLeft ? "9px" : "4px";
          barEl.appendChild(t);
        } else if (named && roomPx >= 24) {
          const t = abs(`left:${ch(bar.b + 1)};top:${ly}px;line-height:${lh}px;padding-left:4px;white-space:nowrap`, span("sv-feature-outside", f.name));
          if (roomPx < 260) (t.firstChild as HTMLElement).style.maxWidth = `${Math.round(roomPx)}px`;
          t.dataset.kind = "feature";
          t.dataset.id = f.id;
          t.classList.add("sv-hit");
          track.appendChild(t);
        }
      }
    }

    track.append(...drawRegionTracks(row.regions, this.chPx));

    gutter.appendChild(abs(`right:0;top:${row.yTop}px;line-height:18px`, span("sv-row-number", fmt(row.start + 1))));
    const el = h("div", { class: "sv-row", style: { top: `${this.offsets[i]}px`, height: `${row.height}px` } }, gutter, track);
    el.dataset.row = String(i);
    return { el, sel };
  }

  // ---------- selection ----------

  private renderSelection() {
    for (const i of this.rendered.keys()) this.renderRowSelection(i);
    const f = this.ctx.store.selection.focus;
    for (const el of this.canvas.querySelectorAll<HTMLElement>(".sv-pr")) el.classList.toggle("sv-pr-selected", f?.kind === "primer" && f.id === el.dataset.id);
    this.updateStripSelection();
  }

  private renderRowSelection(i: number) {
    const r = this.rendered.get(i);
    const row = this.rows[i];
    if (!r || !row) return;
    const { range, caret } = this.ctx.store.selection;
    const n = this.ctx.store.length;
    const o = this.ctx.options;
    const strandsH = o.complement ? row.yBot + 18 - row.yTop : 18;
    const parts: HTMLElement[] = [];
    const ch = (v: number) => `${v}ch`;
    if (range) {
      for (const [a, b] of clip(range.start, range.end, row.start, row.end, n)) {
        const el = document.createElement("div");
        el.className = "sv-sel-band";
        el.setAttribute("style", `left:${ch(a - row.start)};width:${ch(b - a + 1)};top:${row.yTop - 1}px;height:${strandsH + 2}px`);
        parts.push(el);
      }
    }
    const caretRow = caret >= n ? this.rows.length - 1 : Math.floor(caret / this.bpr);
    if (caretRow === i) {
      const el = document.createElement("div");
      el.className = range ? "sv-caret sv-caret-dim" : "sv-caret";
      el.setAttribute("style", `left:${ch(caret - row.start)};top:${row.yTop - 3}px;height:${strandsH + 6}px`);
      parts.push(el);
    }
    r.sel.replaceChildren(...parts);
    // The selected cut site, and the other sites of its enzyme or of the picked ones.
    const { focus } = this.ctx.store.selection;
    markRegionSelection(r.el, focus);
    const picked = pickedEnzymes(this.ctx.store.selection);
    for (const el of Array.from(r.el.querySelectorAll<HTMLElement>('[data-kind="cutsite"]'))) {
      const id = el.dataset.id ?? "";
      const on = focus?.kind === "cutsite" && focus.id === id;
      el.classList.toggle("sv-cut-focused", on);
      el.classList.toggle("sv-cut-related", !on && picked.includes(enzymeOf(id)));
    }
  }

  /** Scrolls so the selection (or caret) is on screen. */
  revealSelection() {
    if (!this.visible || !this.rows.length) return;
    const { range, caret } = this.ctx.store.selection;
    const pos = range ? range.start : Math.min(caret, this.ctx.store.length - 1);
    const i = Math.max(0, Math.min(this.rows.length - 1, Math.floor(pos / this.bpr)));
    const top = this.offsets[i];
    const bottom = this.offsets[i + 1];
    const viewTop = this.scroller.scrollTop;
    const viewBottom = viewTop + this.scroller.clientHeight;
    if (top < viewTop || bottom > viewBottom) this.scroller.scrollTop = Math.max(0, top - 40);
  }

  /** Keeps the caret row in view while moving with the keyboard. */
  private revealCaret() {
    const { caret } = this.ctx.store.selection;
    const i = Math.max(0, Math.min(this.rows.length - 1, Math.floor(Math.min(caret, this.ctx.store.length - 1) / this.bpr)));
    const top = this.offsets[i];
    const bottom = this.offsets[i + 1];
    const viewTop = this.scroller.scrollTop;
    const viewBottom = viewTop + this.scroller.clientHeight;
    if (top < viewTop) this.scroller.scrollTop = top - 8;
    else if (bottom > viewBottom) this.scroller.scrollTop = bottom - this.scroller.clientHeight + 8;
  }

  // ---------- overview strip ----------

  private renderStrip() {
    const d = this.ctx.store.data;
    const n = d.sequence.length || 1;
    const styles = featureStyles(d);
    const pct = (p: number) => `${(p / n) * 100}%`;
    const bars: HTMLElement[] = [];
    for (const f of d.features) {
      for (const [a, b] of clip(f.start, f.end, 0, n - 1, n)) {
        const el = document.createElement("div");
        el.className = "sv-strip-feature";
        el.setAttribute("style", `left:${pct(a)};width:${pct(b - a + 1)};background:${styles.get(f.id)?.fill}`);
        bars.push(el);
      }
    }
    this.strip.replaceChildren(h("div", { class: "sv-strip-line" }), ...bars, this.stripSel, this.stripView);
    this.updateStripView();
    this.updateStripSelection();
  }

  private updateStripView() {
    const n = this.ctx.store.length || 1;
    if (!this.rows.length) return;
    const top = this.scroller.scrollTop;
    const a = this.rows[this.rowAt(top)];
    const b = this.rows[this.rowAt(top + Math.max(1, this.scroller.clientHeight - 1))];
    if (!a || !b) return;
    this.stripView.style.left = `${(a.start / n) * 100}%`;
    this.stripView.style.width = `${Math.max(0.6, ((b.end - a.start + 1) / n) * 100)}%`;
  }

  private updateStripSelection() {
    const { range } = this.ctx.store.selection;
    const n = this.ctx.store.length || 1;
    if (!range) {
      this.stripSel.hidden = true;
      return;
    }
    this.stripSel.hidden = false;
    const start = range.start <= range.end ? range.start : 0;
    const end = range.start <= range.end ? range.end : n - 1;
    this.stripSel.style.left = `${(start / n) * 100}%`;
    this.stripSel.style.width = `${Math.max(0.3, ((end - start + 1) / n) * 100)}%`;
  }

  private jumpFromStrip(e: PointerEvent) {
    const box = this.strip.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - box.left) / Math.max(1, box.width)));
    const pos = Math.floor(frac * this.ctx.store.length);
    const i = Math.floor(pos / this.bpr);
    this.scroller.scrollTop = Math.max(0, (this.offsets[i] ?? 0) - this.scroller.clientHeight / 3);
  }

  // ---------- mouse ----------

  /** Boundary (0…n) under a point in the canvas. */
  private boundaryAt(clientX: number, clientY: number): number {
    const box = this.canvas.getBoundingClientRect();
    const y = clientY - box.top;
    const i = this.rowAt(Math.max(0, y));
    const row = this.rows[i];
    const trackLeft = box.left + GUTTER + 12;
    const x = (clientX - trackLeft) / this.chPx;
    const within = Math.max(0, Math.min(row.end - row.start + 1, Math.round(x)));
    return Math.min(this.ctx.store.length, row.start + within);
  }

  private installMouse() {
    const store = this.ctx.store;
    let anchor: number | null = null;
    let dragging = false;
    let target: Focus | null = null;
    let codon: Range | null = null;
    let startX = 0;
    let startY = 0;
    this.canvas.addEventListener("pointerdown", e => {
      // Control-click is a right-click on a Mac.
      if (e.button !== 0 || (e.ctrlKey && isMac)) return;
      e.preventDefault();
      this.focus();
      const el = (e.target as Element).closest<HTMLElement>(".sv-hit");
      target = el?.dataset.kind ? hitOf(el) : null;
      codon = codonRange(el);
      if (target?.kind === "cutsite" && isPickClick(e)) {
        pickSite(this.ctx, target.id, "sequence");
        anchor = null;
        return;
      }
      const b = this.boundaryAt(e.clientX, e.clientY);
      const sel = store.selection;
      if (e.shiftKey) {
        const from = sel.anchor ?? (sel.range ? sel.range.start : sel.caret);
        this.selectBetween(from, b);
        anchor = from;
      } else anchor = b;
      dragging = false;
      startX = e.clientX;
      startY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", e => {
      if (anchor === null) return;
      if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < 3) return;
      dragging = true;
      this.selectBetween(anchor, this.boundaryAt(e.clientX, e.clientY));
      this.autoScroll(e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (anchor === null) return;
      if (!dragging && !e.shiftKey) {
        if (codon) store.selectRange(codon, null, "sequence");
        else if (target) this.selectAnnotation(target);
        else store.select({ range: null, caret: anchor, anchor }, "sequence");
      }
      anchor = null;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
    this.canvas.addEventListener("contextmenu", e => {
      e.preventDefault();
      const el = (e.target as Element).closest<HTMLElement>(".sv-hit");
      const hit = el?.dataset.kind ? hitOf(el) : null;
      this.focus();
      const t = menuTargetAt(this.ctx, hit, this.boundaryAt(e.clientX, e.clientY), f => this.selectAnnotation(f), "sequence");
      if (t) this.ctx.contextMenu(t, { x: e.clientX, y: e.clientY });
    });
    this.canvas.addEventListener("dblclick", e => {
      const el = (e.target as Element).closest<HTMLElement>(".sv-hit");
      // Pointer capture can send the double-click to the canvas instead of the hit area.
      const hit = el?.dataset.kind ? hitOf(el) : target;
      if (hit) this.selectAnnotation(hit);
    });
  }

  private autoScroll(clientY: number) {
    const box = this.scroller.getBoundingClientRect();
    if (clientY < box.top + 20) this.scroller.scrollTop -= 18;
    else if (clientY > box.bottom - 20) this.scroller.scrollTop += 18;
  }

  /** Selects the bases between two boundaries (the anchor stays fixed). */
  private selectBetween(anchor: number, b: number) {
    const store = this.ctx.store;
    if (anchor === b) store.select({ range: null, caret: b, anchor }, "sequence");
    else store.select({ range: { start: Math.min(anchor, b), end: Math.max(anchor, b) - 1 }, caret: b, anchor }, "sequence");
  }

  private selectAnnotation(f: Focus) {
    const d = this.ctx.store.data;
    let r: Range | null = null;
    if (f.kind === "feature") {
      const x = d.features.find(g => g.id === f.id) ?? null;
      const region = x && f.region !== undefined ? regionsOf(x)[f.region] : undefined;
      r = (x && region && regionRange(x, region, d.sequence.length)) ?? x;
    } else if (f.kind === "primer") r = d.primers.find(x => x.id === f.id) ?? null;
    else if (f.kind === "orf") r = orfs(d, this.ctx.options.orfOptions).find(x => x.id === f.id) ?? null;
    else {
      const c = cutSites(d, this.ctx.options).find(x => x.id === f.id);
      if (c) r = { start: c.start, end: c.end };
    }
    if (r) this.ctx.store.selectRange({ start: r.start, end: r.end }, f, "sequence");
  }

  // ---------- keyboard and clipboard ----------

  /** Keeps the hidden text field holding the selected bases, so the Edit menu's Copy works. */
  private syncClipboard() {
    if (document.activeElement !== this.clipboard) return;
    const { range } = this.ctx.store.selection;
    const text = range ? basesIn(this.ctx.store.data.sequence, range) : "";
    if (this.clipboard.value !== text) this.clipboard.value = text;
    this.clipboard.select();
  }

  private installKeyboard() {
    const store = this.ctx.store;
    const area = this.clipboard;
    const moveTo = (b: number, extend: boolean) => {
      const n = store.length;
      const target = Math.max(0, Math.min(n, b));
      const sel = store.selection;
      if (extend) {
        const from = sel.anchor ?? (sel.range ? (sel.caret === sel.range.start ? sel.range.end + 1 : sel.range.start) : sel.caret);
        this.selectBetween(from, target);
      } else store.select({ range: null, caret: target, anchor: target }, "sequence");
      this.revealCaret();
    };
    let heldAfterFirst = false;
    area.addEventListener("keyup", e => {
      if (e.key === "Backspace" || e.key === "Delete") heldAfterFirst = false;
    });
    area.addEventListener("keydown", e => {
      const mod = e.metaKey || e.ctrlKey;
      const sel = store.selection;
      const n = store.length;
      const caret = sel.caret;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          if (sel.range && !e.shiftKey) moveTo(sel.range.start, false);
          else moveTo(mod ? Math.floor(Math.max(0, caret - 1) / this.bpr) * this.bpr : caret - 1, e.shiftKey);
          return;
        case "ArrowRight":
          e.preventDefault();
          if (sel.range && !e.shiftKey) moveTo(sel.range.end + 1, false);
          else moveTo(mod ? Math.min(n, (Math.floor(caret / this.bpr) + 1) * this.bpr) : caret + 1, e.shiftKey);
          return;
        case "ArrowUp":
          e.preventDefault();
          moveTo(mod ? 0 : caret - this.bpr, e.shiftKey);
          return;
        case "ArrowDown":
          e.preventDefault();
          moveTo(mod ? n : caret + this.bpr, e.shiftKey);
          return;
        case "Home":
          e.preventDefault();
          moveTo(mod ? 0 : Math.floor(caret / this.bpr) * this.bpr, e.shiftKey);
          return;
        case "End":
          e.preventDefault();
          moveTo(mod ? n : Math.min(n, (Math.floor(caret / this.bpr) + 1) * this.bpr), e.shiftKey);
          return;
        case "Escape":
          e.preventDefault();
          store.select({ range: null, caret }, "sequence");
          return;
        case "Backspace":
        case "Delete": {
          e.preventDefault();
          // Held down after a first press on something clicked: its bases wait for a new press.
          if (e.repeat && heldAfterFirst) return;
          const first = firstDelete(store.data, sel);
          if (first) {
            heldAfterFirst = true;
            const left = { range: first.range, caret: sel.caret, anchor: sel.anchor };
            if (first.data !== store.data) {
              store.apply(first.data, first.label ?? "Delete", left);
              this.ctx.noteEdit(first.message);
            } else {
              // Only the selection changed: there is nothing to undo.
              store.select(left, "sequence");
              toast(first.message, "info", { key: "edit", ms: 5000 });
            }
            return;
          }
          if (sel.range) this.deleteSelection();
          else if (e.key === "Backspace" && caret > 0) {
            store.apply(deleteRange(store.data, { start: caret - 1, end: caret - 1 }), "Delete", { caret: caret - 1 }, "delete");
          } else if (e.key === "Delete" && caret < n) {
            store.apply(deleteRange(store.data, { start: caret, end: caret }), "Delete", { caret }, "delete");
          }
          this.revealCaret();
          return;
        }
      }
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "a") {
          e.preventDefault();
          if (n) store.select({ range: { start: 0, end: n - 1 }, caret: n, anchor: 0 }, "sequence");
        } else if (k === "z") {
          e.preventDefault();
          if (e.shiftKey) store.redo();
          else store.undo();
        } else if (k === "y") {
          e.preventDefault();
          store.redo();
        }
        // Copy, cut and paste arrive as clipboard events below.
        return;
      }
      if (e.key.length === 1 && !e.altKey) {
        e.preventDefault();
        if (DNA_CHARS.test(e.key)) this.typeBases(e.key.toUpperCase());
        else if (e.key !== " ") toast(`“${e.key}” isn't a DNA base. Type A, C, G, T or an IUPAC code like N.`, "info", 2200);
      }
    });
    // Anything that slips through as text input is undone; the field mirrors the selection.
    area.addEventListener("input", () => this.syncClipboard());
    area.addEventListener("focus", () => this.el.classList.add("sv-seq-focused"));
    area.addEventListener("blur", () => this.el.classList.remove("sv-seq-focused"));
    area.addEventListener("copy", e => {
      const { range } = store.selection;
      if (!range) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", basesIn(store.data.sequence, range));
    });
    area.addEventListener("cut", e => {
      const { range } = store.selection;
      if (!range) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", basesIn(store.data.sequence, range));
      this.deleteSelection("Cut");
    });
    area.addEventListener("paste", e => {
      e.preventDefault();
      const text = e.clipboardData?.getData("text/plain") || "";
      this.pasteText(text);
    });
  }

  pasteText(text: string) {
    const bases = cleanBases(text).toUpperCase();
    if (!bases) {
      if (text.trim()) toast("The clipboard has no DNA bases to paste.", "info");
      return;
    }
    const dropped = text.replace(/\s+/g, "").length - bases.length;
    this.typeBases(bases, "Paste");
    if (dropped > 0) toast(`Pasted ${fmt(bases.length)} bases (left out ${fmt(dropped)} other characters).`, "info", 3500);
  }

  private typeBases(bases: string, label = "Typing") {
    const store = this.ctx.store;
    const { range, caret } = store.selection;
    if (range) {
      const r = replaceRange(store.data, range, bases);
      store.apply(r.data, label, { caret: r.caret }, label === "Typing" ? "typing" : undefined);
    } else {
      store.apply(insertBases(store.data, caret, bases), label, { caret: caret + bases.length }, label === "Typing" ? "typing" : undefined);
    }
    this.revealCaret();
  }

  deleteSelection(label = "Delete") {
    const store = this.ctx.store;
    const { range } = store.selection;
    if (!range) return;
    const n = store.length;
    const caret = range.start <= range.end ? range.start : Math.max(0, range.start - (range.end + 1));
    store.apply(deleteRange(store.data, range), label, { caret: Math.min(caret, n) });
  }
}
