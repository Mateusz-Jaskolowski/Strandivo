// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { WELCOME_PARTS, WELCOME_VERSION, needsWelcome, welcomeParts } from "./welcome.ts";

test("the window opens until the current version has been seen", () => {
  assert.equal(needsWelcome(0), true);
  assert.equal(needsWelcome(WELCOME_VERSION - 1), true);
  assert.equal(needsWelcome(WELCOME_VERSION), false);
});

test("the first time and from the menu it shows everything, in order", () => {
  const all = WELCOME_PARTS.map(p => p.part);
  assert.deepEqual(welcomeParts(0, false), all);
  assert.deepEqual(welcomeParts(WELCOME_VERSION, true), all);
});

test("someone who saw an older window is asked only what is new", () => {
  // Nothing is newer than the current version.
  assert.deepEqual(welcomeParts(WELCOME_VERSION, false), []);
  // Every part has a version, and the newest decides WELCOME_VERSION.
  assert.ok(WELCOME_PARTS.every(p => p.since >= 1 && p.since <= WELCOME_VERSION));
  const newest = WELCOME_PARTS.filter(p => p.since === WELCOME_VERSION).map(p => p.part);
  if (WELCOME_VERSION > 1) assert.deepEqual(welcomeParts(WELCOME_VERSION - 1, false), newest);
});

test("people who installed before usage statistics are asked about them alone", () => {
  assert.deepEqual(welcomeParts(1, false), ["usage"]);
  assert.equal(needsWelcome(1), true);
});
