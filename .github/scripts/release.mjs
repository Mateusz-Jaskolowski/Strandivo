#!/usr/bin/env node
// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Release helpers for build.yml.
//
//   node .github/scripts/release.mjs check-version v0.2.0
//     Fails unless package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json all say
//     0.2.0, so the version a release announces is the one its app reports.
//     It also fails one CHANGELOG.md has no section for.
//   node .github/scripts/release.mjs latest-json <dir> <tag> <owner/repo>
//     Prints the updater's latest.json for the signed files in <dir>: each platform's file
//     and the signature the build wrote beside it, and the version's short notes.
//   node .github/scripts/release.mjs download-copies <dir> <tag>
//     Copies each installer in <dir> to the name without the version that
//     strandivo.com/download links to (DOWNLOADS).
//   node .github/scripts/release.mjs release-notes <tag>
//     Prints the version's notes from CHANGELOG.md, for the GitHub release.
//
// Run with --experimental-strip-types, as it reads the changelog with the app's own code.

import { copyFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { looksLikeAddress, notesFor } from "../../src/lib/changelog.ts";

/**
 * The updater's platform keys and how each one's update file is named. The updater looks
 * for `<os>-<arch>-<installer>` before `<os>-<arch>`, so a copy installed from the .deb
 * finds the .deb and every other Linux copy (the AppImage) the plain key.
 */
export const PLATFORMS = [
  { key: "darwin-aarch64", matches: f => f.endsWith("_aarch64.app.tar.gz") },
  { key: "darwin-x86_64", matches: f => f.endsWith("_x64.app.tar.gz") },
  { key: "windows-x86_64", matches: f => f.endsWith("-setup.exe") },
  { key: "linux-x86_64", matches: f => f.endsWith(".AppImage") },
  { key: "linux-x86_64-deb", matches: f => f.endsWith(".deb") }
];

/**
 * The installers strandivo.com/download links to. Each release also carries a copy of
 * each under a name without the version, so the page can link to
 * `releases/latest/download/<file>`, which always means the newest published release,
 * and needs no change when one comes out.
 */
export const DOWNLOADS = [
  { file: "Strandivo_aarch64.dmg", os: "mac", label: "Mac with Apple silicon" },
  { file: "Strandivo_x64.dmg", os: "mac", label: "Mac with Intel" },
  { file: "Strandivo_x64-setup.exe", os: "windows", label: "Windows" },
  { file: "Strandivo_amd64.deb", os: "linux", label: "Debian, Ubuntu and relatives" },
  { file: "Strandivo_amd64.AppImage", os: "linux", label: "Other Linux (AppImage)" }
];

/** The copies a release makes for the website, as [built file, copy] pairs. */
export function downloadCopies(names, tag) {
  const version = tag.replace(/^v/, "");
  const missing = [];
  const copies = DOWNLOADS.map(d => {
    const built = d.file.replace(/^Strandivo_/, `Strandivo_${version}_`);
    if (!names.includes(built)) missing.push(built);
    return [built, d.file];
  });
  if (missing.length) throw new Error(`No ${missing.join(", ")} to copy for the website.`);
  return copies;
}

/** The versions a release must agree on, read from the three files that state one. */
export function versions(root) {
  const read = p => readFileSync(join(root, p), "utf8");
  const cargo = read("src-tauri/Cargo.toml").match(/^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m);
  return {
    "package.json": JSON.parse(read("package.json")).version,
    "src-tauri/Cargo.toml": cargo ? cargo[1] : undefined,
    "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version
  };
}

/** Problems with releasing `tag` from these versions; empty when it can go ahead. */
export function versionProblems(tag, found) {
  const m = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
  if (!m) return [`"${tag}" isn't a version tag such as v0.2.0.`];
  return Object.entries(found)
    .filter(([, v]) => v !== m[1])
    .map(([file, v]) => `${file} says ${v ?? "no version"}, the tag ${m[1]}.`);
}

/** What is wrong with the changelog for releasing `tag`, or null. */
export function changelogProblem(tag, changelog) {
  const version = tag.replace(/^v/, "");
  const notes = notesFor(changelog, version);
  if (!notes) return `CHANGELOG.md has no "## ${version}" section.`;
  if (!notes.summary) return `CHANGELOG.md's ${version} section has no short notes (its first paragraph).`;
  // The app wouldn't show them, so What's new would be empty.
  if (looksLikeAddress(notes.summary)) return `CHANGELOG.md's ${version} short notes name an address or a file (such as example.com or pUC19.gb); put that in the details.`;
  return null;
}

/**
 * latest.json for the files in a release: `files` maps file names to their contents for
 * signatures (only `.sig` files are read). Every platform must be there, so a release
 * can't leave one platform's copies without updates. `notes` are the short notes the app
 * shows in "What's new" before updating.
 */
export function latestJson({ files, tag, repo, notes, date = new Date() }) {
  const names = Object.keys(files);
  const platforms = {};
  const missing = [];
  for (const p of PLATFORMS) {
    const file = names.find(n => p.matches(n));
    const sig = file && files[`${file}.sig`];
    if (!file || !sig) {
      missing.push(p.key + (file ? ` (${file} has no .sig)` : ""));
      continue;
    }
    platforms[p.key] = {
      signature: sig.trim(),
      url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(file)}`
    };
  }
  if (missing.length) throw new Error(`No signed update file for ${missing.join(", ")}.`);
  return {
    version: tag.replace(/^v/, ""),
    notes: notes || `What's new: https://github.com/${repo}/releases/tag/${tag}`,
    pub_date: date.toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms
  };
}

function main([command, ...args]) {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const changelog = () => readFileSync(join(root, "CHANGELOG.md"), "utf8");
  if (command === "check-version") {
    const problems = versionProblems(args[0] ?? "", versions(root));
    const notes = problems.length ? null : changelogProblem(args[0], changelog());
    if (notes) problems.push(notes);
    if (problems.length) {
      console.error(`Can't release ${args[0]}:\n  ${problems.join("\n  ")}\nRun npm run version <x.y.z>, commit, and tag that commit.`);
      process.exit(1);
    }
    console.log(`All three files say ${args[0].slice(1)}.`);
  } else if (command === "latest-json") {
    const [dir, tag, repo] = args;
    const files = Object.fromEntries(readdirSync(dir).map(n => [n, n.endsWith(".sig") ? readFileSync(join(dir, n), "utf8") : ""]));
    const notes = notesFor(changelog(), tag.replace(/^v/, ""))?.summary;
    console.log(JSON.stringify(latestJson({ files, tag, repo, notes }), null, 2));
  } else if (command === "download-copies") {
    const [dir, tag] = args;
    for (const [built, copy] of downloadCopies(readdirSync(dir), tag)) {
      copyFileSync(join(dir, built), join(dir, copy));
      console.log(`${built} → ${copy}`);
    }
  } else if (command === "release-notes") {
    const n = notesFor(changelog(), (args[0] ?? "").replace(/^v/, ""));
    if (!n) {
      console.error(`CHANGELOG.md has no section for ${args[0]}.`);
      process.exit(1);
    }
    console.log([n.summary, n.details].filter(Boolean).join("\n\n"));
  } else {
    console.error("Usage: release.mjs check-version <tag> | latest-json <dir> <tag> <owner/repo> | download-copies <dir> <tag> | release-notes <tag>");
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
