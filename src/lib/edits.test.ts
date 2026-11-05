// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Randomised edit tests: thousands of random edits on random documents, checked against a
// simple model that tracks every base by identity. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { deleteRange, insertBases, replaceRange, reverseComplementRange, setOrigin, type Range, type SeqData, type SeqFeature } from "./seqdata.ts";
import { DocStore } from "../doc/store.ts";
import { rescanSites, scanSites, type SiteHit } from "./enzymes.ts";

/** Small seeded generator so a failure can be replayed. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(xs: T[]) => xs[Math.floor(next() * xs.length)] };
}
type R = ReturnType<typeof rng>;

const randomBases = (r: R, len: number) => Array.from({ length: len }, () => r.pick(["A", "C", "G", "T"])).join("");

/** Positions a range covers, in order (following the origin). */
function positions(x: Range, n: number): number[] {
  const out: number[] = [];
  if (x.start <= x.end) for (let i = x.start; i <= x.end; i++) out.push(i);
  else {
    for (let i = x.start; i < n; i++) out.push(i);
    for (let i = 0; i <= x.end; i++) out.push(i);
  }
  return out;
}
const partsOf = (f: { start: number; end: number; locations?: Range[] }) => f.locations ?? [f];

function randomDoc(r: R): SeqData {
  const n = r.int(12, 160);
  const circular = r.next() < 0.7;
  const features: SeqFeature[] = [];
  const count = r.int(0, 6);
  for (let k = 0; k < count; k++) {
    // 1-3 parts, in order along the sequence, then turned so some cross the origin.
    const partCount = r.pick([1, 1, 2, 3]);
    const cuts = new Set<number>();
    while (cuts.size < partCount * 2) cuts.add(r.int(0, n - 1));
    const sorted = [...cuts].sort((a, b) => a - b);
    const shift = circular ? r.int(0, n - 1) : 0;
    const parts = Array.from({ length: partCount }, (_, i) => ({ start: (sorted[2 * i] + shift) % n, end: (sorted[2 * i + 1] + shift) % n }));
    const f: SeqFeature = { id: `f${k}`, name: `f${k}`, type: "misc_feature", start: parts[0].start, end: parts[parts.length - 1].end, strand: r.pick([1, -1, 0] as const), notes: {}, raw: {} };
    if (parts.length > 1) f.locations = parts;
    features.push(f);
  }
  const primers = Array.from({ length: r.int(0, 3) }, (_, k) => {
    const start = r.int(0, n - 1);
    const end = Math.min(n - 1, start + r.int(0, 20));
    return { id: `p${k}`, name: `p${k}`, start, end, strand: r.pick([1, -1] as const), bases: "", notes: {}, raw: {} };
  });
  return { name: "t", description: "", circular, sequence: randomBases(r, n), features, primers, sources: [] };
}

/** Every annotation, as the identities of the bases it covers (parts joined in order). */
function covered(d: SeqData, ids: number[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const a of [...d.features, ...d.primers]) out.set(a.id, partsOf(a).flatMap(p => positions(p, d.sequence.length).map(i => ids[i])));
  return out;
}

/** Each part as the identities of its bases. */
const partIds = (a: { start: number; end: number; locations?: Range[] }, ids: number[]) => partsOf(a).map(p => positions(p, ids.length).map(i => ids[i]));

let nextId = 1_000_000;

/** New bases join a part only when they land between two of its bases. */
const withInsert = (parts: number[][], left: number, right: number, fresh: number[]) =>
  parts.map(part => {
    const i = part.findIndex((id, k) => id === left && part[k + 1] === right);
    return i < 0 ? part : [...part.slice(0, i + 1), ...fresh, ...part.slice(i + 1)];
  });

/** Applies a random edit to both the document and the identity model; returns what each annotation should cover. */
function randomEdit(r: R, d: SeqData, ids: number[]): { data: SeqData; ids: number[]; expected: Map<string, number[] | null>; what: string } {
  const n = d.sequence.length;
  const before = [...d.features, ...d.primers];
  const kinds = ["insert", "delete", "replace", "revcomp", ...(d.circular ? ["origin"] : [])];
  const kind = r.pick(kinds);
  const expected = new Map<string, number[] | null>();

  if (kind === "insert") {
    const p = r.int(0, n);
    const bases = randomBases(r, r.int(1, 8));
    const fresh = Array.from(bases, () => nextId++);
    const left = ids[(p - 1 + n) % n];
    const right = ids[p % n];
    for (const a of before) expected.set(a.id, withInsert(partIds(a, ids), left, right, fresh).flat());
    return { data: insertBases(d, p, bases), ids: [...ids.slice(0, p), ...fresh, ...ids.slice(p)], expected, what: `insert ${bases} at ${p}` };
  }

  if (kind === "delete" || kind === "replace") {
    let range: Range = { start: r.int(0, n - 1), end: 0 };
    range.end = Math.min(n - 1, range.start + r.int(0, Math.max(0, n - 2)));
    if (d.circular && r.next() < 0.3) range = { start: r.int(1, n - 1), end: r.int(0, n - 2) };
    if (range.start > range.end && !d.circular) range = { start: range.end, end: range.start };
    const gone = new Set(positions(range, n).map(i => ids[i]));
    if (gone.size >= n) return randomEdit(r, d, ids); // keep at least one base
    const kept = ids.filter(id => !gone.has(id));
    const remaining = new Map(before.map(a => [a.id, partIds(a, ids).map(part => part.filter(id => !gone.has(id))).filter(p => p.length)]));
    if (kind === "delete") {
      for (const [id, parts] of remaining) expected.set(id, parts.length ? parts.flat() : null);
      return { data: deleteRange(d, range), ids: kept, expected, what: `delete ${range.start}..${range.end}` };
    }
    // Replace = delete, then insert where the range was (at the end for a range across the origin).
    const bases = randomBases(r, r.int(1, 6));
    const res = replaceRange(d, range, bases);
    const at = range.start > range.end ? kept.length : range.start;
    const fresh = Array.from(bases, () => nextId++);
    const m = kept.length;
    for (const [id, parts] of remaining) expected.set(id, parts.length ? withInsert(parts, kept[(at - 1 + m) % m], kept[at % m], fresh).flat() : null);
    return { data: res.data, ids: [...kept.slice(0, at), ...fresh, ...kept.slice(at)], expected, what: `replace ${range.start}..${range.end} with ${bases}` };
  }

  if (kind === "origin") {
    const p = r.int(0, n - 1);
    for (const a of before) expected.set(a.id, partIds(a, ids).flat());
    return { data: setOrigin(d, p), ids: [...ids.slice(p), ...ids.slice(0, p)], expected, what: `origin at ${p}` };
  }

  // Reverse-complement the whole sequence or a stretch of it.
  const whole = r.next() < 0.3;
  const a0 = r.int(0, n - 1);
  const range = whole ? null : { start: a0, end: Math.min(n - 1, a0 + r.int(0, n)) };
  const lo = range ? range.start : 0;
  const hi = range ? range.end : n - 1;
  const newIds = [...ids.slice(0, lo), ...ids.slice(lo, hi + 1).reverse(), ...ids.slice(hi + 1)];
  for (const a of before) {
    const inside = !range || partsOf(a).every(p => p.start <= p.end) && a.start <= a.end && a.start >= lo && a.end <= hi;
    // Inside: the same bases, read from the other strand. Outside: same place, whatever is there now.
    expected.set(a.id, inside ? partIds(a, ids).flat().reverse() : partsOf(a).flatMap(p => positions(p, n).map(i => newIds[i])));
  }
  return { data: reverseComplementRange(d, range), ids: newIds, expected, what: range ? `reverse-complement ${lo}..${hi}` : "reverse-complement all" };
}

function checkValid(d: SeqData, what: string) {
  const n = d.sequence.length;
  for (const a of [...d.features, ...d.primers]) {
    for (const p of partsOf(a)) {
      assert.ok(p.start >= 0 && p.start < n && p.end >= 0 && p.end < n, `${what}: ${a.id} ${p.start}..${p.end} outside 0..${n - 1}`);
      if (!d.circular) assert.ok(p.start <= p.end, `${what}: ${a.id} crosses the origin of a linear sequence`);
    }
    if ("locations" in a && a.locations) {
      assert.ok(a.locations.length > 1, `${what}: ${a.id} has a single listed part`);
      assert.equal(a.start, a.locations[0].start, `${what}: ${a.id} start isn't its first part's`);
      assert.equal(a.end, a.locations[a.locations.length - 1].end, `${what}: ${a.id} end isn't its last part's`);
    }
  }
}

test("random edits keep every annotation on its own bases", () => {
  for (let seed = 1; seed <= 3000; seed++) {
    const r = rng(seed);
    const d = randomDoc(r);
    const ids = Array.from(d.sequence, (_, i) => i);
    const { data, ids: after, expected, what } = randomEdit(r, d, ids);
    const label = `seed ${seed}: ${what}`;
    assert.equal(data.sequence.length, after.length, `${label}: length`);
    checkValid(data, label);
    const actual = covered(data, after);
    for (const [id, want] of expected) {
      if (want === null) assert.ok(!actual.has(id), `${label}: ${id} should be gone`);
      else assert.deepEqual(actual.get(id), want, `${label}: ${id}`);
    }
  }
});

test("chains of random edits stay valid and undo all the way back", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const r = rng(seed * 7919);
    const start = randomDoc(r);
    const store = new DocStore(start);
    let d = start;
    let ids = Array.from(d.sequence, (_, i) => i);
    const steps: SeqData[] = [d];
    for (let k = 0; k < 12; k++) {
      const e = randomEdit(r, d, ids);
      checkValid(e.data, `seed ${seed} step ${k}: ${e.what}`);
      const actual = covered(e.data, e.ids);
      for (const [id, want] of e.expected) if (want !== null) assert.deepEqual(actual.get(id), want, `seed ${seed} step ${k}: ${e.what}: ${id}`);
      // An edit that changes nothing (e.g. the origin "moved" to 1) isn't an undo step.
      if (e.data !== d) steps.push(e.data);
      d = e.data;
      ids = e.ids;
      store.apply(d, e.what);
    }
    for (let k = steps.length - 2; k >= 0; k--) {
      store.undo();
      assert.equal(store.data, steps[k], `seed ${seed}: undo to step ${k}`);
    }
    assert.ok(!store.dirty, `seed ${seed}: back to the saved state`);
    while (store.canRedo) store.redo();
    assert.equal(store.data, d, `seed ${seed}: redo to the end`);
  }
});

test("cut sites updated around an edit match a full search", () => {
  const SITES = ["GAATTC", "GGATCC", "GGTCTC", "GAGACC", "GCTCTTC", "GCCNNNNNGGC", "GAANNNNTTC", "CGTCTC", "GAAGAC", "GCGGCCGC", "CTGCAG", "AAGCTT"];
  const key = (h: SiteHit) => `${h.enzyme}|${h.start}|${h.end}|${h.cut}|${h.bottomCut}|${h.forward}|${h.overhang}`;
  for (let seed = 1; seed <= 400; seed++) {
    const r = rng(seed * 104729);
    // Random DNA with recognition sites sprinkled in (N filled at random).
    let seq = randomBases(r, r.int(200, 2500));
    for (let k = r.int(3, 25); k > 0; k--) {
      const site = r.pick(SITES).replace(/N/g, () => r.pick(["A", "C", "G", "T"]));
      const at = r.int(0, seq.length);
      seq = seq.slice(0, at) + site + seq.slice(at);
    }
    const circular = r.next() < 0.6;
    let state = { sequence: seq, circular, hits: scanSites(seq, circular) };
    for (let step = 0; step < 6; step++) {
      const n = state.sequence.length;
      // Often near either end, where a circular sequence wraps round.
      const at = r.pick([r.int(0, n - 1), r.int(0, 60), r.int(Math.max(0, n - 60), n - 1)]);
      const kind = r.pick(["insert", "delete", "site"]);
      let next: string;
      if (kind === "delete") next = state.sequence.slice(0, at) + state.sequence.slice(Math.min(n, at + r.int(1, 12)));
      else next = state.sequence.slice(0, at) + (kind === "site" ? r.pick(SITES).replace(/N/g, "A") : randomBases(r, r.int(1, 10))) + state.sequence.slice(at);
      const quick = rescanSites(state, next, circular).map(key).sort();
      const full = scanSites(next, circular);
      assert.deepEqual(quick, full.map(key).sort(), `seed ${seed} step ${step}: ${kind} at ${at} (${circular ? "circular" : "linear"}, ${n} bp)`);
      state = { sequence: next, circular, hits: full };
    }
  }
});
