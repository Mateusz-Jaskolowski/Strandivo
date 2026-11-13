#!/usr/bin/env node
// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Checks a published release from outside, as people and installed copies meet it. Run by
// "Check the release" (.github/workflows/after-release.yml) and `npm run release:follow`:
//
//   node --experimental-strip-types .github/scripts/published.mjs <dir> <tag> <owner/repo>
//
// <dir> holds the release's files as published. They are checked as the build checked
// them before drafting (release.mjs verify), then, asking every 30 seconds for up to 25
// minutes, it waits until:
//   - GitHub's record of how each file was built (`gh attestation verify`) names build.yml
//     at this tag, as the Download page tells people to check;
//   - a release is what updates.strandivo.com offers installed copies, the Download page's
//     links lead to it and What's new lists it; a release candidate is offered to no one;
//   - the browser version's deployment for it (web.yml) has finished.
// It uses gh, signed in (GH_TOKEN in a workflow), and changes nothing.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { isPrerelease } from "../../src/lib/changelog.ts";
import { SITE } from "../../tools/build-site.mjs";
import { DOWNLOADS, RELEASE_FILES, releaseFileProblems, updateKey } from "./release.mjs";

const gh = args => spawnSync("gh", args, { encoding: "utf8" });
const lastLine = text => (text ?? "").trim().split("\n").pop() ?? "";

/** The address installed copies ask for updates, from the updater's endpoint, without the query. */
export function updatesUrl(conf) {
  const url = new URL(conf.plugins.updater.endpoints[0]);
  return `${url.origin}${url.pathname}`;
}

/**
 * What people and installed copies don't meet yet of release `tag`, whose latest.json is
 * `latest`; empty once they do. The updates server only hands over GitHub's latest
 * release's latest.json, so that is compared at GitHub, and the server is asked with
 * HEAD, which it answers without counting an update check.
 */
export async function liveProblems({ tag, repo, latest, updates, fetch = globalThis.fetch }) {
  const version = tag.replace(/^v/, "");
  const candidate = isPrerelease(version);
  const problems = [];
  const ask = async (url, init) => {
    try {
      return await fetch(url, init);
    } catch (e) {
      return { ok: false, status: e.message, headers: new Headers(), text: async () => "", json: async () => null };
    }
  };

  const res = await ask(`https://github.com/${repo}/releases/latest/download/latest.json`);
  const offered = res.ok ? await res.json().catch(() => null) : null;
  if (!offered) problems.push(`GitHub's latest release has no readable latest.json (${res.status}).`);
  else if (candidate && offered.version === version) problems.push(`Installed copies are offered ${version}, a release candidate.`);
  else if (!candidate && offered.version !== version) problems.push(`Installed copies are offered ${offered.version}, not ${version}.`);
  else if (!candidate && !isDeepStrictEqual(offered, latest)) problems.push(`The latest.json installed copies get isn't the one ${tag} published.`);

  const server = await ask(updates, { method: "HEAD" });
  if (server.status !== 200) problems.push(`${updates} answers ${server.status}, not 200.`);

  if (!candidate) {
    for (const d of DOWNLOADS) {
      const r = await ask(`https://github.com/${repo}/releases/latest/download/${d.file}`, { method: "HEAD", redirect: "manual" });
      const to = r.headers.get("location") ?? "";
      if (!to.endsWith(`/releases/download/${tag}/${d.file}`)) problems.push(`The Download page's ${d.file} leads to ${to || `nothing (${r.status})`}, not ${tag}'s.`);
    }
    const page = await ask(`${SITE}/changes/`);
    const html = page.ok ? await page.text() : "";
    if (!html.includes(`id="v${version}"`)) problems.push(`${SITE}/changes/ doesn't list ${version}.`);
  }
  return problems;
}

/** The files whose record of how they were built doesn't name build.yml at `tag`. */
export function attestationProblems({ dir, names, tag, repo, run = gh }) {
  const problems = [];
  for (const name of [...RELEASE_FILES.map(f => f.name), "latest.json"].filter(n => names.includes(n))) {
    const r = run(["attestation", "verify", join(dir, name), "--repo", repo,
      "--signer-workflow", `${repo}/.github/workflows/build.yml`, "--source-ref", `refs/tags/${tag}`]);
    if (r.status !== 0) problems.push(`${name} has no record of being built at ${tag}: ${lastLine(r.stderr || r.stdout) || "gh failed"}`);
  }
  return problems;
}

/** The browser version's deployment of `tag`: `{}` once it succeeded, else what's left or what failed. */
export function webDeployment({ tag, repo, run = gh }) {
  const r = run(["run", "list", "--repo", repo, "--workflow", "web.yml", "--event", "release", "--limit", "20", "--json", "headBranch,status,conclusion,url"]);
  if (r.status !== 0) return { waiting: `GitHub didn't list the browser version's deployments: ${lastLine(r.stderr)}` };
  const found = JSON.parse(r.stdout).find(x => x.headBranch === tag);
  if (!found) return { waiting: `The browser version's deployment of ${tag} hasn't started.` };
  if (found.status !== "completed") return { waiting: `The browser version is still deploying: ${found.url}` };
  if (found.conclusion !== "success") return { failed: `The browser version's deployment ended with "${found.conclusion}": ${found.url}` };
  return {};
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Checks release `tag`, whose published files are in `dir`; true when all is well. */
export async function checkPublished({ dir, tag, repo, root, wait = 25 * 60_000, every = 30_000, log = console.log }) {
  const names = readdirSync(dir);
  const latest = JSON.parse(readFileSync(join(dir, "latest.json"), "utf8"));
  const key = updateKey(root);
  const files = releaseFileProblems({ latest, names, read: n => readFileSync(join(dir, n)), tag, repo, publicKey: key });
  if (files.length) {
    log(`✗ ${tag}'s published files aren't right:\n  ${files.join("\n  ")}`);
    return false;
  }
  log(`✓ Every file is there, and each platform's update verifies against key ${key.id}.`);

  const version = tag.replace(/^v/, "");
  const updates = updatesUrl(JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8")));
  const deadline = Date.now() + wait;
  const done = { attested: false, live: false, web: false };
  let shown = "";
  for (;;) {
    const waiting = [];
    if (!done.attested) {
      const p = attestationProblems({ dir, names, tag, repo });
      if (p.length) waiting.push(...p);
      else (done.attested = true), log(`✓ GitHub's record of how each file was built names build.yml at ${tag}.`);
    }
    if (!done.live) {
      const p = await liveProblems({ tag, repo, latest, updates });
      if (p.length) waiting.push(...p);
      else {
        done.live = true;
        log(isPrerelease(version)
          ? "✓ Installed copies aren't offered this release candidate."
          : `✓ Installed copies are offered ${version}, the Download page leads to it and What's new lists it.`);
      }
    }
    if (!done.web) {
      const w = webDeployment({ tag, repo });
      if (w.failed) {
        log(`✗ ${w.failed}`);
        return false;
      }
      if (w.waiting) waiting.push(w.waiting);
      else (done.web = true), log("✓ The browser version is deployed.");
    }
    if (!waiting.length) return true;
    if (Date.now() >= deadline) {
      log(`✗ Still not right after ${Math.round(wait / 60_000)} minutes:\n  ${waiting.join("\n  ")}`);
      return false;
    }
    const now = waiting.join("\n  ");
    if (now !== shown) log(`… Waiting for:\n  ${now}`);
    shown = now;
    await sleep(every);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [dir, tag, repo] = process.argv.slice(2);
  if (!dir || !tag || !repo) {
    console.error("Usage: published.mjs <dir with the release's files> <tag> <owner/repo>");
    process.exit(2);
  }
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const ok = await checkPublished({ dir, tag, repo, root });
  if (ok) console.log(`${tag} is out and checked.`);
  process.exit(ok ? 0 : 1);
}
