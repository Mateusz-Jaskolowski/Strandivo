// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Check files and the paths in them. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { checkFileText, parseCheckFile, relativePath, resolvePath, savedClones } from "./readCheck.ts";

test("paths relative to a folder, on macOS, Windows and the web", () => {
  assert.equal(relativePath("/Users/mj/plates/run1", "/Users/mj/plates/run1/A01_M13F.ab1"), "A01_M13F.ab1");
  assert.equal(relativePath("/Users/mj/plates/run1", "/Users/mj/plasmids/pX.gb"), "../../plasmids/pX.gb");
  assert.equal(relativePath("C:\\Lab\\run1", "C:\\Lab\\pX.gb"), "../pX.gb");
  assert.equal(relativePath("C:\\Lab\\run1", "c:\\lab\\RUN1\\A01.ab1"), "A01.ab1");
  // Another drive or host can't be reached from here: the whole path is kept.
  assert.equal(relativePath("C:\\Lab", "D:\\pX.gb"), "D:\\pX.gb");
  assert.equal(relativePath("/testdata/e2e", "/testdata/library/A01.ab1"), "../library/A01.ab1");
  assert.equal(relativePath("http://localhost:1420/testdata", "http://localhost:1420/testdata/e2e/x.fasta"), "e2e/x.fasta");
});

test("relative paths are made whole with the folder's own separator", () => {
  assert.equal(resolvePath("/Users/mj/plates/run1", "../../plasmids/pX.gb"), "/Users/mj/plasmids/pX.gb");
  assert.equal(resolvePath("C:\\Lab\\run1", "../pX.gb"), "C:\\Lab\\pX.gb");
  assert.equal(resolvePath("C:\\Lab\\run1", "D:\\pX.gb"), "D:\\pX.gb");
  assert.equal(resolvePath("/testdata/e2e", "./c7_bla-F.fasta"), "/testdata/e2e/c7_bla-F.fasta");
  assert.equal(resolvePath("http://localhost:1420/testdata", "e2e/x.fasta"), "http://localhost:1420/testdata/e2e/x.fasta");
});

test("a check file round-trips, wherever the folder is moved", () => {
  const check = {
    reference: "/Users/mj/lab/pUC19.gb",
    reads: [
      { path: "/Users/mj/lab/reads/A01_M13F.ab1", clone: null },
      { path: "/Users/mj/lab/reads/A01_M13R.ab1", clone: "#g1" }
    ],
    minQuality: 30,
    trimCutoff: 0.05
  };
  const text = checkFileText("/Users/mj/lab/reads/pUC19 reads.svcheck", check);
  const saved = JSON.parse(text);
  assert.equal(saved.reference, "../pUC19.gb");
  assert.deepEqual(saved.reads[0], { path: "A01_M13F.ab1", clone: null });
  assert.deepEqual(parseCheckFile(text, "/Users/mj/lab/reads/pUC19 reads.svcheck"), check);
  // Copied with its folder to a colleague's Windows computer.
  const moved = parseCheckFile(text, "E:\\shared\\lab\\reads\\pUC19 reads.svcheck");
  assert.equal(moved.reference, "E:\\shared\\lab\\pUC19.gb");
  assert.equal(moved.reads[1].path, "E:\\shared\\lab\\reads\\A01_M13R.ab1");
});

test("other files are refused with a message", () => {
  assert.throws(() => parseCheckFile("LOCUS pUC19", "/a/x.svcheck"), /isn't a Strandivo check file/);
  assert.throws(() => parseCheckFile('{"reads": []}', "/a/x.svcheck"), /isn't a Strandivo check file/);
  assert.throws(() => parseCheckFile('{"strandivo": "read check", "version": 9, "reference": "x.gb", "reads": []}', "/a/x.svcheck"), /newer version/);
});

test("only groups the user made are saved; the rest are guessed again", () => {
  assert.deepEqual(
    savedClones([
      { key: "a01", manual: false },
      { key: "a01", manual: false },
      // b02 got a read moved into it, so both its reads keep that group.
      { key: "b02", manual: false },
      { key: "b02", manual: true },
      { key: "#r7", manual: true }
    ]),
    [null, null, "#g1", "#g1", "#g2"]
  );
});
