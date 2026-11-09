// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { browserInfo } from "./browser.ts";

const UA = {
  chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  edgeWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.3595.53",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0",
  chromebook: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  chromeIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.46 Mobile/15E148 Safari/604.1",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36",
  operaWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/125.0.0.0"
};

test("the family, its major version and the system, never more", () => {
  assert.deepEqual(browserInfo(UA.chromeMac), { name: "Chrome", version: "142", system: "macOS" });
  assert.deepEqual(browserInfo(UA.safariMac), { name: "Safari", version: "26", system: "macOS" });
  assert.deepEqual(browserInfo(UA.firefoxLinux), { name: "Firefox", version: "145", system: "Linux" });
  assert.deepEqual(browserInfo(UA.chromebook), { name: "Chrome", version: "142", system: "ChromeOS" });
});

test("browsers that also say Chrome are told apart", () => {
  assert.deepEqual(browserInfo(UA.edgeWindows), { name: "Edge", version: "142", system: "Windows" });
  assert.deepEqual(browserInfo(UA.operaWindows), { name: "Opera", version: "125", system: "Windows" });
});

test("phones are named for their system, not the Mac or Linux in their strings", () => {
  assert.deepEqual(browserInfo(UA.chromeIphone), { name: "Chrome", version: "142", system: "iOS" });
  assert.deepEqual(browserInfo(UA.chromeAndroid), { name: "Chrome", version: "142", system: "Android" });
});

test("anything else is a browser with no version", () => {
  assert.deepEqual(browserInfo("curl/8.7.1"), { name: "Browser", version: "", system: "" });
});
