// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Tiny DOM helpers (no framework needed for the app's own UI).

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: Partial<CSSStyleDeclaration> | string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = String(v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: (Child | Child[])[]) {
  for (const c of children) {
    if (Array.isArray(c)) append(el, c);
    else if (c === null || c === undefined || c === false) continue;
    else el.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
}

/** An SVG element, as `h` makes HTML ones. */
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (Node | string)[]) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

let toastHost: HTMLElement | null = null;

/** Small notification in the bottom corner. */
export function toast(message: string, kind: "info" | "success" | "error" = "info", ms = 3500) {
  if (!toastHost) {
    toastHost = h("div", { class: "ps-toasts" });
    document.body.appendChild(toastHost);
  }
  const t = h("div", { class: `ps-toast ps-toast-${kind}` }, message);
  toastHost.appendChild(t);
  setTimeout(() => {
    t.classList.add("ps-toast-out");
    setTimeout(() => t.remove(), 300);
  }, ms);
}

export function icon(name: "open" | "new" | "reads" | "map" | "copy" | "check" | "warn" | "x" | "arrow-right" | "arrow-left" | "file" | "settings"): SVGSVGElement {
  const paths: Record<string, string> = {
    open: "M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M3 7V5a2 2 0 0 1 2-2h4l2 2",
    new: "M12 5v14 M5 12h14",
    reads: "M3 12h3l2-6 3 12 3-9 2 3h5",
    map: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18 M12 3a9 9 0 0 1 9 9",
    copy: "M9 9h10v10H9z M5 15V5h10",
    check: "M5 12l4 4 10-10",
    warn: "M12 4l9 16H3z M12 10v4 M12 17v.5",
    x: "M6 6l12 12 M18 6L6 18",
    "arrow-right": "M4 12h14 M13 6l6 6-6 6",
    "arrow-left": "M20 12H6 M11 6l-6 6 6 6",
    file: "M6 3h8l4 4v14H6z M14 3v4h4",
    settings: "M4 6h9 M17 6h3 M15 4v4 M4 12h3 M11 12h9 M9 10v4 M4 18h11 M19 18h1 M17 16v4"
  };
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths[name].split(" M")) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d.startsWith("M") ? d : "M" + d);
    svg.appendChild(p);
  }
  return svg;
}
