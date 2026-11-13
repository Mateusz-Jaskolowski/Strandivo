// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// A protein's regions as a figure for a slide or a paper: blocks on the protein's line,
// each named above its block, or on an elbow leader where names would collide, with
// nested regions as brackets under their parts and an optional residue scale. It is laid
// out once as shapes with concrete colours, which the dialog draws as SVG, a PNG is
// painted from and an SVG file is written from, so all three show the same picture.
// Pure, so it is unit-tested; the caller measures text.

import { layoutRegions, regionColor, type ProteinDetail, type ProteinRegion } from "./regions.ts";

export type FigureShape =
  | { kind: "line"; points: [number, number][]; stroke: string; width: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; r: number; fill: string; stroke: string; strokeWidth: number; region?: number }
  /** `y` is the baseline; `anchor` says which end or the middle `x` is. */
  | { kind: "text"; x: number; y: number; text: string; size: number; fill: string; anchor: "start" | "middle" | "end"; region?: number };

export interface ProteinFigure {
  width: number;
  height: number;
  shapes: FigureShape[];
}

export interface FigureOptions {
  /** Residues of the protein. */
  length: number;
  /** "domains" leaves out nested regions, drawing their parents as blocks. */
  detail?: Exclude<ProteinDetail, "none">;
  /** Residue numbers under the protein. */
  scale?: boolean;
  /** Width of `text` set at `size` px. */
  measure: (text: string, size: number) => number;
  /** Length of the protein's line in px. */
  width?: number;
}

export const FIGURE_COLORS = {
  text: "#1d2129",
  muted: "#6b7280",
  leader: "#4b5260",
  backbone: "#4b5563",
  outline: "#2b313b",
  tick: "#9aa1ad",
  background: "#ffffff"
};

const FONT = 13;
const SCALE_FONT = 10.5;
const BLOCK_H = 24;
const LANE_GAP = 8;
/** From a block's edge to the nearest row of names, and between rows. */
const LABEL_GAP = 7;
const ROW_H = FONT + 8;
/** Horizontal run of an elbow leader before its name, and the space after it. */
const ELBOW = 7;
const ELBOW_SPACE = 3;
const H_GAP = 10;
/** A leader may pass no closer than this to a name. */
const CLEAR = 3;
const BRACKET_TICK = 6;
const PAD = 16;
/** Baseline below a line of text's middle, as a share of its size: centres capitals and digits. */
const MID = 0.35;

interface Want {
  key: number;
  w: number;
  /** Where its leader leaves the block or bracket. */
  cx: number;
  /** The block's own extent, which a name set straight above it must stay over. */
  left: number;
  right: number;
}

export interface PlacedLabel {
  key: number;
  /** 0 is the row nearest the block. */
  row: number;
  /** Set straight over its block, or on an elbow leader pointing that way. */
  dir: 0 | 1 | -1;
  x0: number;
  x1: number;
  cx: number;
}

/** Leaders closer than this could never pass each other's names. */
const LEADER_SEP = 2 * CLEAR + 2;

/**
 * Where each leader leaves its block: its middle, unless that is too near another's (blocks
 * in lanes one over the other), when they move apart as far as their blocks allow.
 */
function spreadAnchors(wants: Want[]): Want[] {
  const out = wants.map(w => ({ ...w })).sort((a, b) => a.cx - b.cx);
  const lo = (w: Want) => Math.min(w.cx, w.left + 1);
  const hi = (w: Want) => Math.max(w.cx, w.right - 1);
  const limits = out.map(w => [lo(w), hi(w)]);
  for (let pass = 0; pass < 50; pass++) {
    let moved = false;
    for (let i = 1; i < out.length; i++) {
      const short = LEADER_SEP - (out[i].cx - out[i - 1].cx);
      if (short <= 0.01) continue;
      const left = Math.min(short / 2, out[i - 1].cx - limits[i - 1][0]);
      out[i - 1].cx -= left;
      const right = Math.min(short - left, limits[i][1] - out[i].cx);
      out[i].cx += right;
      if (left + right > 0.01) moved = true;
    }
    if (!moved) break;
  }
  return out;
}

/** What a placed name takes up along its row, its elbow included. */
const span = (p: PlacedLabel): [number, number] => (p.dir === 1 ? [p.cx, p.x1] : p.dir === -1 ? [p.x0, p.cx] : [p.x0, p.x1]);

/**
 * Names in rows away from their blocks. A name goes straight over its block (row 0) when it
 * fits there without hiding a neighbour's leader; the rest go on elbow leaders, a cluster
 * of them rising to a peak so that no leader crosses a name: names on the left of the peak
 * point left, those on the right point right.
 */
export function placeLabels(given: Want[], bounds: [number, number]): PlacedLabel[] {
  const wants = spreadAnchors(given);
  const placed: PlacedLabel[] = [];
  const centres = wants.map(w => w.cx);
  // Larger blocks claim the space over themselves first.
  for (const want of [...wants].sort((a, b) => b.right - b.left - (a.right - a.left) || a.cx - b.cx)) {
    const { w, cx } = want;
    // Stay over the block, near its middle, inside the drawing.
    let lo = Math.max(want.left, cx - w * 0.35) - w / 2;
    let hi = Math.min(want.right, cx + w * 0.35) - w / 2;
    lo = Math.max(lo, bounds[0]);
    hi = Math.min(hi, bounds[1] - w);
    for (const p of placed) {
      if (p.x1 <= cx) lo = Math.max(lo, p.x1 + H_GAP);
      else hi = Math.min(hi, p.x0 - H_GAP - w);
    }
    // Never over another block's middle, where that block's leader would rise.
    for (const c of centres) {
      if (c < cx) lo = Math.max(lo, c + CLEAR + 0.5);
      else if (c > cx) hi = Math.min(hi, c - CLEAR - 0.5 - w);
    }
    if (lo > hi) continue;
    const x0 = Math.min(hi, Math.max(lo, cx - w / 2));
    placed.push({ key: want.key, row: 0, dir: 0, x0, x1: x0 + w, cx });
  }
  const direct = new Set(placed.map(p => p.key));
  const rest = wants.filter(w => !direct.has(w.key)).sort((a, b) => a.cx - b.cx);
  const fits = (p: PlacedLabel) => p.x0 >= bounds[0] && p.x1 <= bounds[1];
  const at = (want: Want, row: number, dir: 1 | -1): PlacedLabel => {
    const reach = ELBOW + ELBOW_SPACE;
    const x0 = dir === 1 ? want.cx + reach : want.cx - reach - want.w;
    return { key: want.key, row, dir, x0, x1: x0 + want.w, cx: want.cx };
  };
  const pending = new Set(rest);
  const clear = (c: PlacedLabel, strict: boolean) => {
    const [a, b] = span(c);
    // Nor over a leader still to rise: a leader rises past every name nearer its block.
    if (strict && rest.some(w => pending.has(w) && w.key !== c.key && w.cx >= a - CLEAR && w.cx <= b + CLEAR)) return false;
    return placed.every(p => {
      const [pa, pb] = span(p);
      if (p.row === c.row) return b + H_GAP <= pa || pb + H_GAP <= a;
      // A leader rising past a lower name, or a higher name's leader through this one.
      if (p.row < c.row) return c.cx <= pa - CLEAR || c.cx >= pb + CLEAR;
      return p.dir === 0 || p.cx <= a - CLEAR || p.cx >= b + CLEAR;
    });
  };
  // Clusters: names close enough for their leaders and names to meet. In each, the left
  // half would rather point left and the right half right, so they rise to a peak.
  const preferred = new Map<Want, 1 | -1>();
  const clusters: Want[][] = [];
  for (const want of rest) {
    const open = clusters[clusters.length - 1];
    const last = open?.[open.length - 1];
    if (last && want.cx - last.cx < ELBOW + ELBOW_SPACE + Math.max(want.w, last.w) + H_GAP) open.push(want);
    else clusters.push([want]);
  }
  for (const cluster of clusters) {
    cluster.forEach((want, i) => {
      const dir = i < Math.floor(cluster.length / 2) ? -1 : 1;
      preferred.set(want, fits(at(want, 1, dir)) ? dir : (-dir as 1 | -1));
    });
  }
  /** The lowest place for a name, the other way round costing half a row. */
  const lowest = (want: Want, strict: boolean) => {
    const dir = preferred.get(want)!;
    for (let row = 1; row <= placed.length + pending.size + 1; row++) {
      for (const d of [dir, -dir as 1 | -1]) {
        const c = at(want, row, d);
        if (fits(c) && clear(c, strict)) return { c, cost: row + (d === dir ? 0 : 0.5) };
      }
    }
    return null;
  };
  // Whichever name can go lowest goes next, so a leader is placed before any name over it.
  while (pending.size) {
    let pick: { want: Want; c: PlacedLabel; cost: number } | null = null;
    for (const strict of [true, false]) {
      for (const want of pending) {
        const best = lowest(want, strict);
        if (best && (!pick || best.cost < pick.cost)) pick = { want, ...best };
      }
      if (pick) break;
    }
    // Nothing fits (a name longer than the drawing): over everything else.
    const want = pick?.want ?? pending.values().next().value!;
    placed.push(pick?.c ?? at(want, Math.max(0, ...placed.map(p => p.row)) + 1, preferred.get(want)!));
    pending.delete(want);
  }
  return placed;
}

/** Regions drawn as blocks, those drawn as brackets over their parts, and the blocks' lanes. */
function arrange(regions: ProteinRegion[], detail: Exclude<ProteinDetail, "none">) {
  const rows = layoutRegions(regions, detail);
  const drawn = new Map(rows.map(r => [r.region, r]));
  const byId = new Map(rows.filter(r => r.region.id).map(r => [r.region.id!, r]));
  const parentOf = (r: ProteinRegion) => {
    const p = r.parentId ? byId.get(r.parentId) : undefined;
    return p && p.region !== r && p.depth < drawn.get(r)!.depth && p.region.start <= r.start && p.region.end >= r.end ? p : undefined;
  };
  const children = new Map<ProteinRegion, ProteinRegion[]>();
  for (const r of rows) {
    const p = parentOf(r.region);
    if (p) children.set(p.region, [...(children.get(p.region) ?? []), r.region]);
  }
  const level = new Map<ProteinRegion, number>();
  const levelOf = (r: ProteinRegion): number => {
    const hit = level.get(r);
    if (hit !== undefined) return hit;
    const l = Math.max(0, ...(children.get(r) ?? []).map(c => levelOf(c) + 1));
    level.set(r, l);
    return l;
  };
  // The longest on the protein's line, as domains usually are; one inside another under it.
  const size = (r: ProteinRegion) => r.end - r.start;
  const blocks = rows.filter(r => !children.has(r.region)).sort((a, b) => size(b.region) - size(a.region) || a.region.start - b.region.start);
  const lanes: (typeof blocks[number] & { lane: number })[] = [];
  for (const row of blocks) {
    const r = row.region;
    const overlaps = lanes.filter(o => o.region.start <= r.end && o.region.end >= r.start);
    let lane = Math.max(0, ...overlaps.filter(o => o.region.start <= r.start && o.region.end >= r.end).map(o => o.lane + 1));
    while (overlaps.some(o => o.lane === lane)) lane++;
    lanes.push({ ...row, lane });
  }
  const laneCount = Math.max(0, ...lanes.map(l => l.lane)) + 1;
  const brackets = rows.filter(r => children.has(r.region)).map(r => ({ ...r, level: levelOf(r.region) }));
  return { lanes, laneCount, brackets };
}

/** A "nice" step giving about `count` intervals over `n`. */
function niceStep(n: number, count: number): number {
  const raw = n / count;
  const pow = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

export function proteinFigure(regions: ProteinRegion[], o: FigureOptions): ProteinFigure {
  const length = Math.max(1, Math.round(o.length));
  const W = o.width ?? 880;
  const u = W / length;
  const X = (residue: number) => (residue - 1) * u;
  const C = FIGURE_COLORS;
  const shapes: FigureShape[] = [];
  const text = (x: number, mid: number, s: string, anchor: "start" | "middle" | "end", extra: { size?: number; fill?: string; region?: number } = {}) => {
    const size = extra.size ?? FONT;
    shapes.push({ kind: "text", x, y: mid + size * MID, text: s, size, fill: extra.fill ?? C.text, anchor, ...(extra.region === undefined ? {} : { region: extra.region }) });
  };
  const line = (points: [number, number][], stroke = C.leader, width = 1) => shapes.push({ kind: "line", points, stroke, width });
  const { lanes, laneCount, brackets } = arrange(regions, o.detail ?? "all");
  const laneTop = (lane: number) => -BLOCK_H / 2 + lane * (BLOCK_H + LANE_GAP);
  const bounds: [number, number] = [-48, W + 48];
  const measure = (s: string) => o.measure(s, FONT);

  // The protein, then its blocks: a hair apart where they touch, so each reads as its own.
  line([[0, 0], [W, 0]], C.backbone, 2.5);
  const blocks = lanes.map(({ region, index, lane }) => {
    const x0 = X(region.start);
    const x1 = X(Math.min(length, region.end) + 1);
    const inset = Math.min(1, (x1 - x0) * 0.15);
    const w = Math.max(2, x1 - x0 - 2 * inset);
    const x = (x0 + x1) / 2 - w / 2;
    shapes.push({ kind: "rect", x, y: laneTop(lane), w, h: BLOCK_H, r: Math.min(4, w / 2), fill: regionColor(region), stroke: C.outline, strokeWidth: 1.25, region: index });
    return { region, index, lane, left: x, right: x + w, cx: x + w / 2 };
  });

  // Names: the first lane's above it, the others' below the last lane.
  /** Where a leader down from a block can leave it without crossing the lanes under it. */
  const clearOfLower = (b: (typeof blocks)[number]) => {
    const under = blocks.filter(o => o.lane > b.lane && o.right > b.left && o.left < b.right);
    const free = (x: number) => x >= b.left + 2 && x <= b.right - 2 && under.every(o => x < o.left - CLEAR || x > o.right + CLEAR);
    if (free(b.cx)) return b.cx;
    const spots = under.flatMap(o => [o.left - CLEAR - 1, o.right + CLEAR + 1]).filter(free);
    return spots.reduce((best, x) => (Math.abs(x - b.cx) < Math.abs(best - b.cx) ? x : best), spots[0] ?? b.cx);
  };
  const named = (list: typeof blocks, below: boolean, edge: number, rowMid: (row: number) => number) => {
    const placed = placeLabels(list.map((b, key) => ({ key, w: measure(b.region.name), cx: below ? clearOfLower(b) : b.cx, left: b.left, right: b.right })), bounds);
    for (const p of placed) {
      const b = list[p.key];
      const mid = rowMid(p.row);
      const from = below ? laneTop(b.lane) + BLOCK_H : laneTop(b.lane);
      const textEdge = mid + (below ? -1 : 1) * (FONT / 2 + 1);
      if (p.dir === 0) {
        // Straight over its block; a block in a lane above the others' needs a leader down.
        if (Math.abs(from - edge) > 0.5) line([[p.cx, from], [p.cx, textEdge]]);
        text((p.x0 + p.x1) / 2, mid, b.region.name, "middle", { region: b.index });
      } else {
        line([[p.cx, from], [p.cx, mid], [p.cx + p.dir * ELBOW, mid]]);
        text(p.cx + p.dir * (ELBOW + ELBOW_SPACE), mid, b.region.name, p.dir === 1 ? "start" : "end", { region: b.index });
      }
    }
    return Math.max(-1, ...placed.map(p => p.row)) + 1;
  };
  const top = laneTop(0);
  named(blocks.filter(b => b.lane === 0), false, top, row => top - LABEL_GAP - FONT / 2 - row * ROW_H);
  const lowest = laneTop(laneCount - 1) + BLOCK_H;
  const belowRows = named(blocks.filter(b => b.lane > 0), true, lowest, row => lowest + LABEL_GAP + FONT / 2 + row * ROW_H);
  let y = lowest + (belowRows ? LABEL_GAP + belowRows * ROW_H : 0);

  // Parents under their parts, innermost first; overlapping ones of a level in rows of their own.
  for (let level = 1; level <= Math.max(0, ...brackets.map(b => b.level)); level++) {
    const ends: number[] = [];
    const rows = brackets.filter(b => b.level === level).sort((a, b) => a.region.start - b.region.start).map(b => {
      let row = 0;
      while (ends[row] !== undefined && ends[row] >= b.region.start) row++;
      ends[row] = b.region.end;
      return { ...b, row };
    });
    for (let row = 0; row < ends.length; row++) {
      const yb = y + LABEL_GAP + BRACKET_TICK;
      const these = rows.filter(b => b.row === row).map(b => {
        const x0 = X(b.region.start) + 1;
        const x1 = X(Math.min(length, b.region.end) + 1) - 1;
        line([[x0, yb - BRACKET_TICK], [x0, yb], [x1, yb], [x1, yb - BRACKET_TICK]], C.leader, 1.25);
        return { ...b, cx: (x0 + x1) / 2, left: x0, right: x1 };
      });
      const tick = 4;
      const placed = placeLabels(these.map((b, key) => ({ key, w: measure(b.region.name), cx: b.cx, left: b.left, right: b.right })), bounds);
      const mid = (r: number) => yb + tick + LABEL_GAP / 2 + FONT / 2 + r * ROW_H;
      for (const p of placed) {
        const b = these[p.key];
        if (p.dir === 0) {
          line([[p.cx, yb], [p.cx, yb + tick]], C.leader, 1.25);
          text((p.x0 + p.x1) / 2, mid(0), b.region.name, "middle", { region: b.index });
        } else {
          line([[p.cx, yb], [p.cx, mid(p.row)], [p.cx + p.dir * ELBOW, mid(p.row)]]);
          text(p.cx + p.dir * (ELBOW + ELBOW_SPACE), mid(p.row), b.region.name, p.dir === 1 ? "start" : "end", { region: b.index });
        }
      }
      y = mid(Math.max(0, ...placed.map(p => p.row))) + FONT / 2;
    }
  }

  // Residue numbers at the middle of their residues.
  if (o.scale) {
    const ys = y + 12;
    const at = (residue: number) => (residue - 0.5) * u;
    const step = niceStep(length, Math.max(2, Math.floor(W / 90)));
    const numbers = [1];
    for (let p = step; p < length; p += step) numbers.push(p);
    if (length > 1) numbers.push(length);
    const width = (p: number) => o.measure(p.toLocaleString("en-US"), SCALE_FONT);
    // Drop an interval number that would crowd the last one or the first.
    const shown = numbers.filter((p, i) => {
      if (i === 0 || i === numbers.length - 1) return true;
      const near = (q: number) => Math.abs(at(q) - at(p)) < (width(p) + width(q)) / 2 + 8;
      return !near(numbers[0]) && !near(length);
    });
    line([[0, ys], [W, ys]], C.tick, 1);
    for (const p of shown) {
      line([[at(p), ys], [at(p), ys + 4]], C.tick, 1);
      text(at(p), ys + 6 + SCALE_FONT / 2 + 1, p.toLocaleString("en-US"), "middle", { size: SCALE_FONT, fill: C.muted });
    }
  }
  return fitted(shapes, o.measure);
}

/** Moves the shapes to start at the padding and measures the drawing they make. */
function fitted(shapes: FigureShape[], measure: FigureOptions["measure"]): ProteinFigure {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };
  for (const s of shapes) {
    if (s.kind === "line") s.points.forEach(([x, y]) => add(x, y));
    else if (s.kind === "rect") {
      add(s.x - s.strokeWidth, s.y - s.strokeWidth);
      add(s.x + s.w + s.strokeWidth, s.y + s.h + s.strokeWidth);
    } else {
      const w = measure(s.text, s.size);
      const x0 = s.anchor === "start" ? s.x : s.anchor === "end" ? s.x - w : s.x - w / 2;
      add(x0, s.y - s.size * 0.85);
      add(x0 + w, s.y + s.size * 0.25);
    }
  }
  const dx = PAD - minX;
  const dy = PAD - minY;
  const r1 = (v: number) => Math.round(v * 100) / 100;
  const moved = shapes.map((s): FigureShape => {
    if (s.kind === "line") return { ...s, points: s.points.map(([x, y]) => [r1(x + dx), r1(y + dy)]) };
    if (s.kind === "rect") return { ...s, x: r1(s.x + dx), y: r1(s.y + dy), w: r1(s.w), h: r1(s.h), r: r1(s.r) };
    return { ...s, x: r1(s.x + dx), y: r1(s.y + dy) };
  });
  return { width: Math.ceil(maxX - minX + 2 * PAD), height: Math.ceil(maxY - minY + 2 * PAD), shapes: moved };
}

const escape = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const n = (v: number) => String(Math.round(v * 100) / 100);

/** A standalone SVG file of the figure, on white. */
export function figureSvg(fig: ProteinFigure, fontFamily: string): string {
  const body = fig.shapes.map(s => {
    if (s.kind === "line") return `<polyline points="${s.points.map(([x, y]) => `${n(x)},${n(y)}`).join(" ")}" fill="none" stroke="${s.stroke}" stroke-width="${n(s.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    if (s.kind === "rect") return `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}" rx="${n(s.r)}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${n(s.strokeWidth)}"/>`;
    return `<text x="${n(s.x)}" y="${n(s.y)}" font-size="${n(s.size)}" fill="${s.fill}" text-anchor="${s.anchor}">${escape(s.text)}</text>`;
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fig.width}" height="${fig.height}" viewBox="0 0 ${fig.width} ${fig.height}">`,
    `<rect width="100%" height="100%" fill="${FIGURE_COLORS.background}"/>`,
    `<g font-family="${escape(fontFamily)}">`,
    ...body,
    "</g>",
    "</svg>",
    ""
  ].join("\n");
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A PNG that says its resolution, so a slide or document places it at the size it was
 * drawn rather than one pixel per point. Canvases write none; one already there is kept.
 */
export function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const type = (at: number) => String.fromCharCode(...png.subarray(at + 4, at + 8));
  if (png.length < 33 || type(8) !== "IHDR") return png;
  for (let at = 8; at + 8 <= png.length; at += 12 + view.getUint32(at)) {
    if (type(at) === "pHYs") return png;
    if (type(at) === "IDAT") break;
  }
  const chunk = new Uint8Array(21);
  const c = new DataView(chunk.buffer);
  const perMetre = Math.round(dpi / 0.0254);
  c.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  c.setUint32(8, perMetre);
  c.setUint32(12, perMetre);
  chunk[16] = 1;
  c.setUint32(17, crc32(chunk.subarray(4, 17)));
  const after = 8 + 12 + view.getUint32(8);
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, after));
  out.set(chunk, after);
  out.set(png.subarray(after), after + chunk.length);
  return out;
}
