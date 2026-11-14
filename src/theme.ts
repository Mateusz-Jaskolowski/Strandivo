// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The theme a window shows, kept to Settings' Appearance and, with System, to the computer's
// light or dark mode as it changes. src/themeBoot.ts set it before the first paint.

import { loadSettings, onSettingsChanged } from "./settings.ts";
import { themeFor, type ThemeName } from "./lib/themes.ts";

const listeners = new Set<(theme: ThemeName) => void>();
let started = false;

/** Applies the appearance in Settings to this window, now and on every change. */
export function startTheme(): void {
  if (started) return;
  started = true;
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  let appearance = loadSettings().appearance;
  const apply = () => {
    const theme = themeFor(appearance, media?.matches ?? false);
    const root = document.documentElement;
    if (root.dataset.theme === theme) return;
    root.dataset.theme = theme;
    for (const fn of [...listeners]) fn(theme);
  };
  apply();
  onSettingsChanged(s => {
    appearance = s.appearance;
    apply();
  });
  media?.addEventListener?.("change", apply);
}

/**
 * Calls `fn` when the theme changes, for what reads colours to draw (canvases); CSS follows
 * by itself. Returns a function that stops it.
 */
export function onThemeChanged(fn: (theme: ThemeName) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
