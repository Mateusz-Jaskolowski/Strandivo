// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  basesIn,
  deleteRange,
  featureGaps,
  inRange,
  insertBases,
  rangeLength,
  rangeWithin,
  replaceRange,
  reverseComplement,
  reverseComplementRange,
  setOrigin,
  withSpan,
  type SeqData,
  type SeqFeature
} from "./seqdata.ts";
import { changesText, crossDimer, DEFAULT_TM, findBindingSites, placeEdited, gcContent, hasGoodClamp, longestRun, meltingTemp, primerReport, selectionTmText, tailMatches, threePrimeComplementarity, tmLabel, useTmSettings } from "./primers.ts";
import { findCutSites, overhangText } from "./enzymes.ts";
import { alignPrimer } from "./primerAlign.ts";

const feat = (id: string, start: number, end: number): SeqFeature => ({ id, name: id, type: "misc_feature", start, end, strand: 1, notes: {}, raw: {} });
const doc = (sequence: string, features: SeqFeature[], circular = true): SeqData => ({ name: "t", description: "", circular, sequence, features, primers: [], sources: [] });

test("ranges, including ones across the origin", () => {
  assert.equal(rangeLength({ start: 2, end: 5 }, 10), 4);
  assert.equal(rangeLength({ start: 8, end: 1 }, 10), 4);
  assert.ok(inRange({ start: 8, end: 1 }, 9));
  assert.ok(inRange({ start: 8, end: 1 }, 0));
  assert.ok(!inRange({ start: 8, end: 1 }, 5));
  assert.equal(basesIn("ABCDEFGHIJ", { start: 8, end: 1 }), "IJAB");
  assert.ok(rangeWithin({ start: 9, end: 0 }, { start: 8, end: 1 }, 10));
  assert.ok(!rangeWithin({ start: 2, end: 3 }, { start: 8, end: 1 }, 10));
  assert.ok(rangeWithin({ start: 3, end: 4 }, { start: 2, end: 6 }, 10));
});

test("inserting bases shifts and stretches annotations", () => {
  const d = doc("AAAAACCCCCGGGGG", [feat("before", 0, 3), feat("over", 3, 8), feat("after", 10, 12)]);
  const out = insertBases(d, 5, "TT");
  assert.equal(out.sequence, "AAAAATTCCCCCGGGGG");
  const by = Object.fromEntries(out.features.map(f => [f.id, [f.start, f.end]]));
  assert.deepEqual(by.before, [0, 3]);
  assert.deepEqual(by.over, [3, 10]); // the insert is inside it
  assert.deepEqual(by.after, [12, 14]);
  // Inserting right at a feature's start moves it rather than stretching it.
  assert.deepEqual(insertBases(d, 10, "T").features.find(f => f.id === "after")!.start, 11);
});

test("deleting bases trims, shifts or removes annotations", () => {
  const d = doc("0123456789ABCDE", [feat("inside", 5, 6), feat("left", 2, 5), feat("right", 6, 10), feat("after", 12, 14)]);
  const out = deleteRange(d, { start: 4, end: 7 });
  assert.equal(out.sequence, "012389ABCDE");
  const by = Object.fromEntries(out.features.map(f => [f.id, [f.start, f.end]]));
  assert.equal(by.inside, undefined);
  assert.deepEqual(by.left, [2, 3]);
  assert.deepEqual(by.right, [4, 6]);
  assert.deepEqual(by.after, [8, 10]);
});

test("edits around the origin of a circular sequence", () => {
  // A feature across the origin: bases 8,9,0,1.
  const d = doc("0123456789", [feat("wrap", 8, 1)]);
  const ins = insertBases(d, 9, "X");
  assert.equal(ins.sequence, "012345678X9");
  assert.deepEqual([ins.features[0].start, ins.features[0].end], [8, 1]);
  const ins0 = insertBases(d, 1, "Y");
  assert.deepEqual([ins0.features[0].start, ins0.features[0].end], [9, 2]);
  // Deleting the part before the origin leaves the part after it.
  const del = deleteRange(d, { start: 7, end: 9 });
  assert.equal(del.sequence, "0123456");
  assert.deepEqual([del.features[0].start, del.features[0].end], [0, 1]);
  // Deleting a range that itself crosses the origin.
  const both = deleteRange(d, { start: 9, end: 0 });
  assert.equal(both.sequence, "12345678");
  assert.deepEqual([both.features[0].start, both.features[0].end], [7, 0]);
  assert.equal(deleteRange(d, { start: 8, end: 1 }).features.length, 0);
});

test("replacing a selection", () => {
  const d = doc("AAAACCCCGGGG", [feat("c", 4, 7), feat("g", 8, 11)]);
  const r = replaceRange(d, { start: 4, end: 7 }, "TT");
  assert.equal(r.data.sequence, "AAAATTGGGG");
  assert.deepEqual(r.inserted, { start: 4, end: 5 });
  assert.equal(r.caret, 6);
  assert.deepEqual(r.data.features.map(f => f.id), ["g"]);
  assert.deepEqual([r.data.features[0].start, r.data.features[0].end], [6, 9]);
});

test("other Tm methods match primer3 and the textbook formulas", () => {
  // primer3-py calc_tm(tm_method="breslauer", salt_corrections_method="schildkraut").
  const breslauer = { ...DEFAULT_TM, method: "breslauer" as const };
  assert.equal(meltingTemp("GTAAAACGACGGCCAGT", breslauer)!.toFixed(1), "63.0");
  assert.equal(meltingTemp("CAGGAAACAGCTATGAC", breslauer)!.toFixed(1), "54.7");
  assert.equal(meltingTemp("ATGAGTATTCAACATTTCCGTGTCG", breslauer)!.toFixed(1), "71.9");
  const noMg = { ...breslauer, divalent: 0, dntp: 0, primer: 250 };
  assert.equal(meltingTemp("GTAAAACGACGGCCAGT", noMg)!.toFixed(1), "57.3");
  assert.equal(meltingTemp("ATGAGTATTCAACATTTCCGTGTCG", noMg)!.toFixed(1), "65.6");
  // 2 °C per A/T and 4 °C per G/C; the basic formula falls back to it below 14 bases.
  assert.equal(meltingTemp("GTAAAACGACGGCCAGT", { ...DEFAULT_TM, method: "wallace" }), 52);
  assert.equal(meltingTemp("ACGTACGTAC", { ...DEFAULT_TM, method: "basic" }), 30);
  assert.equal(meltingTemp("GTAAAACGACGGCCAGT", { ...DEFAULT_TM, method: "basic" })!.toFixed(1), "47.1");
  // Without settings, meltingTemp follows the method a window chose.
  useTmSettings({ ...DEFAULT_TM, method: "wallace" });
  assert.equal(meltingTemp("GTAAAACGACGGCCAGT"), 52);
  assert.equal(tmLabel(), "Wallace rule");
  useTmSettings(DEFAULT_TM);
  assert.equal(tmLabel(), "SantaLucia 1998 · 50 mM Na⁺ · 1.5 mM Mg²⁺ · 50 nM primer");
});

const puc19 = (): string => {
  const gb = readFileSync(new URL("../../testdata/e2e/pUC19-annotated.gb", import.meta.url), "utf8");
  return gb.split("ORIGIN")[1].replace(/[^acgtn]/gi, "").toUpperCase();
};

test("primer Tm, GC and checks match primer3-style conditions", () => {
  assert.equal(meltingTemp("GTAAAACGACGGCCAGT")!.toFixed(1), "54.7"); // M13 fwd
  assert.equal(meltingTemp("CAGGAAACAGCTATGAC")!.toFixed(1), "49.1"); // M13 rev
  assert.equal(meltingTemp("ATGAGTATTCAACATTTCCGTGTCG")!.toFixed(1), "59.9");
  assert.equal(meltingTemp("ACGTN"), null);
  // Selections: exact below 80 °C, then "> 80 °C", whatever their length.
  assert.equal(selectionTmText("GTAAAACGACGGCCAGT"), "54.7 °C");
  assert.equal(selectionTmText("ACGTACGTA"), null);
  assert.equal(selectionTmText("GTAAAACGACGGCCAGT".repeat(3)), "79.2 °C");
  assert.equal(selectionTmText("GTAAAACGACGGCCAGT".repeat(5)), "> 80 °C");
  assert.equal(selectionTmText("GTAAAACGACGGCCAGT".repeat(500)), "> 80 °C");
  assert.match(selectionTmText("AT".repeat(40))!, /^\d+\.\d °C$/);
  assert.equal(Math.round(gcContent("GGCCAATT")), 50);
  assert.equal(longestRun("GTAAAACG"), 4);
  assert.ok(hasGoodClamp("ATGAGTATTCAACATTTCCGTGTCG"));
  assert.ok(!hasGoodClamp("GGGAAACGCCTGGTATCTTT"));
  assert.equal(threePrimeComplementarity("GAATTC", "GAATTC"), 6); // palindrome
  // A cross-dimer is the self-dimer check against the other primer, either way round.
  assert.equal(crossDimer("AAAAGGGG", "AAAACCCC"), 4);
  assert.equal(crossDimer("AAAACCCC", "AAAAGGGG"), 4);
  // Only one of the two ends pairs: the pair is still reported by that end.
  assert.equal(crossDimer("TTTTTTGGGG", "CCCCTTTTTT"), 4);
  assert.equal(crossDimer("AAAAAAAA", "AAAAAAAA"), 0);
  const seq = puc19();
  const rev = primerReport("CAGGAAACAGCTATGAC", 17, seq, true);
  assert.ok(rev.checks.some(c => c.short === "Low Tm"));
  assert.equal(rev.sites, 1);
  const tailed = primerReport("gcgccatATGAGTATTCAACATTTCCGTGTCG", 25, seq, true, 60.8);
  assert.equal(tailed.tail, "GCGCCAT");
  assert.equal(tailed.tm!.toFixed(1), "59.9");
  assert.ok(tailed.checks.every(c => c.level === "ok"), JSON.stringify(tailed.checks));
});

test("a 5′ tail that matches the sequence too is reported, with where it does", () => {
  const seq = puc19();
  const site = seq.slice(1000, 1033);
  const place = (bases: string) => alignPrimer({ start: 1000, end: 1032, strand: 1, bases }, seq);
  // A 20-base tail copied from the plasmid: the 3′ end still binds once, but the tail
  // can prime where it came from.
  const copied = seq.slice(2000, 2020);
  const gibson = copied.toLowerCase() + site;
  const r = primerReport(gibson, place(gibson), seq, true);
  assert.equal(r.tail, copied);
  assert.equal(r.sites, 1);
  assert.deepEqual(r.tailSites.map(m => [m.start, m.end, m.strand, m.length]), [[2000, 2019, 1, 20]]);
  const warned = r.checks.find(c => c.short === "Tail binds");
  assert.ok(warned, JSON.stringify(r.checks));
  assert.match(warned!.text, /^20 bases of the 5′ tail also match this sequence at 2,001–2,020, so/);
  // The same bases the other way round are found on the bottom strand.
  const flipped = reverseComplement(copied).toLowerCase() + site;
  assert.deepEqual(primerReport(flipped, place(flipped), seq, true).tailSites.map(m => [m.start, m.end, m.strand]), [[2000, 2019, -1]]);
  // A tail of the primer's own making is left alone, and so is a short one.
  const made = "AAAAACCCCCGGGGGTTTTT";
  assert.deepEqual(tailMatches(made, seq, true), []);
  const clean = primerReport(made.toLowerCase() + site, place(made.toLowerCase() + site), seq, true);
  assert.ok(!clean.checks.some(c => c.short === "Tail binds"), JSON.stringify(clean.checks));
  assert.ok(clean.checks.some(c => c.text === "The 5′ tail matches nothing else here"));
  const short = seq.slice(2000, 2014).toLowerCase() + site;
  const shortReport = primerReport(short, place(short), seq, true);
  assert.deepEqual(shortReport.tailSites, []);
  assert.ok(!shortReport.checks.some(c => /tail/i.test(c.text)), JSON.stringify(shortReport.checks));
});

test("a primer's own 5′ arm beside its site is no second place to prime", () => {
  const seq = puc19();
  // An ordinary primer with ten bases inserted in the middle, as typing in the inspector or
  // Add by sequence leaves it: findBindingSites can't cross a change that big, so the site
  // covers the 3′ arm alone and the 5′ arm becomes a tail lying right beside it.
  const insert = "GAGATGGCAG";
  assert.deepEqual(tailMatches(insert.repeat(2), seq, true), []);
  for (const strand of [1, -1] as const) {
    const top = seq.slice(1480, 1500) + insert + seq.slice(1500, 1520);
    const bases = strand === 1 ? top : reverseComplement(top);
    const [site, ...rest] = findBindingSites(bases, seq, true);
    assert.equal(rest.length, 0, "the edited primer should still bind one place");
    const r = primerReport(bases, alignPrimer({ ...site, bases }, seq), seq, true, null, site);
    assert.ok(!r.checks.some(c => c.short === "Tail binds"), `${strand}: ${JSON.stringify(r.tailSites)}`);
    // Without the site there is nothing to tell the arm from a second site, so it warns:
    // that is what the views pass it for.
    assert.ok(primerReport(bases, alignPrimer({ ...site, bases }, seq), seq, true).checks.some(c => c.short === "Tail binds"));
  }
  // Bases copied from somewhere else are still reported, site or no site. Only the primer's
  // own 5′ arm is left out, so a match on a linear sequence, one on the 3′ side of the site
  // and one on the other strand all still warn, however close they lie.
  const site = { start: 1000, end: 1032, strand: 1 as const };
  const tailed = (from: number, rc = false) => {
    const copied = rc ? reverseComplement(seq.slice(from, from + 20)) : seq.slice(from, from + 20);
    return copied.toLowerCase() + seq.slice(1000, 1033);
  };
  const of = (bases: string, circular: boolean) => primerReport(bases, alignPrimer({ ...site, bases }, seq), seq, circular, null, site);
  for (const [what, bases, circular, at] of [
    ["far off, circular", tailed(2000), true, 2000],
    ["far off, linear", tailed(2000), false, 2000],
    ["just past the 3′ end, where no 5′ arm can lie", tailed(1040), true, 1040],
    ["just past the 3′ end, linear", tailed(1040), false, 1040],
    ["right before the site but on the other strand", tailed(967, true), true, 967]
  ] as const) {
    const r = of(bases, circular);
    assert.deepEqual(r.tailSites.map(m => [m.start, m.length]), [[at, 20]], what);
    assert.ok(r.checks.some(c => c.short === "Tail binds"), what);
  }
  // The arm itself, on either strand, is left out whether the template is circular or not.
  for (const circular of [true, false]) {
    const arm = { start: 1499, end: 1519, strand: 1 as const };
    const bases = seq.slice(1480, 1500) + insert + seq.slice(1500, 1520);
    const r = primerReport(bases, alignPrimer({ ...arm, bases }, seq), seq, circular, null, arm);
    assert.ok(!r.checks.some(c => c.short === "Tail binds"), `arm, circular ${circular}: ${JSON.stringify(r.tailSites)}`);
  }
});

test("an edited primer keeps its site while its bases still lie along it", () => {
  const seq = puc19();
  // What the inspector does with what was typed, so the test makes the same decision.
  const edit = (previous: { start: number; end: number; strand: 1 | -1 }, bases: string, circular = true) => {
    const place = placeEdited(previous, bases, seq, circular);
    const site = place ?? previous;
    const r = primerReport(bases, alignPrimer({ ...site, bases }, seq), seq, circular, null, site);
    return { place, warns: r.checks.some(c => c.short === "Tail binds"), tail: r.tail.length };
  };
  // A 40-base primer deleting 80 bases: far more template than the primer is long, so the
  // site it had is the only thing that says where it binds.
  for (const strand of [1, -1] as const) {
    const previous = { start: 1480, end: 1599, strand };
    const top = seq.slice(1480, 1500) + seq.slice(1580, 1600);
    const bases = strand === 1 ? top : reverseComplement(top);
    const { place, warns, tail } = edit(previous, bases);
    assert.deepEqual(place, { start: 1480, end: 1599, strand, how: "kept" }, `strand ${strand}`);
    assert.equal(tail, 0, `strand ${strand}: the 5′ arm is no tail`);
    assert.ok(!warns, `strand ${strand}`);
    // Searching for it alone lands on the 3′ arm, which is what made the arm look like a
    // second site: the site it had is what tells the two apart.
    assert.deepEqual(
      findBindingSites(bases, seq, true).map(s => [s.start, s.end, s.strand]),
      [[strand === 1 ? 1580 : 1480, strand === 1 ? 1599 : 1499, strand]],
      `strand ${strand}: searching alone finds the 3′ arm`
    );
  }
  // The same across the origin, and on a linear sequence.
  const over = { start: seq.length - 60, end: 59, strand: 1 as const };
  const overBases = seq.slice(-60, -40) + seq.slice(40, 60);
  assert.deepEqual(placeEdited(over, overBases, seq, true), { ...over, how: "kept" });
  const linear = { start: 1480, end: 1599, strand: 1 as const };
  const linearBases = seq.slice(1480, 1500) + seq.slice(1580, 1600);
  assert.deepEqual(placeEdited(linear, linearBases, seq, false), { ...linear, how: "kept" });
  // An edit that really does change where it binds still moves the site.
  const site = { start: 1000, end: 1032, strand: 1 as const };
  const moved = placeEdited(site, seq.slice(2000, 2033), seq, true);
  assert.deepEqual(moved, { start: 2000, end: 2032, strand: 1, how: "found" });
  // Adding bases at the 3′ end grows the site rather than keeping the old one.
  const grown = placeEdited(site, seq.slice(1000, 1038), seq, true);
  assert.deepEqual(grown, { start: 1000, end: 1037, strand: 1, how: "found" });
  // Taking bases off the 5′ end shortens it.
  assert.deepEqual(placeEdited(site, seq.slice(1010, 1033), seq, true), { start: 1010, end: 1032, strand: 1, how: "found" });
  // A sequence that binds nowhere leaves the site alone, as it always did.
  assert.equal(placeEdited(site, "ACGTACGTACGTACGTACGTAAAACCCCGGGGTTTT", seq, true), null);
  // A primer whose 3′ end no longer anneals is a different primer, not an edit of this one.
  assert.notDeepEqual(placeEdited(site, seq.slice(1000, 1022) + "AAAACCCCGGGGTTTTAAAA", seq, true), { ...site, how: "kept" });
});

test("tail matches are the longest ones, on either strand and across the origin", () => {
  const seq = puc19();
  // Grown past the 15-base window it was found by, and reported once.
  assert.deepEqual(tailMatches(seq.slice(500, 540), seq, true), [{ start: 500, end: 539, strand: 1, length: 40 }]);
  // A tail that spans the origin of a circular sequence, but not of a linear one.
  const over = seq.slice(-12) + seq.slice(0, 12);
  assert.deepEqual(tailMatches(over, seq, true).map(m => [m.start, m.length]), [[seq.length - 12, 24]]);
  assert.deepEqual(tailMatches(over, seq, false), []);
  // Once the part after the origin is a window of its own it is found at the template's
  // start as well; around the circle those bases lie inside the longer match, so the place
  // is reported once rather than twice.
  for (const flank of [15, 20, 40]) {
    const wide = seq.slice(-flank) + seq.slice(0, flank);
    assert.deepEqual(tailMatches(wide, seq, true).map(m => [m.start, m.length]), [[seq.length - flank, flank * 2]], `flank ${flank}`);
    assert.deepEqual(tailMatches(reverseComplement(wide), seq, true).map(m => [m.start, m.strand, m.length]), [[seq.length - flank, -1, flank * 2]], `flank ${flank} reversed`);
  }
  // Two places: the 15 bases a tail shares with both are reported for each.
  const twice = tailMatches(seq.slice(100, 120), seq.slice(100, 120) + seq.slice(100, 120), false);
  assert.deepEqual(twice.map(m => [m.start, m.length]), [[0, 20], [20, 20]]);
});

test("binding sites on both strands and across the origin", () => {
  const seq = puc19();
  const fwd = findBindingSites("GTAAAACGACGGCCAGT", seq, true);
  assert.deepEqual(fwd.map(s => [s.start, s.end, s.strand, s.length]), [[378, 394, 1, 17]]);
  const rev = findBindingSites("CAGGAAACAGCTATGAC", seq, true);
  assert.deepEqual(rev.map(s => [s.start, s.end, s.strand, s.length]), [[464, 480, -1, 17]]);
  // A 5' tail that doesn't bind is not part of the site.
  const tailed = findBindingSites("gcgccatATGAGTATTCAACATTTCCGTGTCG", seq, true);
  assert.deepEqual(tailed.map(s => [s.start, s.end, s.strand, s.length]), [[2461, 2486, -1, 26]]);
  // Across the origin of a circular sequence.
  const across = seq.slice(-10) + seq.slice(0, 10);
  const site = findBindingSites(across, seq, true);
  assert.deepEqual(site.map(s => [s.start, s.end, s.strand]), [[seq.length - 10, 9, 1]]);
  const siteRc = findBindingSites(reverseComplement(across), seq, true);
  assert.deepEqual(siteRc.map(s => [s.start, s.end, s.strand]), [[seq.length - 10, 9, -1]]);
});

test("a mutagenic primer's report: arm Tms and a change near the 3′ end", () => {
  const seq = puc19();
  const site = seq.slice(1000, 1033).toUpperCase();
  const sub = site.slice(0, 15) + "TTT" + site.slice(18);
  const a = alignPrimer({ start: 1000, end: 1032, strand: 1, bases: sub }, seq);
  const r = primerReport(sub, a, seq, true);
  assert.ok(r.arms && r.arms.tm3 !== null && r.arms.tm5 !== null);
  assert.equal(r.tm, r.arms!.tm3);
  assert.ok(!r.checks.some(c => c.short === "3′ change"), JSON.stringify(r.checks));
  // The same change two bases from the 3′ end.
  const near = site.slice(0, 30) + (site[30] === "A" ? "C" : "A") + site.slice(31);
  const b = alignPrimer({ start: 1000, end: 1032, strand: 1, bases: near }, seq);
  assert.ok(primerReport(near, b, seq, true).checks.some(c => c.short === "3′ change"));
  // Without changes the report is as before.
  const plain = primerReport(site, alignPrimer({ start: 1000, end: 1032, strand: 1, bases: site }, seq), seq, true);
  assert.equal(plain.arms, null);
  assert.equal(plain.tm, meltingTemp(site));
});

test("binding sites of mutagenic primers take in their 5′ arm", () => {
  const seq = puc19();
  const at = (start: number, end: number) => seq.slice(start, end + 1).toUpperCase();
  const sites = (bases: string) => findBindingSites(bases, seq, true).map(s => [s.start, s.end, s.strand, s.length, s.mismatches, s.insertions, s.deletions]);
  // Three bases changed in the middle: the 5′ arm beyond them still binds.
  const site = at(1000, 1032);
  const sub = site.slice(0, 15) + "TTT" + site.slice(18);
  assert.deepEqual(sites(sub), [[1000, 1032, 1, 33, [...site.slice(15, 18)].filter(c => c !== "T").length, 0, 0]]);
  // Six bases inserted between two arms.
  const ins = at(1000, 1014) + "CATCAT" + at(1015, 1032);
  assert.deepEqual(sites(ins), [[1000, 1032, 1, 39, 0, 6, 0]]);
  // Six template bases skipped.
  const del = at(1000, 1014) + at(1021, 1038);
  assert.deepEqual(sites(del), [[1000, 1038, 1, 33, 0, 0, 6]]);
  // On the other strand.
  assert.deepEqual(sites(reverseComplement(sub)), [[1000, 1032, -1, 33, [...site.slice(15, 18)].filter(c => c !== "T").length, 0, 0]]);
  assert.equal(changesText({ mismatches: 3, insertions: 0, deletions: 0 }), "3 bases changed");
  assert.equal(changesText({ mismatches: 0, insertions: 6, deletions: 1 }), "6 bases inserted, 1 deleted");
  assert.equal(changesText({ mismatches: 0, insertions: 0, deletions: 0 }), "");
  // A tail that doesn't pair stays a tail.
  assert.deepEqual(sites("GGATCCGCGGCCGC" + at(1015, 1032)), [[1015, 1032, 1, 18, 0, 0, 0]]);
});

test("unique cutters in pUC19", () => {
  const sites = findCutSites(puc19(), true, { enzymeSource: "common", enzymeFilter: "unique6", labEnzymes: [], personalEnzymes: [] });
  const at = (name: string) => sites.find(s => s.enzyme === name);
  assert.equal(at("EcoRI")!.cut, 396);
  assert.equal(at("HindIII")!.cut, 447);
  assert.equal(at("NdeI")!.start, 182);
  assert.equal(overhangText(at("EcoRI")!), "5′ overhang AATT");
  assert.equal(overhangText(at("KpnI")!), "3′ overhang GTAC");
  assert.equal(overhangText(at("SmaI")!), "Blunt end");
  assert.ok(!sites.some(s => s.enzyme === "PvuII"), "PvuII cuts twice");
  assert.ok(sites.every(s => s.cuts === 1));
});

test("moving the origin keeps every annotation on its bases", () => {
  const d = doc("ABCDEFGHIJ", [feat("mid", 2, 4), feat("wrap", 8, 1), feat("all", 0, 9)]);
  const out = setOrigin(d, 3);
  assert.equal(out.sequence, "DEFGHIJABC");
  for (const f of d.features) {
    const g = out.features.find(x => x.id === f.id)!;
    assert.equal(basesIn(out.sequence, g), basesIn(d.sequence, f), f.id);
  }
  assert.deepEqual([out.features[0].start, out.features[0].end], [9, 1]); // now crosses the origin
  assert.equal(setOrigin(d, 0), d);
});

test("reverse-complementing turns annotations round", () => {
  const d = doc("AACCGGTTTA", [feat("f", 0, 2), feat("wrap", 9, 1)]);
  const all = reverseComplementRange(d, null);
  assert.equal(all.sequence, reverseComplement("AACCGGTTTA"));
  const f = all.features.find(x => x.id === "f")!;
  assert.deepEqual([f.start, f.end, f.strand], [7, 9, -1]);
  assert.equal(reverseComplement(basesIn(all.sequence, f)), basesIn(d.sequence, d.features[0]));
  const w = all.features.find(x => x.id === "wrap")!;
  assert.deepEqual([w.start, w.end], [8, 0]);

  // Only a stretch: annotations inside turn, others stay.
  const part = reverseComplementRange(doc("AAAACCGTTT", [feat("in", 4, 5), feat("out", 0, 1), feat("across", 3, 7)]), { start: 4, end: 6 });
  assert.equal(part.sequence, "AAAACGGTTT");
  const by = Object.fromEntries(part.features.map(x => [x.id, [x.start, x.end, x.strand]]));
  assert.deepEqual(by.in, [5, 6, -1]);
  assert.deepEqual(by.out, [0, 1, 1]);
  assert.deepEqual(by.across, [3, 7, 1]);
});

test("moving the ends of a feature in parts moves its first and last part", () => {
  const f: SeqFeature = { ...feat("g", 10, 50), locations: [{ start: 10, end: 20 }, { start: 30, end: 40 }, { start: 45, end: 50 }] };
  assert.deepEqual(withSpan(f, 5, 50).locations, [{ start: 5, end: 20 }, { start: 30, end: 40 }, { start: 45, end: 50 }]);
  assert.deepEqual(withSpan(f, 15, 42).locations, [{ start: 15, end: 20 }, { start: 30, end: 42 }]);
  // Trimmed down to one part: one piece.
  assert.equal(withSpan(f, 31, 39).locations, undefined);
  assert.deepEqual([withSpan(f, 31, 39).start, withSpan(f, 31, 39).end], [31, 39]);
});

test("gaps between the parts of a feature", () => {
  const f = { start: 10, end: 50, locations: [{ start: 10, end: 20 }, { start: 21, end: 30 }, { start: 41, end: 50 }] };
  assert.deepEqual(featureGaps(f, 100), [{ start: 31, end: 40 }]);
  // Across the origin: 90…99 and 0…9 touch, 10…14 is skipped.
  assert.deepEqual(featureGaps({ start: 90, end: 20, locations: [{ start: 90, end: 99 }, { start: 0, end: 9 }, { start: 15, end: 20 }] }, 100), [{ start: 10, end: 14 }]);
  assert.deepEqual(featureGaps({ start: 0, end: 9 }, 100), []);
});
