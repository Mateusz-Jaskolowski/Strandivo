// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Double peaks: measured on the library's real reads, and turned into mixes, poor reads
// and unreliable calls on made-up ones.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { peakRatios } from "./chromatogram.ts";
import { clonePeaks, DOUBLE_PEAK, regionKey } from "./mixes.ts";
import type { Chromatogram, CloneResult, Difference, Feature, ReadResult } from "./types.ts";

test("a second peak is measured as a share of the first", () => {
  // Peaks every 10 samples; base 1 has C at half of A's height.
  const trace = (peaks: number[]) => Int16Array.from({ length: 40 }, (_, s) => (s % 10 === 5 ? peaks[(s - 5) / 10] : 0));
  const c: Chromatogram = {
    aTrace: trace([1000, 1000, 0, 0]),
    cTrace: trace([40, 500, 1000, 0]),
    gTrace: trace([0, 0, 0, 0]),
    tTrace: trace([0, 0, 0, 0]),
    basePos: [5, 15, 25, 35],
    baseCalls: ["A", "A", "C", "N"]
  };
  // A peak a sample off still counts.
  c.cTrace[16] = 500;
  c.cTrace[15] = 0;
  const r = peakRatios(c);
  assert.ok(Math.abs(r[0] - 0.04) < 1e-6);
  assert.ok(Math.abs(r[1] - 0.5) < 1e-6);
  assert.equal(r[2], 0);
  assert.equal(r[3], 0, "flat");
});

test("the library's single clone has no double peaks in its CDRs, the mixes have many", async () => {
  const { parseReadFile } = await import("../doc/fileio.ts");
  const ratios = async (name: string) => {
    const path = `testdata/library/${name}`;
    const [read] = await parseReadFile(new Uint8Array(readFileSync(new URL(`../../${path}`, import.meta.url))), path);
    return peakRatios(read.chromatogram!);
  };
  const share = (r: Float32Array, from: number, to: number) => r.slice(from, to).filter(v => v >= DOUBLE_PEAK).length / (to - from);
  // CDR1 (2,172–2,201) is read at these bases, as the core aligns the reads.
  const single = await ratios("2026-10-13_C01_MJG5PRIMER.ab1");
  assert.equal(single.length, 1229);
  assert.equal(share(single, 196, 226), 0);
  assert.ok(Math.max(...single.slice(196, 226)) < 0.12);
  const weaker = await ratios("2026-10-13_A01_MJF3PRIMER.ab1");
  assert.ok(share(weaker, 210, 240) > 0.5, `${share(weaker, 210, 240)}`);
  // Past the end of the alignment the single clone's read gets noisy.
  assert.ok(share(single, 950, 1000) > 0.5);
});

// A made-up read of a 400-base reference, read forward from 0 to 300 without gaps.
const N = 400;
const REF = "ACGT".repeat(N / 4);
const region: Feature = { name: "cdr", type: "misc_feature", start: 100, end: 129, variable: { kind: "any" } };

function read(differences: Difference[] = [], strand: "forward" | "reverse" = "forward", trimEnd = 300): ReadResult {
  return {
    name: "r", status: "aligned", message: null, strand, readLength: 300, qualityEstimated: false,
    trimStart: 0, trimEnd, refStart: 0, refSpan: trimEnd, wrapsOrigin: false,
    matches: 300, mismatches: 0, insertedBases: 0, deletedBases: 0, ambiguous: 0, identity: 1, score: 0,
    differences,
    segments: [{ readFrom: 0, readTo: trimEnd, refFrom: 0, refTo: trimEnd, gappedReference: REF, gappedRead: REF.slice(0, trimEnd) + "-".repeat(N - trimEnd) }]
  };
}
const clone: CloneResult = { key: "c", reads: [0], pieces: [], differences: [], conflicts: [] };
/** Ratios for 300 bases: 0.05, with `at(j)` where it gives one. */
const ratios = (at: (j: number) => number | undefined) => Float32Array.from({ length: 300 }, (_, j) => at(j) ?? 0.05);
const peaks = (r: ReadResult, q: Float32Array, regions = [region]) => clonePeaks(clone, [r], [q], regions, N, false);

test("double peaks in a variable region after clean bases make a mix, with a rough share", () => {
  // Two of every three bases differ between the plasmids, at second peaks of 0.45.
  const q = ratios(j => (j >= 100 && j < 130 && j % 3 ? 0.45 : undefined));
  const p = peaks(read(), q);
  // 0.45 of the major plasmid is 31% of both.
  assert.equal(p.mixed, 0.3);
  assert.deepEqual([...p.mixedRegions], [regionKey(region)]);
  assert.equal(p.poor, false);
  // Calls in and around the region can't be trusted; the rest can.
  assert.ok(p.unreliable.has(115) && p.unreliable.has(98));
  assert.ok(!p.unreliable.has(50) && !p.unreliable.has(200));
  // Read from the other strand, the clean bases before the region are on its right.
  assert.equal(peaks(read([], "reverse"), q.slice().reverse()).mixed, 0.3);
});

test("a mix is found where quality trimming cut the read", () => {
  // The read was trimmed before the region, but its bases go on past the alignment.
  const q = ratios(j => (j >= 100 && j < 130 && j % 3 ? 0.7 : undefined));
  const p = peaks(read([], "forward", 90), q);
  assert.equal(p.mixed, 0.4);
});

test("double peaks without clean bases before them are not a mix", () => {
  // Every base from 60 on: a read running out, or the second of two regions.
  const p = peaks(read(), ratios(j => (j >= 60 ? 0.4 : undefined)));
  assert.equal(p.mixed, null);
  assert.ok(p.unreliable.has(70) && p.unreliable.has(115) && !p.unreliable.has(40));
  // Most of the read is like that: a poor read.
  assert.equal(p.poor, true);
});

test("a read's noisy end makes its calls there unreliable, not the clone mixed or poor", () => {
  const change: Difference = { kind: "deletion", refPos: 290, refBases: "A", readBases: "", readPos: 290, quality: 30, confident: true };
  const p = peaks(read([change]), ratios(j => (j >= 270 ? 0.4 : undefined)));
  assert.equal(p.mixed, null);
  assert.equal(p.poor, false);
  assert.ok(p.unreliable.has(290) && !p.unreliable.has(250));
});

test("a double peak at a change among clean bases is a mix too", () => {
  const change: Difference = { kind: "substitution", refPos: 60, refBases: "A", readBases: "G", readPos: 60, quality: 15, confident: false };
  const p = peaks(read([change]), ratios(j => (j === 60 ? 0.6 : undefined)), []);
  assert.equal(p.mixed, 0.4);
  // The change itself still counts: the plasmids are in register around it.
  assert.ok(!p.unreliable.has(60));
});

test("reads without traces are trusted", () => {
  const two: CloneResult = { ...clone, reads: [0, 1] };
  const noisy = ratios(j => (j >= 200 ? 0.4 : undefined));
  const p = clonePeaks(two, [read(), read()], [noisy, null], [region], N, false);
  assert.ok(!p.unreliable.has(250));
  // Both reads noisy there: unreliable.
  assert.ok(clonePeaks(two, [read(), read()], [noisy, noisy], [region], N, false).unreliable.has(250));
});

test("a deletion among double peaks is unreliable too", () => {
  // The read lacks reference base 290: the bases around where it would be tell.
  const r = read();
  const s = r.segments[0];
  r.segments = [{ ...s, readTo: 299, gappedRead: REF.slice(0, 290) + "-" + REF.slice(291, 300) + "-".repeat(N - 300) }];
  const p = peaks(r, ratios(j => (j >= 270 ? 0.4 : undefined)));
  assert.ok(p.unreliable.has(290));
});
