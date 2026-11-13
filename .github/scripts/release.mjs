#!/usr/bin/env node
// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Release helpers for build.yml.
//
//   node .github/scripts/release.mjs check-version v0.2.0
//     Fails unless package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json all say
//     0.2.0, so the version a release announces is the one its app reports.
//     It also fails one CHANGELOG.md has no section for.
//   node .github/scripts/release.mjs name-files <dir> <tag>
//     Gives each file the builds left in <dir>, and its signature, the name it is published
//     under (RELEASE_FILES), and fails if one is missing or unknown.
//   node .github/scripts/release.mjs latest-json <dir> <tag> <owner/repo>
//     Prints the updater's latest.json for the signed files in <dir>: each platform's file
//     and the signature the build wrote beside it, and the version's short notes.
//   node .github/scripts/release.mjs release-notes <tag>
//     Prints the version's notes from CHANGELOG.md, for the GitHub release. A release
//     candidate (v0.4.0-rc.1) has Unreleased's notes, as it has no section of its own.
//   node .github/scripts/release.mjs verify <dir> <tag> <owner/repo>
//     Fails unless <dir> holds every file a release carries and latest.json sends each
//     platform to this release's file, signed with the key every installed copy trusts
//     (UPDATE_KEY), as copies will check before installing it.
//
// Run with --experimental-strip-types, as it reads the changelog with the app's own code.

import { readFileSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseNotesFor, summaryProblem } from "../../src/lib/changelog.ts";
import { parsePublicKey, signatureProblem, tauriPublicKey, tauriSignature } from "./minisign.mjs";

/**
 * The public half of the update signing key (ID DE18055614E24CDD), which every installed
 * copy holds and checks updates against. It can't change without stranding them all, so
 * it is written here as well as in tauri.conf.json: a test fails when the two differ, and
 * a release's files must verify against this one, whatever the app's file says.
 */
export const UPDATE_KEY = "RWTdTOIUVgUY3td30clrHm+OyTRwLfcZY+kyiH534tR11xMDRTmfTJxF";

/**
 * The files a release carries: `built` ends the name the build gives a file, after
 * `Strandivo_<version>_` (build-app adds version and processor to the Mac's update files,
 * which are otherwise both Strandivo.app.tar.gz), and `name` is the one it is published
 * under. Names say which system a file is for in words people use, not the build's
 * aarch64, x64 and amd64, and carry no version, so the website can link to
 * `releases/latest/download/<name>`, which always means the newest published release, and
 * needs no change when one comes out; latest.json points at the same file under its tag.
 * The Mac's update files say so, as people should take the .dmg.
 */
export const RELEASE_FILES = [
  { built: "aarch64.dmg", name: "Strandivo_Mac_Apple-silicon.dmg" },
  { built: "x64.dmg", name: "Strandivo_Mac_Intel.dmg" },
  { built: "x64-setup.exe", name: "Strandivo_Windows_setup.exe" },
  { built: "amd64.deb", name: "Strandivo_Linux.deb" },
  { built: "amd64.AppImage", name: "Strandivo_Linux.AppImage" },
  { built: "aarch64.app.tar.gz", name: "Strandivo_Mac_Apple-silicon_update.app.tar.gz" },
  { built: "x64.app.tar.gz", name: "Strandivo_Mac_Intel_update.app.tar.gz" }
];

/**
 * The updater's platform keys and each one's update file. The updater looks for
 * `<os>-<arch>-<installer>` before `<os>-<arch>`, so a copy installed from the .deb finds
 * the .deb and every other Linux copy (the AppImage) the plain key. The updater tells what
 * it downloaded from its contents, not its name.
 */
export const PLATFORMS = [
  { key: "darwin-aarch64", file: "Strandivo_Mac_Apple-silicon_update.app.tar.gz" },
  { key: "darwin-x86_64", file: "Strandivo_Mac_Intel_update.app.tar.gz" },
  { key: "windows-x86_64", file: "Strandivo_Windows_setup.exe" },
  { key: "linux-x86_64", file: "Strandivo_Linux.AppImage" },
  { key: "linux-x86_64-deb", file: "Strandivo_Linux.deb" }
];

/** The installers strandivo.com/download links to, at `releases/latest/download/<file>`. */
export const DOWNLOADS = [
  { file: "Strandivo_Mac_Apple-silicon.dmg", os: "mac", label: "Mac with Apple silicon" },
  { file: "Strandivo_Mac_Intel.dmg", os: "mac", label: "Mac with Intel" },
  { file: "Strandivo_Windows_setup.exe", os: "windows", label: "Windows" },
  { file: "Strandivo_Linux.deb", os: "linux", label: "Debian, Ubuntu and relatives" },
  { file: "Strandivo_Linux.AppImage", os: "linux", label: "Other Linux (AppImage)" }
];

/**
 * How to rename the files the builds made (`names`) for release `tag`, as [built, published]
 * pairs, signatures included. Every file must be there, and nothing else may be, so a
 * release never carries a file under the build's own name.
 */
export function releaseNames(names, tag) {
  const version = tag.replace(/^v/, "");
  const renames = [];
  const missing = [];
  const known = new Set();
  for (const f of RELEASE_FILES) {
    const built = `Strandivo_${version}_${f.built}`;
    if (!names.includes(built)) {
      missing.push(built);
      continue;
    }
    renames.push([built, f.name]);
    known.add(built);
    if (names.includes(`${built}.sig`)) {
      renames.push([`${built}.sig`, `${f.name}.sig`]);
      known.add(`${built}.sig`);
    }
  }
  if (missing.length) throw new Error(`The builds made no ${missing.join(", ")}.`);
  const unknown = names.filter(n => !known.has(n));
  if (unknown.length) throw new Error(`No release name for ${unknown.join(", ")}.`);
  return renames;
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
  const notes = releaseNotesFor(changelog, version);
  if (!notes) return `CHANGELOG.md has no "## ${version}" section${version.includes("-") ? " or Unreleased notes" : ""}.`;
  // Notes the app wouldn't show leave What's new empty.
  const problem = summaryProblem(notes.summary);
  return problem ? `CHANGELOG.md's ${version} section ${problem}.` : null;
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
    const file = names.includes(p.file) ? p.file : undefined;
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

/**
 * What is wrong with a release's files as installed copies will meet them, or nothing:
 * latest.json must be this version's and send every platform to this release's file,
 * whose signature verifies against `publicKey` (parsed), and every file a release
 * carries must be there. `read(name)` gives a file's bytes; `names` are the files there.
 */
export function releaseFileProblems({ latest, names, read, tag, repo, publicKey }) {
  const version = tag.replace(/^v/, "");
  const problems = [];
  if (latest.version !== version) problems.push(`latest.json is for ${latest.version}, not ${version}.`);
  const missing = [...RELEASE_FILES.map(f => f.name), "latest.json"].filter(n => !names.includes(n));
  if (missing.length) problems.push(`The release has no ${missing.join(", ")}.`);
  for (const p of PLATFORMS) {
    const entry = latest.platforms?.[p.key];
    if (!entry) {
      problems.push(`latest.json has nothing for ${p.key}.`);
      continue;
    }
    const url = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(p.file)}`;
    if (entry.url !== url) problems.push(`latest.json sends ${p.key} to ${entry.url}, not ${url}.`);
    if (!names.includes(p.file)) continue;
    let problem;
    try {
      problem = signatureProblem(publicKey, tauriSignature(entry.signature ?? ""), read(p.file));
    } catch (e) {
      problem = e.message;
    }
    if (problem) problems.push(`${p.file} (${p.key}): ${problem}.`);
  }
  return problems;
}

/** The key the app is built with (tauri.conf.json), when it is UPDATE_KEY; else it throws. */
export function updateKey(root) {
  const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
  const app = tauriPublicKey(conf.plugins.updater.pubkey);
  const pinned = parsePublicKey(UPDATE_KEY);
  if (app.line !== pinned.line) {
    throw new Error(`tauri.conf.json's update key is ${app.id}, not ${pinned.id}, which every installed copy checks updates against.`);
  }
  return pinned;
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
    const notes = releaseNotesFor(changelog(), tag.replace(/^v/, ""))?.summary;
    console.log(JSON.stringify(latestJson({ files, tag, repo, notes }), null, 2));
  } else if (command === "name-files") {
    const [dir, tag] = args;
    for (const [built, name] of releaseNames(readdirSync(dir), tag)) {
      renameSync(join(dir, built), join(dir, name));
      console.log(`${built} → ${name}`);
    }
  } else if (command === "release-notes") {
    const n = releaseNotesFor(changelog(), (args[0] ?? "").replace(/^v/, ""));
    if (!n) {
      console.error(`CHANGELOG.md has no section for ${args[0]}.`);
      process.exit(1);
    }
    console.log([n.summary, n.details].filter(Boolean).join("\n\n"));
  } else if (command === "verify") {
    const [dir, tag, repo] = args;
    const publicKey = updateKey(root);
    const names = readdirSync(dir);
    const latest = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
    const problems = releaseFileProblems({ latest, names, read: n => readFileSync(join(dir, n)), tag, repo, publicKey });
    if (problems.length) {
      console.error(`${tag} isn't ready:\n  ${problems.join("\n  ")}`);
      process.exit(1);
    }
    console.log(`Every file is there, and each platform's update verifies against key ${publicKey.id}.`);
  } else {
    console.error("Usage: release.mjs check-version <tag> | name-files <dir> <tag> | latest-json <dir> <tag> <owner/repo> | release-notes <tag> | verify <dir> <tag> <owner/repo>");
    process.exit(2);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
