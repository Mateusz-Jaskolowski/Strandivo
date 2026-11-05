// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Extending and trimming primers. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { resizePrimer, MIN_BINDING } from "./primerEdit.ts";
import { findBindingSites } from "./primers.ts";
import { basesIn, reverseComplement, type SeqPrimer } from "./seqdata.ts";

const template = "TTGACCGTAAGCTTGCAGGCATGCAAGCTTGGCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCG";
const primer = (start: number, end: number, strand: 1 | -1, tail = ""): SeqPrimer => {
  const site = basesIn(template, { start, end });
  return { id: "p", name: "P", start, end, strand, bases: tail + (strand === 1 ? site : reverseComplement(site)), notes: {}, raw: {} };
};
// The primer still binds where it says: same 3′ end, at least the bases it claims (a tail
// base may happen to pair too).
const binds = (p: SeqPrimer, circular = false) => {
  const s = findBindingSites(p.bases, template, circular)[0];
  if (!s || s.strand !== p.strand) return false;
  return p.strand === 1 ? s.end === p.end && s.length >= p.end - p.start + 1 : s.start === p.start && s.length >= p.end - p.start + 1;
};

test("forward primer: 3′ end on the right, 5′ end on the left", () => {
  const p = primer(10, 29, 1, "gcgc".toUpperCase());
  const longer3 = resizePrimer(p, template, false, 0, 2)!;
  assert.deepEqual([longer3.start, longer3.end], [10, 31]);
  assert.equal(longer3.bases, "GCGC" + template.slice(10, 32));
  const shorter5 = resizePrimer(p, template, false, -3, 0)!;
  assert.deepEqual([shorter5.start, shorter5.end], [13, 29]);
  assert.equal(shorter5.bases, "GCGC" + template.slice(13, 30));
  assert.ok(binds(longer3) && binds(shorter5));
});

test("reverse primer: 3′ end on the left, 5′ end on the right", () => {
  const p = primer(40, 59, -1, "GGGG");
  const longer3 = resizePrimer(p, template, false, 0, 2)!;
  assert.deepEqual([longer3.start, longer3.end], [38, 59]);
  assert.equal(longer3.bases, "GGGG" + reverseComplement(template.slice(38, 60)));
  const longer5 = resizePrimer(p, template, false, 1, 0)!;
  assert.deepEqual([longer5.start, longer5.end], [40, 60]);
  assert.equal(longer5.bases, "GGGG" + reverseComplement(template.slice(40, 61)));
  const shorter3 = resizePrimer(p, template, false, 0, -2)!;
  assert.deepEqual([shorter3.start, shorter3.end], [42, 59]);
  assert.ok(binds(longer3) && binds(longer5) && binds(shorter3));
});

test("a mismatch in the primer stays where it was", () => {
  const p = primer(10, 29, 1);
  const mutated = { ...p, bases: p.bases.slice(0, 5) + (p.bases[5] === "A" ? "C" : "A") + p.bases.slice(6) };
  const longer = resizePrimer(mutated, template, false, 2, 1)!;
  assert.equal(longer.bases.slice(2, -1), mutated.bases);
});

test("limits: too short, past a linear end, and across the origin of a circle", () => {
  const p = primer(0, 19, 1);
  assert.equal(resizePrimer(p, template, false, 1, 0), null);
  assert.equal(resizePrimer(p, template, false, 0, -(20 - MIN_BINDING + 1)), null);
  const across = resizePrimer(p, template, true, 3, 0)!;
  assert.deepEqual([across.start, across.end], [template.length - 3, 19]);
  assert.equal(across.bases, template.slice(-3) + template.slice(0, 20));
  assert.ok(binds(across, true));
});

test("resizing a mutagenic primer keeps its changes until trimming reaches them", () => {
  const site = template.slice(10, 40);
  const p: SeqPrimer = { id: "m", name: "M", start: 10, end: 39, strand: 1, bases: "GG" + site.slice(0, 12) + "CAC" + site.slice(12), notes: {}, raw: {} };
  // The inserted bases and the tail stay as the 3′ end moves.
  const longer = resizePrimer(p, template, false, 0, 2)!;
  assert.equal(longer.bases, "GG" + site.slice(0, 12) + "CAC" + site.slice(12) + template.slice(40, 42));
  assert.deepEqual([longer.start, longer.end], [10, 41]);
  // Trimming the 5′ end takes bases before the insertion first, then the insertion with them.
  const shorter = resizePrimer(p, template, false, -12, 0)!;
  assert.deepEqual([shorter.start, shorter.end], [22, 39]);
  assert.equal(shorter.bases.slice(-site.slice(12).length), site.slice(12));
  const sub: SeqPrimer = { ...p, bases: site.slice(0, 5) + (site[5] === "A" ? "C" : "A") + site.slice(6) };
  const trimmed = resizePrimer(sub, template, false, -6, 0)!;
  assert.equal(trimmed.bases, site.slice(6));
  assert.deepEqual([trimmed.start, trimmed.end], [16, 39]);
});
