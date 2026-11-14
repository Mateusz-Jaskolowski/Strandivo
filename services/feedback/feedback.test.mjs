// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// The feedback Worker, with GitHub and email replaced. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { appJwt, DAILY_REPORTS, githubToken, handle, issueBody, maintainerEmail, MAX_BYTES, networkKey, pkcs8 } from "./src/index.mjs";

/** The text of an email the Worker sent with one part, decoded. */
const mailText = raw => Buffer.from(raw.split("\r\n\r\n")[1], "base64").toString();

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

// A GitHub App's key, as GitHub hands it out (PKCS#1), and the same key as PKCS#8.
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs1Pem = privateKey.export({ type: "pkcs1", format: "pem" });
const pkcs8Pem = privateKey.export({ type: "pkcs8", format: "pem" });
const appEnv = { GITHUB_APP_CLIENT_ID: "Iv23liExample", GITHUB_APP_INSTALLATION_ID: "12345678", GITHUB_APP_PRIVATE_KEY: pkcs1Pem };

/** D1 as the Worker uses it, over SQLite in memory with the real schema. */
function counts() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  return {
    prepare: sql => ({ bind: (...args) => ({ first: async () => db.prepare(sql).get(...args) ?? null }) }),
    rows: () => db.prepare("SELECT day, reports, failures FROM days ORDER BY day").all().map(r => ({ ...r }))
  };
}

/**
 * GitHub gives the App a token for each report (`tokens`), then files its issue (`github`).
 * The per-network limit records what it was asked about (`limited`).
 */
function service({ github = { status: 201, body: { number: 42, html_url: "https://github.com/o/r/issues/42" } }, tokenStatus = 201, mailFails = false, limited = false, env = {}, now } = {}) {
  const calls = { tokens: [], github: [], mail: [], limited: [] };
  const deps = {
    now,
    fetch: async (url, init) => {
      const call = { url, init, body: JSON.parse(init.body) };
      if (url.includes("/access_tokens")) {
        calls.tokens.push(call);
        return new Response(JSON.stringify(tokenStatus === 201 ? { token: "ghs_report" } : { message: "no" }), { status: tokenStatus });
      }
      calls.github.push(call);
      return new Response(JSON.stringify(github.body), { status: github.status });
    },
    sendMail: async (_env, raw) => {
      if (mailFails) throw new Error("no");
      calls.mail.push(raw);
    }
  };
  const limiter = { limit: async ({ key }) => (calls.limited.push(key), { success: !limited }) };
  const fullEnv = { ...appEnv, MAINTAINER_EMAIL: "maintainer@example.org", LIMITER: limiter, ...env };
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
  assert.equal(call.init.headers.authorization, "Bearer ghs_report");
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
  assert.equal(calls.tokens.length, 0);
  assert.equal(calls.mail.length, 0);
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

test("a name to credit goes in the issue as inline code, and older copies send none", async () => {
  const { calls, send } = service();
  assert.equal((await send({ ...report, name: "JIB" })).status, 200);
  const body = calls.github[0].body.body;
  assert.match(body, /^\*\*Bug\*\*, sent from the app\.\n\nSent by: `JIB`\n\n````text\n/);
  assert.equal((await send(report)).status, 200);
  assert.doesNotMatch(calls.github[1].body.body, /Sent by/);
  // Inline code can't mention, link or close itself early.
  assert.match(issueBody({ ...report, name: "@maintainer [x](https://evil.example) #1 `a`" }), /\nSent by: `` @maintainer \[x\]\(https:\/\/evil\.example\) #1 `a` ``\n/);
  for (const name of ["a\nb", "x".repeat(61), "anna@lab.example.org", "evil‮exe", 7]) {
    assert.equal((await send({ ...report, name })).status, 400, JSON.stringify(name));
  }
  assert.equal(calls.github.length, 2);
});

test("when GitHub turns a report down, the maintainer is told why, with nothing from the report", async () => {
  const { calls, send } = service({ github: { status: 403, body: { message: "Resource not accessible\nby integration" } } });
  assert.equal((await send({ ...report, email: "anna@lab.example.org", name: "JIB" })).status, 502);
  const [mail] = calls.mail;
  assert.match(mail, /^From: Strandivo feedback <noreply@strandivo\.com>\r\nTo: <maintainer@example\.org>\r\nSubject: A report couldn't be filed\r\n/);
  assert.match(mailText(mail), /\n\nGitHub answered 403 for the issue: Resource not accessible by integration\n\n/);
  assert.doesNotMatch(mail + mailText(mail), /Map is blank|Opened a file|anna@|JIB|Reply-To|TypeError/);
  // A token GitHub won't give says so too.
  const refused = service({ tokenStatus: 401 });
  await refused.send(report);
  assert.match(mailText(refused.calls.mail[0]), /GitHub answered 401 for a token: no\n/);
  // With no address, or the email failing, the app still hears it wasn't taken.
  const noAddress = service({ github: { status: 500, body: {} }, env: { MAINTAINER_EMAIL: "" } });
  assert.equal((await noAddress.send(report)).status, 502);
  assert.equal(noAddress.calls.mail.length, 0);
  assert.equal((await service({ github: { status: 500, body: {} }, mailFails: true }).send(report)).status, 502);
});

test("the email's subject may be in any language", () => {
  const mail = maintainerEmail({ ...report, summary: "Mapa jest pusta – żółw" }, { number: 7, url: "u" }, "m@example.org", "B");
  const subject = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(mail)[1];
  assert.equal(Buffer.from(subject, "base64").toString(), "Bug #7: Mapa jest pusta – żółw");
  assert.ok(mail.endsWith("--B--\r\n"));
});

const part = s => JSON.parse(Buffer.from(s, "base64url").toString());
/** `now`, when the token was made at a known time; otherwise just now. */
function checkJwt(jwt, now = null) {
  const [head, claims, signature] = jwt.split(".");
  assert.deepEqual(part(head), { alg: "RS256", typ: "JWT" });
  const c = part(claims);
  assert.equal(c.iss, "Iv23liExample");
  if (now !== null) assert.equal(c.iat, Math.floor(now / 1000) - 60);
  else assert.ok(Math.abs(c.iat - (Date.now() / 1000 - 60)) < 5, `${c.iat}`);
  // A minute back and nine ahead: GitHub takes at most ten minutes, by its own clock.
  assert.equal(c.exp - c.iat, 600);
  assert.ok(verify("RSA-SHA256", Buffer.from(`${head}.${claims}`), publicKey, Buffer.from(signature, "base64url")), "signature");
}

test("the App's key works as GitHub gives it, or as PKCS#8", async () => {
  const now = Date.UTC(2026, 10, 13, 12);
  checkJwt(await appJwt("Iv23liExample", pkcs1Pem, now), now);
  checkJwt(await appJwt("Iv23liExample", pkcs8Pem, now), now);
  // Pasted on one line, with "\n" for its line breaks.
  checkJwt(await appJwt("Iv23liExample", pkcs1Pem.replace(/\n/g, "\\n"), now), now);
  // The wrapped key is the same key Node writes as PKCS#8.
  assert.deepEqual(Buffer.from(pkcs8(pkcs1Pem)), Buffer.from(pkcs8Pem.replace(/-----[^-]+-----|\s/g, ""), "base64"));
  assert.throws(() => pkcs8("not a key"), /PEM/);
});

test("each report gets a token that can only write this repository's issues", async () => {
  const { calls, send } = service();
  assert.equal((await send(report)).status, 200);
  const [token] = calls.tokens;
  assert.equal(token.url, "https://api.github.com/app/installations/12345678/access_tokens");
  assert.deepEqual(token.body, { repositories: ["Strandivo"], permissions: { issues: "write" } });
  checkJwt(token.init.headers.authorization.replace(/^Bearer /, ""));
  // The issue goes in with that token, so the App's bot is its author.
  assert.equal(calls.github[0].init.headers.authorization, "Bearer ghs_report");
  // A token for each report: none is kept between them.
  await send(report);
  assert.equal(calls.tokens.length, 2);
});

test("without a token from GitHub, nothing is filed and the app hears so", async () => {
  const refused = service({ tokenStatus: 401 });
  assert.equal((await refused.send(report)).status, 502);
  assert.equal(refused.calls.tokens.length, 1);
  assert.equal(refused.calls.github.length, 0);
  // A secret missing or wrong asks for nothing, and a token from before the App isn't used.
  const envs = [{ GITHUB_APP_CLIENT_ID: "" }, { GITHUB_APP_INSTALLATION_ID: "", GITHUB_TOKEN: "old" }, { GITHUB_APP_PRIVATE_KEY: "" }, { GITHUB_APP_INSTALLATION_ID: "../repos" }, { GITHUB_APP_PRIVATE_KEY: "nonsense" }];
  for (const env of envs) {
    const s = service({ env });
    assert.equal((await s.send(report)).status, 502, JSON.stringify(env));
    assert.equal(s.calls.tokens.length + s.calls.github.length, 0, JSON.stringify(env));
  }
  await assert.rejects(githubToken({}, async () => new Response("{}")), /App's secrets/);
});

test("one network is an IPv4 address, or the first 64 bits of an IPv6 one", async () => {
  assert.equal(networkKey("192.0.2.7"), "192.0.2.7");
  assert.equal(networkKey(null), "unknown");
  // Every address in a /64 is one network, however it is written.
  for (const ip of ["2001:db8:1:2:3:4:5:6", "2001:0DB8:0001:0002::9", "2001:db8:1:2::", "2001:db8:1:2::192.0.2.1"]) assert.equal(networkKey(ip), "2001:db8:1:2::/64", ip);
  assert.equal(networkKey("2001:db8:1:3::1"), "2001:db8:1:3::/64");
  assert.equal(networkKey("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(networkKey("::1"), "0:0:0:0::/64");
  assert.equal(networkKey("::ffff:192.0.2.1"), "0:0:0:0::/64");
  const { calls, send } = service();
  await send(report, { "cf-connecting-ip": "2001:db8:1:2:aaaa:bbbb:cccc:dddd" });
  await send(report, { "cf-connecting-ip": "203.0.113.5" });
  assert.deepEqual(calls.limited, ["2001:db8:1:2::/64", "203.0.113.5"]);
});

const day1 = new Date("2026-11-14T23:59:00Z");
const day2 = new Date("2026-11-15T00:01:00Z");

test("past the day's limit, reports are turned away and the maintainer hears so once", async () => {
  const db = counts();
  const { calls, send } = service({ env: { COUNTS: db }, now: day1 });
  for (let i = 0; i < DAILY_REPORTS; i++) assert.equal((await send(report)).status, 200);
  assert.equal(calls.mail.length, 0);
  // Not 429, which copies of the app read as "wait a minute"; they show this reason as it is.
  for (let i = 0; i < 3; i++) {
    const res = await send({ ...report, email: "anna@lab.example.org" });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: "Too many reports today." });
  }
  assert.equal(calls.github.length, DAILY_REPORTS);
  assert.equal(calls.tokens.length, DAILY_REPORTS);
  const [mail] = calls.mail;
  assert.equal(calls.mail.length, 1);
  assert.match(mail, /^From: Strandivo feedback <noreply@strandivo\.com>\r\nTo: <maintainer@example\.org>\r\nSubject: Today's limit of reports was reached\r\n/);
  assert.match(mailText(mail), new RegExp(`^${DAILY_REPORTS} reports reached the feedback service today \\(2026-11-14, UTC\\)`));
  assert.match(mailText(mail), /issues\?q=is%3Aissue\+label%3Afrom-app\+created%3A2026-11-14\n/);
  assert.doesNotMatch(mail + mailText(mail), /Map is blank|anna@|Reply-To/);
  // A report turned away as unsound isn't counted.
  assert.equal((await send({ ...report, summary: "" })).status, 400);
  assert.deepEqual(db.rows(), [{ day: "2026-11-14", reports: DAILY_REPORTS + 3, failures: 0 }]);
  // A new day (UTC) starts again.
  const next = service({ env: { COUNTS: db }, now: day2 });
  assert.equal((await next.send(report)).status, 200);
  assert.deepEqual(db.rows()[1], { day: "2026-11-15", reports: 1, failures: 0 });
});

test("GitHub turning reports down emails the maintainer once a day", async () => {
  const db = counts();
  const refused = { github: { status: 403, body: { message: "Resource not accessible by integration" } }, env: { COUNTS: db } };
  const s = service({ ...refused, now: day1 });
  for (let i = 0; i < 3; i++) assert.equal((await s.send(report)).status, 502);
  assert.equal(s.calls.mail.length, 1);
  assert.match(mailText(s.calls.mail[0]), /GitHub answered 403 for the issue: Resource not accessible by integration\n/);
  assert.match(mailText(s.calls.mail[0]), /Only the day's first is emailed/);
  assert.deepEqual(db.rows(), [{ day: "2026-11-14", reports: 3, failures: 3 }]);
  const next = service({ ...refused, now: day2 });
  await next.send(report);
  assert.equal(next.calls.mail.length, 1);
});

test("without a database, or when it fails, reports go through as before", async () => {
  const broken = { prepare: () => ({ bind: () => ({ first: async () => { throw new Error("D1 down"); } }) }) };
  for (const env of [{}, { COUNTS: broken }]) {
    const ok = service({ env });
    for (let i = 0; i <= DAILY_REPORTS; i++) assert.equal((await ok.send(report)).status, 200);
    // And each refusal is emailed, with no count to say which is the day's first.
    const refused = service({ env, github: { status: 500, body: {} } });
    await refused.send(report);
    await refused.send(report);
    assert.equal(refused.calls.mail.length, 2);
    assert.doesNotMatch(mailText(refused.calls.mail[0]), /day's first/);
  }
});
