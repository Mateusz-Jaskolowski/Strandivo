// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The feedback Worker, with GitHub and email replaced. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { handle, issueBody, maintainerEmail, MAX_BYTES } from "./src/index.mjs";

const report = {
  kind: "bug",
  summary: "Map is blank",
  details: "Opened a file.\n```\nclosing the fence @maintainer [x](https://evil.example)",
  email: null,
  app: { version: "0.2.1", os: "macos", osVersion: "15.1", arch: "aarch64" },
  view: "Map",
  errors: ["10:00:00 TypeError: x is undefined"],
  file: null
};

function service({ github = { status: 201, body: { number: 42, html_url: "https://github.com/o/r/issues/42" } }, mailFails = false, limited = false, env = {} } = {}) {
  const calls = { github: [], mail: [] };
  const deps = {
    fetch: async (url, init) => {
      calls.github.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(github.body), { status: github.status });
    },
    sendMail: async (_env, raw) => {
      if (mailFails) throw new Error("no");
      calls.mail.push(raw);
    }
  };
  const fullEnv = { GITHUB_TOKEN: "t", MAINTAINER_EMAIL: "maintainer@example.org", LIMITER: { limit: async () => ({ success: !limited }) }, ...env };
  const send = (body, headers = {}) =>
    handle(new Request("https://feedback.strandivo.com/report", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), fullEnv, deps);
  return { calls, send };
}

test("a report becomes an issue, and the answer is its number", async () => {
  const { calls, send } = service();
  const res = await send(report);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { number: 42, emailed: true });
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  const [call] = calls.github;
  assert.equal(call.url, "https://api.github.com/repos/Mateusz-Jaskolowski/Strandivo/issues");
  assert.equal(call.init.headers.authorization, "Bearer t");
  assert.deepEqual(call.body.labels, ["from-app", "bug"]);
  assert.equal(call.body.title, "Map is blank");
  assert.equal(calls.mail.length, 0);
});

test("what the reporter wrote can't break out of its fence", () => {
  const body = issueBody(report);
  // The details' own fence is three backticks, so theirs is four.
  assert.match(body, /\n````text\nOpened a file\.\n```\nclosing the fence @maintainer \[x\]\(https:\/\/evil\.example\)\n````\n/);
  assert.match(body, /\| App \| Strandivo 0\.2\.1 · macOS 15\.1 · Apple silicon \|/);
  assert.match(body, /Recent errors, with file paths removed/);
});

test("the email address and the file never go in the issue", async () => {
  const { calls, send } = service();
  const res = await send({ ...report, email: "anna@lab.example.org", file: { name: "pSecret.gb", contents: "LOCUS pSecret 4000 bp\nORIGIN acgt" } });
  assert.deepEqual(await res.json(), { number: 42, emailed: true });
  const issue = JSON.stringify(calls.github[0].body);
  assert.doesNotMatch(issue, /anna@lab|LOCUS|acgt/);
  assert.match(issue, /an email address for an answer and the open file, which went to the maintainer alone/);
  const [mail] = calls.mail;
  assert.match(mail, /^From: Strandivo feedback <noreply@strandivo\.com>\r\nTo: <maintainer@example\.org>\r\nReply-To: <anna@lab\.example\.org>\r\n/);
  assert.match(mail, /Content-Disposition: attachment; filename="pSecret\.gb"/);
  assert.ok(mail.includes(Buffer.from("LOCUS pSecret 4000 bp\nORIGIN acgt").toString("base64")));
});

test("an email that can't be sent doesn't lose the issue", async () => {
  for (const s of [service({ mailFails: true }), service({ env: { MAINTAINER_EMAIL: "" } })]) {
    const res = await s.send({ ...report, email: "anna@lab.example.org" });
    assert.deepEqual(await res.json(), { number: 42, emailed: false });
  }
});

test("only a sound report is filed", async () => {
  const { calls, send } = service();
  assert.equal((await send({ ...report, summary: "" })).status, 400);
  assert.equal((await send({ ...report, email: "Bcc: x@y.org\r\n" })).status, 400);
  assert.equal((await send("not json")).status, 400);
  assert.equal((await send(report, { "content-type": "text/plain" })).status, 415);
  assert.equal((await send(report, { "content-length": String(MAX_BYTES + 1) })).status, 413);
  assert.equal(calls.github.length, 0);
  assert.equal((await service({ limited: true }).send(report)).status, 429);
  assert.equal((await service({ github: { status: 401, body: {} } }).send(report)).status, 502);
  const get = await handle(new Request("https://feedback.strandivo.com/report"), {}, {});
  assert.equal(get.status, 405);
  const preflight = await handle(new Request("https://feedback.strandivo.com/report", { method: "OPTIONS" }), {}, {});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-headers"), "content-type");
});

test("a crash goes in the issue fenced, and older copies' reports still pass", async () => {
  const crash = { version: "0.4.0", at: "2026-11-06T09:30:00.000Z", thread: "tokio-runtime-worker", location: "reqwest-0.13.0/src/async_impl/client.rs:2311:5", message: "no TLS provider\n```\n@maintainer" };
  const body = issueBody({ ...report, crash });
  assert.match(body, /The app quit unexpectedly/);
  assert.match(body, /\n````text\nStrandivo 0\.4\.0, 2026-11-06 09:30:00 UTC\nThread: tokio-runtime-worker\nAt: reqwest-0\.13\.0\/src\/async_impl\/client\.rs:2311:5\nno TLS provider\n```\n@maintainer\n````\n/);
  const { calls, send } = service();
  assert.equal((await send({ ...report, crash })).status, 200);
  assert.equal((await send({ ...report, crash: null })).status, 200);
  // A copy before 0.4.0 sends no crash field at all.
  assert.equal((await send(report)).status, 200);
  assert.equal((await send({ ...report, crash: { ...crash, extra: "x" } })).status, 400);
  assert.equal((await send({ ...report, crash: { ...crash, location: "a\nb" } })).status, 400);
  assert.equal(calls.github.length, 3);
});

test("the email's subject may be in any language", () => {
  const mail = maintainerEmail({ ...report, summary: "Mapa jest pusta – żółw" }, { number: 7, url: "u" }, "m@example.org", "B");
  const subject = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(mail)[1];
  assert.equal(Buffer.from(subject, "base64").toString(), "Bug #7: Mapa jest pusta – żółw");
  assert.ok(mail.endsWith("--B--\r\n"));
});
