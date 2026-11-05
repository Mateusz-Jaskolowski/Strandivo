#!/usr/bin/env node
// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Sets the app's version everywhere a release checks it:
//
//   npm run version 0.2.0
//
// package.json, src-tauri/Cargo.toml (and its entry in src-tauri/Cargo.lock) and
// src-tauri/tauri.conf.json. Commit the result, then tag that commit v0.2.0.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2] ?? "";
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: npm run version <x.y.z>, such as npm run version 0.2.0");
  process.exit(2);
}
const root = process.env.STRANDIVO_ROOT ?? fileURLToPath(new URL("..", import.meta.url));

function edit(path, change) {
  const file = join(root, path);
  const before = readFileSync(file, "utf8");
  const after = change(before);
  if (after === before) throw new Error(`Found no version to set in ${path}.`);
  writeFileSync(file, after);
  console.log(`${path}: ${version}`);
}

// Only the "version" field at the top of each JSON file, keeping their own formatting.
const jsonVersion = s => s.replace(/^(\s{2}"version":\s*")[^"]*(")/m, `$1${version}$2`);
edit("package.json", jsonVersion);
edit("src-tauri/tauri.conf.json", jsonVersion);
edit("src-tauri/Cargo.toml", s => s.replace(/^(\[package\][^[]*?^version\s*=\s*")[^"]*(")/m, `$1${version}$2`));
edit("src-tauri/Cargo.lock", s => s.replace(/^(name = "strandivo"\nversion = ")[^"]*(")/m, `$1${version}$2`));
