// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The Map tab: a circular (or linear) map of the sequence drawn as SVG, with features,
// primers and cut sites, labels laid out so they don't overlap, and selection by clicking
// annotations or dragging around the map.

import { h } from "../ui/dom.ts";
import { enzymeControls, enzymeSummary } from "./enzymeControls.ts";
import { fontStack, s, textWidth } from "../ui/svg.ts";
import { cutSiteById, cutSites, featureStyles, orfs, orfTitle, primerColors } from "../doc/analysis.ts";
import type { DocContext } from "../doc/context.ts";
import { type CutSite } from "../lib/enzymes.ts";
import type { Focus } from "../doc/store.ts";
import { menuTargetAt } from "../doc/contextMenu.ts";
import { isPickClick, pickSite } from "../doc/pickEnzyme.ts";
import { enzymeOf, pickedEnzymes } from "../lib/enzymePick.ts";
import { layoutRegions, regionColor, regionRange, regionSpans, regionsOf, regionTextColor, regionTitle, type ProteinRegion } from "../lib/regions.ts";
import { featureGaps, pieces as rangePieces, rangeLength, type Range, type SeqData, type SeqFeature } from "../lib/seqdata.ts";
import { checkIcon, iconSvg } from "../ui/icons.ts";
import { fmt, fmtRange } from "../ui/format.ts";
import { selectedRanges } from "../lib/selection.ts";
import { sweep, sweptRange } from "../lib/mapDrag.ts";


interface LabelItem {
  angle: number;
  /** Radius where the leader line starts. */
  r: number;
  text: string;
  kind: "feature" | "primer" | "cutsite";
  id: string;
  region?: number;
  /** The feature's or primer's own colour, for its mark, text and leader. */
  color?: string;
  /** Which way a primer points, for its mark. */
  strand?: 1 | -1;
  /** An enzyme that cuts once, which is the one people look for. */
  unique?: boolean;
  /** Tooltip, for labels whose shape on the map has none. */
  title?: string;
  width: number;
  y: number;
  ly: number;
}

/** Width of the mark before a primer's label, and the space after it, for labels of `px`. */
const glyphSize = (px: number) => px * 0.85;
const glyphGap = (px: number) => Math.max(3, px * 0.35);
/** Room either side of a feature's name inside its background. */
const chipPad = (px: number) => Math.max(3, px * 0.45);
/** Enzymes are set smaller, in monospace (`.sv-map-label-cut`), so they read as the quiet kind. */
const CUT_SCALE = 0.92;

/**
 * The background behind a feature's name, a tint of the feature's colour: features are what
 * a map is read for, so they get the strongest mark. It starts at `x` and grows towards
 * `dir` over `textW` and its padding, centred on `y`.
 */
function labelChip(l: Pick<LabelItem, "id" | "color">, x: number, y: number, textW: number, px: number, dir: 1 | -1): SVGElement {
  const w = textW + 2 * chipPad(px);
  const hgt = px * 1.12;
  return s("rect", {
    x: f1(dir > 0 ? x : x - w),
    y: f1(y - hgt / 2),
    width: f1(w),
    height: f1(hgt),
    rx: f1(px * 0.3),
    class: "sv-map-chip",
    style: l.color ? `--lc:${l.color}` : undefined,
    "data-kind": "feature",
    "data-id": l.id
  });
}

/**
 * The small mark beside a primer's or a region's label: an arrow pointing the primer's way,
 * or a square of the region's colour, which tells which of a protein's many small segments
 * a name belongs to. It is `size` wide from `x`, growing towards `dir`, centred on `y`.
 * Features have a background instead (`labelChip`), and enzymes nothing: with dozens of
 * them marks made the map busy, and their font and dotted leader set them apart already.
 */
function labelGlyph(l: Pick<LabelItem, "kind" | "id" | "color" | "strand" | "region">, x: number, y: number, size: number, dir: 1 | -1): SVGElement | null {
  const x0 = dir > 0 ? x : x - size;
  const at = { "data-kind": l.kind, "data-id": l.id };
  if (l.region !== undefined) {
    const side = size * 0.64;
    return s("rect", { ...at, "data-region": l.region, x: f1(dir > 0 ? x0 : x0 + size - side), y: f1(y - side / 2), width: f1(side), height: f1(side), rx: f1(side * 0.22), fill: l.color, class: "sv-map-swatch" });
  }
  if (l.kind === "primer") {
    const reverse = l.strand === -1;
    const tip = reverse ? x0 : x0 + size;
    const back = reverse ? size * 0.4 : -size * 0.4;
    const hh = size * 0.34;
    const d = `M${f1(reverse ? x0 + size : x0)},${f1(y)} H${f1(tip)} M${f1(tip + back)},${f1(y - hh)} L${f1(tip)},${f1(y)} L${f1(tip + back)},${f1(y + hh)}`;
    return s("path", { ...at, d, class: "sv-map-glyph sv-map-glyph-primer", style: l.color ? `--pc:${l.color}` : undefined });
  }
  return null;
}

/** An enzyme's tooltip: how often it cuts, which is what decides whether it is any use. */
const cutTitle = (c: CutSite) => (c.cuts === 1 ? `${c.enzyme} · cuts once, at ${fmt(c.cut)}` : `${c.enzyme} · cuts ${fmt(c.cuts)} times · this cut at ${fmt(c.cut)}`);

/** Map tooltips name the owning CDS, including for a region nested in another region. */
const mapRegionTitle = (r: ProteinRegion, f: SeqFeature) => `${regionTitle(r)} · region of ${f.name}`;

/** Class names of a label's text, by kind (and, for an enzyme, whether it cuts once). */
const labelClass = (l: Pick<LabelItem, "kind" | "unique" | "region">) =>
  l.kind === "cutsite" ? `sv-map-label sv-map-label-cut${l.unique ? " sv-map-unique" : ""}` : l.kind === "primer" ? "sv-map-label sv-map-label-primer" : l.region !== undefined ? "sv-map-label sv-map-region-label" : "sv-map-label sv-map-label-feature";

interface Geometry {
  n: number;
  rotation: number;
  circular: boolean;
  /** Linear map: x of position 0 and px per base. */
  x0?: number;
  scale?: number;
  selTop?: number;
  selBottom?: number;
}

const BAND_OUT = 151;
const BAND = 18;
const LANE_STEP = 22;
const PRIMER_R = 158;
const PRIMER_STEP = 7;
/** ORF arcs inside the features: thickness and lane step. */
const ORF_BAND = 4;
const ORF_STEP = 7;

/** A "nice" ruler step giving roughly `count` ticks over `n`. */
function niceStep(n: number, count: number): number {
  const raw = n / count;
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

const isMac = /Mac/.test(navigator.platform || navigator.userAgent);

// The zoom slider runs 0…100 on a log scale up to 8×, so each step enlarges by about 2%.
const ZOOM_MAX = 8;
const zoomToSlider = (z: number) => Math.round((Math.log(Math.max(1, z)) / Math.log(ZOOM_MAX)) * 100);
const sliderToZoom = (v: number) => Math.round(ZOOM_MAX ** (v / 100) * 100) / 100;

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();

function pt(a: number, r: number): [number, number] {
  const t = (a * Math.PI) / 180;
  return [r * Math.sin(t), -r * Math.cos(t)];
}
const P = (p: [number, number]) => `${f1(p[0])},${f1(p[1])}`;

/** What a clicked shape stands for; a region's band also says which region. */
function hitOf(el: Element): Focus {
  const region = el.getAttribute("data-region");
  return { kind: el.getAttribute("data-kind") as Focus["kind"], id: el.getAttribute("data-id") || "", ...(region === null ? {} : { region: Number(region) }) };
}

/** Degrees an arrowhead takes on an arc of `span` degrees at radius `rm`. */
const headAngle = (span: number, rm: number, dir: number, headPx = 9) => (dir ? Math.min((headPx / (2 * Math.PI * rm)) * 360, span * 0.6) : 0);

/**
 * Annular segment from angle a0 to a1 (clockwise, degrees), with an optional arrowhead.
 * `notch` cuts a notch of that many degrees into the start or end, for a neighbour's
 * arrowhead to sit in, so features that touch meet without a gap.
 */
function arcShape(a0: number, a1: number, r1: number, r2: number, dir: 1 | -1 | 0, headPx = 9, notch: [number, number] = [0, 0]): string {
  let span = a1 - a0;
  if (span <= 0) span += 360;
  span = Math.min(span, 359.6);
  const b = a0 + span;
  const rm = (r1 + r2) / 2;
  const hb = headAngle(span, rm, dir, headPx);
  const s0 = dir === -1 ? a0 + hb : a0 - notch[0];
  const s1 = dir === 1 ? b - hb : b + notch[1];
  const large = s1 - s0 > 180 ? 1 : 0;
  let d = `M${P(pt(s0, r2))} A${r2},${r2} 0 ${large} 1 ${P(pt(s1, r2))} `;
  if (dir === 1 || notch[1]) d += `L${P(pt(b, rm))} `;
  d += `L${P(pt(s1, r1))} A${r1},${r1} 0 ${large} 0 ${P(pt(s0, r1))} `;
  if (dir === -1 || notch[0]) d += `L${P(pt(a0, rm))} `;
  return d + "Z";
}

/** A bar from x1 to x2 with an arrowhead or a notch (for a neighbour's arrowhead) at either end. */
function barPath(x1: number, x2: number, y: number, hgt: number, head: { left: number; right: number }, notch: { left: number; right: number }): string {
  const mid = f1(y + hgt / 2);
  const lx = head.left ? x1 + head.left : x1 - notch.left;
  const rx = head.right ? x2 - head.right : x2 + notch.right;
  const right = head.right || notch.right ? `L${f1(x2)},${mid} ` : "";
  const left = head.left || notch.left ? `L${f1(x1)},${mid} ` : "";
  return `M${f1(lx)},${y} H${f1(rx)} ${right}L${f1(rx)},${y + hgt} H${f1(lx)} ${left}Z`;
}

/**
 * For each feature, the feature in the same lane that ends where it starts with an arrowhead
 * pointing into it (`before`), and the one that starts where it ends pointing back (`after`).
 */
function arrowNeighbours<K>(feats: SeqFeature[], laneOf: (f: SeqFeature) => K, n: number): Map<SeqFeature, { before?: SeqFeature; after?: SeqFeature }> {
  const out = new Map<SeqFeature, { before?: SeqFeature; after?: SeqFeature }>();
  const byStart = new Map<string, SeqFeature[]>();
  for (const f of feats) {
    const k = `${laneOf(f)}:${f.start}`;
    byStart.set(k, [...(byStart.get(k) ?? []), f]);
  }
  for (const g of feats) {
    for (const f of byStart.get(`${laneOf(g)}:${(g.end + 1) % n}`) ?? []) {
      if (f === g) continue;
      // Only one of two arrowheads pointing at each other can sit in a notch: neither does.
      if (g.strand === 1 && f.strand !== -1) out.set(f, { ...out.get(f), before: g });
      if (f.strand === -1 && g.strand !== 1) out.set(g, { ...out.get(g), after: f });
    }
  }
  return out;
}

/** Labels beside the map are cut short so one long name can't shrink the whole map. */
const shortLabel = (name: string, max = 32) => (name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name);

function arcPath(a0: number, a1: number, r: number, reverse: boolean): string {
  let span = a1 - a0;
  if (span <= 0) span += 360;
  const b = a0 + Math.min(span, 359.6);
  const large = b - a0 > 180 ? 1 : 0;
  return reverse ? `M${P(pt(b, r))} A${r},${r} 0 ${large} 0 ${P(pt(a0, r))}` : `M${P(pt(a0, r))} A${r},${r} 0 ${large} 1 ${P(pt(b, r))}`;
}

/** Places labels on one side without overlaps, keeping each close to where it points. */
function layoutLabels(items: LabelItem[], gap: number) {
  items.sort((a, b) => a.y - b.y);
  let clusters: LabelItem[][] = items.map(it => [it]);
  const place = (c: LabelItem[]) => {
    const mean = c.reduce((s, it) => s + it.y, 0) / c.length;
    const top = mean - ((c.length - 1) * gap) / 2;
    c.forEach((it, k) => (it.ly = top + k * gap));
  };
  clusters.forEach(place);
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < clusters.length - 1; i++) {
      const a = clusters[i];
      const b = clusters[i + 1];
      if (a[a.length - 1].ly + gap > b[0].ly) {
        clusters = [...clusters.slice(0, i), [...a, ...b], ...clusters.slice(i + 2)];
        place(clusters[i]);
        changed = true;
        break;
      }
    }
  }
}

/** Assigns overlapping arcs to lanes (0 = outermost). Intervals are boundary pairs, may wrap. */
function assignLanes<T>(items: { item: T; start: number; end: number }[], n: number, pad: number): Map<T, number> {
  const lanes: [number, number][][] = [];
  const out = new Map<T, number>();
  const piecesOf = (s0: number, e0: number): [number, number][] => (e0 > s0 ? [[s0, e0]] : [[s0, n], [0, e0]]);
  const sorted = [...items].sort((a, b) => ((b.end - b.start + n) % n || n) - ((a.end - a.start + n) % n || n));
  for (const it of sorted) {
    const ps = piecesOf(it.start, it.end);
    let lane = 0;
    for (; lane < lanes.length; lane++) {
      if (!lanes[lane].some(([a, b]) => ps.some(([c, d]) => c < b + pad && a < d + pad))) break;
    }
    if (!lanes[lane]) lanes[lane] = [];
    lanes[lane].push(...ps);
    out.set(it.item, lane);
  }
  return out;
}

export class MapView {
  readonly el: HTMLElement;
  private area: HTMLElement;
  private svgHost: HTMLElement;
  private svg: SVGSVGElement | null = null;
  private selLayer: SVGGElement | null = null;
  private geom: Geometry | null = null;
  private shapes = new Map<string, SVGElement[]>();
  private focused: SVGElement[] = [];
  private hoveredKey: string | null = null;
  private hovered: SVGElement[] = [];
  private hoveredParents: SVGElement[] = [];
  private chips: Record<string, HTMLButtonElement> = {};
  private modeButtons: { circular: HTMLButtonElement; linear: HTMLButtonElement };
  private sliders: { rotate: HTMLInputElement; zoom: HTMLInputElement; label: HTMLInputElement };
  private rotateWrap: HTMLElement;
  private enzymeControls: ReturnType<typeof enzymeControls>;
  private proteinSelect: HTMLSelectElement;
  /** The buttons beside the Cut sites and Regions chips that open their menus. */
  private menuButtons: { cutsites: HTMLButtonElement; regions: HTMLButtonElement };
  private closeMenu: (() => void) | null = null;
  private visible = false;
  private stale = true;
  private ctx: DocContext;

  constructor(ctx: DocContext) {
    this.ctx = ctx;
    const chip = (key: "features" | "mapRegions" | "primers" | "orfs" | "cutsites" | "ruler", label: string) => {
      const b = h("button", { type: "button", class: "sv-chip", onclick: () => ctx.setOptions({ [key]: !ctx.options[key] }) }, checkIcon(), label);
      this.chips[key] = b;
      return b;
    };
    this.modeButtons = {
      circular: h("button", { type: "button", onclick: () => ctx.setOptions({ linearMap: false }) }, "Circular"),
      linear: h("button", { type: "button", onclick: () => ctx.setOptions({ linearMap: true }) }, "Linear")
    };
    this.enzymeControls = enzymeControls(ctx, true);
    this.proteinSelect = h("select", { class: "sv-input sv-input-small", "aria-label": "Protein region detail", onchange: () => ctx.setOptions({ proteinDetail: this.proteinSelect.value as "domains" | "all" }) },
      h("option", { value: "domains" }, "Top level"), h("option", { value: "all" }, "All regions")) as HTMLSelectElement;
    // What a chip draws is chosen in a menu beside it, which says the choice while closed.
    const cutsMenu = this.chipMenu("Cut site options", h("div", { class: "sv-chip-menu-body" }, this.enzymeControls.el, this.enzymeControls.edit));
    const regionsMenu = this.chipMenu("Region options", h("label", { class: "sv-enzyme-filter" }, h("span", null, "Show"), this.proteinSelect));
    this.menuButtons = { cutsites: cutsMenu.button, regions: regionsMenu.button };
    const header = h(
      "div",
      { class: "sv-pane-head" },
      chip("features", "Features"),
      h("div", { class: "sv-chip-group" }, chip("mapRegions", "Regions"), regionsMenu.button, regionsMenu.menu),
      chip("primers", "Primers"),
      chip("orfs", "ORFs"),
      h("div", { class: "sv-chip-group sv-chip-joined" }, chip("cutsites", "Cut sites"), cutsMenu.button, cutsMenu.menu),
      chip("ruler", "Ruler"),
      h("div", { class: "sv-segmented sv-push" }, this.modeButtons.circular, this.modeButtons.linear)
    );
    this.svgHost = h("div", { class: "sv-map-svg" });
    this.area = h("div", { class: "sv-map-area" }, this.svgHost);

    const slider = (label: string, iconName: "rotate" | "zoom" | "text", min: number, max: number, value: number, onInput: (v: number) => void) => {
      const input = h("input", { type: "range", min: String(min), max: String(max), value: String(value), "aria-label": label }) as HTMLInputElement;
      input.addEventListener("input", () => onInput(Number(input.value)));
      return { input, wrap: h("label", { class: "sv-map-slider", title: label }, iconSvg(iconName), input) };
    };
    const rot = slider("Rotate", "rotate", 0, 359, ctx.options.mapRotation, v => ctx.setOptions({ mapRotation: v }));
    const zoom = slider("Zoom", "zoom", 0, 100, zoomToSlider(ctx.options.mapZoom), v => this.zoomTo(sliderToZoom(v)));
    const lab = slider("Label size", "text", 3, 16, ctx.options.labelSize, v => ctx.setOptions({ labelSize: v }));
    this.sliders = { rotate: rot.input, zoom: zoom.input, label: lab.input };
    this.rotateWrap = rot.wrap;
    // Back to the whole map, which every map opens at.
    const fit = h("button", { type: "button", class: "sv-link sv-map-fit", title: "Fit the map to the window", onclick: () => {
      this.ctx.setOptions({ mapZoom: 1 });
      this.area.scrollTo(0, 0);
    } }, "Fit");
    // Only what moves the drawing; what it draws is chosen in the chips above.
    const controls = h("div", { class: "sv-map-controls" }, rot.wrap, h("div", { class: "sv-map-zoom" }, zoom.wrap, fit), lab.wrap);
    this.el = h("div", { class: "sv-map" }, header, this.area, controls);

    this.installPointer();
    ctx.store.subscribe(c => {
      if (c.data) this.invalidate();
      else if (c.selection) this.renderSelection();
    });
    ctx.onOptions(() => this.invalidate());
    new ResizeObserver(() => {
      if (this.isLinear()) this.invalidate();
    }).observe(this.area);
  }

  setVisible(v: boolean) {
    this.visible = v;
    if (!v) {
      this.closeMenu?.();
      this.hoverRegion(null);
    }
    if (v && this.stale) this.render();
  }

  /** A button opening `body` under it; one menu is open at a time, and it closes on Escape or a click outside. */
  private chipMenu(label: string, body: HTMLElement) {
    const menu = h("div", { class: "sv-chip-menu", role: "dialog", "aria-label": label, hidden: true }, body);
    const button = h("button", { type: "button", class: "sv-chip sv-chip-more", "aria-label": label, "aria-haspopup": "dialog", "aria-expanded": "false" }) as HTMLButtonElement;
    const outside = (e: PointerEvent) => {
      if (!menu.contains(e.target as Node) && !button.contains(e.target as Node)) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
      button.focus();
    };
    const close = () => {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", outside, true);
      menu.removeEventListener("keydown", key);
      if (this.closeMenu === close) this.closeMenu = null;
    };
    button.addEventListener("click", () => {
      if (!menu.hidden) return close();
      this.closeMenu?.();
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
      document.addEventListener("pointerdown", outside, true);
      menu.addEventListener("keydown", key);
      this.closeMenu = close;
      menu.querySelector<HTMLElement>("[role=\"radio\"][aria-checked=\"true\"], select")?.focus();
    });
    return { button, menu };
  }

  private invalidate() {
    this.stale = true;
    if (this.visible) this.render();
  }

  /** Zooms keeping the middle of what is on screen in the middle. */
  private zoomTo(zoom: number) {
    const a = this.area;
    const cx = a.scrollWidth ? (a.scrollLeft + a.clientWidth / 2) / a.scrollWidth : 0.5;
    const cy = a.scrollHeight ? (a.scrollTop + a.clientHeight / 2) / a.scrollHeight : 0.5;
    this.ctx.setOptions({ mapZoom: zoom });
    a.scrollLeft = cx * a.scrollWidth - a.clientWidth / 2;
    a.scrollTop = cy * a.scrollHeight - a.clientHeight / 2;
  }

  private isLinear() {
    return this.ctx.options.linearMap || !this.ctx.store.data.circular;
  }

  render() {
    this.hoverRegion(null);
    this.stale = false;
    const o = this.ctx.options;
    for (const [k, b] of Object.entries(this.chips)) {
      const on = !!o[k as "features"];
      b.setAttribute("aria-pressed", String(on));
      b.classList.toggle("sv-chip-off", !on);
    }
    const linear = this.isLinear();
    this.modeButtons.circular.setAttribute("aria-pressed", String(!linear));
    this.modeButtons.linear.setAttribute("aria-pressed", String(linear));
    this.modeButtons.circular.disabled = !this.ctx.store.data.circular;
    this.rotateWrap.hidden = linear;
    this.sliders.rotate.value = String(o.mapRotation);
    this.sliders.zoom.value = String(zoomToSlider(o.mapZoom));
    this.sliders.label.value = String(o.labelSize);
    this.enzymeControls.update();
    this.proteinSelect.value = o.proteinDetail;
    this.proteinSelect.disabled = !o.mapRegions;

    const d = this.ctx.store.data;
    // Top-level/all only changes nested regions; independent overlaps stay in both.
    this.proteinSelect.hidden = !o.features || !o.mapRegions || !d.features.some(f => layoutRegions(regionsOf(f)).some(r => r.depth > 0));
    const { cutsites, regions } = this.menuButtons;
    cutsites.replaceChildren(enzymeSummary(o), iconSvg("chevronDown", 12));
    regions.replaceChildren(o.proteinDetail === "all" ? "All" : "Top level", iconSvg("chevronDown", 12));
    regions.hidden = this.proteinSelect.hidden;
    regions.parentElement?.classList.toggle("sv-chip-joined", !regions.hidden);
    if (regions.hidden && regions.getAttribute("aria-expanded") === "true") this.closeMenu?.();
    this.shapes.clear();
    this.focused = [];
    if (!d.sequence.length) {
      this.svgHost.replaceChildren(h("div", { class: "sv-empty" }, "This sequence is empty. Switch to the Sequence tab and type or paste bases."));
      this.svg = null;
      return;
    }
    const svg = linear ? this.buildLinear(d) : this.buildCircular(d);
    this.svg = svg;
    this.svgHost.replaceChildren(svg);
    // Zoom enlarges the drawing inside the scrollable area.
    this.svgHost.style.width = linear ? "" : `${o.mapZoom * 100}%`;
    this.svgHost.style.height = linear ? "" : `${o.mapZoom * 100}%`;
    this.svgHost.classList.toggle("sv-map-svg-linear", linear);
    this.renderSelection();
  }

  // ---------- circular ----------

  private buildCircular(d: SeqData): SVGSVGElement {
    const o = this.ctx.options;
    const n = d.sequence.length;
    const rot = o.mapRotation;
    const ang = (boundary: number) => (boundary / n) * 360 + rot;
    const styles = featureStyles(d);
    const sans = fontStack("sans");
    const mono = fontStack("mono");
    const labelPx = 10.5 * (o.labelSize / 8);
    const gap = labelPx * 1.32;
    const labelFont = (w: number) => `${w} ${labelPx}px ${sans}`;
    const cutFont = `400 ${labelPx * CUT_SCALE}px ${mono}`;
    const pad = Math.max(1, n * 0.002);

    // Feature lanes, outermost first. Features that only touch share a lane.
    const feats = o.features ? d.features : [];
    const lanes = assignLanes(
      feats.map(f => ({ item: f, start: f.start, end: (f.end + 1) % n || n })),
      n,
      0
    );
    const laneCount = Math.max(1, ...Array.from(lanes.values()).map(l => l + 1));
    const innermost = BAND_OUT - (laneCount - 1) * LANE_STEP - BAND;
    // ORF lanes, going inwards from the features; the ruler sits inside them.
    const orfList = o.orfs ? orfs(d, o.orfOptions) : [];
    const oLanes = assignLanes(
      orfList.map(x => ({ item: x, start: x.start, end: (x.end + 1) % n || n })),
      n,
      pad
    );
    const oLaneCount = orfList.length ? Math.max(...Array.from(oLanes.values())) + 1 : 0;
    const rulerOut = innermost - (oLaneCount ? oLaneCount * ORF_STEP + 3 : 0);

    // Primer lanes, going outwards.
    const primers = o.primers ? d.primers : [];
    const pLanes = assignLanes(
      primers.map(p => ({ item: p, start: p.start, end: (p.end + 1) % n || n })),
      n,
      pad
    );
    const pLaneCount = primers.length ? Math.max(...Array.from(pLanes.values())) + 1 : 0;
    const outer = pLaneCount ? PRIMER_R + (pLaneCount - 1) * PRIMER_STEP + 4 : BAND_OUT;
    const tickOut = outer + 9;
    const knee = tickOut + 10;
    const rLab = knee + 21;

    const root = s("g");
    const sel = s("g", { class: "sv-map-sel" });
    root.appendChild(sel);
    this.selLayer = sel;

    // Backbone and ruler.
    root.appendChild(s("circle", { cx: 0, cy: 0, r: BAND_OUT - BAND / 2, fill: "none", class: "sv-map-backbone" }));
    if (o.ruler) {
      const step = niceStep(n, 6);
      const minor = step / 5 >= 1 ? step / 5 : step;
      const ticks = s("g", { class: "sv-map-tick" });
      const tickLabels = s("g", { class: "sv-map-ticklabel", "font-size": 9.5, "text-anchor": "middle", "dominant-baseline": "central", "font-family": mono });
      const tr = rulerOut - 1;
      for (let p = minor; p < n; p += minor) {
        const major = Math.abs(p / step - Math.round(p / step)) < 1e-9;
        const a = ang(p);
        ticks.appendChild(s("line", { x1: f1(pt(a, tr)[0]), y1: f1(pt(a, tr)[1]), x2: f1(pt(a, tr - (major ? 8 : 4))[0]), y2: f1(pt(a, tr - (major ? 8 : 4))[1]) }));
        if (major) {
          const [x, y] = pt(a, tr - 20);
          tickLabels.appendChild(s("text", { x: f1(x), y: f1(y) }, fmt(p)));
        }
      }
      root.append(ticks, tickLabels);
    }

    const labels: LabelItem[] = [];
    const arcLabels = s("g", { "font-size": labelPx, "dominant-baseline": "central" });
    const defs = s("defs");
    root.appendChild(defs);

    // Features.
    const featureLayer = s("g");
    const touching = arrowNeighbours(feats, f => lanes.get(f) ?? 0, n);
    const headOf = (g: SeqFeature, r1: number, r2: number) => headAngle(((rangeLength(g, n) / n) * 360), (r1 + r2) / 2, g.strand);
    feats.forEach((f, i) => {
      const lane = lanes.get(f) ?? 0;
      const r2 = BAND_OUT - lane * LANE_STEP;
      const r1 = r2 - BAND;
      const a0 = ang(f.start);
      const a1 = ang(f.end + 1);
      let span = a1 - a0;
      if (span <= 0) span += 360;
      // Features that touch meet: an arrowhead sits in a notch in its neighbour.
      const nb = touching.get(f);
      const notch: [number, number] = [nb?.before ? headOf(nb.before, r1, r2) : 0, nb?.after ? headOf(nb.after, r1, r2) : 0];
      const st = styles.get(f.id)!;
      const shape = arcShape(a0, a1, r1, r2, f.strand, 9, notch);
      // Regions of the protein: segments of the CDS's own arrow, not features of their own.
      const regionRows = layoutRegions(regionsOf(f), o.mapRegions ? o.proteinDetail : "none");
      const banded = regionRows.length > 0;
      const title = `${f.name} · ${f.type} · ${fmtRange(f.start + 1, f.end + 1)} (${fmt(rangeLength(f, n))} bp)`;
      const path = s(
        "path",
        { d: shape, fill: st.fill, class: "sv-map-feature", "data-kind": "feature", "data-id": f.id },
        s("title", null, title)
      );
      featureLayer.appendChild(path);
      this.addShape(`feature:${f.id}`, path);
      if (banded) {
        const clip = `sv-clip-${i}`;
        defs.appendChild(s("clipPath", { id: clip }, s("path", { d: shape })));
        const segments = s("g", { "clip-path": `url(#${clip})` });
        const regionLanes = Math.max(1, ...regionRows.map(r => r.lane + 1));
        const thick = BAND / regionLanes;
        regionRows.forEach(({ region, index, lane }) => {
          // Top-level regions outermost; the outer and inner lanes run past the band, so
          // the clip, not a segment's separating stroke, makes the CDS's edge.
          const top = r2 - lane * thick;
          const bottom = top - thick;
          const key = `feature:${f.id}:region:${index}`;
          const spans = regionSpans(f, region, n);
          for (const span of spans) {
            const seg = s("path", { d: arcShape(ang(span.start), ang(span.end + 1), lane === regionLanes - 1 ? bottom - 2 : bottom, lane === 0 ? top + 2 : top, 0), fill: regionColor(region), class: "sv-map-region", "data-kind": "feature", "data-id": f.id, "data-region": index }, s("title", null, mapRegionTitle(region, f)));
            segments.appendChild(seg);
            this.addShape(key, seg);
          }
          // Its name on its longest piece where it fits, as a feature's is; else beside the map.
          const longest = spans.reduce<Range | null>((best, sp) => (!best || rangeLength(sp, n) > rangeLength(best, n) ? sp : best), null);
          if (!longest) return;
          const rm = top - thick / 2;
          const sweep = (rangeLength(longest, n) / n) * 360;
          const tw = textWidth(region.name, labelFont(500));
          if (thick >= labelPx + 3 && (sweep / 360) * 2 * Math.PI * rm > tw + 10) {
            const mid = (ang(longest.start) + sweep / 2) % 360;
            const pid = `sv-arc-${i}-${index}`;
            defs.appendChild(s("path", { id: pid, d: arcPath(ang(longest.start), ang(longest.end + 1), rm, mid > 90 && mid < 270) }));
            const name = s("text", { "font-weight": 500, fill: regionTextColor(region), class: "sv-map-region-name", "data-kind": "feature", "data-id": f.id, "data-region": index }, s("textPath", { href: `#${pid}`, startOffset: "50%", "text-anchor": "middle" }, region.name));
            arcLabels.appendChild(name);
            this.addShape(key, name);
            return;
          }
          const range = regionRange(f, region, n)!;
          labels.push({ angle: ang(range.start) + rangeLength(range, n) / n * 180, r: r2, text: region.name, kind: "feature", id: f.id, region: index, color: regionColor(region), title: mapRegionTitle(region, f), width: textWidth(region.name, labelFont(400)), y: 0, ly: 0 });
        });
        featureLayer.appendChild(segments);
        // The arrow's outline over its segments; selection and hover style it as the CDS.
        const outline = s("path", { d: shape, class: "sv-map-feature sv-map-outline", "pointer-events": "none", "data-kind": "feature", "data-id": f.id });
        featureLayer.appendChild(outline);
        this.addShape(`feature:${f.id}`, outline);
      }
      // Bases a feature in parts skips (introns): a thin line instead of the band.
      for (const gap of featureGaps(f, n)) {
        const g0 = ang(gap.start);
        const g1 = ang(gap.end + 1);
        featureLayer.appendChild(s("path", { d: arcShape(g0, g1, r1 - 0.5, r2 + 0.5, 0), style: "fill:var(--panel)", "pointer-events": "none" }));
        featureLayer.appendChild(s("path", { d: arcPath(g0, g1, (r1 + r2) / 2, false), fill: "none", stroke: st.fill, "stroke-width": 2, "pointer-events": "none" }));
      }
      const arcLen = (span / 360) * 2 * Math.PI * (r1 + BAND / 2);
      const tw = textWidth(f.name, labelFont(600));
      // A CDS showing its regions has its name beside the map, as text over them can't be read.
      if (!banded && arcLen > tw + 14 && labelPx <= BAND - 3) {
        const mid = (a0 + span / 2) % 360;
        const flip = mid > 90 && mid < 270;
        const pid = `sv-arc-${i}`;
        defs.appendChild(s("path", { id: pid, d: arcPath(a0, a1, r1 + BAND / 2, flip) }));
        arcLabels.appendChild(
          s(
            "text",
            { "font-weight": 600, fill: st.text, class: "sv-map-arctext", "data-kind": "feature", "data-id": f.id },
            s("textPath", { href: `#${pid}`, startOffset: "50%", "text-anchor": "middle" }, f.name)
          )
        );
      } else {
        const text = shortLabel(f.name);
        labels.push({ angle: (a0 + span / 2) % 360, r: r2, text, kind: "feature", id: f.id, color: st.fill, width: textWidth(text, labelFont(600)), y: 0, ly: 0 });
      }
    });
    root.appendChild(featureLayer);
    root.appendChild(arcLabels);

    // ORFs: thin arcs with arrowheads, coloured by frame.
    const orfLayer = s("g");
    for (const x of orfList) {
      const r2 = innermost - 3 - (oLanes.get(x) ?? 0) * ORF_STEP;
      const path = s(
        "path",
        { d: arcShape(ang(x.start), ang(x.end + 1), r2 - ORF_BAND, r2, x.strand, 6), class: `sv-map-orf sv-orf-${x.strand === 1 ? "f" : "r"}${x.frame + 1}`, "data-kind": "orf", "data-id": x.id },
        s("title", null, `${orfTitle(x)} · ${fmtRange(x.start + 1, x.end + 1)}`)
      );
      orfLayer.appendChild(path);
      this.addShape(`orf:${x.id}`, path);
    }
    root.appendChild(orfLayer);

    // Primers.
    const primerLayer = s("g");
    for (const p of primers) {
      const lane = pLanes.get(p) ?? 0;
      const r = PRIMER_R + lane * PRIMER_STEP;
      const a0 = ang(p.start);
      const a1 = ang(p.end + 1);
      const path = s(
        "path",
        { d: arcShape(a0, a1, r - 2.5, r + 2.5, p.strand, 6), class: "sv-map-primer", "data-kind": "primer", "data-id": p.id },
        s("title", null, `${p.name} · primer · ${fmtRange(p.start + 1, p.end + 1)}`)
      );
      const own = primerColors(p).color;
      if (own) path.style.setProperty("--pc", own);
      primerLayer.appendChild(path);
      this.addShape(`primer:${p.id}`, path);
      let span = a1 - a0;
      if (span <= 0) span += 360;
      const text = shortLabel(p.name);
      labels.push({ angle: (a0 + span / 2) % 360, r: r + 3, text, kind: "primer", id: p.id, color: own, strand: p.strand === -1 ? -1 : 1, width: textWidth(text, labelFont(500)), y: 0, ly: 0 });
    }
    root.appendChild(primerLayer);

    // Cut sites.
    if (o.cutsites) {
      const cuts = s("g", { class: "sv-map-cut" });
      for (const c of cutSites(d, o)) {
        const a = ang(c.cut);
        const [x1, y1] = pt(a, BAND_OUT);
        const [x2, y2] = pt(a, tickOut);
        const unique = c.cuts === 1;
        const tick = s("line", { x1: f1(x1), y1: f1(y1), x2: f1(x2), y2: f1(y2), class: unique ? "sv-map-unique" : undefined });
        cuts.appendChild(tick);
        this.addShape(`cutsite:${c.id}`, tick);
        labels.push({
          angle: ((a % 360) + 360) % 360,
          r: tickOut,
          text: c.enzyme,
          kind: "cutsite",
          id: c.id,
          unique,
          title: cutTitle(c),
          width: textWidth(c.enzyme, cutFont),
          y: 0,
          ly: 0
        });
      }
      root.appendChild(cuts);
    }

    // Outside labels.
    let minX = -knee;
    let maxX = knee;
    let minY = -knee;
    let maxY = knee;
    for (const l of labels) l.angle = ((l.angle % 360) + 360) % 360;
    // Only as many labels as fit beside the map: features first (largest first), then
    // primers, then enzymes that cut once, then the rest. The others stay reachable from
    // the outline and by hovering.
    const capacity = Math.max(8, Math.floor((2.4 * rLab) / gap));
    const featureSize = new Map(feats.map(f => [f.id, rangeLength(f, n)]));
    const rank = (l: LabelItem) => (l.kind === "feature" ? 0 : l.kind === "primer" ? 1 : l.unique ? 2 : 3);
    const fit = (side: LabelItem[]) => {
      if (side.length <= capacity) return side;
      const keep = new Set([...side].sort((a, b) => rank(a) - rank(b) || (featureSize.get(b.id) ?? 0) - (featureSize.get(a.id) ?? 0)).slice(0, capacity));
      return side.filter(l => keep.has(l));
    };
    const right = fit(labels.filter(l => l.angle < 180));
    const left = fit(labels.filter(l => l.angle >= 180));
    const leaders = s("g", { fill: "none", class: "sv-map-leader" });
    // Features get a chip, regions a square of their colour, and primers an arrow.
    const gs = glyphSize(labelPx);
    const gg = glyphGap(labelPx);
    const cp = chipPad(labelPx);
    const texts = s("g", { "font-size": labelPx, "dominant-baseline": "central" });
    for (const [side, sgn] of [
      [right, 1],
      [left, -1]
    ] as const) {
      for (const l of side) l.y = -rLab * Math.cos((l.angle * Math.PI) / 180);
      layoutLabels(side, gap);
      for (const l of side) {
        const dy = l.ly;
        const p0 = pt(l.angle, l.r);
        const k = pt(l.angle, knee);
        let x = sgn * Math.sqrt(Math.max(rLab * rLab - dy * dy, 34 * 34));
        x = sgn > 0 ? Math.max(x, k[0] + 6) : Math.min(x, k[0] - 6);
        const colour = l.color ? `--lc:${l.color}` : undefined;
        const shapeKey = `${l.kind}:${l.id}${l.region === undefined ? "" : `:region:${l.region}`}`;
        const leader = s("polyline", { points: `${P(p0)} ${P(k)} ${f1(x)},${f1(dy)}`, class: `sv-map-leader-${l.region !== undefined ? "region" : l.kind}`, style: colour });
        leaders.appendChild(leader);
        if (l.kind === "cutsite" || l.region !== undefined) this.addShape(shapeKey, leader);
        const gx = x + sgn * 4;
        const chip = l.kind === "feature" && l.region === undefined ? labelChip(l, gx, dy, l.width, labelPx, sgn) : null;
        const mark = chip ?? labelGlyph(l, gx, dy, gs, sgn);
        if (mark) texts.appendChild(mark);
        if (chip || l.region !== undefined) this.addShape(shapeKey, mark!);
        const tx = chip ? gx + sgn * cp : mark ? gx + sgn * (gs + gg) : gx;
        const t = s(
          "text",
          { x: f1(tx), y: f1(dy), "text-anchor": sgn > 0 ? "start" : "end", class: labelClass(l), style: colour, "data-kind": l.kind, "data-id": l.id, "data-region": l.region },
          l.text,
          l.title ? s("title", null, l.title) : null
        );
        texts.appendChild(t);
        this.addShape(shapeKey, t);
        const end = tx + sgn * (l.width + (chip ? cp : 0));
        minX = Math.min(minX, gx, end);
        maxX = Math.max(maxX, gx, end);
        minY = Math.min(minY, dy - gap / 2);
        maxY = Math.max(maxY, dy + gap / 2);
      }
    }
    root.append(leaders, texts);

    // Name in the middle.
    const nameSize = Math.min(18, Math.max(12, (innermost * 1.6) / Math.max(4, d.name.length)));
    root.appendChild(s("text", { x: 0, y: -8, "text-anchor": "middle", "font-size": f1(nameSize), "font-weight": 600, class: "sv-map-name" }, d.name));
    root.appendChild(s("text", { x: 0, y: 12, "text-anchor": "middle", "font-size": 11.5, class: "sv-map-size" }, `${fmt(n)} bp`));

    const m = 10;
    const vb = [minX - m, minY - m, maxX - minX + 2 * m, maxY - minY + 2 * m];
    const svg = s("svg", { viewBox: vb.map(f1).join(" "), class: "sv-map-svgel", role: "img", "aria-label": `Circular map of ${d.name}`, "font-family": sans }, root);
    this.geom = { n, rotation: rot, circular: true };
    return svg;
  }

  // ---------- linear ----------

  private buildLinear(d: SeqData): SVGSVGElement {
    const o = this.ctx.options;
    const n = d.sequence.length;
    const styles = featureStyles(d);
    const sans = fontStack("sans");
    const mono = fontStack("mono");
    const labelPx = 10.5 * (o.labelSize / 8);
    const width = Math.max(480, (this.area.clientWidth || 900) * o.mapZoom - 40);
    const m = 24;
    const scale = (width - 2 * m) / n;
    const X = (p: number) => m + p * scale;
    const labelFont = (w: number) => `${w} ${labelPx}px ${sans}`;
    // Feature names under their bars sit on a tint of their colour, as on the circular map.
    const cp = chipPad(labelPx);
    const cutFont = `400 ${labelPx * CUT_SCALE}px ${mono}`;

    // Enzyme label rows, from the backbone upwards.
    const cuts = o.cutsites ? cutSites(d, o) : [];
    const rows: number[] = [];
    const placed = cuts.map(c => {
      const text = c.enzyme;
      const w = textWidth(text, cutFont) + 6;
      // Centred on the cut, but kept inside the drawing near the ends.
      const x = Math.max(2, Math.min(width - w - 2, X(c.cut) - w / 2));
      let row = 0;
      while (rows[row] !== undefined && rows[row] > x) row++;
      rows[row] = x + w;
      return { c, x, w, row };
    });
    const rowH = labelPx + 4;
    const primerRows: number[] = [];
    const primers = o.primers ? d.primers : [];
    const primerPlaced = primers.map(p => {
      const a = X(p.start);
      const b = X(p.end + 1);
      const w = Math.max(b - a, textWidth(p.name, labelFont(500)) + 4);
      let row = 0;
      while (primerRows[row] !== undefined && primerRows[row] > a) row++;
      primerRows[row] = a + w + 4;
      return { p, a, b, row };
    });
    const labelTop = 8;
    const labelsH = rows.length * rowH;
    const primerTop = labelTop + labelsH + (rows.length ? 10 : 0);
    const primerH = primerRows.length * (labelPx + 10);
    const baseY = primerTop + primerH + 8;

    // Features that only touch share a lane. A name too long for its bar goes under it,
    // in as many rows as the lane's names need.
    const feats = o.features ? d.features : [];
    const lanes = assignLanes(
      feats.map(f => ({ item: f.id, start: f.start, end: (f.end + 1) % n || n })),
      n,
      0
    );
    const laneCount = Math.max(1, ...Array.from(lanes.values()).map(l => l + 1));
    // Regions of a protein are segments of its bar, named inside where they fit and
    // otherwise in rows under it; the CDS's own name then goes under it too.
    const swatch = glyphSize(labelPx);
    const swatchGap = glyphGap(labelPx);
    const regionBands = new Map(feats.map(f => {
      const rows = layoutRegions(regionsOf(f), o.mapRegions ? o.proteinDetail : "none");
      const lanes = Math.max(1, ...rows.map(r => r.lane + 1));
      const thick = 16 / lanes;
      const pieceWidth = (g: Range) => X(g.end + 1) - X(g.start);
      const drawn = rows.flatMap(row => {
        const pieces = regionSpans(f, row.region, n).flatMap(sp => rangePieces(sp, n));
        if (!pieces.length) return [];
        const longest = pieces.reduce((a, b) => (pieceWidth(b) > pieceWidth(a) ? b : a));
        const inside = thick >= labelPx + 3 && pieceWidth(longest) > textWidth(row.region.name, labelFont(500)) + 8;
        const w = swatch + swatchGap + textWidth(row.region.name, labelFont(400));
        return [{ ...row, pieces, longest, inside, w, x: Math.max(2, Math.min(X(pieces[0].start), width - w - 8)), labelRow: -1 }];
      });
      return [f.id, { rows: drawn, lanes, thick }] as const;
    }));
    // Names that don't fit go in rows under their lane, shared by the CDSs in it.
    const regionLabelRows = Array.from({ length: laneCount }, (_, l) => {
      const ends: number[] = [];
      const named = feats.filter(f => (lanes.get(f.id) ?? 0) === l).flatMap(f => regionBands.get(f.id)!.rows.filter(r => !r.inside));
      for (const r of named.sort((a, b) => a.x - b.x)) {
        let row = 0;
        while (ends[row] !== undefined && ends[row] > r.x) row++;
        ends[row] = r.x + r.w + 8;
        r.labelRow = row;
      }
      return ends.length;
    });
    const banded = (f: SeqFeature) => (regionBands.get(f.id)?.rows.length ?? 0) > 0;
    const nameBelow = (f: SeqFeature) => banded(f) || X((f.end >= f.start ? f.end : n - 1) + 1) - X(f.start) <= textWidth(f.name, labelFont(600)) + 16;
    const nameRow = new Map<string, number>();
    const nameRowEnds: number[][] = Array.from({ length: laneCount }, () => []);
    // A name starts under its feature's start, moved left if it would run off the end.
    const nameWidth = (f: SeqFeature) => 2 * cp + textWidth(shortLabel(f.name), labelFont(600));
    const nameX = (f: SeqFeature) => Math.max(2, Math.min(X(f.start), width - 2 - nameWidth(f)));
    for (const f of [...feats].sort((a, b) => a.start - b.start)) {
      if (!nameBelow(f)) continue;
      const x = nameX(f);
      const ends = nameRowEnds[lanes.get(f.id) ?? 0];
      let row = 0;
      while (ends[row] !== undefined && ends[row] > x) row++;
      ends[row] = x + nameWidth(f) + 6;
      nameRow.set(f.id, row);
    }
    const nameStep = Math.max(14, labelPx + 4);
    // The ruler's numbers sit between the backbone and the features.
    const laneY: number[] = [baseY + (o.ruler ? 22 : 8)];
    for (let l = 0; l < laneCount; l++) {
      laneY.push(laneY[l] + 16 + Math.max(1, nameRowEnds[l].length) * nameStep + regionLabelRows[l] * nameStep);
    }
    // ORFs in thin lanes under the features.
    const orfList = o.orfs ? orfs(d, o.orfOptions) : [];
    const oLanes = assignLanes(
      orfList.map(x => ({ item: x, start: x.start, end: (x.end + 1) % n || n })),
      n,
      Math.max(1, 4 / scale)
    );
    const oLaneCount = orfList.length ? Math.max(...Array.from(oLanes.values())) + 1 : 0;
    const orfTop = laneY[laneCount];
    const height = orfTop + oLaneCount * ORF_STEP + 8;

    const root = s("g");
    const sel = s("g", { class: "sv-map-sel" });
    root.appendChild(sel);
    this.selLayer = sel;

    root.appendChild(s("line", { x1: X(0), y1: baseY, x2: X(n), y2: baseY, class: "sv-map-backbone" }));
    if (o.ruler) {
      const step = niceStep(n, Math.max(4, Math.floor(width / 110)));
      const ticks = s("g", { class: "sv-map-tick" });
      const tickLabels = s("g", { class: "sv-map-ticklabel", "font-size": 9.5, "text-anchor": "middle", "font-family": mono });
      for (let p = 0; p <= n; p += step) {
        ticks.appendChild(s("line", { x1: f1(X(p)), y1: baseY, x2: f1(X(p)), y2: baseY + 5 }));
        tickLabels.appendChild(s("text", { x: f1(X(p)), y: baseY + 15 }, fmt(p === 0 ? 1 : p)));
      }
      root.append(ticks, tickLabels);
    }

    const featureLayer = s("g", { "font-size": labelPx, "dominant-baseline": "central" });
    const regionNames = s("g", { "font-size": labelPx, "dominant-baseline": "central" });
    const defs = s("defs");
    root.appendChild(defs);
    // Features that touch meet: an arrowhead sits in a notch in its neighbour.
    // The two ends of the line don't meet, even for a circular sequence.
    const touching = arrowNeighbours(feats, f => lanes.get(f.id) ?? 0, n + 1);
    // The arrowhead of a feature, from the width of the piece it is drawn on.
    const headOf = (g: SeqFeature) => {
      const w = g.strand === 1 ? X(g.end + 1) - X(g.start <= g.end ? g.start : 0) : X(g.start <= g.end ? g.end + 1 : n) - X(g.start);
      return Math.min(8, Math.max(1.5, w) * 0.5);
    };
    for (const f of feats) {
      const lane = lanes.get(f.id) ?? 0;
      const y = laneY[lane];
      const st = styles.get(f.id)!;
      const nb = touching.get(f);
      const pieces = f.start <= f.end ? [[f.start, f.end + 1]] : [[f.start, n], [0, f.end + 1]];
      const bands = regionBands.get(f.id)!;
      const isBanded = banded(f);
      const shapes: string[] = [];
      for (const [a, b] of pieces) {
        const x1 = X(a);
        const x2 = Math.max(X(b), x1 + 1.5);
        const head = Math.min(8, (x2 - x1) * 0.5);
        const atStart = a === f.start;
        const atEnd = b === f.end + 1;
        const dpath = barPath(
          x1,
          x2,
          y,
          16,
          { left: f.strand === -1 && atStart ? head : 0, right: f.strand === 1 && atEnd ? head : 0 },
          { left: atStart && nb?.before ? headOf(nb.before) : 0, right: atEnd && nb?.after ? headOf(nb.after) : 0 }
        );
        shapes.push(dpath);
        const path = s("path", { d: dpath, fill: st.fill, class: "sv-map-feature", "data-kind": "feature", "data-id": f.id }, s("title", null, `${f.name} · ${f.type} · ${fmtRange(f.start + 1, f.end + 1)}`));
        featureLayer.appendChild(path);
        this.addShape(`feature:${f.id}`, path);
      }
      if (isBanded) {
        // Segments of the bar, as on the circular map: clipped to its arrow, outlined over.
        const clip = `sv-clip-${f.id.replace(/[^\w-]/g, "_")}`;
        defs.appendChild(s("clipPath", { id: clip }, shapes.map(d => s("path", { d }))));
        const segments = s("g", { "clip-path": `url(#${clip})` });
        const { lanes: regionLanes, thick } = bands;
        for (const { region, index, lane: regionLane, pieces: parts, longest, inside, x, labelRow } of bands.rows) {
          const key = `feature:${f.id}:region:${index}`;
          const top = y + regionLane * thick;
          const y0 = regionLane === 0 ? top - 2 : top;
          const y1 = regionLane === regionLanes - 1 ? top + thick + 2 : top + thick;
          for (const g of parts) {
            const rect = s("rect", { x: f1(X(g.start)), y: f1(y0), width: f1(Math.max(1, X(g.end + 1) - X(g.start))), height: f1(y1 - y0), fill: regionColor(region), class: "sv-map-region", "data-kind": "feature", "data-id": f.id, "data-region": index }, s("title", null, mapRegionTitle(region, f)));
            segments.appendChild(rect);
            this.addShape(key, rect);
          }
          if (inside) {
            const name = s("text", { x: f1((X(longest.start) + X(longest.end + 1)) / 2), y: f1(top + thick / 2), "text-anchor": "middle", "font-weight": 500, fill: regionTextColor(region), class: "sv-map-region-name", "data-kind": "feature", "data-id": f.id, "data-region": index }, region.name);
            regionNames.appendChild(name);
            this.addShape(key, name);
            continue;
          }
          const ry = y + 16 + Math.max(1, nameRowEnds[lane].length) * nameStep + labelRow * nameStep + nameStep / 2;
          const mark = labelGlyph({ kind: "feature", id: f.id, region: index, color: regionColor(region) }, x, ry, swatch, 1)!;
          const label = s("text", { x: f1(x + swatch + swatchGap), y: f1(ry), class: labelClass({ kind: "feature", region: index }), "data-kind": "feature", "data-id": f.id, "data-region": index }, region.name, s("title", null, mapRegionTitle(region, f)));
          featureLayer.append(mark, label);
          this.addShape(key, mark);
          this.addShape(key, label);
        }
        featureLayer.appendChild(segments);
        for (const d of shapes) {
          const outline = s("path", { d, class: "sv-map-feature sv-map-outline", "pointer-events": "none", "data-kind": "feature", "data-id": f.id });
          featureLayer.appendChild(outline);
          this.addShape(`feature:${f.id}`, outline);
        }
      }
      for (const gap of featureGaps(f, n)) {
        for (const g of rangePieces(gap, n)) {
          const gx1 = X(g.start);
          const gx2 = X(g.end + 1);
          featureLayer.appendChild(s("rect", { x: f1(gx1), y: y - 0.5, width: f1(gx2 - gx1), height: 17, style: "fill:var(--panel)", "pointer-events": "none" }));
          featureLayer.appendChild(s("line", { x1: f1(gx1), x2: f1(gx2), y1: y + 8, y2: y + 8, stroke: st.fill, "stroke-width": 2, "pointer-events": "none" }));
        }
      }
      const x1 = X(f.start);
      const x2 = X((f.end >= f.start ? f.end : n - 1) + 1);
      if (!nameBelow(f)) {
        featureLayer.appendChild(s("text", { x: f1((x1 + x2) / 2), y: y + 8, "text-anchor": "middle", "font-weight": 600, fill: st.text, class: "sv-map-arctext", "data-kind": "feature", "data-id": f.id }, f.name));
      } else {
        const ty = y + 16 + nameStep / 2 + (nameRow.get(f.id) ?? 0) * nameStep;
        const mark = { kind: "feature" as const, id: f.id, color: st.fill };
        const name = shortLabel(f.name);
        const nx = nameX(f);
        const chip = labelChip(mark, nx, ty, textWidth(name, labelFont(600)), labelPx, 1);
        featureLayer.appendChild(chip);
        this.addShape(`feature:${f.id}`, chip);
        featureLayer.appendChild(s("text", { x: f1(nx + cp), y: f1(ty), class: labelClass(mark), style: `--lc:${st.fill}`, "data-kind": "feature", "data-id": f.id }, name));
      }
    }
    root.append(featureLayer, regionNames);

    const orfLayer = s("g");
    for (const x of orfList) {
      const y = orfTop + (oLanes.get(x) ?? 0) * ORF_STEP;
      for (const [a, b] of x.start <= x.end ? [[x.start, x.end + 1]] : [[x.start, n], [0, x.end + 1]]) {
        const x1 = X(a);
        const x2 = Math.max(X(b), x1 + 1.5);
        const head = Math.min(5, (x2 - x1) * 0.5);
        const dpath = barPath(x1, x2, y, ORF_BAND, { left: x.strand === -1 && a === x.start ? head : 0, right: x.strand === 1 && b === x.end + 1 ? head : 0 }, { left: 0, right: 0 });
        const path = s("path", { d: dpath, class: `sv-map-orf sv-orf-${x.strand === 1 ? "f" : "r"}${x.frame + 1}`, "data-kind": "orf", "data-id": x.id }, s("title", null, `${orfTitle(x)} · ${fmtRange(x.start + 1, x.end + 1)}`));
        orfLayer.appendChild(path);
        this.addShape(`orf:${x.id}`, path);
      }
    }
    root.appendChild(orfLayer);

    const primerLayer = s("g", { "font-size": labelPx, "dominant-baseline": "central" });
    for (const { p, a, b, row } of primerPlaced) {
      const y = baseY - 10 - row * (labelPx + 10);
      const head = Math.min(6, (b - a) / 2);
      const d2 =
        p.strand === 1
          ? `M${f1(a)},${y - 2} H${f1(b - head)} L${f1(b)},${y} L${f1(b - head)},${y + 2} H${f1(a)} Z`
          : `M${f1(a + head)},${y - 2} H${f1(b)} V${y + 2} H${f1(a + head)} L${f1(a)},${y} Z`;
      // The name sits on the primer's own arrow, so it needs no mark of its own.
      const own = primerColors(p).color;
      const path = s("path", { d: d2, class: "sv-map-primer", style: own ? `--pc:${own}` : undefined, "data-kind": "primer", "data-id": p.id }, s("title", null, `${p.name} · primer`));
      primerLayer.appendChild(path);
      this.addShape(`primer:${p.id}`, path);
      primerLayer.appendChild(s("text", { x: f1(a), y: y - labelPx * 0.75, class: labelClass({ kind: "primer" }), style: own ? `--lc:${own}` : undefined, "data-kind": "primer", "data-id": p.id }, p.name));
    }
    root.appendChild(primerLayer);

    const cutLayer = s("g", { "font-size": labelPx, "dominant-baseline": "central" });
    for (const { c, x, w, row } of placed) {
      const y = labelTop + (rows.length - 1 - row) * rowH + rowH / 2;
      const mark = { kind: "cutsite" as const, id: c.id, unique: c.cuts === 1 };
      const leader = s("line", { x1: f1(X(c.cut)), y1: f1(y + rowH / 2), x2: f1(X(c.cut)), y2: baseY, class: "sv-map-leader sv-map-leader-cutsite" });
      cutLayer.appendChild(leader);
      this.addShape(`cutsite:${c.id}`, leader);
      const t = s("text", { x: f1(x + w / 2), y: f1(y), "text-anchor": "middle", class: labelClass(mark), "data-kind": "cutsite", "data-id": c.id }, c.enzyme, s("title", null, cutTitle(c)));
      cutLayer.appendChild(t);
      this.addShape(`cutsite:${c.id}`, t);
    }
    root.appendChild(cutLayer);

    const svg = s("svg", { viewBox: `0 0 ${f1(width)} ${f1(height)}`, width: f1(width), height: f1(height), class: "sv-map-svgel", role: "img", "aria-label": `Linear map of ${d.name}`, "font-family": sans }, root);
    this.geom = { n, rotation: 0, circular: false, x0: m, scale, selTop: primerTop - 4, selBottom: height - 4 };
    return svg;
  }

  private addShape(key: string, el: SVGElement) {
    const list = this.shapes.get(key);
    if (list) list.push(el);
    else this.shapes.set(key, [el]);
  }

  // ---------- selection ----------

  private renderSelection() {
    const layer = this.selLayer;
    const g = this.geom;
    if (!layer || !g || !this.svg) return;
    for (const el of this.focused) el.classList.remove("sv-focused", "sv-related");
    this.focused = [];
    const sel = this.ctx.store.selection;
    const focus = sel.focus;
    if (focus) {
      for (const el of this.shapes.get(`${focus.kind}:${focus.id}${focus.region === undefined ? "" : `:region:${focus.region}`}`) || []) {
        el.classList.add("sv-focused");
        this.focused.push(el);
      }
    }
    // The other sites of the selected or picked enzymes.
    const picked = pickedEnzymes(sel);
    if (picked.length) {
      for (const [key, els] of this.shapes) {
        if (!key.startsWith("cutsite:") || key === `${focus?.kind}:${focus?.id}` || !picked.includes(enzymeOf(key.slice(8)))) continue;
        for (const el of els) {
          el.classList.add("sv-related");
          this.focused.push(el);
        }
      }
    }
    const parts: SVGElement[] = [];
    const ranges = selectedRanges(sel);
    const n = g.n;
    if (g.circular) {
      const ang = (b: number) => (b / n) * 360 + g.rotation;
      for (const range of ranges) {
        const a0 = ang(range.start);
        const a1 = ang(range.end + 1);
        const whole = rangeLength(range, n) >= n;
        parts.push(s("path", { d: whole ? arcShape(0, 359.9, 46, 176, 0) : arcShape(a0, a1, 46, 176, 0), class: "sv-map-wedge" }));
        if (!whole)
          for (const a of [a0, a1]) {
            const [x1, y1] = pt(a, 46);
            const [x2, y2] = pt(a, 176);
            parts.push(s("line", { x1: f1(x1), y1: f1(y1), x2: f1(x2), y2: f1(y2), class: "sv-map-wedge-edge" }));
          }
      }
      if (!ranges.length) {
        const a = ang(sel.caret);
        const [x1, y1] = pt(a, 60);
        const [x2, y2] = pt(a, 170);
        parts.push(s("line", { x1: f1(x1), y1: f1(y1), x2: f1(x2), y2: f1(y2), class: "sv-map-caret" }));
      }
    } else if (g.x0 !== undefined && g.scale !== undefined) {
      const X = (p: number) => g.x0! + p * g.scale!;
      const top = g.selTop ?? 0;
      const bottom = g.selBottom ?? 100;
      for (const range of ranges) {
        const pieces = range.start <= range.end ? [[range.start, range.end + 1]] : [[range.start, n], [0, range.end + 1]];
        for (const [a, b] of pieces) parts.push(s("rect", { x: f1(X(a)), y: f1(top), width: f1(Math.max(1.5, X(b) - X(a))), height: f1(bottom - top), class: "sv-map-wedge" }));
      }
      if (!ranges.length) {
        parts.push(s("line", { x1: f1(X(sel.caret)), y1: top, x2: f1(X(sel.caret)), y2: bottom, class: "sv-map-caret" }));
      }
    }
    layer.replaceChildren(...parts);
  }

  // ---------- mouse ----------

  /** Hover is local to the drawing: it never selects bases or changes the document. */
  private hoverRegion(el: Element | null) {
    const hit = this.visible ? el?.closest('[data-kind="feature"][data-region]') : null;
    const id = hit?.getAttribute("data-id");
    const key = hit && id ? `feature:${id}:region:${hit.getAttribute("data-region")}` : null;
    if (key === this.hoveredKey) return;
    for (const shape of this.hovered) shape.classList.remove("sv-map-region-hover");
    for (const shape of this.hoveredParents) shape.classList.remove("sv-map-parent-hover");
    this.hoveredKey = key;
    this.hovered = key ? this.shapes.get(key) ?? [] : [];
    this.hoveredParents = id ? (this.shapes.get(`feature:${id}`) ?? []).filter(shape => shape.classList.contains("sv-map-feature")) : [];
    for (const shape of this.hovered) shape.classList.add("sv-map-region-hover");
    for (const shape of this.hoveredParents) shape.classList.add("sv-map-parent-hover");
  }

  /** Boundary (0…n) under a client point, from its angle (circular) or x (linear). */
  private boundaryAt(clientX: number, clientY: number): number | null {
    const g = this.geom;
    const svg = this.svg;
    if (!g || !svg) return null;
    const m = svg.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    if (g.circular) {
      let a = (Math.atan2(p.x, -p.y) * 180) / Math.PI - g.rotation;
      a = ((a % 360) + 360) % 360;
      return Math.round((a / 360) * g.n) % g.n;
    }
    const b = Math.round((p.x - (g.x0 ?? 0)) / (g.scale ?? 1));
    return Math.max(0, Math.min(g.n, b));
  }

  private installPointer() {
    const store = this.ctx.store;
    let anchor: number | null = null;
    let moved = false;
    let target: Focus | null = null;
    // On a circle: the boundary last under the pointer and the bases swept since the press.
    let last = 0;
    let swept = 0;
    const rangeTo = (a: number, b: number): Range | null => {
      const g = this.geom;
      if (g && !g.circular) return a === b ? null : { start: Math.min(a, b), end: Math.max(a, b) - 1 };
      // The way the pointer went round, so dragging anticlockwise selects what it passed over.
      swept = sweep(swept, last, b, store.length);
      last = b;
      return sweptRange(a, swept, store.length);
    };
    this.svgHost.addEventListener("pointerdown", e => {
      this.hoverRegion(null);
      // Control-click is a right-click on a Mac.
      if (e.button !== 0 || (e.ctrlKey && isMac)) return;
      const el = (e.target as Element).closest("[data-kind]");
      target = el ? hitOf(el) : null;
      if (target?.kind === "cutsite" && isPickClick(e)) {
        pickSite(this.ctx, target.id, "map");
        e.preventDefault();
        return;
      }
      anchor = this.boundaryAt(e.clientX, e.clientY);
      last = anchor ?? 0;
      swept = 0;
      moved = false;
      this.svgHost.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    this.svgHost.addEventListener("pointermove", e => {
      if (anchor === null) {
        this.hoverRegion(e.buttons === 0 && e.pointerType !== "touch" ? e.target as Element : null);
        return;
      }
      const b = this.boundaryAt(e.clientX, e.clientY);
      if (b === null) return;
      if (!moved && b === anchor) return;
      moved = true;
      const r = rangeTo(anchor, b);
      store.select(r ? { range: r, anchor, caret: b } : { range: null, caret: anchor }, "map");
    });
    const end = (e: PointerEvent) => {
      if (anchor === null) return;
      if (!moved) {
        if (target) this.selectAnnotation(target);
        else store.select({ range: null, caret: anchor }, "map");
      }
      anchor = null;
      try {
        this.svgHost.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
    };
    this.svgHost.addEventListener("pointerup", end);
    this.svgHost.addEventListener("pointercancel", e => {
      this.hoverRegion(null);
      end(e);
    });
    this.svgHost.addEventListener("pointerleave", () => this.hoverRegion(null));
    this.svgHost.addEventListener("contextmenu", e => {
      e.preventDefault();
      const el = (e.target as Element).closest("[data-kind]");
      const hit = el ? hitOf(el) : null;
      const t = menuTargetAt(this.ctx, hit, this.boundaryAt(e.clientX, e.clientY), f => this.selectAnnotation(f), "map");
      if (t) this.ctx.contextMenu(t, { x: e.clientX, y: e.clientY }, true);
    });
  }

  private selectAnnotation(f: Focus) {
    const d = this.ctx.store.data;
    let range: Range | null = null;
    if (f.kind === "feature") {
      const x = d.features.find(g => g.id === f.id) ?? null;
      const region = x && f.region !== undefined ? regionsOf(x)[f.region] : undefined;
      range = (x && region && regionRange(x, region, d.sequence.length)) ?? x;
    } else if (f.kind === "primer") range = d.primers.find(x => x.id === f.id) ?? null;
    else if (f.kind === "orf") range = orfs(d, this.ctx.options.orfOptions).find(x => x.id === f.id) ?? null;
    else {
      const c = cutSiteById(d, this.ctx.options, f.id);
      if (c) range = { start: c.start, end: c.end };
    }
    if (range) this.ctx.store.selectRange({ start: range.start, end: range.end }, f, "map");
  }
}
