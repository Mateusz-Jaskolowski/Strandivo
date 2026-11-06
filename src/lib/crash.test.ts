// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { addError, ERROR_DAYS, errorLines, parseCrash, parseErrorLog } from "./crash.ts";
import { buildReport, crashLines, LIMITS, reportProblem, reportText } from "./feedback.ts";

// As src-tauri/src/crash.rs writes it.
const file = JSON.stringify({
  format: 1,
  version: "0.4.0",
  os: "macos",
  arch: "aarch64",
  time: 1793957400,
  thread: "tokio-runtime-worker",
  location: "src/usage.rs:139:5",
  message: "called `Result::unwrap()` on an `Err` value: Could not read /Users/anna/Lab plasmids/pSecret.gb\nsecond line"
});

const app = { version: "0.4.1", os: "macos", osVersion: "15.1", arch: "aarch64" };
const base = { kind: "bug" as const, summary: "Strandivo quit unexpectedly", details: "", email: "", app, view: "Home", errors: null, file: null };

test("the shell's crash file is read, and anything else is not", () => {
  const crash = parseCrash(file);
  assert.deepEqual(crash, {
    version: "0.4.0",
    at: "2026-11-06T09:30:00.000Z",
    thread: "tokio-runtime-worker",
    location: "src/usage.rs:139:5",
    message: "called `Result::unwrap()` on an `Err` value: Could not read /Users/anna/Lab plasmids/pSecret.gb\nsecond line"
  });
  for (const bad of [null, "", "{", "[]", "null", JSON.stringify({ ...JSON.parse(file), format: 2 }), JSON.stringify({ ...JSON.parse(file), message: " " }), JSON.stringify({ ...JSON.parse(file), time: "yesterday" })]) {
    assert.equal(parseCrash(bad), null, String(bad));
  }
  const bare = parseCrash(JSON.stringify({ format: 1, time: 1793957400, message: "boom", location: null }));
  assert.equal(bare?.location, "unknown");
  assert.equal(parseCrash(JSON.stringify({ ...JSON.parse(file), message: "x".repeat(5000) }))?.message.length, LIMITS.crashMessage);
});

test("a crash in a report has no file paths, and is shown as it is sent", () => {
  const r = buildReport({ ...base, crash: parseCrash(file) });
  assert.equal(r.crash?.message, "called `Result::unwrap()` on an `Err` value: Could not read <path>\nsecond line");
  assert.equal(r.crash?.location, "src/usage.rs:139:5");
  assert.equal(reportProblem(r), null);
  assert.deepEqual(crashLines(r.crash!), ["Strandivo 0.4.0, 2026-11-06 09:30:00 UTC", "Thread: tokio-runtime-worker", "At: src/usage.rs:139:5", r.crash!.message]);
  assert.match(reportText(r), /It quit unexpectedly:\nStrandivo 0\.4\.0, 2026-11-06 09:30:00 UTC\n/);
  assert.doesNotMatch(JSON.stringify(r), /anna|pSecret/);
  // Locations of the build machine's sources are kept: they are Strandivo's, not the user's.
  for (const location of ["reqwest-0.13.0/src/async_impl/client.rs:2311:5", "crates/seqcore/src/sanger.rs:12:9", "library/core/src/option.rs:2015:5"]) {
    assert.equal(buildReport({ ...base, crash: { ...r.crash!, location } }).crash?.location, location);
  }
  assert.equal(buildReport(base).crash, null);
});

test("the service turns down a crash the dialog wouldn't send", () => {
  const ok = buildReport({ ...base, crash: parseCrash(file) });
  const bad = (patch: Record<string, unknown>) => reportProblem({ ...ok, crash: { ...ok.crash, ...patch } });
  assert.match(bad({ at: "yesterday" }) ?? "", /crash/);
  assert.match(bad({ version: "<b>" }) ?? "", /crash/);
  assert.match(bad({ location: "a\nb" }) ?? "", /crash/);
  assert.match(bad({ message: "x".repeat(LIMITS.crashMessage + 1) }) ?? "", /too long/);
  assert.match(bad({ message: "bell \u0007" }) ?? "", /crash/);
  assert.match(bad({ extra: "x" }) ?? "", /crash/);
  assert.match(reportProblem({ ...ok, crash: "boom" }) ?? "", /crash/);
  // Copies before 0.4.0 send no crash field.
  const { crash: _, ...older } = ok;
  assert.equal(reportProblem(older), null);
});

test("recent errors are kept for a week, the last 20, across launches", () => {
  const now = new Date("2026-11-06T09:30:12.000Z");
  let list = addError([], "  TypeError: x is undefined  ", now);
  assert.deepEqual(errorLines(list), ["2026-11-06 09:30:12 TypeError: x is undefined"]);
  assert.equal(addError(list, "   ", now), list);
  for (let i = 0; i < 30; i++) list = addError(list, `error ${i} ${"x".repeat(1000)}`, now);
  assert.equal(list.length, LIMITS.errors);
  assert.ok(list[0].text.startsWith("error 10 "));
  assert.equal(list[0].text.length, LIMITS.error);
  // What was stored comes back, as long as it is from the past week.
  const stored = JSON.stringify([{ at: "2026-10-01T00:00:00.000Z", text: "old" }, ...list, { at: 3, text: "bad" }, "junk"]);
  assert.deepEqual(parseErrorLog(stored, now.getTime()), list);
  assert.deepEqual(parseErrorLog(stored, now.getTime() + (ERROR_DAYS + 1) * 86_400_000), []);
  for (const bad of [null, "", "{", "{}", "7"]) assert.deepEqual(parseErrorLog(bad, now.getTime()), []);
});
