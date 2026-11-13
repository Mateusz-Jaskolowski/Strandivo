// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { browserShortcut, DOCUMENT_KEYS, documentShortcut, MENU_KEYS, menuShortcut, shortcutFor, shortcutHint, shortcutText } from "./shortcuts.ts";

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
    // An open file claims these itself, so it can skip the menu's copy of the press.
    if (DOCUMENT_KEYS.includes(id)) assert.equal(documentShortcut(press(accel), { mac: false, browser: false }), id, `${id} (${accel})`);
    else assert.equal(menuShortcut(press(accel)), id, `${id} (${accel})`);
  }
});

test("an open file's own keys, on a Mac and elsewhere", () => {
  const app = { mac: false, browser: false };
  const macApp = { mac: true, browser: false };
  const ctrl = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  const cmd = { ctrlKey: false, metaKey: true, altKey: false, shiftKey: false };
  assert.equal(documentShortcut({ ...ctrl, key: "I", shiftKey: true }, app), "invert-selection");
  assert.equal(documentShortcut({ ...cmd, key: "i", shiftKey: true }, macApp), "invert-selection");
  assert.equal(documentShortcut({ ...ctrl, key: "i" }, app), null);
  // A browser keeps it for developer tools, or to email the page.
  assert.equal(documentShortcut({ ...ctrl, key: "I", shiftKey: true }, { mac: false, browser: true }), null);
  assert.equal(documentShortcut({ ...cmd, key: "i", shiftKey: true }, { mac: true, browser: true }), null);
  // Redo answers to both systems' keys; Ctrl on a Mac is not ⌘, and Ctrl+Alt is AltGr.
  assert.equal(documentShortcut({ ...cmd, key: "z", shiftKey: true }, macApp), "redo");
  assert.equal(documentShortcut({ ...cmd, key: "y" }, macApp), "redo");
  assert.equal(documentShortcut({ ...ctrl, key: "a" }, macApp), null);
  assert.equal(documentShortcut({ ...ctrl, key: "a", altKey: true }, app), null);
  assert.equal(documentShortcut({ ...cmd, key: "3" }, macApp), "show-primers");
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

test("the keys shown in the app are the menu's own", () => {
  const menu = accelerators();
  for (const [id, accel] of menu) {
    if (id === "quit") continue;
    const s = shortcutFor(id, { mac: false, browser: false });
    assert.ok(s, `${id} has a key in the app`);
    assert.equal(`CmdOrCtrl+${s.shift ? "Shift+" : ""}${s.key}`, accel, id);
  }
  // Redo is ⇧⌘Z on a Mac.
  assert.match(shell, /"CmdOrCtrl\+Shift\+Z"/);
  assert.deepEqual(shortcutFor("redo", { mac: true, browser: false }), { key: "Z", shift: true });
});

test("a browser shows no key it keeps for itself", () => {
  const where = { mac: false, browser: true };
  for (const id of [...accelerators().keys(), "redo"]) {
    const s = shortcutFor(id, where);
    if (!s) continue;
    assert.ok(!/^[NWTQ1-9]$/.test(s.key) || s.alt, `${id}: ${s.key} is the browser's`);
    assert.ok(!(s.key === "R" && s.shift), `${id}: Shift+R reloads`);
    assert.ok(!(s.key === "W" && s.alt), `${id}: Safari's ⌥⌘W closes the other tabs`);
    assert.ok(!(s.key === "I" && s.shift), `${id}: Ctrl+Shift+I opens developer tools, ⇧⌘I emails the page in Chrome`);
  }
  assert.equal(shortcutHint("invert-selection", { mac: true, browser: true }), "");
  assert.equal(shortcutHint("invert-selection", { mac: false, browser: true }), "");
  assert.equal(shortcutHint("invert-selection", { mac: true, browser: false }), " (⇧⌘I)");
  assert.equal(shortcutHint("invert-selection", { mac: false, browser: false }), " (Ctrl+Shift+I)");
  assert.equal(shortcutHint("new", { mac: true, browser: true }), " (⌥⌘N)");
  assert.equal(shortcutHint("close", { mac: true, browser: true }), "");
  assert.equal(shortcutHint("show-map", { mac: false, browser: true }), "");
  assert.equal(shortcutHint("show-map", { mac: false, browser: false }), " (Ctrl+1)");
});

test("keys read the same as the app's tooltips always have", () => {
  assert.equal(shortcutText({ key: "H", shift: true }, true), "⇧⌘H");
  assert.equal(shortcutText({ key: "H", shift: true }, false), "Ctrl+Shift+H");
  assert.equal(shortcutText({ key: "N", alt: true }, false), "Ctrl+Alt+N");
});

test("a browser's own keys for New Sequence, Open… and Home", () => {
  const mac = { ctrlKey: false, metaKey: true, altKey: false, shiftKey: false };
  // ⌥ on a Mac types another character: the key's place is what counts.
  assert.equal(browserShortcut({ ...mac, altKey: true, key: "˜", code: "KeyN" }, true), "new");
  assert.equal(browserShortcut({ ...mac, key: "n", code: "KeyN" }, true), null);
  assert.equal(browserShortcut({ ...mac, key: "o", code: "KeyO" }, true), "open");
  assert.equal(browserShortcut({ ...mac, shiftKey: true, key: "H", code: "KeyH" }, true), "home");
  const pc = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false };
  assert.equal(browserShortcut({ ...pc, altKey: true, key: "n", code: "KeyN" }, false), "new");
  assert.equal(browserShortcut({ ...pc, key: "o", code: "KeyO" }, false), "open");
  assert.equal(browserShortcut({ ...pc, key: "o", code: "KeyO" }, true), null);
});
