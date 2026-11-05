// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The updates Worker, with GitHub replaced by a stub. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, LATEST } from "./src/index.mjs";

const manifest = { version: "0.2.0", notes: "", pub_date: "2026-11-06T10:00:00Z", platforms: { "darwin-aarch64": { signature: "s", url: "u" } } };
const ask = (path = "/latest.json?target=darwin&arch=aarch64&version=0.1.0", method = "GET") =>
  new Request(`https://updates.strandivo.com${path}`, { method });
const github = (status, body) => async url => {
  assert.equal(url, LATEST);
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
};

test("hands over the latest release's manifest", async () => {
  const res = await handle(ask(), github(200, manifest));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  assert.deepEqual(await res.json(), manifest);
});

test("says there is no update when there is no release, an error or a bad file", async () => {
  for (const fetchLatest of [github(404, "Not Found"), github(500, "oops"), github(200, "<html>"), github(200, { hello: 1 }), async () => { throw new Error("offline"); }]) {
    const res = await handle(ask(), fetchLatest);
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");
  }
});

test("answers only GET and HEAD on /latest.json", async () => {
  assert.equal((await handle(ask("/latest.json", "POST"), github(200, manifest))).status, 405);
  assert.equal((await handle(ask("/"), github(200, manifest))).status, 404);
  assert.equal((await handle(ask("/other.json"), github(200, manifest))).status, 404);
  const head = await handle(ask("/latest.json", "HEAD"), github(200, manifest));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});
