#!/usr/bin/env node
// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Sets the app's version everywhere a release checks it:
//
//   npm run version 0.2.0
//
// package.json, src-tauri/Cargo.toml (and its entry in src-tauri/Cargo.lock) and
// src-tauri/tauri.conf.json. `npm run release` (tools/release.mjs) calls it, so it is
// rarely run by hand. Run with --experimental-strip-types, as it reads the changelog with
// the app's own code.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseNotesFor } from "../src/lib/changelog.ts";

export const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Where each file states the version: the part before it and the part after. */
const PLACES = [
  ["package.json", /^(\s{2}"version":\s*")[^"]*(")/m],
  ["src-tauri/tauri.conf.json", /^(\s{2}"version":\s*")[^"]*(")/m],
  ["src-tauri/Cargo.toml", /^(\[package\][^[]*?^version\s*=\s*")[^"]*(")/m],
  ["src-tauri/Cargo.lock", /^(name = "strandivo"\nversion = ")[^"]*(")/m]
];

/** Writes `version` into every file that states it; returns the files it names. */
export function setVersion(root, version) {
  if (!VERSION.test(version)) throw new Error(`"${version}" isn't a version such as 0.2.0.`);
  // The notes come first: a release without them would offer an update with nothing to say.
  // A release candidate (0.4.0-rc.1) goes out with Unreleased's notes instead.
  const changelog = readFileSync(join(root, "CHANGELOG.md"), "utf8");
  if (!releaseNotesFor(changelog, version)?.summary) {
    throw new Error(`Write ${version}'s notes in CHANGELOG.md first: a "## ${version}" section whose first paragraph is the short version the app shows${version.includes("-") ? ", or for a release candidate, Unreleased's" : ""}.`);
  }
  for (const [path, place] of PLACES) {
    const file = join(root, path);
    const before = readFileSync(file, "utf8");
    if (!place.test(before)) throw new Error(`Found no version to set in ${path}.`);
    writeFileSync(file, before.replace(place, `$1${version}$2`));
  }
  return PLACES.map(([path]) => path);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2] ?? "";
  if (!VERSION.test(version)) {
    console.error("Usage: npm run version <x.y.z>, such as npm run version 0.2.0");
    process.exit(2);
  }
  const root = process.env.STRANDIVO_ROOT ?? fileURLToPath(new URL("..", import.meta.url));
  try {
    for (const path of setVersion(root, version)) console.log(`${path}: ${version}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
