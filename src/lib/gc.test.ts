// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// GC content along a sequence. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { gcLevel, gcProfile, gcRuns, gcRunText, overviewWindow } from "./gc.ts";

/** GC of bases a…b by counting, the slow way, for comparing. */
function counted(seq: string, circular: boolean, i: number, window: number): number {
  const n = seq.length;
  const half = (window - 1) / 2;
  let gc = 0;
  let known = 0;
  for (let j = i - half; j <= i + half; j++) {
    if (!circular && (j < 0 || j >= n)) continue;
    const c = seq[((j % n) + n) % n].toUpperCase();
    if ("GCS".includes(c)) gc++;
    if ("GCSATUW".includes(c)) known++;
  }
  return known ? gc / known : NaN;
}

test("the window is centred on each base", () => {
  const p = gcProfile("AAAAAGGGGG", false, 3);
  assert.deepEqual(Array.from(p), [0, 0, 0, 0, 1 / 3, 2 / 3, 1, 1, 1, 1]);
});

test("a linear sequence cuts the window short at its ends", () => {
  const p = gcProfile("GAAAAAAAAC", false, 5);
  assert.equal(p[0], 1 / 3);
  assert.equal(p[9], 1 / 3);
  assert.equal(p[5], 0);
});

test("a circular sequence wraps the window across the origin", () => {
  const p = gcProfile("GAAAAAAAAC", true, 5);
  assert.equal(p[0], 2 / 5);
  assert.equal(p[9], 2 / 5);
  assert.equal(p[1], 2 / 5);
  assert.equal(p[5], 0);
});

test("a window as long as a circular sequence is the whole sequence's GC", () => {
  assert.deepEqual(Array.from(gcProfile("GCAT", true, 21)), [0.5, 0.5, 0.5, 0.5]);
});

test("N and ambiguity codes count as neither; S and W do count", () => {
  const p = gcProfile("NNNNN", false, 3);
  assert.ok(Array.from(p).every(Number.isNaN));
  assert.equal(gcProfile("GNA", false, 3)[1], 0.5);
  assert.equal(gcProfile("SRW", false, 3)[1], 0.5);
  assert.equal(gcProfile("gcat", false, 3)[1], 2 / 3);
});

test("the profile matches counting window by window", () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let round = 0; round < 40; round++) {
    const n = 1 + Math.floor(rand() * 80);
    const seq = Array.from({ length: n }, () => "ACGTNacgtSW"[Math.floor(rand() * 11)]).join("");
    const window = 1 + 2 * Math.floor(rand() * 15);
    for (const circular of [false, true]) {
      const p = gcProfile(seq, circular, window);
      const full = circular && window >= n;
      for (let i = 0; i < n; i++) {
        const want = full ? counted(seq, false, 0, 2 * n + 1) : counted(seq, circular, i, window);
        if (Number.isNaN(want)) assert.ok(Number.isNaN(p[i]), `${seq} ${window} ${circular} ${i}`);
        else assert.ok(Math.abs(p[i] - want) < 1e-12, `${seq} ${window} ${circular} ${i}: ${p[i]} vs ${want}`);
      }
    }
  }
});

test("levels follow the primer checks' thresholds", () => {
  assert.equal(gcLevel(0.3), "at");
  assert.equal(gcLevel(0.35), "at-light");
  assert.equal(gcLevel(0.399), "at-light");
  assert.equal(gcLevel(0.4), "mid");
  assert.equal(gcLevel(12 / 20), "mid");
  assert.equal(gcLevel(0.6 + 0.001), "gc-light");
  assert.equal(gcLevel(0.65), "gc-light");
  assert.equal(gcLevel(0.66), "gc");
  assert.equal(gcLevel(NaN), null);
});

test("runs join values of one level and skip unknown ones", () => {
  const values = [0.5, 0.45, 0.7, 0.8, NaN, 0.1, 0.55];
  const runs = gcRuns(values.length, i => values[i]);
  assert.deepEqual(runs.map(r => [r.a, r.b, r.level]), [[0, 1, "mid"], [2, 3, "gc"], [5, 5, "at"], [6, 6, "mid"]]);
  assert.equal(gcRunText(runs[0]), "GC 45–50%");
  assert.equal(gcRunText(runs[2]), "GC 10%");
});

test("the overview window grows with the sequence and stays odd", () => {
  assert.equal(overviewWindow(2686), 101);
  assert.equal(overviewWindow(50000), 501);
  assert.equal(overviewWindow(12000) % 2, 1);
});
