// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// feedback.strandivo.com: where Help → Send Feedback… sends a report (part 4 of
// docs/updates-feedback-usage-plan.md). It checks the report with the app's own rules
// (src/lib/feedback.ts), files it as an issue in the repository as a GitHub App's bot,
// with a token made for that report that can only write issues, and answers with the
// issue's number. The issue is public, so the
// reporter's email address and any attached file never go in it: they are emailed to the
// maintainer alone, with the issue's link. It keeps nothing and logs nothing
// (wrangler.toml); how often one network sends is held back by Cloudflare's rate limiter.

import { codeSpan, crashLines, describeSystem, FEEDBACK_KINDS, fenced, reportProblem } from "../../../src/lib/feedback.ts";

export const REPO = "Mateusz-Jaskolowski/Strandivo";
const GITHUB_HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "strandivo-feedback" };
/** A report with the largest file the app attaches, as JSON, and some room. */
export const MAX_BYTES = 2_600_000;
/** GitHub's own labels where they fit, so the repository needs only "from-app" added. */
export const LABELS = { bug: "bug", idea: "enhancement", question: "question" };
const FROM = "noreply@strandivo.com";

// Any origin: the app's page is tauri://localhost on a Mac and http://tauri.localhost on
// Windows, and the service takes no cookies or credentials, so nothing is gained by naming them.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400"
};

const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

/**
 * The issue's text. What the reporter wrote is fenced as plain text, and the name to
 * credit is inline code, so neither can mention anyone, link anywhere or change how the
 * issue looks; the rest is the app's own, checked by reportProblem.
 */
export function issueBody(r) {
  const kind = FEEDBACK_KINDS.find(k => k.id === r.kind)?.label ?? r.kind;
  const lines = [`**${kind}**, sent from the app.`, ""];
  // Older copies send no name.
  if (r.name) lines.push(`Sent by: ${codeSpan(r.name)}`, "");
  if (r.details) lines.push(fenced(r.details), "");
  lines.push("| | |", "| --- | --- |", `| App | ${describeSystem(r.app)} |`, `| Open view | ${r.view} |`, "");
  // Older copies send no crash; everything in it is fenced, though the app made it.
  if (r.crash) lines.push("The app quit unexpectedly, and this is what it noted, with file paths removed:", "", fenced(crashLines(r.crash).join("\n")), "");
  if (r.errors?.length) lines.push("Recent errors, with file paths removed:", "", fenced(r.errors.join("\n")), "");
  const private_ = [r.email ? "an email address for an answer" : "", r.file ? "the open file" : ""].filter(Boolean);
  if (private_.length) lines.push(`_The reporter sent ${private_.join(" and ")}, which went to the maintainer alone._`, "");
  return lines.join("\n");
}

/** Base64 of UTF-8 text, in lines of 76 as email wants. */
function base64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/.{76}(?=.)/g, "$&\r\n");
}

/** A header value that may not be ASCII (RFC 2047). */
const encodedWord = text => `=?UTF-8?B?${base64(text).replace(/\r\n/g, "")}?=`;

/**
 * The maintainer's email: the issue's link, the reporter's address as Reply-To, so
 * answering goes to them, and the file attached. Every value in a header has been checked
 * (an address has no spaces or line breaks; a file name no control characters).
 */
export function maintainerEmail(r, issue, to, boundary = `sv-${crypto.randomUUID()}`) {
  const kind = FEEDBACK_KINDS.find(k => k.id === r.kind)?.label ?? r.kind;
  const text = [
    `${kind} #${issue.number}: ${r.summary}`,
    issue.url,
    "",
    r.email ? `The reporter would like an answer at ${r.email} (Reply-To). Their address is not in the issue.` : "The reporter left no email address.",
    r.file ? `They attached the open file, ${r.file.name}. It is not in the issue.` : ""
  ].join("\n");
  const head = [
    `From: Strandivo feedback <${FROM}>`,
    `To: <${to}>`,
    ...(r.email ? [`Reply-To: <${r.email}>`] : []),
    `Subject: ${encodedWord(`${kind} #${issue.number}: ${r.summary}`)}`,
    `Message-ID: <${crypto.randomUUID()}@strandivo.com>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`
  ];
  const parts = [["Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: base64", "", base64(text)].join("\r\n")];
  if (r.file) {
    const name = r.file.name.replace(/["\\]/g, "_");
    parts.push([`Content-Type: text/plain; charset=utf-8; name="${name}"`, `Content-Disposition: attachment; filename="${name}"`, "Content-Transfer-Encoding: base64", "", base64(r.file.contents)].join("\r\n"));
  }
  return [...head, "", ...parts.map(p => `--${boundary}\r\n${p}`), `--${boundary}--`, ""].join("\r\n");
}

// ---------- who files the issue ----------

const base64url = bytes => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const base64urlText = text => base64url(new TextEncoder().encode(text));

/** A DER element: its tag, its length and its bytes. */
function der(tag, body) {
  const n = body.length;
  const length = n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 0xff] : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff];
  return new Uint8Array([tag, ...length, ...body]);
}

/**
 * The App's private key as PKCS#8, which is all WebCrypto takes. GitHub hands out PKCS#1
 * ("BEGIN RSA PRIVATE KEY"), which is wrapped here as an RSA key of PKCS#8, so the file
 * GitHub gives can be set as the secret as it is. A key pasted with "\n" for its line
 * breaks works too.
 */
export function pkcs8(pem) {
  const m = /-----BEGIN (RSA )?PRIVATE KEY-----([\s\S]+?)-----END (?:RSA )?PRIVATE KEY-----/.exec(pem.replace(/\\n/g, "\n"));
  if (!m) throw new Error("GITHUB_APP_PRIVATE_KEY isn't a private key in PEM.");
  const bytes = Uint8Array.from(atob(m[2].replace(/\s+/g, "")), c => c.charCodeAt(0));
  if (!m[1]) return bytes;
  // SEQUENCE { INTEGER 0, SEQUENCE { OID rsaEncryption, NULL }, OCTET STRING { the key } }
  const version = [0x02, 0x01, 0x00];
  const rsaEncryption = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  return der(0x30, [...version, ...rsaEncryption, ...der(0x04, bytes)]);
}

/**
 * The JSON Web Token a GitHub App signs to ask for an installation's token: RS256, issued
 * a minute back and good for nine, as GitHub takes ten at most and clocks drift.
 */
export async function appJwt(clientId, pem, now = Date.now()) {
  const iat = Math.floor(now / 1000) - 60;
  const head = base64urlText(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64urlText(JSON.stringify({ iat, exp: iat + 600, iss: clientId }));
  const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  const key = await crypto.subtle.importKey("pkcs8", pkcs8(pem), algorithm, false, ["sign"]);
  const signature = await crypto.subtle.sign(algorithm, key, new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${base64url(new Uint8Array(signature))}`;
}

/** Whether the GitHub App's three secrets are set; until they all are, the old token files issues. */
export const usesApp = env => Boolean(env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY);

/**
 * A token to file one report's issue. With the App's secrets, the installation's token,
 * made for this report and narrowed to this repository's issues, so issues show the
 * App's bot as their author. Without them, the maintainer's fine-grained token
 * (GITHUB_TOKEN), whose issues show the maintainer: kept until the App is set up.
 */
export async function githubToken(env, fetchFn, now = Date.now()) {
  if (!usesApp(env)) {
    if (!env.GITHUB_TOKEN) throw new Error("No way to reach GitHub is set up.");
    return env.GITHUB_TOKEN;
  }
  const installation = String(env.GITHUB_APP_INSTALLATION_ID).trim();
  if (!/^\d+$/.test(installation)) throw new Error("GITHUB_APP_INSTALLATION_ID isn't a number.");
  const jwt = await appJwt(String(env.GITHUB_APP_CLIENT_ID).trim(), env.GITHUB_APP_PRIVATE_KEY, now);
  const res = await fetchFn(`https://api.github.com/app/installations/${installation}/access_tokens`, {
    method: "POST",
    headers: { ...GITHUB_HEADERS, authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ repositories: [REPO.split("/")[1]], permissions: { issues: "write" } })
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for a token`);
  const { token } = await res.json();
  if (typeof token !== "string" || !token) throw new Error("GitHub gave no token.");
  return token;
}

async function createIssue(r, env, fetchFn) {
  const token = await githubToken(env, fetchFn);
  const res = await fetchFn(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: { ...GITHUB_HEADERS, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ title: r.summary, body: issueBody(r), labels: ["from-app", LABELS[r.kind]] })
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const issue = await res.json();
  return { number: issue.number, url: issue.html_url };
}

async function sendWithBinding(env, raw) {
  const { EmailMessage } = await import("cloudflare:email");
  await env.MAILER.send(new EmailMessage(FROM, env.MAINTAINER_EMAIL, raw));
}

export async function handle(request, env, deps = {}) {
  const fetchFn = deps.fetch ?? fetch;
  const sendMail = deps.sendMail ?? sendWithBinding;
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (url.pathname !== "/report") return answer(404, { error: "Not found." });
  if (request.method !== "POST") return answer(405, { error: "Only POST is answered here." });
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return answer(415, { error: "Send JSON." });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return answer(413, { error: "The report is too big." });

  // Per network, for a minute, by Cloudflare: we keep no addresses ourselves.
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: request.headers.get("cf-connecting-ip") ?? "unknown" });
    if (!success) return answer(429, { error: "Too many reports from this network just now." });
  }

  const text = await request.text();
  if (text.length > MAX_BYTES) return answer(413, { error: "The report is too big." });
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    return answer(400, { error: "The report isn't JSON." });
  }
  const problem = reportProblem(report);
  if (problem) return answer(400, { error: problem });

  let issue;
  try {
    issue = await createIssue(report, env, fetchFn);
  } catch {
    return answer(502, { error: "GitHub didn't take the issue just now." });
  }

  // The issue is filed whatever happens to the email: the dialog then says the address
  // or file didn't get through, so the reporter can write instead.
  let emailed = true;
  if (report.email || report.file) {
    try {
      if (!env.MAINTAINER_EMAIL) throw new Error("No maintainer address.");
      await sendMail(env, maintainerEmail(report, issue, env.MAINTAINER_EMAIL));
    } catch {
      emailed = false;
    }
  }
  return answer(200, { number: issue.number, emailed });
}

export default { fetch: (request, env) => handle(request, env) };
