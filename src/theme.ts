// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The theme a window shows, kept to Settings' Appearance and, with System, to the computer's
// light or dark mode as it changes. src/themeBoot.ts set it before the first paint.

import { loadSettings, onSettingsChanged } from "./settings.ts";
import { themeFor, type ThemeName } from "./lib/themes.ts";
import { setWindowLook } from "./platform.ts";

const listeners = new Set<(theme: ThemeName) => void>();
let started = false;

/** Applies the appearance in Settings to this window, now and on every change. */
export function startTheme(): void {
  if (started) return;
  started = true;
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  let appearance = loadSettings().appearance;
  let told = "";
  const apply = () => {
    const theme = themeFor(appearance, media?.matches ?? false);
    const root = document.documentElement;
    if (root.dataset.theme !== theme) {
      root.dataset.theme = theme;
      for (const fn of [...listeners]) fn(theme);
    }
    // The shell styles what is outside the page as the theme's block says: its
    // `color-scheme`, and its background for a window's first moment.
    const style = getComputedStyle(root);
    const look = {
      theme: appearance === "system" ? null : style.colorScheme === "dark" ? ("dark" as const) : ("light" as const),
      background: hexColor(getComputedStyle(document.body).backgroundColor)
    };
    if (JSON.stringify(look) === told) return;
    told = JSON.stringify(look);
    setWindowLook(look).catch(e => console.error(e));
  };
  apply();
  onSettingsChanged(s => {
    appearance = s.appearance;
    apply();
  });
  media?.addEventListener?.("change", apply);
}

/** `rgb(15, 17, 20)` as `#0f1114`, or null for anything else (a transparent body). */
function hexColor(css: string): string | null {
  const m = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(css);
  return m ? `#${m.slice(1).map(v => Number(v).toString(16).padStart(2, "0")).join("")}` : null;
}

/**
 * Calls `fn` when the theme changes, for what reads colours to draw (canvases); CSS follows
 * by itself. Returns a function that stops it.
 */
export function onThemeChanged(fn: (theme: ThemeName) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
