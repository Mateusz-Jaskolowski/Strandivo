// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bucket, fileFormat, USAGE_EVENTS, usageEvent, type PropSpec } from "./usage.ts";

const events = Object.entries(USAGE_EVENTS) as [string, { why: string; props: Record<string, PropSpec> }][];

test("no event can carry free text: every property is a list of words or a count", () => {
  for (const [name, spec] of events) {
    assert.match(name, /^[a-z_]{1,32}$/, name);
    assert.ok(spec.why.length > 10, `${name} says why it is counted`);
    for (const [key, allowed] of Object.entries(spec.props)) {
      assert.match(key, /^[a-z_]{1,24}$/, `${name}.${key}`);
      if (allowed === "count") continue;
      assert.ok(Array.isArray(allowed) && allowed.length > 0, `${name}.${key}`);
      // What the shell accepts too (`send_usage` in src-tauri/src/usage.rs).
      for (const w of allowed) assert.match(w, /^[a-z0-9_+-]{1,24}$/, `${name}.${key}: ${w}`);
    }
  }
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
          assert.ok(allowed === "count" ? ["0", "1", "2-5", "6-20", "21+"].includes(out) : allowed.includes(out), `${name}.${k} = ${out}`);
        }
      }
    }
  }
  assert.equal(usageEvent("opened_secret_file"), null);
  assert.equal(usageEvent("toString"), null);
  assert.deepEqual(usageEvent("view_shown", { view: "reads" })?.props, { view: "reads" });
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
