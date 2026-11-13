// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareVersions, jobProgress, publishArgs, pullRequestBody, wrap } from "./release.mjs";
import { setVersion } from "./set-version.mjs";

test("versions are compared by number, a pre-release before its release", () => {
  assert.equal(compareVersions("0.3.0", "0.2.1"), 1);
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("0.2.1", "0.2.1"), 0);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.1"), 1);
  assert.equal(compareVersions("0.2.1", "1.0.0-beta.1"), -1);
  // Release candidates: in order among themselves, and before their release.
  assert.equal(compareVersions("0.4.0-rc.1", "0.3.1"), 1);
  assert.equal(compareVersions("0.4.0-rc.2", "0.4.0-rc.10"), -1);
  assert.equal(compareVersions("0.4.0-rc.1", "0.4.0"), -1);
  assert.equal(compareVersions("0.4.0-rc", "0.4.0-rc.1"), -1);
  assert.equal(compareVersions("0.4.0-1", "0.4.0-rc"), -1);
});

test("the pull request quotes the short notes and says what comes next", () => {
  const body = pullRequestBody("0.3.0", { summary: "Faster maps.", details: "- Labels." });
  assert.match(body, /^> Faster maps\.$/m);
  assert.match(body, /^- Labels\.$/m);
  assert.match(body, /npm run release:tag/);
  assert.match(pullRequestBody("0.4.0-rc.1", { summary: "Faster maps.", details: "" }), /pre-release/);
});

test("a release candidate's version is set from Unreleased's notes", () => {
  const repo = fileURLToPath(new URL("..", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "strandivo-rc-"));
  for (const f of ["package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]) {
    cpSync(join(repo, f), join(dir, f));
  }
  writeFileSync(join(dir, "CHANGELOG.md"), "## Unreleased\n\n## 9.8.7\n\nOld.\n");
  assert.throws(() => setVersion(dir, "9.9.0-rc.1"), /Unreleased's/);
  writeFileSync(join(dir, "CHANGELOG.md"), "## Unreleased\n\nNew things.\n\n## 9.8.7\n\nOld.\n");
  setVersion(dir, "9.9.0-rc.1");
  assert.equal(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version, "9.9.0-rc.1");
  // The release itself still needs its own section.
  assert.throws(() => setVersion(dir, "9.9.0"), /"## 9\.9\.0" section/);
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

test("publishing makes a release latest, and a candidate stays a pre-release", () => {
  assert.deepEqual(publishArgs("0.5.0"), ["release", "edit", "v0.5.0", "--draft=false", "--latest"]);
  // GitHub never makes a pre-release latest, so no installed copy is offered a candidate.
  assert.deepEqual(publishArgs("0.5.0-rc.1"), ["release", "edit", "v0.5.0-rc.1", "--draft=false"]);
});

test("a build's progress counts its finished jobs", () => {
  const jobs = [{ status: "completed" }, { status: "completed" }, { status: "in_progress" }, { status: "waiting" }];
  assert.equal(jobProgress(jobs), "2 of 4 jobs done");
});
