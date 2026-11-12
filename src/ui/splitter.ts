// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// A divider that resizes what is beside it: dragged, moved with the arrow keys when
// focused, and double-clicked to reset or fit. The caller keeps the size, limits it and
// saves it; this only turns pointer and keys into sizes.

import { h } from "./dom.ts";

export interface SplitterOptions {
  /** "x" resizes a width (a vertical divider), "y" a height. */
  axis: "x" | "y";
  /** What it resizes, for screen readers ("Resize read names"). */
  label: string;
  /** The size now, in pixels. */
  size(): number;
  /** Asked for a new size; the caller limits it. */
  resize(px: number): void;
  /** A drag or key press is over: the place to save the size. */
  done?(): void;
  /** Double-click. */
  reset?(): void;
  /** True when the divider is on the near side of what it resizes (left or top), so moving it away shrinks it. */
  before?: boolean;
  /** Pixels per arrow key press. */
  step?: number;
  class?: string;
}

export function splitter(o: SplitterOptions): HTMLElement {
  const x = o.axis === "x";
  const sign = o.before ? -1 : 1;
  const el = h("div", {
    class: `sv-splitter sv-splitter-${o.axis}${o.class ? ` ${o.class}` : ""}`,
    role: "separator",
    "aria-orientation": x ? "vertical" : "horizontal",
    "aria-label": o.label,
    tabindex: "0"
  });
  el.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add("sv-splitter-active");
    const from = x ? e.clientX : e.clientY;
    const start = o.size();
    const move = (ev: PointerEvent) => o.resize(start + sign * ((x ? ev.clientX : ev.clientY) - from));
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.classList.remove("sv-splitter-active");
      o.done?.();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  });
  el.addEventListener("dblclick", e => {
    if (!o.reset) return;
    e.preventDefault();
    o.reset();
    o.done?.();
  });
  el.addEventListener("keydown", e => {
    const [less, more] = x ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
    if (e.key !== less && e.key !== more) return;
    e.preventDefault();
    o.resize(o.size() + sign * (e.key === more ? 1 : -1) * (o.step ?? 16));
    o.done?.();
  });
  return el;
}
