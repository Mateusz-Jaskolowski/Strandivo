// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Gels and maps as images, to copy or save as PNG or SVG. A view hands over its figure
// drawn as on screen, with its classes. Here it is drawn off screen in the light theme, as
// an image keeps its own colours whatever the window shows, measured whole, and each shape
// given its style as attributes of its own, so the SVG file has nothing left that only the
// page understood (classes, CSS variables, `color-mix()`, tooltips) and its text stays
// text, in the fonts installed where it is opened. Browsers and macOS Quick Look draw it as
// it looks; editors that substitute fonts were not tried. The PNG is painted from that
// same SVG on a canvas, shape by shape, rather than loaded as an image: the Content
// Security Policy allows no image that isn't one of the app's files, and loading one would
// make copying wait past the click that asked, which is the only time a browser lets a
// page copy.

import { h, toast } from "../ui/dom.ts";
import { s } from "../ui/svg.ts";
import { iconSvg } from "../ui/icons.ts";
import { chooseSavePath, copyImage, saveBytes, saveText } from "../platform.ts";
import { basename } from "../lib/files.ts";
import { pngWithDpi } from "../lib/proteinFigure.ts";
import { cssColor, fitBox, pngScale, svgColor, svgDashes, svgLength, type Box } from "../lib/imageExport.ts";

const XLINK = "http://www.w3.org/1999/xlink";
/** What a figure is drawn on, unless it is asked to be transparent. */
export const PAPER = "#ffffff";
/** Room round what is drawn, in pixels of the drawing. */
const PAD = 12;

export interface FigureOptions {
  /** The file's title, which other programs show as the image's name. */
  title: string;
  transparent?: boolean;
}

// ---------- the light theme, off screen ----------

let lightTokens: [string, string][] | null = null;

/** The light theme's tokens, as its block in src/styles.css sets them. */
function lightTheme(): [string, string][] {
  if (lightTokens?.length) return lightTokens;
  const out: [string, string][] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule) || !/\[data-theme=["']?light["']?\]/.test(rule.selectorText)) continue;
      for (let i = 0; i < rule.style.length; i++) {
        const name = rule.style[i];
        if (name.startsWith("--")) out.push([name, rule.style.getPropertyValue(name).trim()]);
      }
    }
  }
  return (lightTokens = out);
}

let exported = 0;

/**
 * Runs `use` on `figure` in the page but out of sight, in the light theme, with ids of its
 * own: the view it was drawn from is still in the page, with the same ids, and a reference
 * to one (a clip, a name along its feature) would find the view's.
 */
function offscreen<T>(figure: SVGSVGElement, use: (svg: SVGSVGElement) => T): T {
  const prefix = `sv-export-${++exported}-`;
  const ids = new Map<string, string>();
  figure.querySelectorAll("[id]").forEach((el, i) => {
    ids.set(el.id, `${prefix}${i}`);
    el.id = `${prefix}${i}`;
  });
  for (const el of [figure, ...Array.from(figure.querySelectorAll("*"))]) {
    for (const a of Array.from(el.attributes)) {
      if (a.localName === "href" && a.value.startsWith("#") && ids.has(a.value.slice(1))) el.setAttribute(a.name, `#${ids.get(a.value.slice(1))}`);
      else if (a.value.includes("url(")) el.setAttribute(a.name, a.value.replace(/url\(\s*["']?#([^"')\s]+)["']?\s*\)/g, (m, id: string) => (ids.has(id) ? `url(#${ids.get(id)})` : m)));
    }
  }
  const host = h("div", { "aria-hidden": "true", style: { position: "fixed", left: "-30000px", top: "0", width: "1000px", height: "1000px", overflow: "hidden", pointerEvents: "none" } });
  for (const [name, value] of lightTheme()) host.style.setProperty(name, value);
  figure.setAttribute("width", "1000");
  figure.setAttribute("height", "1000");
  host.appendChild(figure);
  document.body.appendChild(host);
  try {
    return use(figure);
  } finally {
    host.remove();
  }
}

// ---------- styles as attributes ----------

/** Inherited in SVG 1.1, so written only where they change from the parent's. */
const INHERITED = ["fill", "fill-opacity", "fill-rule", "stroke", "stroke-opacity", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "font-family", "font-size", "font-weight", "font-style", "text-anchor"];
const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const TEXT_PARTS = new Set(["tspan", "textPath"]);
/** Attributes only the page uses. */
const PAGE_ONLY = /^(class|style|role|tabindex|pointer-events|cursor|data-.*|aria-.*)$/;
/** Lengths, kept to hundredths of a pixel in the file. */
const LENGTHS = new Set(["x", "y", "dx", "dy", "width", "height", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry"]);
const hundredths = (v: string) => (/^-?\d*\.\d{3,}$/.test(v.trim()) ? String(Math.round(parseFloat(v) * 100) / 100) : v);

let probe: CanvasRenderingContext2D | null | undefined;
const colours = new Map<string, { r: number; g: number; b: number; a: number } | null>();
/** The channels of a computed colour in a form `cssColor` doesn't read, from a pixel painted in it. */
function probeColour(css: string) {
  if (colours.has(css)) return colours.get(css)!;
  if (probe === undefined) probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  let out: { r: number; g: number; b: number; a: number } | null = null;
  if (probe) {
    probe.canvas.width = 1;
    probe.canvas.height = 1;
    probe.fillStyle = "#010203";
    probe.fillStyle = css;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    out = { r, g, b, a: a / 255 };
  }
  colours.set(css, out);
  return out;
}

const fraction = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 1;
};

/** An element's style as SVG attributes, from what the page computes for it. */
function styleOf(el: Element): Map<string, string> {
  const cs = getComputedStyle(el);
  const out = new Map<string, string>();
  for (const paint of ["fill", "stroke"]) {
    const value = cs.getPropertyValue(paint).trim();
    const opacity = fraction(cs.getPropertyValue(`${paint}-opacity`));
    if (value === "none" || value.startsWith("url(")) {
      out.set(paint, value === "none" ? "none" : value.replace(/["']/g, ""));
      out.set(`${paint}-opacity`, String(opacity));
      continue;
    }
    const c = cssColor(value) ?? probeColour(value);
    const v = c ? svgColor(c.r, c.g, c.b, c.a * opacity) : null;
    out.set(paint, v ? v.color : "none");
    out.set(`${paint}-opacity`, v ? String(v.opacity) : "1");
  }
  out.set("fill-rule", cs.getPropertyValue("fill-rule"));
  out.set("stroke-width", svgLength(cs.getPropertyValue("stroke-width")));
  out.set("stroke-dasharray", svgDashes(cs.getPropertyValue("stroke-dasharray")));
  out.set("stroke-linecap", cs.getPropertyValue("stroke-linecap"));
  out.set("stroke-linejoin", cs.getPropertyValue("stroke-linejoin"));
  out.set("font-family", cs.getPropertyValue("font-family"));
  out.set("font-size", svgLength(cs.getPropertyValue("font-size")));
  out.set("font-weight", cs.getPropertyValue("font-weight"));
  out.set("font-style", cs.getPropertyValue("font-style"));
  out.set("text-anchor", cs.getPropertyValue("text-anchor"));
  out.set("dominant-baseline", cs.getPropertyValue("dominant-baseline"));
  out.set("opacity", cs.getPropertyValue("opacity"));
  out.set("display", cs.getPropertyValue("display"));
  return out;
}

/**
 * Writes each element's computed style onto it and takes away what only the page used.
 * Every style is read before any class goes, as many depend on a parent's class.
 */
function inlineStyles(svg: SVGSVGElement) {
  const all = [svg, ...Array.from(svg.querySelectorAll("*"))];
  // Shapes that only say where a clip or a name along a path goes have no style to keep.
  const geometry = (el: Element) => {
    for (let p: Element | null = el; p && p !== svg; p = p.parentElement) if (p.localName === "defs" || p.localName === "clipPath") return true;
    return false;
  };
  const styles = new Map<Element, Map<string, string>>();
  for (const el of all) if (!geometry(el)) styles.set(el, styleOf(el));
  for (const el of all) {
    for (const a of Array.from(el.attributes)) {
      if (PAGE_ONLY.test(a.name)) el.removeAttribute(a.name);
      else if (LENGTHS.has(a.name)) el.setAttribute(a.name, hundredths(a.value));
    }
    if (el.localName === "title") {
      el.remove();
      continue;
    }
    const own = styles.get(el);
    for (const name of [...INHERITED, "dominant-baseline", "opacity"]) el.removeAttribute(name);
    if (!own) continue;
    const parent = el.parentElement ? styles.get(el.parentElement) : undefined;
    if (own.get("display") === "none") {
      el.remove();
      continue;
    }
    // Hit areas: clear shapes over others, there to be pointed at.
    if (SHAPES.has(el.localName) && own.get("fill") === "none" && own.get("stroke") === "none") {
      el.remove();
      continue;
    }
    for (const name of INHERITED) if (!parent || parent.get(name) !== own.get(name)) el.setAttribute(name, own.get(name)!);
    // Not inherited in SVG 1.1, and WebKit doesn't pass it on to a name along a path, so
    // every text and part of one says its own.
    const baseline = own.get("dominant-baseline")!;
    if ((el.localName === "text" || TEXT_PARTS.has(el.localName)) && baseline !== "auto") el.setAttribute("dominant-baseline", baseline);
    if (own.get("opacity") !== "1") el.setAttribute("opacity", own.get("opacity")!);
    // Programs older than SVG 2 look for a name's path here.
    const href = el.getAttribute("href");
    if (href && el.localName === "textPath") el.setAttributeNS(XLINK, "xlink:href", href);
  }
}

/**
 * Makes `svg` stand alone: styles as attributes, a title, fitted to what it draws with room
 * round it, on paper unless transparent. Returns the box it now shows.
 */
function standalone(svg: SVGSVGElement, o: FigureOptions): Box {
  inlineStyles(svg);
  // Measured as one group, so shapes moved by a transform are measured where they are drawn.
  const all = s("g");
  all.append(...Array.from(svg.childNodes));
  svg.appendChild(all);
  const drawn = all.getBBox();
  const box = fitBox({ x: drawn.x, y: drawn.y, width: drawn.width, height: drawn.height }, PAD);
  const f = (v: number) => String(Math.round(v * 100) / 100);
  svg.setAttribute("viewBox", [box.x, box.y, box.width, box.height].map(f).join(" "));
  svg.setAttribute("width", f(box.width));
  svg.setAttribute("height", f(box.height));
  if (!o.transparent) svg.insertBefore(s("rect", { x: box.x, y: box.y, width: box.width, height: box.height, fill: PAPER }), all);
  svg.insertBefore(s("title", null, o.title), svg.firstChild);
  return box;
}

// ---------- painting the PNG ----------

const BASELINES: Record<string, CanvasTextBaseline> = {
  central: "middle",
  middle: "middle",
  mathematical: "middle",
  hanging: "hanging",
  "text-before-edge": "top",
  "text-top": "top",
  "text-after-edge": "bottom",
  "text-bottom": "bottom",
  ideographic: "ideographic"
};

const numberAttr = (el: Element, name: string): number | undefined => {
  const v = el.getAttribute(name);
  if (v === null || v.trim() === "") return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};

/** The outline of a basic shape or path, in its own coordinates. */
function outline(el: Element): Path2D | null {
  const n = (name: string) => numberAttr(el, name) ?? 0;
  const p = new Path2D();
  switch (el.localName) {
    case "path": {
      const d = el.getAttribute("d");
      return d ? new Path2D(d) : null;
    }
    case "rect": {
      const [x, y, w, hh] = [n("x"), n("y"), n("width"), n("height")];
      if (!(w > 0 && hh > 0)) return null;
      const r = Math.min(numberAttr(el, "rx") ?? numberAttr(el, "ry") ?? 0, w / 2, hh / 2);
      if (r <= 0) {
        p.rect(x, y, w, hh);
        return p;
      }
      p.moveTo(x + r, y);
      p.arcTo(x + w, y, x + w, y + hh, r);
      p.arcTo(x + w, y + hh, x, y + hh, r);
      p.arcTo(x, y + hh, x, y, r);
      p.arcTo(x, y, x + w, y, r);
      p.closePath();
      return p;
    }
    case "circle":
      p.arc(n("cx"), n("cy"), n("r"), 0, 2 * Math.PI);
      return p;
    case "ellipse":
      p.ellipse(n("cx"), n("cy"), n("rx"), n("ry"), 0, 0, 2 * Math.PI);
      return p;
    case "line":
      p.moveTo(n("x1"), n("y1"));
      p.lineTo(n("x2"), n("y2"));
      return p;
    case "polyline":
    case "polygon": {
      const v = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
      for (let i = 0; i + 1 < v.length; i += 2) (i ? p.lineTo(v[i], v[i + 1]) : p.moveTo(v[i], v[i + 1]));
      if (el.localName === "polygon") p.closePath();
      return p;
    }
  }
  return null;
}

const referenced = (svg: SVGSVGElement, ref: string | null) => {
  const id = /^#(.+)$/.exec(ref ?? "")?.[1] ?? /url\(\s*["']?#([^"')\s]+)/.exec(ref ?? "")?.[1];
  return id ? svg.querySelector(`[id="${CSS.escape(id)}"]`) : null;
};

const fontOf = (cs: CSSStyleDeclaration) => `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

function paintShape(g: CanvasRenderingContext2D, p: Path2D, cs: CSSStyleDeclaration) {
  const alpha = g.globalAlpha;
  const fill = cs.getPropertyValue("fill");
  if (fill !== "none" && !fill.startsWith("url(")) {
    g.fillStyle = fill;
    g.globalAlpha = alpha * fraction(cs.getPropertyValue("fill-opacity"));
    g.fill(p, cs.getPropertyValue("fill-rule") === "evenodd" ? "evenodd" : "nonzero");
  }
  const stroke = cs.getPropertyValue("stroke");
  const width = parseFloat(cs.getPropertyValue("stroke-width"));
  if (stroke !== "none" && !stroke.startsWith("url(") && width > 0) {
    g.strokeStyle = stroke;
    g.lineWidth = width;
    g.lineCap = cs.getPropertyValue("stroke-linecap") as CanvasLineCap;
    g.lineJoin = cs.getPropertyValue("stroke-linejoin") as CanvasLineJoin;
    const dashes = svgDashes(cs.getPropertyValue("stroke-dasharray"));
    g.setLineDash(dashes === "none" ? [] : dashes.split(" ").map(Number));
    g.globalAlpha = alpha * fraction(cs.getPropertyValue("stroke-opacity"));
    g.stroke(p);
  }
  g.globalAlpha = alpha;
}

/** Fills (and strokes) text set at `x`, `y` in the style of `cs`. */
function paintGlyphs(g: CanvasRenderingContext2D, text: string, x: number, y: number, cs: CSSStyleDeclaration) {
  const alpha = g.globalAlpha;
  const fill = cs.getPropertyValue("fill");
  if (fill !== "none") {
    g.fillStyle = fill;
    g.globalAlpha = alpha * fraction(cs.getPropertyValue("fill-opacity"));
    g.fillText(text, x, y);
  }
  const stroke = cs.getPropertyValue("stroke");
  if (stroke !== "none" && parseFloat(cs.getPropertyValue("stroke-width")) > 0) {
    g.strokeStyle = stroke;
    g.lineWidth = parseFloat(cs.getPropertyValue("stroke-width"));
    g.globalAlpha = alpha * fraction(cs.getPropertyValue("stroke-opacity"));
    g.strokeText(text, x, y);
  }
  g.globalAlpha = alpha;
}

interface Run {
  text: string;
  cs: CSSStyleDeclaration;
  x?: number;
  y?: number;
  dx: number;
  dy: number;
}

/**
 * A text in runs of one style, laid out as SVG does: a run given its own x or y starts a
 * new chunk, which its text-anchor places as a whole; dx and dy move what follows.
 */
function paintText(g: CanvasRenderingContext2D, text: SVGTextElement, svg: SVGSVGElement) {
  const along = text.querySelector("textPath");
  if (along) return paintAlongPath(g, along, svg);
  const runs: Run[] = [];
  const collect = (el: Element, pending: { x?: number; y?: number; dx: number; dy: number }) => {
    let at: typeof pending | null = { x: numberAttr(el, "x") ?? pending.x, y: numberAttr(el, "y") ?? pending.y, dx: (numberAttr(el, "dx") ?? 0) + pending.dx, dy: (numberAttr(el, "dy") ?? 0) + pending.dy };
    const cs = getComputedStyle(el);
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = (node.textContent ?? "").replace(/\s+/g, " ");
        if (!t) continue;
        runs.push({ text: t, cs, ...(at ?? { dx: 0, dy: 0 }) });
        at = null;
      } else if (node instanceof Element && node.localName === "tspan") {
        collect(node, at ?? { dx: 0, dy: 0 });
        at = null;
      }
    }
  };
  collect(text, { dx: 0, dy: 0 });
  if (!runs.length) return;
  runs[0].text = runs[0].text.trimStart();
  runs[runs.length - 1].text = runs[runs.length - 1].text.trimEnd();
  const baseline = BASELINES[getComputedStyle(text).getPropertyValue("dominant-baseline")] ?? "alphabetic";
  const width = (r: Run) => {
    g.font = fontOf(r.cs);
    return g.measureText(r.text).width;
  };
  let x = 0;
  let y = 0;
  for (let i = 0; i < runs.length; ) {
    let j = i + 1;
    while (j < runs.length && runs[j].x === undefined && runs[j].y === undefined) j++;
    const chunk = runs.slice(i, j);
    const total = chunk.reduce((sum, r) => sum + r.dx + width(r), 0);
    const anchor = chunk[0].cs.getPropertyValue("text-anchor");
    x = (chunk[0].x ?? x) - (anchor === "middle" ? total / 2 : anchor === "end" ? total : 0);
    y = chunk[0].y ?? y;
    for (const r of chunk) {
      x += r.dx;
      y += r.dy;
      const w = width(r);
      g.textAlign = "left";
      g.textBaseline = baseline;
      paintGlyphs(g, r.text, x, y, r.cs);
      x += w;
    }
    i = j;
  }
}

/** A name along its feature: each character placed and turned along the path. */
function paintAlongPath(g: CanvasRenderingContext2D, along: Element, svg: SVGSVGElement) {
  const path = referenced(svg, along.getAttribute("href") ?? along.getAttributeNS(XLINK, "href"));
  if (!(path instanceof SVGPathElement)) return;
  const cs = getComputedStyle(along);
  const text = (along.textContent ?? "").replace(/\s+/g, " ").trim();
  const length = path.getTotalLength();
  const offset = along.getAttribute("startOffset") ?? "0";
  const from = offset.trim().endsWith("%") ? (length * parseFloat(offset)) / 100 : parseFloat(offset) || 0;
  g.font = fontOf(cs);
  const total = g.measureText(text).width;
  const anchor = cs.getPropertyValue("text-anchor");
  const start = from - (anchor === "middle" ? total / 2 : anchor === "end" ? total : 0);
  g.textAlign = "center";
  g.textBaseline = BASELINES[cs.getPropertyValue("dominant-baseline")] ?? BASELINES[getComputedStyle(along.parentElement!).getPropertyValue("dominant-baseline")] ?? "alphabetic";
  const chars = Array.from(text);
  let before = 0;
  chars.forEach((c, i) => {
    // Measured as part of what comes before it, so pairs keep their kerning.
    const upTo = g.measureText(chars.slice(0, i + 1).join("")).width;
    const middle = start + (before + upTo) / 2;
    before = upTo;
    if (middle < 0 || middle > length) return;
    const p = path.getPointAtLength(middle);
    const a = path.getPointAtLength(Math.max(0, middle - 0.5));
    const b = path.getPointAtLength(Math.min(length, middle + 0.5));
    g.save();
    g.translate(p.x, p.y);
    g.rotate(Math.atan2(b.y - a.y, b.x - a.x));
    paintGlyphs(g, c, 0, 0, cs);
    g.restore();
  });
}

const UNPAINTED = new Set(["defs", "clipPath", "title", "desc", "metadata", "style", "mask", "symbol", "marker"]);

function paintNode(g: CanvasRenderingContext2D, el: Element, svg: SVGSVGElement) {
  if (UNPAINTED.has(el.localName)) return;
  const cs = getComputedStyle(el);
  if (cs.display === "none") return;
  g.save();
  const transform = (el as SVGGraphicsElement).transform?.baseVal;
  if (transform?.numberOfItems) {
    const m = transform.consolidate()!.matrix;
    g.transform(m.a, m.b, m.c, m.d, m.e, m.f);
  }
  const opacity = fraction(cs.getPropertyValue("opacity"));
  if (opacity < 1) g.globalAlpha *= opacity;
  const clip = referenced(svg, el.getAttribute("clip-path"));
  if (clip) {
    const area = new Path2D();
    let rule: CanvasFillRule = "nonzero";
    for (const part of Array.from(clip.children)) {
      const p = outline(part);
      if (p) area.addPath(p);
      if (part.getAttribute("clip-rule") === "evenodd") rule = "evenodd";
    }
    g.clip(area, rule);
  }
  if (el.localName === "svg" || el.localName === "g" || el.localName === "a") for (const child of Array.from(el.children)) paintNode(g, child, svg);
  else if (el.localName === "text") paintText(g, el as SVGTextElement, svg);
  else {
    const p = outline(el);
    if (p) paintShape(g, p, cs);
  }
  g.restore();
}

function pngOf(canvas: HTMLCanvasElement, dpi: number): Uint8Array {
  // Made at once rather than with toBlob, so copying stays within the click that asked.
  const data = atob(canvas.toDataURL("image/png").split(",")[1]);
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
  return pngWithDpi(bytes, dpi);
}

// ---------- what the views use ----------

/**
 * The figure as an SVG file, with its text as text (in the fonts installed where it is
 * opened). Checked in browsers and macOS Quick Look, not in editors that substitute fonts.
 */
export function exportSvg(figure: SVGSVGElement, o: FigureOptions): string {
  return offscreen(figure, svg => {
    standalone(svg, o);
    return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}\n`;
  });
}

/** The figure as a PNG, about 3,000 pixels across and marked with its resolution. */
export function exportPng(figure: SVGSVGElement, o: FigureOptions): Uint8Array {
  return offscreen(figure, svg => {
    const box = standalone(svg, o);
    const scale = pngScale(box.width, box.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(box.width * scale));
    canvas.height = Math.max(1, Math.round(box.height * scale));
    const g = canvas.getContext("2d");
    if (!g) throw new Error("This window can't draw images.");
    // The canvas has whole pixels, so the paper drawn to the box's size can leave a last
    // column or row of it half covered, which a dark slide shows as a pale fringe.
    if (!o.transparent) {
      g.fillStyle = PAPER;
      g.fillRect(0, 0, canvas.width, canvas.height);
    }
    g.scale(scale, scale);
    g.translate(-box.x, -box.y);
    paintNode(g, svg, svg);
    return pngOf(canvas, 96 * scale);
  });
}

export interface ImageExport {
  /** What the image shows, as messages name it: "the gel". */
  what: string;
  /** The file's name without its extension. */
  fileName: () => string;
  /** The file's title. */
  title: () => string;
  /** Drawn anew for each export, as the view shows it then. */
  figure: () => SVGSVGElement;
  transparent?: () => boolean;
  /** Small buttons, beside a figure rather than at a dialog's foot. */
  small?: boolean;
}

/**
 * Copy image, Save as PNG… and Save as SVG…, as the protein schematic has them. Each
 * button has a `data-focus` key, so a dialog drawn again gives focus back to it.
 */
export function imageButtons(o: ImageExport): HTMLButtonElement[] {
  const options = () => ({ title: o.title(), transparent: o.transparent?.() ?? false });
  const copy = async () => {
    try {
      await copyImage(exportPng(o.figure(), options()));
      toast(`Copied ${o.what}`, "success", 1800);
    } catch {
      toast(`Couldn't copy ${o.what}. Save it as a PNG instead.`, "error", 5000);
    }
  };
  const save = async (kind: "png" | "svg") => {
    try {
      const path = await chooseSavePath(`${o.fileName()}.${kind}`, [kind === "png" ? { name: "PNG image", extensions: ["png"] } : { name: "SVG image", extensions: ["svg"] }]);
      if (!path) return;
      if (kind === "png") await saveBytes(path, exportPng(o.figure(), options()));
      else await saveText(path, exportSvg(o.figure(), options()));
      toast(`Saved ${basename(path)}`, "success", 3000);
    } catch (e) {
      toast(`Couldn't save ${o.what}: ${e instanceof Error ? e.message : e}`, "error", 6000);
    }
  };
  const cls = o.small ? "sv-btn sv-btn-small" : "sv-btn";
  const key = o.what.replace(/^the /, "").replace(/\s+/g, "-");
  return [
    h("button", { type: "button", class: cls, "data-focus": `${key}-copy`, onclick: () => void copy() }, iconSvg("copy", 14), "Copy image"),
    h("button", { type: "button", class: cls, "data-focus": `${key}-png`, onclick: () => void save("png") }, iconSvg("download", 14), "Save as PNG…"),
    h("button", { type: "button", class: cls, "data-focus": `${key}-svg`, onclick: () => void save("svg") }, "Save as SVG…")
  ] as HTMLButtonElement[];
}
