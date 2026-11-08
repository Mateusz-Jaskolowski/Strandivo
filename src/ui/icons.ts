// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Stroke icons used across the document window (24×24 grid, drawn with currentColor).

const PATHS = {
  search: ["M11 4.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13", "M20 20l-4.2-4.2"],
  filter: ["M4 6h16", "M7 12h10", "M10 18h4"],
  plus: ["M12 5v14", "M5 12h14"],
  featureAdd: ["M3 9h9l3 3-3 3H3z", "M19 8v8", "M15 12h8"],
  detect: ["M3 10h8l3 3-3 3H3z", "M18.5 4l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z"],
  primerAdd: ["M3 14h16", "M14 9l5 5"],
  scissors: ["M6 4.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5", "M6 14.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5", "M8.2 8.4L20 17", "M8.2 15.6L20 7"],
  export: ["M12 3v12", "M8 7l4-4 4 4", "M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"],
  home: ["M4 11l8-7 8 7", "M6 9.5V20h12V9.5", "M10 20v-6h4v6"],
  folder: ["M3.5 7A1.5 1.5 0 0 1 5 5.5h4.2l2 2.2H19a1.5 1.5 0 0 1 1.5 1.5v8.3A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"],
  sidebar: ["M5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4z", "M9 4v16"],
  inspector: ["M5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4z", "M15 4v16"],
  split: ["M5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4z", "M12 4v16"],
  chevronDown: ["M6 9l6 6 6-6"],
  chevronLeft: ["M15 6l-6 6 6 6"],
  chevronRight: ["M9 6l6 6-6 6"],
  rotate: ["M20 12a8 8 0 1 1-2.34-5.66", "M20 4v5h-5"],
  zoom: ["M11 4.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13", "M20 20l-4.2-4.2", "M8.5 11h5", "M11 8.5v5"],
  text: ["M2 19L7.5 5 13 19", "M4.2 14h6.6", "M15 19l3.5-9 3.5 9", "M16.3 16h4.4"],
  copy: ["M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z", "M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  warn: ["M12 3.5l9.5 16.5h-19z", "M12 10v4.5", "M12 17.2v.1"],
  okCircle: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18", "M8 12.5l2.7 2.7L16 9.5"],
  undo: ["M9 14L4 9l5-5", "M4 9h11a5 5 0 0 1 0 10h-3"],
  redo: ["M15 14l5-5-5-5", "M20 9H9a5 5 0 0 0 0 10h3"],
  map: ["M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16", "M12 4a8 8 0 0 1 7.4 5"],
  lines: ["M4 7h16", "M4 12h16", "M4 17h10"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  x: ["M6 6l12 12", "M18 6L6 18"],
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12", "M9 7V4h6v3"],
  more: [],
  wave: ["M3 15c2-7 4-7 5 0s3 7 5 0 3-7 5 0 2 4 3 2"],
  gel: ["M4.5 3.5h15v17h-15z", "M7.5 7h3.5", "M13 7h3.5", "M7.5 11h3.5", "M13 13.5h3.5", "M7.5 16h3.5"],
  clone: ["M16 6A7.5 7.5 0 1 1 8 6", "M8.5 3.5h7v4h-7z"],
  pcr: ["M3 9h15", "M14 5l4 4", "M21 15H6", "M10 19l-4-4"],
  library: ["M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z", "M5 17a3 3 0 0 1 3-3h11"],
  upload: ["M12 15V3", "M8 7l4-4 4 4", "M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"],
  download: ["M12 3v12", "M8 11l4 4 4-4", "M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"],
  settings: ["M4 7h10", "M18 7h2", "M4 17h4", "M12 17h8", "M16 5a2 2 0 1 0 0 4a2 2 0 1 0 0-4", "M10 15a2 2 0 1 0 0 4a2 2 0 1 0 0-4"]
} satisfies Record<string, string[]>;

export type IconName = keyof typeof PATHS;

const NS = "http://www.w3.org/2000/svg";

export function iconSvg(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "sv-icon");
  if (name === "more") {
    svg.setAttribute("fill", "currentColor");
    for (const cx of [5, 12, 19]) {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", String(cx));
      c.setAttribute("cy", "12");
      c.setAttribute("r", "1.7");
      svg.appendChild(c);
    }
    return svg;
  }
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of PATHS[name]) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

export function checkIcon(): SVGSVGElement {
  const svg = iconSvg("check", 11);
  svg.setAttribute("stroke-width", "2.6");
  svg.classList.add("sv-check");
  return svg;
}

/** Small strand arrow (→ / ←) for lists. */
export function strandIcon(strand: 1 | -1 | 0, label = true): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 14 10");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "10");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "sv-strand");
  if (label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", strand === 1 ? "forward" : strand === -1 ? "reverse" : "no direction");
  } else svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", strand === 1 ? "M1 5h11M8.5 1.5L12 5 8.5 8.5" : strand === -1 ? "M13 5H2M5.5 1.5L2 5l3.5 3.5" : "M2 5h10");
  svg.appendChild(p);
  return svg;
}

/** Half-arrow used for primers (→ forward, ← reverse). */
export function primerIcon(strand: 1 | -1, color?: string): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  if (color) svg.style.color = color;
  svg.setAttribute("viewBox", "0 0 14 10");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "10");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("class", "sv-primer-icon");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", strand === 1 ? "forward primer" : "reverse primer");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", strand === 1 ? "M1 7h11M8.5 3.5L12 7" : "M13 3H2M5.5 6.5L2 3");
  svg.appendChild(p);
  return svg;
}
