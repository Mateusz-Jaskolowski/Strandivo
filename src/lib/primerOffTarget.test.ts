// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TM,
  findBindingSites,
  findPartialOffTargetSites,
  meltingTemp,
  PARTIAL_SITE_MIN_TM,
  PARTIAL_SITE_SEED,
  PARTIAL_SITE_TM_DROP,
  primerReport,
  useTmSettings,
  type TmMethod
} from "./primers.ts";
import { reverseComplement } from "./seqdata.ts";

const METHODS: TmMethod[] = ["santalucia", "neb", "breslauer", "wallace", "basic"];

// Non-repetitive AT-balanced spacer with no accidental seed matches.
const PAD = "ATATAATTTGCTACGATCATTTAGCTGACTATTTCAGTCGATTTCTACGTATTTTGTAGCTGAT";

test("exact contiguous 3′ partial off-target is detected across all 5 Tm methods", () => {
  // Non-palindromic, non-repetitive 20 bp primer with a GC-rich 14 bp 3′ stretch.
  const primer = "ATATTAGCTGACCGCGTCCG";
  const tail3 = primer.slice(-14); // GCTGACCGCGTCCG (14 bp)
  assert.notEqual(primer[primer.length - 15], "T");
  const offTarget = "T" + tail3;
  const seq = PAD + primer + PAD + offTarget + PAD;

  try {
    for (const method of METHODS) {
      useTmSettings({ ...DEFAULT_TM, method });
      const primary = findBindingSites(primer, seq, false);
      assert.equal(primary.length, 1, `${method}: only 1 primary binding site`);
      const primaryTm = primary[0].tm;
      assert.ok(primaryTm !== null, `${method}: primary site carries exact Tm`);

      const partials = findPartialOffTargetSites(primer, seq, false, primary, primaryTm);
      const expectedTm = meltingTemp(tail3)!;
      const floor = Math.max(PARTIAL_SITE_MIN_TM, primaryTm - PARTIAL_SITE_TM_DROP);
      if (expectedTm >= floor) {
        assert.equal(partials.length, 1, `${method}: detects exact 14 bp 3′ partial hit`);
        assert.equal(partials[0].length, 14, `${method}: stops at the first mismatch`);
        assert.equal(partials[0].strand, 1, `${method}: forward strand`);
        assert.equal(partials[0].tm, expectedTm, `${method}: exact Tm of contiguous matched run`);
      } else {
        assert.equal(partials.length, 0, `${method}: below relative floor is not flagged`);
      }
    }
  } finally {
    useTmSettings(DEFAULT_TM);
  }
});

test("relative Tm threshold max(45 °C, primaryTm - 15 °C) filters weak partial hits", () => {
  useTmSettings(DEFAULT_TM);
  // Non-repetitive 22 bp primer with high primary Tm (~65 °C, so floor ~50 °C).
  const highPrimer = "CTGGACGTGCCTGACCGCGTCC";
  const highTm = meltingTemp(highPrimer)!;
  assert.ok(highTm > 62, `expected high primary Tm, got ${highTm}`);
  const floor = Math.max(PARTIAL_SITE_MIN_TM, highTm - PARTIAL_SITE_TM_DROP);

  // 10 bp 3′ match: well below floor -> NOT flagged.
  const weak3 = highPrimer.slice(-10);
  const weakTm = meltingTemp(weak3)!;
  assert.ok(weakTm < floor, `weakTm ${weakTm} should sit below relative floor ${floor}`);

  // 14 bp 3′ match: above floor -> SHOULD be flagged.
  const strong3 = highPrimer.slice(-14);
  const strongTm = meltingTemp(strong3)!;
  assert.ok(strongTm >= floor, `strongTm ${strongTm} should meet relative floor ${floor}`);

  const seqWeakOnly = PAD + highPrimer + PAD + "A" + weak3 + PAD;
  const primary1 = findBindingSites(highPrimer, seqWeakOnly, false);
  assert.equal(findPartialOffTargetSites(highPrimer, seqWeakOnly, false, primary1, highTm).length, 0);

  const seqStrong = PAD + highPrimer + PAD + "A" + strong3 + PAD;
  const primary2 = findBindingSites(highPrimer, seqStrong, false);
  const hits = findPartialOffTargetSites(highPrimer, seqStrong, false, primary2, highTm);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].length, 14);
  assert.equal(hits[0].tm, strongTm);
});

test("strictly contiguous exact 3′ match stops at the first mismatch (no mismatch bridging)", () => {
  useTmSettings(DEFAULT_TM);
  const primer = "CATGGCTAGCTGACCGCGTCCG"; // 22 bp, non-repetitive
  // Break match 11 bases from the 3′ end (even though 10 bases 5′ of the break also match).
  const idx = primer.length - 12;
  const broken = primer.slice(0, idx) + (primer[idx] === "A" ? "T" : "A") + primer.slice(idx + 1);
  const seq = PAD + primer + PAD + broken + PAD;
  const primary = findBindingSites(primer, seq, false);
  assert.equal(primary.length, 1);
  const hits = findPartialOffTargetSites(primer, seq, false, primary, 55);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].length, 11, "must stop strictly at the first mismatch without bridging");
  assert.equal(hits[0].tm, meltingTemp(primer.slice(-11)));
});

test("circular wrap-around finds partial 3′ off-targets on both strands across origin", () => {
  useTmSettings(DEFAULT_TM);
  const primer = "ATATTAGCTGACCGCGTCCG"; // 20 bp, non-palindromic
  const match14 = primer.slice(-14); // GCTGACCGCGTCCG
  const rc14 = reverseComplement(match14);
  // Forward partial hit straddling the circular origin (7 bp at end, 7 bp at start).
  const seqFwd = match14.slice(7) + PAD + primer + PAD + "T" + match14.slice(0, 7);
  const primaryFwd = findBindingSites(primer, seqFwd, true);
  assert.equal(primaryFwd.length, 1);
  const hitsFwd = findPartialOffTargetSites(primer, seqFwd, true, primaryFwd, primaryFwd[0].tm);
  assert.ok(hitsFwd.some(h => h.strand === 1 && h.start > h.end && h.length === 14), "finds origin-wrapping forward partial site");

  // Reverse-strand partial hit straddling the origin.
  const seqRev = rc14.slice(7) + "A" + PAD + primer + PAD + rc14.slice(0, 7);
  const primaryRev = findBindingSites(primer, seqRev, true);
  assert.equal(primaryRev.length, 1);
  const hitsRev = findPartialOffTargetSites(primer, seqRev, true, primaryRev, primaryRev[0].tm);
  assert.ok(hitsRev.some(h => h.strand === -1 && h.start > h.end && h.length === 14), "finds origin-wrapping reverse partial site");
});

test("deduplicates against primary sites and stored mutagenic site, and wires into primerReport().checks", () => {
  useTmSettings(DEFAULT_TM);
  const primer = "ATATTAGCTGACCGCGTCCG";
  const match14 = primer.slice(-14);
  const seq = PAD + primer + PAD + "T" + match14 + PAD;
  const start = PAD.length;
  const end = start + primer.length - 1;

  // Report includes both partialSites and a matching warning in checks, while primary sites stays 1.
  const report = primerReport(primer, primer.length, seq, false, null, { start, end, strand: 1 });
  assert.equal(report.sites, 1);
  assert.equal(report.siteList.length, 1);
  assert.equal(report.partialSites.length, 1);
  const warn = report.checks.find(c => c.short === "Partial off-target");
  assert.ok(warn && warn.level === "warn", "warning check present for partial off-target");
  assert.match(warn.text, /Partial 3′ match at/);

  // Mutagenic primer whose stored site has a mismatch 13 bp from 3′ end (absent from findBindingSites)
  // must NOT flag its own stored site as a partial off-target!
  const mutPrimer = "ATATTAGCTGACCGCGTCCG";
  const mutTemplate = "ATATTACCTGACCGCGTCCG"; // 1 mismatch at index 6; last 13 bases match exactly
  const mutSeq = PAD + mutTemplate + PAD;
  const mutSite = { start: PAD.length, end: PAD.length + mutTemplate.length - 1, strand: 1 as const };
  assert.equal(findBindingSites(mutPrimer, mutSeq, false).length, 0);
  const partials = findPartialOffTargetSites(mutPrimer, mutSeq, false, [], 55, mutSite);
  assert.equal(partials.length, 0, "stored mutagenic site is never flagged as a partial off-target");

  // Shorter than PARTIAL_SITE_SEED returns empty.
  assert.equal(findPartialOffTargetSites("ACGTACG", seq, false, [], 50).length, 0);
  assert.equal(PARTIAL_SITE_SEED, 8);
});
