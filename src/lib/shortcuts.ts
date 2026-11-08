// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Keys of the native menu's items. On a Mac the menu hears every key first. On Windows it
// never hears a key pressed in the page, as WebView2 keeps it, so outside macOS the page
// passes these on to the shell (`menu_shortcut` in src-tauri/src/lib.rs), which runs the
// item as if it had been chosen and skips it if the menu heard the same press.

export interface MenuKey {
  /** The menu item's id in src-tauri/src/lib.rs. */
  id: string;
  /** `KeyboardEvent.key`, lower case. */
  key: string;
  shift: boolean;
}

export const MENU_KEYS: readonly MenuKey[] = [
  { id: "new", key: "n", shift: false },
  { id: "open", key: "o", shift: false },
  { id: "close", key: "w", shift: false },
  { id: "home", key: "h", shift: true },
  { id: "save", key: "s", shift: false },
  { id: "save-as", key: "s", shift: true },
  { id: "add-reads", key: "r", shift: true },
  { id: "library", key: "l", shift: true },
  { id: "settings", key: ",", shift: false },
];

/** Menu items whose keys an open file handles itself everywhere (`shortcutCommand` in
 *  src/doc/document.ts), as text fields keep their own undo and select-all. */
export const DOCUMENT_KEYS: readonly string[] = [
  "undo", "redo", "select-all", "find",
  "show-map", "show-sequence", "show-primers", "show-reads", "show-info",
];

type Keys = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** The menu item a key press outside macOS stands for, if any. Ctrl with Alt is AltGr on
 *  Windows, which types characters, so it never counts. */
export function menuShortcut(e: Keys): string | null {
  if (!e.ctrlKey || e.metaKey || e.altKey) return null;
  const key = e.key.toLowerCase();
  return MENU_KEYS.find(k => k.key === key && k.shift === e.shiftKey)?.id ?? null;
}

// ---------- keys as shown, in the app and in a browser ----------

/** A key with the platform's modifier (⌘ on a Mac, Ctrl elsewhere), maybe with Shift or Alt. */
export interface Shortcut {
  key: string;
  shift?: boolean;
  alt?: boolean;
}

/** The menu's keys in the app, as src-tauri/src/lib.rs gives them (a unit test compares). */
const APP_SHORTCUTS: Record<string, Shortcut> = {
  new: { key: "N" },
  open: { key: "O" },
  close: { key: "W" },
  home: { key: "H", shift: true },
  save: { key: "S" },
  "save-as": { key: "S", shift: true },
  "add-reads": { key: "R", shift: true },
  "show-map": { key: "1" },
  "show-sequence": { key: "2" },
  "show-primers": { key: "3" },
  "show-reads": { key: "4" },
  "show-info": { key: "5" },
  undo: { key: "Z" },
  "select-all": { key: "A" },
  find: { key: "F" },
  library: { key: "L", shift: true },
  settings: { key: "," }
};

/**
 * The keys that reach the page in a browser. Browsers keep ⌘N, ⌘W, ⌘T and ⌘1–⌘9 (Ctrl
 * elsewhere) for themselves, ⇧⌘R reloads, and Safari's ⌥⌘W closes the other tabs, so New
 * Sequence moves to ⌥⌘N and the rest have only their buttons there. ⌘, and ⇧⌘L open
 * browser windows in some browsers, and Settings and the libraries have buttons in the bar.
 */
const WEB_SHORTCUTS: Record<string, Shortcut> = {
  new: { key: "N", alt: true },
  open: APP_SHORTCUTS.open,
  home: APP_SHORTCUTS.home,
  save: APP_SHORTCUTS.save,
  "save-as": APP_SHORTCUTS["save-as"],
  undo: APP_SHORTCUTS.undo,
  "select-all": APP_SHORTCUTS["select-all"],
  find: APP_SHORTCUTS.find
};

export interface Where {
  mac: boolean;
  browser: boolean;
}

/** A menu item's key where the user is, or null where it has none that works. */
export function shortcutFor(id: string, where: Where): Shortcut | null {
  // Redo follows each system's convention.
  if (id === "redo") return where.mac ? { key: "Z", shift: true } : { key: "Y" };
  return (where.browser ? WEB_SHORTCUTS : APP_SHORTCUTS)[id] ?? null;
}

/** "⌥⇧⌘N" on a Mac (Apple's order), "Ctrl+Alt+Shift+N" elsewhere. */
export function shortcutText(s: Shortcut, mac: boolean): string {
  if (mac) return `${s.alt ? "⌥" : ""}${s.shift ? "⇧" : ""}⌘${s.key}`;
  return `Ctrl+${s.alt ? "Alt+" : ""}${s.shift ? "Shift+" : ""}${s.key}`;
}

/** " (⌘S)" for a tooltip, or "" where the item has no key that works. */
export function shortcutHint(id: string, where: Where): string {
  const s = shortcutFor(id, where);
  return s ? ` (${shortcutText(s, where.mac)})` : "";
}

/**
 * The window's own menu items a key press stands for in a browser (an open file handles
 * Save, Undo and the like itself). Letters are matched by their key's place, as ⌥ on a Mac
 * changes the character.
 */
export function browserShortcut(e: Keys & { code?: string }, mac: boolean): "new" | "open" | "home" | null {
  if (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return null;
  for (const id of ["new", "open", "home"] as const) {
    const s = WEB_SHORTCUTS[id];
    const key = e.code ? e.code === `Key${s.key}` : e.key.toUpperCase() === s.key;
    if (key && !!s.shift === e.shiftKey && !!s.alt === e.altKey) return id;
  }
  return null;
}
