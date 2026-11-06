// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUCKETS, bucket, fileFormat, inBucket, propWords, readFormat, USAGE_EVENTS, usageEvent, type PropSpec } from "./usage.ts";

const events = Object.entries(USAGE_EVENTS) as [string, { why: string; props: Record<string, PropSpec> }][];

test("no event can carry free text: every property is a list of words or a count", () => {
  for (const [name, spec] of events) {
    assert.match(name, /^[a-z_]{1,32}$/, name);
    assert.ok(spec.why.length > 10, `${name} says why it is counted`);
    for (const [key, allowed] of Object.entries(spec.props)) {
      assert.match(key, /^[a-z_]{1,24}$/, `${name}.${key}`);
      assert.ok(typeof allowed === "string" ? allowed === "count" || Object.hasOwn(BUCKETS, allowed) : allowed.length > 0, `${name}.${key}`);
      // What the shell accepts too (`send_usage` in src-tauri/src/usage.rs), buckets included.
      for (const w of propWords(allowed)) assert.match(w, /^[a-z0-9_+-]{1,24}$/, `${name}.${key}: ${w}`);
    }
    // The shell takes at most four properties an event.
    assert.ok(Object.keys(spec.props).length <= 4, name);
  }
});

test("names say what happened to what", () => {
  for (const [name] of events) assert.match(name, /^[a-z]+(_[a-z]+)*_(started|chosen|opened|saved|used|added|detected|designed|shown|exported|made|simulated|aligned|installed|caught)$/, name);
});

test("numbers go out as their bucket's word", () => {
  assert.deepEqual([0, 4.9, 5, 14, 15, 49, 50, 4000].map(n => inBucket("kb", n)), ["under_5kb", "under_5kb", "5-15kb", "5-15kb", "15-50kb", "15-50kb", "50kb+", "50kb+"]);
  assert.deepEqual([0.2, 1, 29, 30].map(n => inBucket("seconds", n)), ["under_1s", "1-5s", "5-30s", "30s+"]);
  assert.deepEqual([0, 0.9, 1, 6.9, 7, 29, 30, 400].map(n => inBucket("days", n)), ["first_day", "first_day", "first_week", "first_week", "first_month", "first_month", "longer", "longer"]);
});

test("a batch of reads is one format or mixed", () => {
  assert.equal(readFormat(["/a/A1.ab1", "B2.ABI"]), "ab1");
  assert.equal(readFormat(["nanopore.fq"]), "fastq");
  assert.equal(readFormat(["x.fasta", "y.seq", "z.txt"]), "fasta");
  assert.equal(readFormat(["x.ab1", "y.fasta"]), "mixed");
});

test("whatever is passed, only listed words and buckets go out", () => {
  const names = ["pX330 lab copy.gb", "/Users/anna/a.dna", "ATGCATGC", "anna@lab.org", "map ", "MAP", "<b>", "toString", "__proto__"];
  for (const [name, spec] of events) {
    for (const key of [...Object.keys(spec.props), "path", "name", "constructor"]) {
      for (const v of [...names, 7, -1, Number.NaN, Infinity, null, {}, ["map"]]) {
        const e = usageEvent(name, { [key]: v });
        assert.ok(e);
        for (const [k, out] of Object.entries(e.props)) {
          const allowed = spec.props[k];
          assert.ok(allowed, `${name} sent ${k}`);
          assert.ok(propWords(allowed).includes(out), `${name}.${k} = ${out}`);
        }
      }
    }
  }
  assert.equal(usageEvent("opened_secret_file"), null);
  assert.equal(usageEvent("toString"), null);
  assert.deepEqual(usageEvent("view_used", { view: "reads" })?.props, { view: "reads" });
  assert.equal(usageEvent("view_shown"), null);
  assert.deepEqual(usageEvent("file_opened", { format: "genbank", length: 2.7, topology: "circular" })?.props, { format: "genbank", length: "under_5kb", topology: "circular" });
  assert.deepEqual(usageEvent("reads_aligned", { reads: 96, kind: "sanger" })?.props, { reads: "21+", kind: "sanger" });
  assert.match(usageEvent("check_saved", {}, new Date(Date.UTC(2026, 10, 6, 9, 30)))?.at ?? "", /^2026-11-06T09:30:00\.000Z$/);
});

test("counts go in buckets", () => {
  assert.deepEqual([0, 1, 2, 5, 6, 20, 21, 384].map(bucket), ["0", "1", "2-5", "2-5", "6-20", "6-20", "21+", "21+"]);
});

test("file formats come from the name alone", () => {
  assert.equal(fileFormat("/Users/anna/pUC19.GB"), "genbank");
  assert.equal(fileFormat("C:\\lab\\pX330.dna"), "snapgene");
  assert.equal(fileFormat("insert.fasta"), "fasta");
  assert.equal(fileFormat("plasmid.xdna"), "other");
  assert.equal(fileFormat("no extension"), "other");
});

test("the privacy page names every event and property", () => {
  const privacy = readFileSync(new URL("../../docs/privacy.md", import.meta.url), "utf8");
  for (const [name, spec] of events) {
    assert.ok(privacy.includes(`\`${name}\``), `docs/privacy.md lists ${name}`);
    for (const key of Object.keys(spec.props)) assert.ok(privacy.includes(`\`${key}\``), `docs/privacy.md names ${name}.${key}`);
  }
});
