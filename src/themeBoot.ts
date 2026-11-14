// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Sets the theme before the page first paints, so no window flashes light on start. A
// module (src/main.ts) may run only after that paint, so vite.config.ts makes this a plain
// script in the page's <head>, with no imports: `__THEMES__` is src/lib/themes.ts' list.
// It decides as `themeFor` there does; src/theme.ts then keeps the theme up to date.

(() => {
  let chosen: unknown;
  try {
    // Settings' key in src/settings.ts.
    chosen = JSON.parse(localStorage.getItem("strandivo.settings") || "{}").appearance;
  } catch {
    /* no storage or unreadable settings: System, as loadSettings has it */
  }
  let dark = false;
  try {
    dark = matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    /* no media queries: light */
  }
  document.documentElement.dataset.theme = __THEMES__.includes(chosen as string) ? (chosen as string) : dark ? "dark" : "light";
})();
