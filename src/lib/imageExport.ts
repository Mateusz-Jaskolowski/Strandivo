// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// What every exported image shares, apart from drawing it (src/views/imageExport.ts): its
// file name, how many pixels of PNG it gets per pixel of drawing, the box it is fitted to,
// and colours written as SVG 1.1 has them, for programs that read neither `color-mix()`
// nor `rgb()` with an alpha.

/** Characters no file system takes in a name. */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]+/g;

/** "pUC19 map": a name for an image of `what`, safe on every system; `fallback` stands in for a blank name. */
export function imageFileName(name: string, what: string, fallback = "Sequence"): string {
  const safe = name.replace(UNSAFE, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return `${safe || fallback} ${what}`;
}

/** The longest side of a PNG, in pixels, for a slide or a lab record. */
export const PNG_TARGET = 3000;
/** Pixels of PNG per pixel of drawing never go below this, so a large drawing stays sharp. */
export const PNG_MIN_SCALE = 3;
/** Nor above this, so a small one isn't blown up into a huge file. */
export const PNG_MAX_SCALE = 8;
/** Canvases fail, or draw blank, above about this many pixels in some browsers. */
export const PNG_MAX_PIXELS = 40_000_000;
export const PNG_MAX_SIDE = 16_000;

/**
 * Pixels of PNG per pixel of a drawing `width` by `height`: about 3,000 along its longest
 * side, at least three, and within what a canvas can hold. The PNG says its resolution
 * (96 dpi times this), so a slide places it at the size it was drawn.
 */
export function pngScale(width: number, height: number): number {
  const longest = Math.max(1, width, height);
  let scale = Math.min(PNG_MAX_SCALE, Math.max(PNG_MIN_SCALE, PNG_TARGET / longest));
  scale = Math.min(scale, PNG_MAX_SIDE / longest, Math.sqrt(PNG_MAX_PIXELS / Math.max(1, width * height)));
  return Math.floor(scale * 100) / 100;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The box a drawing is fitted to: what it covers, `pad` all round, on whole pixels. */
export function fitBox(covered: Box, pad: number): Box {
  const x = Math.floor(covered.x - pad);
  const y = Math.floor(covered.y - pad);
  return { x, y, width: Math.ceil(covered.x + covered.width + pad) - x, height: Math.ceil(covered.y + covered.height + pad) - y };
}

/**
 * A colour as SVG 1.1 writes it, `#rrggbb` and an opacity, from its channels (0–255, alpha
 * 0–1). Other programs read neither `color-mix()` nor `rgb()` with an alpha reliably.
 * Null for a colour that can't be seen.
 */
export function svgColor(r: number, g: number, b: number, alpha: number): { color: string; opacity: number } | null {
  if (!(alpha > 0.004)) return null;
  const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return { color: `#${hex(r)}${hex(g)}${hex(b)}`, opacity: Math.min(1, Math.round(alpha * 1000) / 1000) };
}

/**
 * The channels of a colour as browsers compute it: `rgb()` and `rgba()`, either syntax, and
 * `color(srgb …)`, which is what `color-mix()` in srgb computes to. Undefined for any other
 * form, which is then left to a canvas to read.
 */
export function cssColor(css: string): { r: number; g: number; b: number; a: number } | undefined {
  const v = css.trim().toLowerCase();
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const num = (s: string, whole: number) => (s.endsWith("%") ? (parseFloat(s) / 100) * whole : parseFloat(s));
  const rgb = /^rgba?\(([^)]*)\)$/.exec(v);
  if (rgb) {
    const [r, g, b, a = "1"] = rgb[1].split(/[\s,/]+/).filter(Boolean);
    const out = { r: num(r, 255), g: num(g, 255), b: num(b, 255), a: num(a, 1) };
    return Object.values(out).every(Number.isFinite) ? out : undefined;
  }
  const srgb = /^color\(srgb\s+([^)]*)\)$/.exec(v);
  if (srgb) {
    const [r, g, b, a = "1"] = srgb[1].split(/[\s/]+/).filter(Boolean);
    const out = { r: num(r, 1) * 255, g: num(g, 1) * 255, b: num(b, 1) * 255, a: num(a, 1) };
    return Object.values(out).every(Number.isFinite) ? out : undefined;
  }
  return undefined;
}

/** A length CSS gives in pixels, as an SVG attribute: "1.5px" → "1.5". */
export const svgLength = (v: string) => v.replace(/px\b/g, "").trim();

/** A dash pattern CSS gives ("3px, 2px"), as an SVG attribute ("3 2"). */
export const svgDashes = (v: string) => (v === "none" || !v.trim() ? "none" : v.split(/[\s,]+/).filter(Boolean).map(svgLength).join(" "));
