// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, describeSystem, isEmail, LIMITS, reportProblem, reportText, scrubPaths, type FeedbackReport } from "./feedback.ts";

const app = { version: "0.2.1", os: "macos", osVersion: "15.1", arch: "aarch64" };
const base = { kind: "bug" as const, summary: "Map is blank", details: "Opened pUC19.", email: "", app, view: "Map", errors: null, file: null };

test("file paths never reach a report's errors", () => {
  for (const [input, want] of [
    ["Couldn't read /Users/anna/Lab/secret construct.gb", "Couldn't read <path>"],
    ["Couldn't read \"/Volumes/Lab drive/My plasmids/a b.gb\" (no access)", "Couldn't read \"<path>\" (no access)"],
    ["/home/anna/x.gb\nnext line", "<path>\nnext line"],
    ["ENOENT: open '/home/anna/plasmids/pX330.dna'", "ENOENT: open '<path>'"],
    ["Couldn't read C:\\Users\\Anna\\Documents\\pX330.dna", "Couldn't read <path>"],
    ["at render (tauri://localhost/assets/index-abc.js:12:3)", "at render (<path>)"],
    ["Saved ~/Desktop/a.gb", "Saved <path>"],
    // Where such a path ends can't be told, so the rest of the line goes with it.
    ["\\\\labserver\\share\\a.gb missing", "<path>"]
  ]) {
    assert.equal(scrubPaths(input), want, input);
  }
  // Ordinary text with a slash stays.
  assert.equal(scrubPaths("forward/reverse primers and 1/2 of reads"), "forward/reverse primers and 1/2 of reads");
});

test("a report is trimmed to its limits, and a title stays one line", () => {
  const r = buildReport({ ...base, summary: `  Map\nis blank${"!".repeat(300)}`, email: "  anna@lab.org ", errors: Array.from({ length: 30 }, (_, i) => `error ${i} at /Users/anna/x/y.js`) });
  assert.equal(r.summary.length, LIMITS.summary);
  assert.ok(r.summary.startsWith("Map is blank"));
  assert.equal(r.email, "anna@lab.org");
  assert.equal(r.errors?.length, LIMITS.errors);
  assert.equal(r.errors?.[0], "error 10 at <path>");
  assert.equal(reportProblem(r), null);
  assert.equal(buildReport(base).email, null);
});

test("the service turns down what the dialog wouldn't send", () => {
  const ok = buildReport(base);
  assert.equal(reportProblem(ok), null);
  const bad = (patch: Record<string, unknown>) => reportProblem({ ...ok, ...patch });
  assert.match(bad({ kind: "rant" }) ?? "", /bug, idea or question/);
  assert.match(bad({ summary: " " }) ?? "", /summary/);
  assert.match(bad({ summary: "a\nb" }) ?? "", /one line/);
  assert.match(bad({ email: "not an address" }) ?? "", /email/);
  assert.match(bad({ app: { ...app, version: "<script>" } }) ?? "", /app's details/);
  assert.match(bad({ errors: ["x".repeat(LIMITS.error + 1)] }) ?? "", /errors/);
  assert.match(bad({ file: { name: "../a.gb", contents: "" } }) ?? "", /name/);
  assert.match(bad({ file: { name: "a.gb", contents: "a".repeat(LIMITS.fileBytes + 1) } }) ?? "", /too big/);
  assert.match(bad({ token: "x" }) ?? "", /shouldn't/);
  assert.match(reportProblem(null) ?? "", /empty/);
  assert.equal(bad({ file: { name: "pUC19.gb", contents: "LOCUS" } }), null);
});

test("email addresses", () => {
  assert.ok(isEmail("anna@lab.example.org"));
  for (const s of ["anna", "anna@lab", "a b@lab.org", "<a@b.org>", "a@b.org,c@d.org"]) assert.equal(isEmail(s), false, s);
});

test("the copied text says what the report says, without the file", () => {
  const r: FeedbackReport = { ...buildReport({ ...base, errors: ["Boom"] }), file: { name: "a.gb", contents: "LOCUS secret" } };
  const text = reportText(r);
  assert.match(text, /^Bug: Map is blank\nOpened pUC19\.\n\nStrandivo 0\.2\.1 · macOS 15\.1 · Apple silicon\nOpen view: Map\n\nRecent errors:\nBoom$/);
  assert.doesNotMatch(text, /LOCUS/);
  assert.equal(describeSystem({ ...app, os: "windows", osVersion: "11", arch: "x86_64" }), "Strandivo 0.2.1 · Windows 11 · Intel or AMD");
});
