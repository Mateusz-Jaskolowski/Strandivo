// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_MENU, DESKTOP_ONLY_ITEMS, type AppMenuItem } from "./appMenu.ts";
import { OPEN_EXTENSIONS } from "./files.ts";

const shell = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");

/** The native menu's items with a plain label, as `id → label`. */
const native = new Map([...shell.matchAll(/with_id\("([^"]+)",\s*"([^"]*)"\)/g)].map(m => [m[1], m[2]]));
const items = APP_MENU.flatMap(g => g.items.filter((i): i is AppMenuItem => i !== "separator"));

test("the browser's menu has the native menu's items, with their labels", () => {
  assert.ok(native.size > 30, "the native menu's items were found in lib.rs");
  for (const item of items) assert.equal(native.get(item.id), item.label, item.id);
});

test("every native item is in the browser's menu, or has no place there", () => {
  const ids = new Set(items.map(i => i.id));
  for (const id of native.keys()) assert.ok(ids.has(id) || DESKTOP_ONLY_ITEMS.includes(id), `${id} is missing from APP_MENU`);
  assert.equal(ids.size, items.length, "no item twice");
});

test("the browser's Open… offers the same files as the app's", () => {
  const list = shell.match(/const OPEN_EXTENSIONS: &\[&str\] = &\[([^\]]*)\]/);
  assert.ok(list);
  const app = [...list[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual([...OPEN_EXTENSIONS].sort(), app.sort());
});
