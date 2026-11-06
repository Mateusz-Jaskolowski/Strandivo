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
