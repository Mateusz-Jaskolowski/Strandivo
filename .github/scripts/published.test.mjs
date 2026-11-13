// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Checking a published release from outside, with GitHub and the website stood in for. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { attestationProblems, liveProblems, updatesUrl, webDeployment } from "./published.mjs";
import { DOWNLOADS, RELEASE_FILES } from "./release.mjs";

const repo = "o/r";
const updates = "https://updates.example/latest.json";

/** The web as it looks once `released` is out and `listed` versions are on What's new. */
function web({ released, latest, listed = [released], server = 200 }) {
  const asked = [];
  const fetch = async (url, init = {}) => {
    asked.push(`${init.method ?? "GET"} ${url}`);
    const headers = new Headers();
    if (url === updates) return { ok: server === 200, status: server, headers };
    if (url.endsWith("/releases/latest/download/latest.json")) {
      return { ok: true, status: 200, headers, json: async () => latest };
    }
    const download = url.match(/\/releases\/latest\/download\/(.+)$/);
    if (download) {
      headers.set("location", `https://github.com/${repo}/releases/download/v${released}/${download[1]}`);
      return { ok: false, status: 302, headers };
    }
    if (url === "https://strandivo.com/changes/") {
      return { ok: true, status: 200, headers, text: async () => listed.map(v => `<section id="v${v}">`).join("") };
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fetch, asked };
}

const manifest = version => ({ version, notes: "Faster maps.", platforms: { "darwin-aarch64": { url: `u/${version}`, signature: "s" } } });

test("a release is checked as installed copies and visitors meet it", async () => {
  const latest = manifest("0.5.0");
  const { fetch, asked } = web({ released: "0.5.0", latest });
  assert.deepEqual(await liveProblems({ tag: "v0.5.0", repo, latest, updates, fetch }), []);
  // The updates server is never sent a GET, which it would count as an installed copy.
  assert.deepEqual(asked.filter(a => a.includes(updates)), [`HEAD ${updates}`]);
  assert.equal(asked.filter(a => a.includes("/releases/latest/download/Strandivo_")).length, DOWNLOADS.length);
});

test("a release not out yet says what still shows the one before", async () => {
  const before = manifest("0.4.0");
  const { fetch } = web({ released: "0.4.0", latest: before, listed: ["0.4.0"], server: 204 });
  const problems = await liveProblems({ tag: "v0.5.0", repo, latest: manifest("0.5.0"), updates, fetch });
  assert.equal(problems[0], "Installed copies are offered 0.4.0, not 0.5.0.");
  assert.equal(problems[1], `${updates} answers 204, not 200.`);
  assert.match(problems[2], /^The Download page's Strandivo_Mac_Apple-silicon\.dmg leads to .*\/v0\.4\.0\/.*, not v0\.5\.0's\.$/);
  assert.equal(problems.at(-1), "https://strandivo.com/changes/ doesn't list 0.5.0.");
  assert.equal(problems.length, 3 + DOWNLOADS.length);

  // The same version with another manifest: a second build's, say.
  const other = web({ released: "0.5.0", latest: { ...manifest("0.5.0"), notes: "Other." } });
  assert.deepEqual(await liveProblems({ tag: "v0.5.0", repo, latest: manifest("0.5.0"), updates, fetch: other.fetch }), [
    "The latest.json installed copies get isn't the one v0.5.0 published."
  ]);
});

test("a release candidate must not be offered, and isn't looked for on the website", async () => {
  const { fetch, asked } = web({ released: "0.4.0", latest: manifest("0.4.0"), listed: ["0.4.0"] });
  assert.deepEqual(await liveProblems({ tag: "v0.5.0-rc.1", repo, latest: manifest("0.5.0-rc.1"), updates, fetch }), []);
  assert.equal(asked.some(a => a.includes("strandivo.com/changes") || a.includes("download/Strandivo_")), false);
  const offered = web({ released: "0.5.0-rc.1", latest: manifest("0.5.0-rc.1") });
  assert.deepEqual(await liveProblems({ tag: "v0.5.0-rc.1", repo, latest: manifest("0.5.0-rc.1"), updates, fetch: offered.fetch }), [
    "Installed copies are offered 0.5.0-rc.1, a release candidate."
  ]);
});

test("each published file needs GitHub's record of being built by build.yml at its tag", () => {
  const calls = [];
  const names = [...RELEASE_FILES.map(f => f.name), "latest.json", "notes.txt"];
  const run = args => {
    calls.push(args);
    return args[2].endsWith(".deb") ? { status: 1, stderr: "Error: expected SourceRepositoryRef to be refs/tags/v0.5.0, got refs/tags/v0.4.0\n" } : { status: 0 };
  };
  assert.deepEqual(attestationProblems({ dir: "d", names, tag: "v0.5.0", repo, run }), [
    "Strandivo_Linux.deb has no record of being built at v0.5.0: Error: expected SourceRepositoryRef to be refs/tags/v0.5.0, got refs/tags/v0.4.0"
  ]);
  assert.equal(calls.length, RELEASE_FILES.length + 1);
  assert.deepEqual(calls[0].slice(3), ["--repo", repo, "--signer-workflow", "o/r/.github/workflows/build.yml", "--source-ref", "refs/tags/v0.5.0"]);
});

test("the browser version's deployment is waited for, and its failure reported", () => {
  const runs = list => () => ({ status: 0, stdout: JSON.stringify(list) });
  const one = (status, conclusion) => [{ headBranch: "v0.4.0", status: "completed", conclusion: "success", url: "old" }, { headBranch: "v0.5.0", status, conclusion, url: "new" }];
  assert.match(webDeployment({ tag: "v0.5.0", repo, run: runs([]) }).waiting, /hasn't started/);
  assert.match(webDeployment({ tag: "v0.5.0", repo, run: runs(one("in_progress", "")) }).waiting, /still deploying: new/);
  assert.match(webDeployment({ tag: "v0.5.0", repo, run: runs(one("completed", "failure")) }).failed, /ended with "failure": new/);
  assert.deepEqual(webDeployment({ tag: "v0.5.0", repo, run: runs(one("completed", "success")) }), {});
});

test("updates are asked for where the app asks", () => {
  const conf = { plugins: { updater: { endpoints: ["https://updates.strandivo.com/latest.json?target={{target}}&arch={{arch}}&version={{current_version}}"] } } };
  assert.equal(updatesUrl(conf), "https://updates.strandivo.com/latest.json");
});
