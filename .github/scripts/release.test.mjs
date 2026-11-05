// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Release helpers: the version check and latest.json. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { latestJson, versionProblems, versions } from "./release.mjs";

const files = {
  "Strandivo_0.2.0_aarch64.app.tar.gz": "",
  "Strandivo_0.2.0_aarch64.app.tar.gz.sig": "sig-mac-arm\n",
  "Strandivo_0.2.0_x64.app.tar.gz": "",
  "Strandivo_0.2.0_x64.app.tar.gz.sig": "sig-mac-intel",
  "Strandivo_0.2.0_x64-setup.exe": "",
  "Strandivo_0.2.0_x64-setup.exe.sig": "sig-win",
  "Strandivo_0.2.0_amd64.AppImage": "",
  "Strandivo_0.2.0_amd64.AppImage.sig": "sig-linux",
  "Strandivo_0.2.0_aarch64.dmg": "",
  "Strandivo_0.2.0_amd64.deb": ""
};

test("latest.json names each platform's signed file and its signature", () => {
  const j = latestJson({ files, tag: "v0.2.0", repo: "owner/Strandivo", date: new Date("2026-11-06T10:00:00.123Z") });
  assert.equal(j.version, "0.2.0");
  assert.equal(j.pub_date, "2026-11-06T10:00:00Z");
  assert.deepEqual(Object.keys(j.platforms), ["darwin-aarch64", "darwin-x86_64", "windows-x86_64", "linux-x86_64"]);
  assert.deepEqual(j.platforms["darwin-aarch64"], {
    signature: "sig-mac-arm",
    url: "https://github.com/owner/Strandivo/releases/download/v0.2.0/Strandivo_0.2.0_aarch64.app.tar.gz"
  });
  assert.equal(j.platforms["windows-x86_64"].url.endsWith("/Strandivo_0.2.0_x64-setup.exe"), true);
  assert.equal(j.platforms["linux-x86_64"].signature, "sig-linux");
  assert.match(j.notes, /releases\/tag\/v0\.2\.0$/);
});

test("latest.json refuses a release missing a platform or a signature", () => {
  const noWindows = Object.fromEntries(Object.entries(files).filter(([n]) => !n.includes("setup.exe")));
  assert.throws(() => latestJson({ files: noWindows, tag: "v0.2.0", repo: "o/r" }), /windows-x86_64/);
  const unsigned = { ...files };
  delete unsigned["Strandivo_0.2.0_amd64.AppImage.sig"];
  assert.throws(() => latestJson({ files: unsigned, tag: "v0.2.0", repo: "o/r" }), /linux-x86_64 \(Strandivo_0\.2\.0_amd64\.AppImage has no \.sig\)/);
});

test("a release tag must match the version in every file", () => {
  const same = { "package.json": "0.2.0", "src-tauri/Cargo.toml": "0.2.0", "src-tauri/tauri.conf.json": "0.2.0" };
  assert.deepEqual(versionProblems("v0.2.0", same), []);
  assert.deepEqual(versionProblems("v0.2.1", same).length, 3);
  assert.deepEqual(versionProblems("v0.2.0", { ...same, "src-tauri/Cargo.toml": "0.1.0" }), ["src-tauri/Cargo.toml says 0.1.0, the tag 0.2.0."]);
  assert.match(versionProblems("0.2.0", same)[0], /isn't a version tag/);
  assert.deepEqual(versionProblems("v0.2.0-rc.1", { "package.json": "0.2.0-rc.1" }), []);
});

test("the repository's three files agree on one version today", () => {
  const found = versions(fileURLToPath(new URL("../..", import.meta.url)));
  const values = new Set(Object.values(found));
  assert.equal(values.size, 1, JSON.stringify(found));
  assert.match([...values][0], /^\d+\.\d+\.\d+/);
});
