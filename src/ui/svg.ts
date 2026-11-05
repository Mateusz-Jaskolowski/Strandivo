// Small helpers for building SVG and measuring text.

const NS = "http://www.w3.org/2000/svg";

type SvgChild = SVGElement | string | number | null | undefined | false;

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, unknown> | null = null, ...children: (SvgChild | SvgChild[])[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === "class") el.setAttribute("class", String(v));
      else el.setAttribute(k, String(v));
    }
  }
  const add = (c: SvgChild | SvgChild[]) => {
    if (Array.isArray(c)) c.forEach(add);
    else if (c === null || c === undefined || c === false) return;
    else if (typeof c === "string" || typeof c === "number") el.appendChild(document.createTextNode(String(c)));
    else el.appendChild(c);
  };
  children.forEach(add);
  return el;
}

let ctx: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();

/** Width of text in px for a CSS font shorthand (e.g. "500 11px sans-serif"). */
export function textWidth(text: string, font: string): number {
  const key = font + "|" + text;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  let w: number;
  if (ctx) {
    ctx.font = font;
    w = ctx.measureText(text).width;
  } else {
    w = text.length * parseFloat(/(\d+(\.\d+)?)px/.exec(font)?.[1] || "11") * 0.56;
  }
  if (widthCache.size > 5000) widthCache.clear();
  widthCache.set(key, w);
  return w;
}

/** The app's font stacks, read from the CSS custom properties. */
export function fontStack(kind: "sans" | "mono"): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(kind === "sans" ? "--sans" : "--mono").trim();
  return v || (kind === "sans" ? "system-ui, sans-serif" : "monospace");
}
