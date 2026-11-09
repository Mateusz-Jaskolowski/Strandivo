// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The browser version's Content Security Policy (public-web/_headers) against the
// desktop's (src-tauri/tauri.conf.json): an address added to one and not the other would
// work in one build and be blocked in the other, and the policy is what docs/privacy.md
// promises. They differ only where the builds do.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WEB_USAGE_ENDPOINT } from "./usage.ts";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

function webPolicy(): Record<string, string[]> {
  const line = read("public-web/_headers")
    .split("\n")
    .find(l => /^\s+Content-Security-Policy:/.test(l));
  assert.ok(line, "public-web/_headers sets a Content Security Policy");
  const policy = line.slice(line.indexOf(":") + 1);
  return Object.fromEntries(
    policy
      .split(";")
      .map(d => d.trim().split(/\s+/))
      .filter(d => d[0])
      .map(([name, ...values]) => [name, values])
  );
}

function desktopPolicy(): Record<string, string[]> {
  const csp = JSON.parse(read("src-tauri/tauri.conf.json")).app.security.csp as Record<string, string>;
  return Object.fromEntries(Object.entries(csp).map(([name, values]) => [name, values.split(/\s+/)]));
}

test("the browser talks to the desktop's addresses, without the shell's, and to Aptabase alone besides", () => {
  const web = webPolicy()["connect-src"];
  const desktop = desktopPolicy()["connect-src"].filter(a => a !== "ipc:" && a !== "http://ipc.localhost");
  // The desktop sends statistics through the shell, which no policy covers.
  assert.deepEqual(web, [...desktop, new URL(WEB_USAGE_ENDPOINT).origin]);
});

test("every other rule is the desktop's, and the browser's own only add to it", () => {
  const web = webPolicy();
  const desktop = desktopPolicy();
  for (const [name, values] of Object.entries(desktop)) {
    if (name === "connect-src") continue;
    // The worker compiles the core; nothing else may be compiled or evaluated.
    const expected = name === "script-src" ? [...values, "'wasm-unsafe-eval'"] : values;
    assert.deepEqual(web[name], expected, name);
  }
  // A header can say what a page in Tauri can't: no other site may frame it.
  assert.deepEqual(web["frame-ancestors"], ["'none'"]);
  assert.deepEqual(web["worker-src"], ["'self'"]);
  assert.deepEqual(Object.keys(web).sort(), [...Object.keys(desktop), "frame-ancestors", "worker-src"].sort());
  assert.ok(!Object.values(web).flat().includes("'unsafe-eval'"));
});
