#!/usr/bin/env node
// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Makes a release from a maintainer's own checkout, in two steps:
//
//   npm run release 0.3.0
//     On an up-to-date main: turns CHANGELOG.md's Unreleased into the 0.3.0 section (its
//     short notes must be written first, above its bullets), sets the version, rebuilds the
//     website's What's new page, commits on chore/release-0.3.0 and opens a pull request.
//     `npm run release -- 0.3.0 --no-push` stops after the commit (npm keeps flags before --).
//   npm run release:tag
//     Once that pull request is merged: brings main up to date, checks it is ready to
//     release (the same check as the release build) and pushes the tag v0.3.0 on it.
//
// The tag stays a person's step on purpose: only admins may create v* tags, and the build
// it starts waits for a maintainer's approval before it may sign anything. This script
// only saves typing. .github/scripts/release.mjs is the release build's own half.
// Run with --experimental-strip-types, as it reads the changelog with the app's own code.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { notesFor, releaseUnreleased } from "../src/lib/changelog.ts";
import { changelogProblem, versionProblems, versions } from "../.github/scripts/release.mjs";
import { setVersion, VERSION } from "./set-version.mjs";

/** -1, 0 or 1 as version a comes before, with or after b; a pre-release before its release. */
export function compareVersions(a, b) {
  const parse = v => {
    const [core, pre] = v.split("-", 2);
    return { nums: core.split(".").map(Number), pre: pre ?? null };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** The pull request's text: the notes as they will be released, and what comes next. */
export function pullRequestBody(version, notes) {
  return [
    `Releases ${version}. Its notes, as CHANGELOG.md now has them (the first paragraph is what the app shows):`,
    "",
    `> ${notes.summary}`,
    "",
    notes.details,
    "",
    "## After merging",
    "",
    "Run `npm run release:tag` on main. It tags the merge commit, which starts the release build; approve it in the `release` environment, then publish the draft release."
  ].join("\n");
}

class Stop extends Error {}

const root = fileURLToPath(new URL("..", import.meta.url));

/** Runs a command in the checkout; its output is returned, or shown when `show` is set. */
function run(cmd, args, { show = false, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", stdio: show ? "inherit" : "pipe" });
  if (r.error) throw new Stop(`Couldn't run ${cmd}: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) {
    throw new Stop(`${cmd} ${args.join(" ")} failed${show ? "" : `:\n${(r.stderr || r.stdout).trim()}`}`);
  }
  return r.status === 0 ? (r.stdout ?? "").trim() : null;
}
const git = (...args) => run("git", args);

/** Stops unless this is main, with nothing uncommitted, at the same commit as GitHub's. */
function onCurrentMain({ pull }) {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== "main") throw new Stop(`Switch to main first (this is ${branch}).`);
  if (git("status", "--porcelain", "--untracked-files=no")) throw new Stop("Commit or stash the changes in this checkout first.");
  git("fetch", "--quiet", "--tags", "origin", "main");
  if (pull) run("git", ["merge", "--ff-only", "--quiet", "origin/main"]);
  if (git("rev-parse", "HEAD") !== git("rev-parse", "origin/main")) {
    throw new Stop("main here isn't the same as on GitHub: pull (or push) first.");
  }
}

function tagExists(tag) {
  return git("tag", "--list", tag) !== "" || run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]) !== "";
}

/** Text cut into lines of at most `width` characters, at spaces, for a commit's body. */
export function wrap(text, width = 72) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function prepare(version, { push }) {
  if (!VERSION.test(version ?? "")) throw new Stop("Usage: npm run release <x.y.z>, such as npm run release 0.3.0");
  onCurrentMain({ pull: false });
  const current = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  if (compareVersions(version, current) <= 0) throw new Stop(`${version} isn't after the current version, ${current}.`);
  if (push) run("gh", ["auth", "status"]);
  if (tagExists(`v${version}`)) throw new Stop(`The tag v${version} already exists.`);
  const branch = `chore/release-${version}`;
  if (git("branch", "--list", branch)) throw new Stop(`A branch ${branch} already exists here.`);

  const path = join(root, "CHANGELOG.md");
  const released = releaseUnreleased(readFileSync(path, "utf8"), version);
  if ("problem" in released) throw new Stop(released.problem);
  writeFileSync(path, released.text);
  const files = ["CHANGELOG.md", ...setVersion(root, version)];
  run(process.execPath, ["--experimental-strip-types", "tools/build-site.mjs"]);
  files.push("site");

  const notes = notesFor(released.text, version);
  git("switch", "--quiet", "-c", branch);
  git("add", "--", ...files);
  git("commit", "--quiet", "-m", `chore(release): set the version to ${version}`, "-m", wrap(notes.summary));
  console.log(`Committed ${version}'s version and notes on ${branch}.`);
  if (!push) {
    console.log(`Not pushed. When it looks right: git push -u origin ${branch}, and open a pull request.`);
    return;
  }
  run("git", ["push", "--quiet", "-u", "origin", branch], { show: true });
  const url = run("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", `chore(release): ${version}`, "--body", pullRequestBody(version, notes)]);
  console.log(`Opened ${url}\nOnce its checks pass, merge it, then run: npm run release:tag`);
}

function tag() {
  onCurrentMain({ pull: true });
  const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
  const name = `v${version}`;
  const problems = versionProblems(name, versions(root));
  const notes = changelogProblem(name, readFileSync(join(root, "CHANGELOG.md"), "utf8"));
  if (notes) problems.push(notes);
  if (problems.length) throw new Stop(`main isn't ready to release ${version}:\n  ${problems.join("\n  ")}`);
  if (tagExists(name)) throw new Stop(`${name} is already tagged: main has no new version to release.`);

  const sha = git("rev-parse", "HEAD");
  const runs = run("gh", ["run", "list", "--commit", sha, "--workflow", "checks.yml", "--json", "status,conclusion,url", "--limit", "1"], { allowFail: true });
  const checks = runs ? JSON.parse(runs)[0] : null;
  if (checks?.status === "completed" && checks.conclusion !== "success") {
    throw new Stop(`Checks ended with "${checks.conclusion}" on this commit (${checks.url}). Fix that before releasing.`);
  }
  if (checks && checks.status !== "completed") console.log(`Checks are still running on this commit (${checks.url}); the pull request's passed.`);

  git("tag", "-a", name, "-m", `Strandivo ${version}`);
  run("git", ["push", "--quiet", "origin", name], { show: true });
  const repo = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], { allowFail: true }) ?? "<owner>/<repo>";
  console.log(`Pushed ${name} on ${sha.slice(0, 7)}. Next:
  1. Approve the build in the release environment: https://github.com/${repo}/actions/workflows/build.yml
  2. When it has finished, check the draft and publish it: https://github.com/${repo}/releases`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "prepare") prepare(args.find(a => !a.startsWith("--")), { push: !args.includes("--no-push") });
    else if (command === "tag") tag();
    else throw new Stop("Usage: release.mjs prepare <x.y.z> [--no-push] | tag");
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    console.error(e.message);
    process.exit(1);
  }
}
