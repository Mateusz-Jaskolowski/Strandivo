// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, pullRequestBody, wrap } from "./release.mjs";
import { setVersion } from "./set-version.mjs";

test("versions are compared by number, a pre-release before its release", () => {
  assert.equal(compareVersions("0.3.0", "0.2.1"), 1);
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("0.2.1", "0.2.1"), 0);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.1"), 1);
  assert.equal(compareVersions("0.2.1", "1.0.0-beta.1"), -1);
});

test("the pull request quotes the short notes and says what comes next", () => {
  const body = pullRequestBody("0.3.0", { summary: "Faster maps.", details: "- Labels." });
  assert.match(body, /^> Faster maps\.$/m);
  assert.match(body, /^- Labels\.$/m);
  assert.match(body, /npm run release:tag/);
});

test("the version is set in all four files, and not without notes", () => {
  const repo = fileURLToPath(new URL("..", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "strandivo-version-"));
  for (const f of ["package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]) {
    cpSync(join(repo, f), join(dir, f));
  }
  writeFileSync(join(dir, "CHANGELOG.md"), "## 9.8.7\n\nNotes.\n");
  assert.throws(() => setVersion(dir, "9.8.8"), /Write 9\.8\.8's notes/);
  assert.equal(setVersion(dir, "9.8.7").length, 4);
  // Setting it again changes nothing and doesn't fail.
  setVersion(dir, "9.8.7");
  assert.equal(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version, "9.8.7");
  assert.equal(JSON.parse(readFileSync(join(dir, "src-tauri/tauri.conf.json"), "utf8")).version, "9.8.7");
  assert.match(readFileSync(join(dir, "src-tauri/Cargo.toml"), "utf8"), /^\[package\][^[]*?^version = "9\.8\.7"/m);
  assert.match(readFileSync(join(dir, "src-tauri/Cargo.lock"), "utf8"), /name = "strandivo"\nversion = "9\.8\.7"/);
});

test("a commit's body is wrapped at spaces", () => {
  assert.equal(wrap("one two three", 7), "one two\nthree");
  assert.ok(wrap("word ".repeat(40)).split("\n").every(l => l.length <= 72));
});
