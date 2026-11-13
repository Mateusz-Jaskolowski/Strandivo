// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// feedback.strandivo.com: where Help → Send Feedback… sends a report (part 4 of
// docs/updates-feedback-usage-plan.md). It checks the report with the app's own rules
// (src/lib/feedback.ts), files it as an issue in the repository with a token that can
// only write issues, and answers with the issue's number. The issue is public, so the
// reporter's email address and any attached file never go in it: they are emailed to the
// maintainer alone, with the issue's link. It keeps nothing and logs nothing
// (wrangler.toml); how often one network sends is held back by Cloudflare's rate limiter.

import { codeSpan, crashLines, describeSystem, FEEDBACK_KINDS, fenced, reportProblem } from "../../../src/lib/feedback.ts";

export const REPO = "Mateusz-Jaskolowski/Strandivo";
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

async function createIssue(r, env, fetchFn) {
  const res = await fetchFn(`https://api.github.com/repos/${REPO}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "strandivo-feedback",
      "content-type": "application/json"
    },
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
