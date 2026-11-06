// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DOCUMENT_KEYS, MENU_KEYS, menuShortcut } from "./shortcuts.ts";

const shell = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");

/** Every `CmdOrCtrl` accelerator the menu gives an item, as `id → key`. */
function accelerators(): Map<string, string> {
  const found = new Map<string, string>();
  const re = /with_id\("([^"]+)",[^)]*\)\s*\.accelerator\(([^;]*?)\)\s*\.build/g;
  for (const m of shell.matchAll(re)) {
    // Redo's differs by system ("CmdOrCtrl+Shift+Z" or "CmdOrCtrl+Y"): take the one outside macOS.
    const keys = [...m[2].matchAll(/"(CmdOrCtrl\+[^"]+)"/g)].map(k => k[1]);
    if (keys.length) found.set(m[1], keys[keys.length - 1]);
  }
  return found;
}

const press = (accel: string) => {
  const parts = accel.split("+").slice(1);
  const key = parts[parts.length - 1];
  return { key: parts.includes("Shift") ? key.toUpperCase() : key.toLowerCase(), ctrlKey: true, metaKey: false, altKey: false, shiftKey: parts.includes("Shift") };
};

test("every key in the menu is handled by the page outside macOS", () => {
  const menu = accelerators();
  assert.ok(menu.size > 10, "the menu's accelerators were found in lib.rs");
  for (const [id, accel] of menu) {
    if (id === "quit") continue; // macOS only: Windows has Alt+F4.
    if (DOCUMENT_KEYS.includes(id)) continue;
    assert.equal(menuShortcut(press(accel)), id, `${id} (${accel})`);
  }
});

test("the page and the shell agree on which items it may run", () => {
  const list = shell.match(/const PAGE_SHORTCUTS: &\[&str\] = &\[([^\]]*)\]/);
  assert.ok(list);
  const ids = [...list[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids.sort(), MENU_KEYS.map(k => k.id).sort());
});

test("only Ctrl counts, and AltGr never does", () => {
  const base = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  assert.equal(menuShortcut({ ...base, key: "s" }), "save");
  assert.equal(menuShortcut({ ...base, key: "S", shiftKey: true }), "save-as");
  assert.equal(menuShortcut({ ...base, key: "S" }), "save"); // Caps Lock
  assert.equal(menuShortcut({ ...base, key: "s", altKey: true }), null);
  assert.equal(menuShortcut({ ...base, key: "s", ctrlKey: false }), null);
  assert.equal(menuShortcut({ ...base, key: "s", metaKey: true }), null);
  assert.equal(menuShortcut({ ...base, key: "z" }), null);
});
