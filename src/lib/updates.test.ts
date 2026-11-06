// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECK_EVERY_MS, dueForCheck, parseMemory, progressText, shouldOffer, wasUpdated } from "./updates.ts";

const now = Date.UTC(2026, 10, 6, 12);

test("an automatic check runs at most once a day, and never when turned off", () => {
  assert.equal(dueForCheck({}, now, true), true);
  assert.equal(dueForCheck({}, now, false), false);
  assert.equal(dueForCheck({ lastCheck: now - 60_000 }, now, true), false);
  assert.equal(dueForCheck({ lastCheck: now - CHECK_EVERY_MS }, now, true), true);
  // A clock set back would otherwise wait until it caught up.
  assert.equal(dueForCheck({ lastCheck: now + CHECK_EVERY_MS * 30 }, now, true), true);
});

test("a skipped version is offered again only when the user asks", () => {
  assert.equal(shouldOffer("0.3.0", { skipped: "0.3.0" }, false), false);
  assert.equal(shouldOffer("0.3.0", { skipped: "0.3.0" }, true), true);
  assert.equal(shouldOffer("0.3.1", { skipped: "0.3.0" }, false), true);
});

test("progress says a share when the size is known, and megabytes when it isn't", () => {
  assert.equal(progressText(0, 2e7), "Downloading… 0%");
  assert.equal(progressText(9e6, 2e7), "Downloading… 45%");
  assert.equal(progressText(3e7, 2e7), "Downloading… 100%");
  assert.equal(progressText(12_345_678, null), "Downloading… 12.3 MB");
});

test("remembered state survives junk", () => {
  assert.deepEqual(parseMemory(null), {});
  assert.deepEqual(parseMemory("not json"), {});
  assert.deepEqual(parseMemory('{"lastCheck":"yesterday","skipped":3}'), {});
  assert.deepEqual(parseMemory('{"lastCheck":5,"skipped":"0.3.0"}'), { lastCheck: 5, skipped: "0.3.0" });
});

test("an update is announced once, and a first install isn't", () => {
  assert.equal(wasUpdated({}, "0.2.0"), false);
  assert.equal(wasUpdated({ shownVersion: "0.2.0" }, "0.2.0"), false);
  assert.equal(wasUpdated({ shownVersion: "0.2.0" }, "0.3.0"), true);
  assert.deepEqual(parseMemory('{"shownVersion":"0.2.0"}'), { shownVersion: "0.2.0" });
});
