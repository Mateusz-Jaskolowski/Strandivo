// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The interface's themes. Each is a block of colour tokens in src/styles.css, named by
// `data-theme` on the page; Settings' Appearance stores a theme's name, or "system" to
// follow the computer's light or dark mode.

/** Every theme, by the name its block of tokens has. */
export const THEMES = ["light", "dark"] as const;
export type ThemeName = (typeof THEMES)[number];
export type Appearance = "system" | ThemeName;

/** How Settings names each theme. */
export const THEME_LABELS: Record<ThemeName, string> = { light: "Light", dark: "Dark" };

export function isAppearance(v: unknown): v is Appearance {
  return v === "system" || THEMES.includes(v as ThemeName);
}

/** The theme a window shows: the one chosen, or with "system" (or anything unknown) the system's. */
export function themeFor(appearance: unknown, systemDark: boolean): ThemeName {
  return THEMES.includes(appearance as ThemeName) ? (appearance as ThemeName) : systemDark ? "dark" : "light";
}
