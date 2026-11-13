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
//     release (the same check as the release build), pushes the tag v0.3.0 on it and
//     follows the release from there, as below.
//   npm run release:follow [0.3.0]
//     Takes a tagged release the rest of the way, from wherever it is (Ctrl+C leaves it as
//     it is): asks you to approve its build in the release environment, waits for it,
//     checks the draft (every file there, each update signed with the key every installed
//     copy trusts, GitHub's record of how each was built), asks you to publish it, then
//     waits for "Check the release" and shows what it found. A release candidate is
//     published without asking, as no copy is offered one. Each yes is yours, at the
//     terminal, through your own gh login. Without a terminal it waits for an approval
//     given in the browser and stops before publishing a release.
//   npm run release 0.4.0-rc.1
//     A release candidate: the same steps, but Unreleased stays as it is and gives the
//     candidate its notes, since the release proper needs them too. Its build drafts a
//     pre-release, which updates and the website's Download page never offer, so only
//     people who download it from the release page get it.
//
// The tag stays a person's step on purpose: only admins may create v* tags, and the build
// it starts waits for a maintainer's approval before it may sign anything. This script
// only saves typing and checking: nothing here, and no token kept anywhere, can approve
// or publish without a maintainer saying yes. .github/scripts/release.mjs is the release
// build's own half, and .github/scripts/published.mjs checks a published release.
// Run with --experimental-strip-types, as it reads the changelog with the app's own code.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { isPrerelease, releaseNotesFor, releaseUnreleased, unreleasedProblem } from "../src/lib/changelog.ts";
import { attestationProblems } from "../.github/scripts/published.mjs";
import { changelogProblem, releaseFileProblems, updateKey, versionProblems, versions } from "../.github/scripts/release.mjs";
import { setVersion, VERSION } from "./set-version.mjs";

/**
 * -1, 0 or 1 as version a comes before, with or after b, by semver's rules: a pre-release
 * comes before its release, and its parts compare as numbers where both are (rc.2 < rc.10).
 */
export function compareVersions(a, b) {
  const parse = v => {
    const dash = v.indexOf("-");
    const core = dash < 0 ? v : v.slice(0, dash);
    return { nums: core.split(".").map(Number), pre: dash < 0 ? null : v.slice(dash + 1).split(".") };
  };
  const sign = d => (d < 0 ? -1 : d > 0 ? 1 : 0);
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return sign(x.nums[i] - y.nums[i]);
  if (!x.pre || !y.pre) return x.pre ? -1 : y.pre ? 1 : 0;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === q) continue;
    const [pn, qn] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    if (pn && qn) return sign(Number(p) - Number(q));
    if (pn !== qn) return pn ? -1 : 1;
    return p < q ? -1 : 1;
  }
  return sign(x.pre.length - y.pre.length);
}

/** The pull request's text: the notes as they will be released, and what comes next. */
export function pullRequestBody(version, notes) {
  const candidate = isPrerelease(version);
  return [
    candidate
      ? `Release candidate ${version}, to try the signed build before the release. It goes out as a pre-release: updates and the Download page skip it. Its notes are Unreleased's, which stays as it is (the first paragraph is what the app shows):`
      : `Releases ${version}. Its notes, as CHANGELOG.md now has them (the first paragraph is what the app shows):`,
    "",
    `> ${notes.summary}`,
    "",
    notes.details,
    "",
    "## After merging",
    "",
    `Run \`npm run release:tag\` on main. It tags the merge commit, which starts the release build, asks you to approve it, checks the draft and ${candidate ? "publishes it as a pre-release; then install it from its release page" : "asks you to publish it"}.`
  ].join("\n");
}

/** "3 of 8 jobs done", from a run's jobs as gh lists them. */
export function jobProgress(jobs) {
  return `${jobs.filter(j => j.status === "completed").length} of ${jobs.length} jobs done`;
}

/**
 * How gh publishes the draft of `version`: a release is made latest, which is what
 * installed copies and the Download page follow; a candidate can't be, so no copy is
 * offered it.
 */
export function publishArgs(version) {
  const args = ["release", "edit", `v${version}`, "--draft=false"];
  return isPrerelease(version) ? args : [...args, "--latest"];
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

  // A candidate leaves Unreleased as it is (it is the release's notes too), so the website,
  // which shows only sections, doesn't change either.
  const path = join(root, "CHANGELOG.md");
  let changelog = readFileSync(path, "utf8");
  const files = [];
  if (isPrerelease(version)) {
    const problem = unreleasedProblem(changelog);
    if (problem) throw new Stop(problem);
  } else {
    const released = releaseUnreleased(changelog, version);
    if ("problem" in released) throw new Stop(released.problem);
    changelog = released.text;
    writeFileSync(path, changelog);
    files.push("CHANGELOG.md");
  }
  files.push(...setVersion(root, version));
  if (!isPrerelease(version)) {
    run(process.execPath, ["--experimental-strip-types", "tools/build-site.mjs"]);
    files.push("site");
  }

  const notes = releaseNotesFor(changelog, version);
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

async function tag() {
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
  console.log(`Pushed ${name} on ${sha.slice(0, 7)}.`);
  await follow(version);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const gh = (...args) => run("gh", args);
const ghJson = (...args) => JSON.parse(gh(...args));

/** A yes from the person at the terminal: only an answer starting with y. */
async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

/** What `get` gives once it gives something, asking every `every` ms for up to `timeout`. */
async function waitFor(what, get, { every, timeout }) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const found = get();
    if (found) return found;
    if (Date.now() >= deadline) throw new Stop(`Gave up waiting for ${what}. Run npm run release:follow again to pick it up.`);
    await sleep(every);
  }
}

/** Waits for the build of `tag`, which asks to be approved, until it has finished. */
async function followBuild(tag, repo, terminal) {
  const build = await waitFor(`the build of ${tag} to start`, () =>
    ghJson("run", "list", "--workflow", "build.yml", "--branch", tag, "--event", "push", "--limit", "1", "--json", "databaseId,url")[0],
  { every: 5_000, timeout: 5 * 60_000 });
  console.log(`Build: ${build.url}`);
  const id = String(build.databaseId);
  const approvedIds = new Set();
  let yes = false;
  let told = false;
  let shown = "";
  const deadline = Date.now() + 3 * 3600_000;
  for (;;) {
    const r = ghJson("run", "view", id, "--json", "status,conclusion,jobs");
    if (r.status === "completed") {
      if (r.conclusion === "success") return;
      const drafted = r.jobs.some(j => j.name === "Draft release" && j.conclusion === "success");
      throw new Stop(drafted
        ? `The release is drafted, but GitHub's record of how its files were built wasn't made. Re-run that job (gh run rerun ${id} --failed), then npm run release:follow.`
        : `The build ended with "${r.conclusion}" before drafting the release: ${build.url}`);
    }
    const waiting = ghJson("api", `repos/${repo}/actions/runs/${id}/pending_deployments`)
      .filter(d => d.environment?.name === "release" && !approvedIds.has(d.environment.id));
    if (waiting.length && !yes) {
      if (!waiting.every(d => d.current_user_can_approve)) throw new Stop(`Your GitHub account can't approve the release environment; a maintainer who can must, at ${build.url}`);
      if (!terminal) {
        if (!told) console.log(`Waiting for the signed build to be approved: ${build.url}`);
        told = true;
      } else if (await confirm(`Approve the signed build of ${tag}? Its jobs get the update signing key.`)) {
        yes = true;
      } else {
        throw new Stop(`Not approved. The build waits up to 30 days: approve it at ${build.url}, then run npm run release:follow.`);
      }
    }
    if (waiting.length && yes) {
      const ids = [...new Set(waiting.map(d => d.environment.id))];
      gh("api", "-X", "POST", `repos/${repo}/actions/runs/${id}/pending_deployments`,
        ...ids.flatMap(e => ["-F", `environment_ids[]=${e}`]), "-f", "state=approved", "-f", "comment=Approved at the terminal (npm run release:follow).");
      for (const e of ids) approvedIds.add(e);
      console.log("Approved. The signed builds take about 25 minutes.");
    }
    const progress = jobProgress(r.jobs);
    if (progress !== shown) console.log(`… ${progress}`);
    shown = progress;
    if (Date.now() >= deadline) throw new Stop(`The build is still running: ${build.url}. Run npm run release:follow again to pick it up.`);
    await sleep(waiting.length ? 3_000 : 20_000);
  }
}

/** Checks the draft of `tag` as installed copies will meet it; throws if anything is wrong. */
function checkDraft(tag, repo, url) {
  const dir = mkdtempSync(join(tmpdir(), `strandivo-${tag}-`));
  try {
    console.log("Checking the draft's files…");
    gh("release", "download", tag, "--dir", dir);
    const names = readdirSync(dir);
    const latest = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
    const key = updateKey(root);
    const problems = [
      ...releaseFileProblems({ latest, names, read: n => readFileSync(join(dir, n)), tag, repo, publicKey: key }),
      ...attestationProblems({ dir, names, tag, repo })
    ];
    if (problems.length) throw new Stop(`The draft isn't right, so it stays a draft (${url}):\n  ${problems.join("\n  ")}`);
    console.log(`✓ Every file is there, each update verifies against key ${key.id}, and GitHub's record of how each was built names build.yml at ${tag}.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Takes the release of `version`, already tagged, the rest of the way (see the top). */
async function follow(version) {
  if (!VERSION.test(version ?? "")) throw new Stop("Usage: npm run release:follow [x.y.z]");
  const tag = `v${version}`;
  const candidate = isPrerelease(version);
  const repo = gh("repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner");
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!tagExists(tag)) throw new Stop(`${tag} isn't tagged yet: npm run release:tag tags it.`);

  await followBuild(tag, repo, terminal);
  const release = ghJson("release", "view", tag, "--json", "isDraft,isPrerelease,url");
  if (release.isPrerelease !== candidate) throw new Stop(`${tag} is ${candidate ? "not " : ""}marked a pre-release, unlike its version: ${release.url}`);
  if (release.isDraft) {
    checkDraft(tag, repo, release.url);
    if (!candidate) {
      if (!terminal) throw new Stop(`Checked and ready to publish: ${release.url}. "Check the release" runs once it is.`);
      if (!(await confirm(`Publish ${tag}? Every installed copy will be offered it.`))) throw new Stop(`Not published. The draft is checked and waiting: ${release.url}`);
    }
    gh(...publishArgs(version));
    console.log(candidate ? `Published ${tag} as a pre-release, which no installed copy is offered. Install it from ${release.url}` : `Published ${tag}.`);
  } else {
    console.log(`${tag} is already published: ${release.url}`);
  }

  const checkRun = () =>
    ghJson("run", "list", "--workflow", "after-release.yml", "--event", "release", "--limit", "20", "--json", "databaseId,headBranch,url").find(r => r.headBranch === tag);
  if (!release.isDraft && !checkRun()) {
    console.log(`No "Check the release" ran when ${tag} was published. Run it from the Actions tab with the tag ${tag}.`);
    return;
  }
  const check = await waitFor(`"Check the release" to start`, checkRun, { every: 10_000, timeout: 5 * 60_000 });
  console.log(`Checking the published release: ${check.url}`);
  const done = await waitFor("the check to finish", () => {
    const r = ghJson("run", "view", String(check.databaseId), "--json", "status,conclusion");
    return r.status === "completed" ? r : null;
  }, { every: 20_000, timeout: 45 * 60_000 });
  const log = run("gh", ["run", "view", String(check.databaseId), "--log"], { allowFail: true }) ?? "";
  // Its findings, without the annotation run.sh repeats a failure in.
  for (const line of log.split("\n")) {
    const m = !line.includes("::error") && line.match(/[✓✗].*$/);
    if (m) console.log(m[0]);
  }
  if (done.conclusion !== "success") throw new Stop(`"Check the release" found a problem: ${check.url}`);
  console.log(`${tag} is out and checked.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "prepare") prepare(args.find(a => !a.startsWith("--")), { push: !args.includes("--no-push") });
    else if (command === "tag") await tag();
    else if (command === "follow") await follow(args[0] ?? JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
    else throw new Stop("Usage: release.mjs prepare <x.y.z> [--no-push] | tag | follow [x.y.z]");
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    console.error(e.message);
    process.exit(1);
  }
}
