// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The widths of a file's side panels: the sidebar on the left (the outline, or the list of
// reads in the Reads tab) and the inspector on the right. One width each for the whole
// app, kept in local storage and set as CSS variables on the page, so every open file
// follows a change at once. Until a panel is resized it keeps its own default width.

import { splitter } from "./ui/splitter.ts";

export type Panel = "sidebar" | "inspector";

const KEY = "strandivo.panels";
const LIMITS: Record<Panel, [number, number]> = { sidebar: [200, 480], inspector: [260, 520] };
/** Room always left for the view between the panels. */
const MAIN_MIN = 360;
const OTHER: Record<Panel, Panel> = { sidebar: "inspector", inspector: "sidebar" };

let widths: Partial<Record<Panel, number>> = load();

function load(): Partial<Record<Panel, number>> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "{}");
    const out: Partial<Record<Panel, number>> = {};
    for (const p of ["sidebar", "inspector"] as Panel[]) {
      const w = Number(v?.[p]);
      if (Number.isFinite(w) && w >= LIMITS[p][0] && w <= LIMITS[p][1]) out[p] = w;
    }
    return out;
  } catch {
    return {};
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(widths));
  } catch {
    /* storage unavailable: the widths last until the window closes */
  }
}

/** Sets the CSS variables; a panel not resized has none, so its own default applies. */
export function applyPanelWidths() {
  const style = document.documentElement.style;
  for (const p of ["sidebar", "inspector"] as Panel[]) {
    const w = widths[p];
    if (w === undefined) style.removeProperty(`--sv-${p}`);
    else style.setProperty(`--sv-${p}`, `${w}px`);
  }
}

/**
 * The divider on a panel's inner edge. `panel` gives the element whose width it changes,
 * as the sidebar's default differs between the outline and the list of reads.
 */
export function panelSplitter(which: Panel, panel: () => HTMLElement): HTMLElement {
  // The other panel, beside its own divider, which is hidden with it.
  const other = () => {
    const split = panel().parentElement?.querySelector<HTMLElement>(`:scope > .sv-splitter-${OTHER[which]}`);
    if (!split || split.hidden) return 0;
    const el = which === "sidebar" ? split.nextElementSibling : split.previousElementSibling;
    return el instanceof HTMLElement ? el.getBoundingClientRect().width : 0;
  };
  const el = splitter({
    axis: "x",
    label: which === "sidebar" ? "Resize sidebar" : "Resize inspector",
    class: `sv-panel-split sv-splitter-${which}`,
    before: which === "inspector",
    size: () => panel().getBoundingClientRect().width,
    resize: px => {
      const [least, most] = LIMITS[which];
      const room = window.innerWidth - other() - MAIN_MIN;
      widths = { ...widths, [which]: Math.round(Math.max(least, Math.min(most, room, px))) };
      applyPanelWidths();
    },
    done: save,
    reset: () => {
      widths = { ...widths };
      delete widths[which];
      applyPanelWidths();
    }
  });
  el.title = "Drag to resize, double-click for the usual width";
  return el;
}
