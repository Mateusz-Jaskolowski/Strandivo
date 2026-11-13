// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The protein figure (src/lib/proteinFigure.ts) in the page, as a PNG and as an SVG file.
// The page draws its shapes as SVG elements, so names stay text; the PNG is painted from
// the same shapes on a canvas rather than from that SVG, so no image has to be loaded.

import { fontStack, s, textWidth } from "../ui/svg.ts";
import { FIGURE_COLORS, pngWithDpi, type ProteinFigure } from "../lib/proteinFigure.ts";

/** Pixels of the PNG per pixel of the figure: about 3,000 across, for a slide or print. */
const PNG_SCALE = 3;

/** The app's font, then common ones, so an SVG opened elsewhere keeps a similar face. */
export const figureFont = () => `${fontStack("sans")}, Helvetica, Arial, sans-serif`;

export const figureMeasure = (font: string) => (text: string, size: number) => textWidth(text, `400 ${size}px ${font}`);

/** The figure in the page; a block or a name picks its region. */
export function figureElement(fig: ProteinFigure, font: string, o: { label: string; selected?: number; title: (region: number) => string; pick: (region: number) => void }): SVGSVGElement {
  const svg = s("svg", { viewBox: `0 0 ${fig.width} ${fig.height}`, class: "sv-figure", role: "img", "aria-label": o.label, "font-family": font });
  for (const sh of fig.shapes) {
    if (sh.kind === "line") {
      svg.appendChild(s("polyline", { points: sh.points.map(p => p.join(",")).join(" "), fill: "none", stroke: sh.stroke, "stroke-width": sh.width, "stroke-linecap": "round", "stroke-linejoin": "round" }));
      continue;
    }
    const region = sh.region;
    const picks = region === undefined ? {} : { class: `sv-figure-pick${region === o.selected ? " sv-selected" : ""}`, "data-region": region, onclick: () => o.pick(region) };
    const title = region === undefined ? null : s("title", null, o.title(region));
    if (sh.kind === "rect") svg.appendChild(s("rect", { x: sh.x, y: sh.y, width: sh.w, height: sh.h, rx: sh.r, fill: sh.fill, stroke: sh.stroke, "stroke-width": sh.strokeWidth, ...picks }, title));
    else svg.appendChild(s("text", { x: sh.x, y: sh.y, "font-size": sh.size, fill: sh.fill, "text-anchor": sh.anchor, ...picks }, sh.text, title));
  }
  return svg;
}

/** The figure as a PNG on white, marked with its resolution. */
export function figurePng(fig: ProteinFigure, font: string): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(fig.width * PNG_SCALE);
  canvas.height = Math.ceil(fig.height * PNG_SCALE);
  const g = canvas.getContext("2d");
  if (!g) throw new Error("This window can't draw images.");
  g.scale(PNG_SCALE, PNG_SCALE);
  g.fillStyle = FIGURE_COLORS.background;
  g.fillRect(0, 0, fig.width, fig.height);
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const sh of fig.shapes) {
    if (sh.kind === "line") {
      g.beginPath();
      sh.points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.strokeStyle = sh.stroke;
      g.lineWidth = sh.width;
      g.stroke();
    } else if (sh.kind === "rect") {
      const { x, y, w, h } = sh;
      const r = Math.min(sh.r, w / 2, h / 2);
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
      g.fillStyle = sh.fill;
      g.fill();
      g.strokeStyle = sh.stroke;
      g.lineWidth = sh.strokeWidth;
      g.stroke();
    } else {
      g.font = `400 ${sh.size}px ${font}`;
      g.fillStyle = sh.fill;
      g.textAlign = sh.anchor === "start" ? "left" : sh.anchor === "end" ? "right" : "center";
      g.textBaseline = "alphabetic";
      g.fillText(sh.text, sh.x, sh.y);
    }
  }
  // Made at once rather than with toBlob, so copying stays within the click that asked.
  const data = atob(canvas.toDataURL("image/png").split(",")[1]);
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
  return pngWithDpi(bytes, 96 * PNG_SCALE);
}
