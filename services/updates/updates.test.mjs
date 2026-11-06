// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The updates Worker, with GitHub replaced by a stub. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkKey, COUNT_SQL, handle, LATEST } from "./src/index.mjs";

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

/** A stand-in for D1 that keeps the rows the SQL would. */
function fakeDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      assert.equal(sql, COUNT_SQL);
      return {
        bind: (...args) => ({
          run: async () => {
            const key = args.join("|");
            rows.set(key, (rows.get(key) ?? 0) + 1);
          }
        })
      };
    }
  };
}

test("counts checks per day, version, OS and processor, and nothing else", async () => {
  const db = fakeDb();
  const pending = [];
  const waitUntil = p => pending.push(p);
  await handle(ask(), github(200, manifest), { CHECKS: db }, waitUntil);
  await handle(ask(), github(404, "Not Found"), { CHECKS: db }, waitUntil);
  await handle(ask("/latest.json?target=windows&arch=x86_64&version=0.2.1"), github(200, manifest), { CHECKS: db }, waitUntil);
  // Whatever else a request carries is counted as "other", never kept as it came.
  await handle(ask("/latest.json?target=<script>&arch=pc&version=0.2.1-evil&user=anna"), github(200, manifest), { CHECKS: db }, waitUntil);
  // HEAD and other paths aren't checks.
  await handle(ask("/latest.json", "HEAD"), github(200, manifest), { CHECKS: db }, waitUntil);
  await handle(ask("/other"), github(200, manifest), { CHECKS: db }, waitUntil);
  await Promise.all(pending);
  const day = new Date().toISOString().slice(0, 10);
  assert.deepEqual(Object.fromEntries(db.rows), {
    [`${day}|0.1.0|darwin|aarch64`]: 2,
    [`${day}|0.2.1|windows|x86_64`]: 1,
    [`${day}|other|other|other`]: 1
  });
});

test("a check is answered even when it can't be counted", async () => {
  const broken = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error("D1 down"); } }) }) };
  const pending = [];
  const res = await handle(ask(), github(200, manifest), { CHECKS: broken }, p => pending.push(p));
  assert.equal(res.status, 200);
  await Promise.all(pending);
  // And without a database at all, as before one was set up.
  assert.equal((await handle(ask(), github(200, manifest))).status, 200);
});

test("a check is counted as known words alone", () => {
  const k = checkKey(new URL("https://updates.strandivo.com/latest.json?target=linux&arch=x86_64&version=0.3.0"), new Date(Date.UTC(2026, 10, 6)));
  assert.deepEqual(k, { day: "2026-11-06", version: "0.3.0", os: "linux", arch: "x86_64" });
});
