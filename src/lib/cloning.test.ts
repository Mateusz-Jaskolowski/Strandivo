// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Cloning simulation: digests, ligation, overlap assembly and Golden Gate. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { assemblyBases, cloningDigest, compatible, cutsFor, digest, existingFragment, findOverlap, flip, fragmentDigest, fragmentWith, goldenGate, GIBSON, IN_FUSION, joinFragments, largest, ligateInsert, overlapMatches, planAssembly, selfLigates, vectorPcrRange, wholeFragment, type Fragment, type OverlapMethod } from "./cloning.ts";
import { codingPositions, useAmberSuppression } from "./genetics.ts";
import { hostMethylation } from "./methylation.ts";
import { DEFAULT_TM, meltingTemp, type TmMethod } from "./primers.ts";
import { regionsOf, regionSpans, withRegions, type ProteinRegion } from "./regions.ts";
import { basesIn, clipRange, deleteRange, featureBases, reverseComplement, setOrigin, type Range, type SeqData, type SeqFeature } from "./seqdata.ts";

const puc19 = (): string => {
  const gb = readFileSync(new URL("../../testdata/e2e/pUC19-annotated.gb", import.meta.url), "utf8");
  return gb.split("ORIGIN")[1].replace(/[^acgtn]/gi, "").toUpperCase();
};
const doc = (name: string, sequence: string, circular: boolean, features: SeqFeature[] = []): SeqData => ({ name, description: "", circular, sequence, features, primers: [], sources: [] });
const feature = (name: string, start: number, end: number, strand: 1 | -1 = 1): SeqFeature => ({ id: name, name, type: "CDS", start, end, strand, notes: {}, raw: {} });

/** The same circular sequence, whatever its origin and strand. */
function sameCircle(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const twice = b + b;
  return twice.includes(a) || twice.includes(reverseComplement(a));
}

/** Bases without sites of the enzymes these tests use, the same on every run. */
function filler(length: number, seed: number): string {
  let x = seed;
  let s = "";
  while (s.length < length) {
    x = (x * 1103515245 + 12345) % 2147483648;
    s += "ACGT"[(x >> 16) & 3];
    s = s.replace(/GGTCTC|GAGACC|GAATTC|AAGCTT|CTGCAG/g, "");
  }
  return s.slice(0, length);
}

test("EcoRI opens pUC19 once, leaving AATT on both ends", () => {
  const seq = puc19();
  const n = seq.length;
  const fs = digest(doc("pUC19", seq, true), ["EcoRI"]);
  assert.equal(fs.length, 1);
  const f = fs[0];
  assert.equal(f.data.sequence.length, n + 4);
  assert.deepEqual([f.left.kind, f.left.bases, f.right.kind, f.right.bases], ["5'", "AATT", "5'", "AATT"]);
  assert.ok(f.data.sequence.startsWith("AATTC") && f.data.sequence.endsWith("GAATT"));
  assert.ok(selfLigates(f));
});

test("a cut across the origin gives the same fragments as one away from it", () => {
  const seq = puc19();
  const e = seq.indexOf("GAATTC");
  const turned = setOrigin(doc("pUC19", seq, true), e + 3); // the site now crosses the origin
  const a = digest(doc("pUC19", seq, true), ["EcoRI", "HindIII"]).map(f => f.data.sequence).sort();
  const b = digest(turned, ["EcoRI", "HindIII"]).map(f => f.data.sequence).sort();
  assert.deepEqual(b, a);
  // PstI leaves 3′ overhangs: the fragment is the bottom strand's longer stretch.
  const p = seq.indexOf("CTGCAG");
  const [f] = digest(doc("pUC19", seq, true), ["PstI"]);
  assert.deepEqual([f.left.kind, f.left.bases], ["3'", "TGCA"]);
  assert.equal(f.source.start, p + 1);
});

test("a linear sequence keeps its own ends on the outer pieces", () => {
  const s = filler(100, 1) + "GAATTC" + filler(100, 2);
  const fs = digest(doc("lin", s, false), ["EcoRI"]);
  assert.equal(fs.length, 2);
  assert.equal(fs[0].left.kind, "blunt");
  assert.equal(fs[1].right.kind, "blunt");
  assert.equal(fs[0].data.sequence.length + fs[1].data.sequence.length, s.length + 4);
  assert.equal(cutsFor(s, false, ["HindIII"]).length, 0);
});

test("restriction cloning with two enzymes puts the insert in one way only", () => {
  const seq = puc19();
  const vector = doc("pUC19", seq, true, [feature("lacZα-ish", 100, 300)]);
  const middle = filler(600, 3);
  const insertSeq = filler(30, 4) + "GAATTC" + middle + "AAGCTT" + filler(30, 5);
  const insert = doc("insert", insertSeq, false, [feature("gene", 40, 600)]);
  const backbone = largest(digest(vector, ["EcoRI", "HindIII"]))!;
  const pieces = digest(insert, ["EcoRI", "HindIII"]);
  const piece = fragmentWith(pieces, { start: 40, end: 600 }, insertSeq.length)!;
  assert.equal(piece.source.start, 31);
  assert.ok(!selfLigates(backbone));
  const results = ligateInsert(backbone, piece);
  assert.equal(results.length, 1);
  const e = seq.indexOf("GAATTC");
  const h = seq.indexOf("AAGCTT");
  // pUC19's MCS runs HindIII…EcoRI on the top strand, so the insert goes in reversed.
  const lo = Math.min(e, h);
  const hi = Math.max(e, h);
  const ins = e < h ? "GAATTC" + middle + "AAGCTT" : reverseComplement("GAATTC" + middle + "AAGCTT");
  const expected = seq.slice(0, lo) + ins + seq.slice(hi + 6);
  assert.ok(sameCircle(results[0].product.sequence, expected));
  assert.equal(results[0].flipped, h < e);
  const product = results[0].product;
  const gene = product.features.find(f => f.name === "gene")!;
  const geneBases = insertSeq.slice(40, 601);
  assert.equal(featureBases(product.sequence, gene), results[0].flipped ? reverseComplement(geneBases) : geneBases);
  assert.equal(gene.strand, results[0].flipped ? -1 : 1);
  assert.ok(product.features.some(f => f.name === "lacZα-ish"));
  assert.equal(new Set(product.features.map(f => f.id)).size, product.features.length);
});

test("one enzyme or blunt ends ligate both ways round", () => {
  const seq = puc19();
  const backbone = digest(doc("pUC19", seq, true), ["EcoRI"])[0];
  const insert = digest(doc("ins", filler(20, 6) + "GAATTC" + filler(300, 7) + "GAATTC" + filler(20, 8), false), ["EcoRI"])[1];
  const both = ligateInsert(backbone, insert);
  assert.equal(both.length, 2);
  assert.deepEqual(both.map(r => r.flipped), [false, true]);
  assert.equal(both[0].product.sequence.length, seq.length + 300 + 6);
  // Blunt PCR product into SmaI.
  const smaVector = digest(doc("pUC19", seq, true), ["SmaI"])[0];
  assert.equal(smaVector.left.kind, "blunt");
  assert.equal(ligateInsert(smaVector, wholeFragment(doc("pcr", filler(200, 9), false))).length, 2);
  // Incompatible ends don't join.
  assert.ok(!compatible(backbone.right, flip(digest(doc("p", seq, true), ["PstI"])[0]).left));
});

test("automatic insert selection requires a unique fragment carrying the whole region in order", () => {
  const sequence = "A".repeat(50) + "GAATTC" + "C".repeat(80) + "AAGCTT" + "G".repeat(60);
  const vector = doc("donor", sequence, true);
  const pieces = digest(vector, ["EcoRI", "HindIII"]);
  assert.equal(fragmentWith(pieces, { start: 180, end: 30 }, sequence.length), pieces[1]);
  assert.equal(fragmentWith(pieces, { start: 25, end: 90 }, sequence.length), null);
  assert.equal(fragmentWith(pieces, { start: 51, end: 54 }, sequence.length), null);
  const opened = digest(vector, ["EcoRI"]);
  assert.equal(fragmentWith(opened, { start: 35, end: 80 }, sequence.length), null);
});

test("In-Fusion: 15 bases of each vector end go on the insert's primers", () => {
  const seq = puc19();
  const backbone = largest(digest(doc("pUC19", seq, true), ["EcoRI", "HindIII"]))!;
  const template = doc("template", filler(1000, 10), false);
  const range = { start: 200, end: 799 };
  const plan = planAssembly(
    [
      { name: "pUC19", fragment: backbone },
      { name: "gene", fragment: wholeFragment(template, range), pcr: { template, range } }
    ],
    IN_FUSION
  );
  assert.deepEqual(plan.problems, []);
  const [fwd, rev] = plan.pieces[1].primers;
  assert.equal(fwd.tail, 15);
  assert.equal(rev.tail, 15);
  const bb = backbone.data.sequence;
  assert.equal(fwd.bases.slice(0, 15).toUpperCase(), bb.slice(-15));
  assert.equal(rev.bases.slice(0, 15).toUpperCase(), reverseComplement(bb.slice(0, 15)));
  assert.ok(plan.joins.every(j => j.designed && j.bases.length === 15));
  // The vector's overhang bases stay; the insert lies between them.
  const product = plan.product!;
  assert.ok(sameCircle(product.sequence, bb + template.sequence.slice(200, 800)));
  assert.equal(product.primers.length, 2);
});

test("Gibson: two PCR pieces share the overlap's halves; existing overlaps are used as they are", () => {
  const a = doc("A", filler(1500, 11), false);
  const b = doc("B", filler(900, 12), false);
  const ra = { start: 100, end: 1399 };
  const rb = { start: 50, end: 849 };
  const plan = planAssembly(
    [
      { name: "vec", fragment: wholeFragment(a, ra), pcr: { template: a, range: ra } },
      { name: "ins", fragment: wholeFragment(b, rb), pcr: { template: b, range: rb } }
    ],
    GIBSON
  );
  assert.equal(plan.pieces[0].primers[1].tail, 10);
  assert.equal(plan.pieces[1].primers[0].tail, 10);
  assert.equal(plan.joins[0].bases.length, 20);
  assert.ok(sameCircle(plan.product!.sequence, a.sequence.slice(100, 1400) + b.sequence.slice(50, 850)));
  // In-Fusion with both amplified: all 15 bases of each overlap on the insert's primers.
  const inf = planAssembly(
    [
      { name: "vec", fragment: wholeFragment(a, ra), pcr: { template: a, range: ra } },
      { name: "ins", fragment: wholeFragment(b, rb), pcr: { template: b, range: rb } }
    ],
    IN_FUSION
  );
  assert.deepEqual(inf.pieces.map(p => p.primers.map(x => x.tail)), [[0, 0], [15, 15]]);
  assert.ok(sameCircle(inf.product!.sequence, a.sequence.slice(100, 1400) + b.sequence.slice(50, 850)));

  // Synthetic fragments that already overlap by 25 bases, assembled as they are (linear).
  const x = filler(400, 13);
  const y = x.slice(-25) + filler(300, 14);
  const asIs = planAssembly(
    [
      { name: "x", fragment: wholeFragment(doc("x", x, false)) },
      { name: "y", fragment: wholeFragment(doc("y", y, false)) }
    ],
    GIBSON,
    false
  );
  assert.equal(asIs.product!.sequence, x + y.slice(25));
  assert.equal(asIs.joins[0].designed, false);
  assert.equal(asIs.pieces.flatMap(p => p.primers).length, 0);
  // Reusing shared bases keeps one copy, which is only one of the two molecules that fit.
  assert.equal(asIs.reused.length, 1);
  assert.deepEqual(
    { merged: asIs.reused[0].merged, kept: asIs.reused[0].kept },
    { merged: x.length + y.length - 25, kept: x.length + y.length }
  );
  assert.match(asIs.notes[0], /keeps one copy/);
  // Without overlaps or PCR, nothing joins.
  const none = planAssembly([{ name: "x", fragment: wholeFragment(doc("x", x, false)) }, { name: "z", fragment: wholeFragment(doc("z", filler(300, 15), false)) }], GIBSON);
  assert.equal(none.product, null);
  assert.match(none.problems[0], /don't overlap/);
  assert.equal(findOverlap("AAAACCCCGGGG", "CCGGGGTTTT", 4), 6);
});

test("overlap assembly: a repeat shared by two neighbours is never merged in silence", () => {
  // A Gly-Ser linker at the end of one part and the start of the next. Sequence alone
  // can't say whether that is one shared stretch or one copy in each part, so the plan
  // has to say which molecule it built and what the other one would be.
  const linker = "GGTGGCGGTAGCGGTGGCGG"; // 20, as both parts would legitimately carry it
  const a = filler(300, 31) + linker;
  const b = linker + filler(250, 32);
  const docA = doc("A", a, false);
  const docB = doc("B", b, false);
  const plan = planAssembly(
    [
      { name: "A", fragment: wholeFragment(docA) },
      { name: "B", fragment: wholeFragment(docB) }
    ],
    GIBSON,
    false
  );
  assert.equal(plan.product!.sequence.length, a.length + b.length - linker.length);
  assert.equal(plan.joins[0].designed, false);
  assert.deepEqual(plan.reused.map(r => [r.left, r.right, r.bases.length, r.merged, r.kept]), [["A", "B", 20, a.length + b.length - 20, a.length + b.length]]);
  assert.equal(plan.notes.length, 1);
  assert.match(plan.notes[0], /keeps one copy/);
  assert.match(plan.notes[0], new RegExp(String(a.length + b.length)));
  // It is not an error: a plan that says what it did still produces its product.
  assert.deepEqual(plan.problems, []);

  // The note tells the user what to do, so check that doing it works rather than checking
  // the wording — and check it under both methods, since the overlap is split across the
  // junction in one and taken whole from one piece's end in the other.
  const oneCopyEach = a + b; // what "a copy in each part" means, base for base
  const rest = filler(250, 32);
  const twoPieces = (left: string, right: string, method: OverlapMethod) => {
    const dl = doc("A", left, false);
    const dr = doc("B", right, false);
    return planAssembly(
      [
        { name: "A", fragment: wholeFragment(dl), pcr: { template: dl, range: { start: 0, end: left.length - 1 } } },
        { name: "B", fragment: wholeFragment(dr), pcr: { template: dr, range: { start: 0, end: right.length - 1 } } }
      ],
      method,
      false
    );
  };
  // Stepping one base at a time, because copies of a tandem repeat overlap each other and
  // split() or a global regex would skip the second one — the very case this is about.
  const occurrences = (haystack: string, needle: string) => {
    let n = 0;
    for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + 1)) n++;
    return n;
  };

  // Both copies inside one piece AND the join past them, in sequence that occurs once.
  // Counted on the product, not on a piece: Gibson splits the overlap across the junction
  // so it lies in neither piece whole, while In-Fusion takes it from one piece's end.
  for (const method of [GIBSON, IN_FUSION]) {
    const left = filler(300, 31) + linker + linker + rest.slice(0, 40);
    const fixed = twoPieces(left, rest.slice(40), method);
    assert.equal(fixed.product!.sequence, oneCopyEach, "following the note's advice should build the molecule it describes");
    assert.equal(fixed.joins[0].designed, true);
    assert.equal(occurrences(fixed.product!.sequence, fixed.joins[0].bases), 1, "the overlap has to fall in sequence that occurs once");
    assert.deepEqual(fixed.notes, [], "with the repeat off the junction there is nothing left to warn about");
    assert.deepEqual(fixed.problems, [], "and a unique overlap is not reported");
  }

  // Grouping the copies without moving the join is NOT enough, which is why the note says
  // more than "put them in one piece". The length comes out right either way, so length is
  // no test of it: In-Fusion takes its overlap whole from the end of the piece, and the
  // piece ends in a tandem repeat, so that overlap occurs twice and the join has two
  // registers again. The uniqueness check is what catches it.
  const groupedOnly = filler(300, 31) + linker + linker;
  const stillRepeated = twoPieces(groupedOnly, rest, IN_FUSION);
  assert.equal(stillRepeated.product!.sequence, oneCopyEach, "the length is right, which is exactly what makes this one hard to see");
  assert.equal(occurrences(stillRepeated.product!.sequence, stillRepeated.joins[0].bases), 2, "In-Fusion's overlap still falls inside the repeat");
  assert.equal(occurrences(groupedOnly, stillRepeated.joins[0].bases), 2, "and both copies are in the piece the overlap was taken from");
  assert.equal(stillRepeated.problems.length, 1);
  assert.match(stillRepeated.problems[0], /read the same in 2 places/);
  // Gibson avoids it here only because a split overlap is half of each neighbour, so it is
  // in neither input region — though it IS in both finished amplicons, which is the pairing
  // the design intends. Geometry, not a check; the check agrees all the same.
  const split = twoPieces(groupedOnly, rest, GIBSON);
  assert.equal(occurrences(split.product!.sequence, split.joins[0].bases), 1);
  assert.equal(occurrences(groupedOnly, split.joins[0].bases), 0, "not in the input region");
  assert.deepEqual(
    split.pieces.map(x => occurrences(x.fragment.data.sequence, split.joins[0].bases)),
    [1, 1],
    "but in both amplicons once the tails are on"
  );
  assert.deepEqual(split.problems, []);

  // And the advice the first version of this note gave — trim the shared bases from one
  // piece and let the primers add the overlap — does not work: a designed overlap is built
  // from bases the neighbours already have, so it adds none and the product is unchanged.
  const trimmed = planAssembly(
    [
      { name: "A", fragment: wholeFragment(docA, { start: 0, end: a.length - 1 - linker.length }), pcr: { template: docA, range: { start: 0, end: a.length - 1 - linker.length } } },
      { name: "B", fragment: wholeFragment(docB), pcr: { template: docB, range: { start: 0, end: b.length - 1 } } }
    ],
    GIBSON,
    false
  );
  assert.equal(trimmed.product!.sequence.length, a.length + b.length - linker.length, "trimming does not recover the second copy");
  assert.notEqual(trimmed.product!.sequence, oneCopyEach);
});

test("overlap assembly: a designed overlap taken whole from one end is checked for uniqueness too", () => {
  // The shared-overlap note cannot reach either arrangement here: it fires only when
  // neighbours already share minOverlap bases, and these share nothing. The overlap is
  // designed, and still taken whole from one piece — which is why the risk is not
  // In-Fusion's alone. Only the uniqueness check catches these.
  // Stepping one base at a time, because copies of a tandem repeat overlap each other and
  // split() or a global regex would skip the second one — the very case this is about.
  const occurrences = (haystack: string, needle: string) => {
    let n = 0;
    for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + 1)) n++;
    return n;
  };
  const linker = "GGTGGCGGTAGCGGTGGCGG";

  // A vector that is not amplified: the overlap goes on the insert's primer, taken whole
  // from the vector's start, so a repeat there is repeated in the overlap. Gibson cannot
  // split it, because only one of the two neighbours has primers to split it across.
  const vector = linker + linker + filler(300, 51);
  const insertSeq = filler(400, 52);
  const insert = doc("I", insertSeq, false);
  for (const method of [GIBSON, IN_FUSION]) {
    const p = planAssembly(
      [
        { name: "V", fragment: wholeFragment(doc("V", vector, false)) },
        { name: "I", fragment: wholeFragment(insert), pcr: { template: insert, range: { start: 0, end: insertSeq.length - 1 } } }
      ],
      method,
      true
    );
    const back = p.joins[1];
    assert.equal(back.designed, true);
    assert.equal(occurrences(vector, back.bases), 2, "the overlap was cut out of a tandem repeat");
    assert.equal(p.problems.length, 1, "Gibson is exposed to this as well: with one piece amplified there is nothing to split across");
    assert.match(p.problems[0], /bases joining I and V read the same in 2 places/);
    assert.deepEqual(p.notes, [], "no note can fire, because the neighbours share nothing");
  }

  // A repeat whose period is below minOverlap, so findOverlap never sees it, but whose run
  // is long enough for the overlap to sit inside it twice. The two registers are 12 bases
  // apart and the overlap is 15, so they overlap each other: a count that skipped past each
  // match would see one place and report nothing.
  const short = "GGTGGCGGTAGC"; // 12 bp, under minOverlap
  const left = filler(300, 61) + short.repeat(3);
  const right = filler(250, 62);
  const dl = doc("A", left, false);
  const dr = doc("B", right, false);
  const p = planAssembly(
    [
      { name: "A", fragment: wholeFragment(dl), pcr: { template: dl, range: { start: 0, end: left.length - 1 } } },
      { name: "B", fragment: wholeFragment(dr), pcr: { template: dr, range: { start: 0, end: right.length - 1 } } }
    ],
    IN_FUSION,
    false
  );
  assert.equal(findOverlap(left, right, IN_FUSION.minOverlap), 0, "the neighbours share nothing, so no note fires");
  assert.equal(occurrences(left, p.joins[0].bases), 2);
  assert.equal(p.problems.length, 1, "a repeat too short for findOverlap still makes the overlap ambiguous");
  assert.match(p.problems[0], /read the same in 2 places/);
  assert.deepEqual(p.notes, []);
});

test("finding where a join can land reads both strands, ignores case and crosses the origin", () => {
  const tag = "GCATGCAACGTTGCATTACG"; // 20 bp, and not its own reverse complement
  const pad = filler(200, 71);
  const places = (sequence: string, circular: boolean, bases: string) => overlapMatches(sequence, circular, bases).length;

  assert.equal(places(tag + pad, false, tag), 1);
  assert.equal(places(tag + pad + tag, false, tag), 2, "a second forward copy is a second place to land");
  // A join anneals to whichever strand matches, so an inverted copy counts as well, and the
  // report has to say which it was and where.
  const inverted = overlapMatches(tag + pad + reverseComplement(tag), false, tag);
  assert.deepEqual(inverted.map(m => m.direct), [true, false]);
  assert.deepEqual(inverted.map(m => m.start), [0, tag.length + pad.length]);
  // A palindrome reads the same both ways; counting each strand would double it.
  const palindrome = "GAATTCGCGCGAATTC";
  assert.equal(reverseComplement(palindrome), palindrome);
  assert.equal(places(palindrome + pad, false, palindrome), 1, "a palindrome is one place, not two");
  // Copies of a tandem repeat overlap each other, and those are the ones that matter most:
  // a count that resumed after each match instead of one base on would miss the second.
  assert.equal(places("GGTGGCGGTAGC".repeat(3) + pad, false, "AGCGGTGGCGGTAGC"), 2, "overlapping registers are two places");

  // A file keeps its own capitalisation, which says nothing about the bases, so case is
  // ignored on both sides and in the reverse complement.
  assert.equal(places((tag + pad + tag).toLowerCase(), false, tag), 2, "a lower-case sequence holds the same bases");
  assert.equal(places(tag + pad + tag, false, tag.toLowerCase()), 2, "and so does a lower-case overlap");
  assert.equal(places((tag + pad + reverseComplement(tag)).toLowerCase(), false, tag), 2, "the inverted copy too");
  const mixed = tag.toLowerCase() + pad + tag.slice(0, 10) + tag.slice(10).toLowerCase();
  assert.equal(places(mixed, false, tag), 2, "and a sequence that mixes the two");

  // On a circle the bases run on past the end, so a copy split across the origin is real.
  const wrapped = tag.slice(10) + pad + tag.slice(0, 10); // ends with the first half, starts with the second
  assert.equal(places(wrapped, false, tag), 0, "linear: the halves are at opposite ends and never meet");
  assert.equal(places(wrapped, true, tag), 1, "circular: they are neighbours across the origin");
  assert.equal(places(wrapped.toLowerCase(), true, tag), 1, "whatever case it is written in");
  // The seam must not invent a match that isn't there, nor count an interior one twice.
  assert.equal(places(tag + pad, true, tag), 1);
});

test("overlap assembly: a repeated overlap is reported whatever case the file is written in", () => {
  // The overlap is uppercased before it is compared, while a document keeps the
  // capitalisation it was read with, so a lower-case file once passed every check.
  const repeat = "GGTGGCGGTAGCGGTGGCGG";
  const vectorSeq = repeat + repeat + filler(300, 51);
  const insertSeq = filler(400, 52);
  for (const method of [GIBSON, IN_FUSION]) {
    for (const written of [(s: string) => s, (s: string) => s.toLowerCase(), (s: string) => s.slice(0, 20) + s.slice(20).toLowerCase()]) {
      const insert = doc("I", written(insertSeq), false);
      const p = planAssembly(
        [
          { name: "V", fragment: wholeFragment(doc("V", written(vectorSeq), false)) },
          { name: "I", fragment: wholeFragment(insert), pcr: { template: insert, range: { start: 0, end: insertSeq.length - 1 } } }
        ],
        method,
        true
      );
      assert.equal(p.product!.sequence.length, 740);
      assert.equal(p.problems.length, 1, "the same bases are the same bases in any case");
      assert.match(p.problems[0], /read the same in 2 places/);
    }
  }
});

test("overlap assembly: a piece too short for the overlap is reported, not quietly trimmed", () => {
  // Pre-existing: the overlap was recorded as the length the method asks for, while the
  // tails could only carry what the shorter piece had. Joining on more bases than the
  // pieces share cut the difference out of the product.
  const short = "GCATGCAACGTTGCA"; // 15 bp, shorter than Gibson's 20
  const body = filler(300, 52);
  const b = doc("B", body, false);
  const plan = (method: OverlapMethod) =>
    planAssembly(
      [
        { name: "A", fragment: wholeFragment(doc("A", short, false)) },
        { name: "B", fragment: wholeFragment(b), pcr: { template: b, range: { start: 0, end: body.length - 1 } } }
      ],
      method,
      false
    );

  const gibson = plan(GIBSON);
  assert.equal(gibson.product!.sequence, short + body, "every base of both pieces has to survive");
  assert.equal(gibson.product!.sequence.length, short.length + body.length);
  assert.equal(gibson.joins[0].bases.length, short.length, "the overlap is what the pieces can carry, not what was asked for");
  // Two things are wrong with it and both are said: the overlap is shorter than asked for,
  // and 15 bases of this sequence melt below the 48 C the method is checked against.
  assert.equal(gibson.problems.length, 2);
  assert.match(gibson.problems.join(" "), /too short to carry the whole 20 base overlap, so it can only be 15 bases\./);
  // 15 is exactly minOverlap, so the "shorter than this method needs" clause stays quiet.
  assert.doesNotMatch(gibson.problems.join(" "), /shorter than the 15 bases/);
  assert.match(gibson.problems.join(" "), /melts at 46\.0 .C/);
  // Each join's overlap must be somewhere in the product it builds; before this it was not.
  assert.equal(overlapMatches(gibson.product!.sequence, false, gibson.joins[0].bases).length, 1);

  // In-Fusion asks for exactly the 15 bases the piece has, so nothing is short and nothing
  // is reported: the message belongs to the shortfall, not to small pieces as such.
  const inFusion = plan(IN_FUSION);
  assert.equal(inFusion.product!.sequence, short + body);
  assert.deepEqual(inFusion.problems, []);
});

test("overlap assembly: degenerate overlaps are described accurately and briefly", () => {
  const body = filler(300, 52);
  const b = doc("B", body, false);
  const plan = (piece: string) =>
    planAssembly(
      [
        { name: "A", fragment: wholeFragment(doc("A", piece, false)) },
        { name: "B", fragment: wholeFragment(b), pcr: { template: b, range: { start: 0, end: body.length - 1 } } }
      ],
      GIBSON,
      false
    );

  // meltingTemp returns null for an overlap under two bases as well as for one holding
  // anything but A, C, G or T. Reporting the wrong reason is worse than reporting neither.
  const one = plan("G");
  const joined = one.problems.join(" ");
  assert.match(joined, /is 1 base, too short to work out a melting temperature for/);
  assert.doesNotMatch(joined, /aren't A, C, G or T/, "the bases here are perfectly known");
  assert.match(joined, /it can only be 1 base,/, "and a length of one is not '1 bases'");
  assert.match(joined, /The 1 base joining A and B reads the same/);

  // A one-base overlap reads the same in 134 places. Listing them all is unreadable, so
  // the message names the first few and the total.
  const repeated = one.problems.find(q => /reads the same/.test(q))!;
  assert.match(repeated, /in 134 places in the product, at [^,]+(, [^,]+){5} and 128 more,/);
  assert.equal(repeated.length < 300, true, `the message has to stay readable, was ${repeated.length} characters`);

  // No bases to join on is not a short overlap. Keeping every base of nothing is not a
  // product, so none is built.
  const none = plan("");
  assert.equal(none.product, null, "sequence preserved is not the same as an assembly");
  assert.deepEqual(none.problems, ["There are no bases to join A and B on. Check that both pieces have sequence in them."]);
});

test("overlap assembly: an overlap that can't be measured is reported whatever the method", () => {
  // In-Fusion sets no minimum Tm. That must not switch off the check that an overlap's
  // sequence is known: the two questions are separate.
  assert.equal(IN_FUSION.minTm, 0);
  const amb = "ATGCNNNNATGCATGCATGCATGC";
  const linear = [
    { name: "A", fragment: wholeFragment(doc("A", filler(200, 43) + amb, false)) },
    { name: "B", fragment: wholeFragment(doc("B", amb + filler(200, 44), false)) }
  ];
  for (const method of [GIBSON, IN_FUSION]) {
    const p = planAssembly(linear, method, false);
    assert.equal(p.joins[0].tm, null);
    assert.equal(p.product, null);
    assert.match(p.problems.join(" "), /no telling whether it will anneal/, `${method.overlap} bp method missed an unmeasurable overlap`);
  }
  // Circular too, where the last piece joins the first.
  const ring = planAssembly(
    [
      { name: "A", fragment: wholeFragment(doc("A", amb + filler(200, 45) + "GCTAGCTTACGGATCCTTAA", false)) },
      { name: "B", fragment: wholeFragment(doc("B", "GCTAGCTTACGGATCCTTAA" + filler(200, 46) + amb, false)) }
    ],
    IN_FUSION,
    true
  );
  assert.equal(ring.joins.length, 2);
  assert.equal(ring.product, null);
  assert.match(ring.problems.join(" "), /no telling whether it will anneal/);
});

test("overlap assembly: a plan with no product reports no product lengths", () => {
  const linker = "GGTGGCGGTAGCGGTGGCGG";
  const p = planAssembly(
    [
      { name: "A", fragment: wholeFragment(doc("A", filler(300, 31) + linker, false)) },
      { name: "B", fragment: wholeFragment(doc("B", linker + filler(250, 32), false)) },
      { name: "C", fragment: wholeFragment(doc("C", filler(300, 58), false)) }
    ],
    GIBSON,
    false
  );
  assert.equal(p.product, null);
  // The reused join is still real and still worth saying; its lengths are not known.
  assert.deepEqual(p.reused.map(r => [r.bases.length, r.merged, r.kept]), [[20, null, null]]);
  assert.equal(p.notes.length, 1);
  assert.doesNotMatch(p.notes[0], /\(\d+ bp\)/, "no length should be quoted when none was worked out");
  // Nothing was built, so the note has to talk about what would happen, not what did.
  assert.match(p.notes[0], /would be joined/);
  assert.doesNotMatch(p.notes[0], /were joined/);
});

test("overlap assembly: the overlap Tm is measured by the method its threshold was set for", () => {
  // 48 °C for this chemistry is a Wallace-rule figure, so the check must not follow the
  // method Settings picked for what is shown elsewhere.
  assert.equal(GIBSON.tmMethod, "wallace");
  const planFor = (overlap: string, m: TmMethod, seed: number) =>
    planAssembly(
      [
        { name: "A", fragment: wholeFragment(doc("A", filler(300, seed) + overlap, false)) },
        { name: "B", fragment: wholeFragment(doc("B", overlap + filler(250, seed + 1), false)) }
      ],
      { ...GIBSON, tmMethod: m },
      false
    );
  const warned = (overlap: string, m: TmMethod, seed: number) => {
    const p = planFor(overlap, m, seed);
    // Guard against the filler lengthening the match and changing what is being measured.
    assert.equal(p.joins[0].bases.length, overlap.length);
    return p.problems.some(x => /melts at/.test(x));
  };

  // What matters is that the method decides whether an overlap is accepted, not only what
  // number is shown. These two straddle the 48 °C threshold in opposite directions, so
  // each would get the wrong answer under the other method.
  const wallacePasses = "GTTTACAGAGAGTTAGAG"; // Wallace 50.0 °C, nearest-neighbour 45.9 °C
  const wallaceFails = "CTTTGCAACCCGACT"; //   Wallace 46.0 °C, nearest-neighbour 50.2 °C
  assert.equal(warned(wallacePasses, "wallace", 41), false);
  assert.equal(warned(wallacePasses, "santalucia", 41), true, "would have warned on an overlap the 48 °C guideline accepts");
  assert.equal(warned(wallaceFails, "wallace", 43), true);
  assert.equal(warned(wallaceFails, "santalucia", 43), false, "would have passed an overlap the 48 °C guideline rejects");

  // The Tm reported alongside is the one the check used, so the two can be compared.
  for (const m of ["wallace", "santalucia"] as TmMethod[]) {
    assert.ok(Math.abs(planFor(wallacePasses, m, 41).joins[0].tm! - meltingTemp(wallacePasses, { ...DEFAULT_TM, method: m })!) < 0.05);
  }

  // An overlap whose Tm can't be worked out is reported, not quietly skipped.
  const n = filler(200, 43) + "ATGCNNNNATGCATGCATGCATGC";
  const withN = planAssembly(
    [
      { name: "A", fragment: wholeFragment(doc("A", n, false)) },
      { name: "B", fragment: wholeFragment(doc("B", "ATGCNNNNATGCATGCATGCATGC" + filler(200, 44), false)) }
    ],
    GIBSON,
    false
  );
  assert.equal(withN.joins[0].tm, null);
  assert.match(withN.problems.join(" "), /aren't A, C, G or T/);
});

test("Golden Gate: overhangs set the order and orientation of the parts", () => {
  const bbA = filler(1200, 20);
  const bbB = filler(800, 21);
  const [o1, o3, o2] = ["AATG", "AGGT", "GCTT"];
  // The vector's sites face out of the dropout; the parts' sites face in.
  const vector = doc("vector", bbA + o1 + "T" + "GAGACC" + filler(300, 22) + "GGTCTC" + "A" + o2 + bbB, true);
  const geneA = filler(500, 23);
  const geneB = filler(400, 24);
  const donor = (insert: string, seed: number) => filler(600, seed) + "GGTCTC" + "A" + insert + "T" + "GAGACC" + filler(400, seed + 1);
  const partA = doc("partA", donor(o1 + geneA + o3, 30), true);
  // Part B sits the other way round in its plasmid.
  const partB = doc("partB", reverseComplement(donor(o3 + geneB + o2, 40)), true);
  const r = goldenGate(
    [
      { name: "vector", data: vector },
      { name: "partB", data: partB },
      { name: "partA", data: partA }
    ],
    "BsaI"
  );
  assert.deepEqual(r.problems, []);
  assert.deepEqual(
    r.order.map(f => f.source.name),
    ["vector", "partA", "partB"]
  );
  assert.ok(sameCircle(r.product!.sequence, bbA + o1 + geneA + o3 + geneB + o2 + bbB));

  // A missing part leaves an end with nothing to join.
  const short = goldenGate([{ name: "vector", data: vector }, { name: "partA", data: partA }], "BsaI");
  assert.equal(short.product, null);
  assert.match(short.problems.join(" "), /Nothing joins the AGGT end of partA/);
});

test("opening a circle inside a CDS preserves its bases and region numbering", () => {
  const region = (name: string, start: number, end: number) => ({ name, kind: "Transmembrane", start, end, accession: "", sourceStart: start, sourceEnd: end, predicted: false });
  const f: SeqFeature = { ...feature("cds", 51, 20), notes: withRegions({}, [region("TM1", 1, 3), region("TM2", 8, 10)]) };
  const sequence = filler(60, 7);
  const linear = wholeFragment(doc("p", sequence, true, [f])).data;
  const kept = linear.features[0];
  assert.equal(linear.circular, false);
  assert.deepEqual(kept.locations, [{ start: 51, end: 59 }, { start: 0, end: 20 }]);
  assert.equal(featureBases(linear.sequence, kept), featureBases(sequence, f));
  assert.deepEqual(regionsOf(kept), regionsOf(f));
});

test("overlap assembly cannot offer a product from an undersized PCR piece or coincident joins", () => {
  const vector = wholeFragment(doc("vector", filler(250, 31), false));
  const template = doc("donor", filler(140, 52), true);
  const range = { start: 35, end: 46 };
  const short = { name: template.name, fragment: wholeFragment(template, range), pcr: { template, range } };
  const repeated = ["A", "B"].map(name => ({ name, fragment: wholeFragment(doc(name, "AC".repeat(40), false)) }));
  for (const method of [GIBSON, IN_FUSION]) {
    const proposed = planAssembly([{ name: "vector", fragment: vector }, short], method);
    assert.equal(proposed.product, null);
    assert.match(proposed.problems.join(" "), /No primers could be designed for donor/);
    assert.equal(planAssembly(repeated, method).product, null);
  }
});

test("vector PCR distinguishes an insertion point from replacing the whole circle", () => {
  assert.deepEqual(vectorPcrRange(240, null, 0), { start: 0, end: 239 });
  assert.deepEqual(vectorPcrRange(240, { start: 230, end: 9 }, 0), { start: 10, end: 229 });
  assert.equal(vectorPcrRange(240, { start: 0, end: 239 }, 0), null);
  assert.equal(vectorPcrRange(240, { start: 20, end: 19 }, 0), null);
  assert.equal(vectorPcrRange(0, null, 0), null);
});

test("an as-is insert must already be a whole linear fragment", () => {
  const circle = doc("donor", filler(140, 52), true);
  const whole = { start: 0, end: 139 };
  assert.equal(existingFragment(circle, whole), null);
  const linear = { ...circle, circular: false };
  assert.equal(existingFragment(linear, { start: 20, end: 119 }), null);
  assert.equal(existingFragment(linear, whole)?.data.sequence, circle.sequence);
});

test("features and primers on both sides of shared bases keep their complete coordinates", () => {
  const shared = "TTCGCCGAAGTGACATGATAC";
  const closing = "GTCGTAGCGGTCGGAATCTG";
  const left = doc("A", closing + filler(60, 31) + shared, false, [feature("at end", 68, 99)]);
  const right = doc("B", shared + filler(60, 32) + closing, false, [feature("at start", 0, 29), feature("wraps", 70, 99, -1)]);
  right.primers.push({ id: "p", name: "across closing join", bases: reverseComplement(right.sequence.slice(70, 100)), start: 70, end: 99, strand: -1, notes: {}, raw: {} });
  const { data } = joinFragments([wholeFragment(left), wholeFragment(right)], [shared.length, closing.length], true)!;
  assert.equal(data.circular, true);
  assert.equal(data.sequence, left.sequence + right.sequence.slice(shared.length, -closing.length));
  for (const [i, original] of [left.features[0], ...right.features].entries()) {
    assert.equal(featureBases(data.sequence, data.features[i]), featureBases(i === 0 ? left.sequence : right.sequence, original));
  }
  assert.equal(reverseComplement(featureBases(data.sequence, data.primers[0])), right.primers[0].bases);
  assert.ok(data.primers[0].start > data.primers[0].end);
});

test("an uncut linear digest preserves the sample without claiming an enzyme cut", () => {
  const vector = doc("uncut", "ACGT".repeat(10) + "TCTAGATC" + "ACGT".repeat(12), false);
  const r = fragmentDigest(vector, ["XbaI"], hostMethylation(""));
  assert.equal(r.cut, false);
  assert.equal(r.problem, undefined);
  assert.deepEqual(r.fragments.map(f => f.data.sequence), [vector.sequence]);
  assert.deepEqual(cloningDigest(vector, ["XbaI"], hostMethylation("")).fragments, []);
  assert.equal(fragmentDigest(vector, ["XbaI"], hostMethylation("JM110")).cut, true);
});

test("cloning requires every chosen enzyme to cut, even when another enzyme can open the vector", () => {
  const vector = doc("vector", "A".repeat(60) + "GAATTC" + "C".repeat(59) + "TCTAGATC" + "G".repeat(60), true);
  const enzymes = ["EcoRI", "XbaI"];
  const damPlus = hostMethylation("");
  assert.equal(fragmentDigest(vector, enzymes, damPlus).fragments.length, 1);
  assert.deepEqual(cloningDigest(vector, enzymes, damPlus), {
    fragments: [], cut: false, problem: "XbaI doesn't cut vector."
  });
  assert.equal(cloningDigest(vector, enzymes, hostMethylation("JM110")).fragments.length, 2);
  // Isoschizomers each cut, but the two cuts in the same place give only one break.
  const sameCut = doc("vector", "A".repeat(50) + "CCCGGG" + "T".repeat(50), true);
  assert.equal(cloningDigest(sameCut, ["XmaI", "Cfr9I"]).fragments.length, 1);
});

test("Golden Gate finds the complete product whichever way the parts were listed", () => {
  const donor = (name: string, body: string, end: string) =>
    ({ name, data: doc(name, "CT".repeat(16) + "GGTCTCAAATG" + body + end + "TGAGACC" + "AC".repeat(16), true) });
  const vector = { name: "vector", data: doc("vector", "AC".repeat(40) + "AATGTGAGACC" + "CT".repeat(16) + "GGTCTCAGCTT" + "CT".repeat(40), true) };
  const a = donor("A", "CA".repeat(16), "GCTT");
  const b = donor("B", "TC".repeat(11), "AATG");
  for (const inserts of [[a, b], [b, a]]) {
    const r = goldenGate([vector, ...inserts], "BsaI");
    assert.deepEqual(r.order.map(f => f.source.name), ["vector", "B", "A"]);
    assert.equal(r.product?.circular, true);
    assert.equal(r.product.sequence, "GCTT" + "CT".repeat(40) + "AC".repeat(40) + "AATG" + "TC".repeat(11) + "AATG" + "CA".repeat(16));
    assert.match(r.problems.join(" "), /without all the selected parts/);
  }
  const c = donor("C", "AT".repeat(10), "AATG");
  const ambiguous = goldenGate([vector, a, b, c], "BsaI");
  assert.equal(ambiguous.product, null);
  assert.match(ambiguous.problems.join(" "), /More than one circular assembly/);
});

test("Golden Gate rejects a site recreated across the product's origin", () => {
  const bb = "AC".repeat(40) + "AATGTGAGACC" + "CT".repeat(16) + "GGTCTCAGTCT" + "CT".repeat(40);
  const part = "CT".repeat(16) + "GGTCTCAAATG" + "TC".repeat(14) + "GGTCTTGAGACC" + "AC".repeat(16);
  assert.equal(cutsFor(bb, true, ["BsaI"]).length, 2);
  assert.equal(cutsFor(part, true, ["BsaI"]).length, 2);
  const expected = "GTCT" + "CT".repeat(40) + "AC".repeat(40) + "AATG" + "TC".repeat(14) + "G";
  assert.equal(cutsFor(expected, false, ["BsaI"]).length, 0);
  assert.equal(cutsFor(expected, true, ["BsaI"]).length, 1);
  const r = goldenGate([{ name: "vector", data: doc("vector", bb, true) }, { name: "part", data: doc("part", part, true) }], "BsaI");
  assert.equal(r.product, null);
  assert.match(r.problems.join(" "), /recreates a BsaI site/);
});

test("restriction cloning: Dam methylation blocks a site until the DNA is grown in a dam- strain", () => {
  const clean = (n: number, seed: number) => filler(n, seed).replace(/TCTAGA|GATC/g, "ACGT");
  // Vector has an EcoRI site and a Dam-overlapping XbaI site (TCTAGATC).
  const vector = doc("vector", clean(600, 81) + "GAATTC" + clean(120, 82) + "AAATCTA" + "GATC" + clean(600, 83), true);
  // Insert has clean EcoRI and XbaI sites (flanked by As so no GATC overlaps).
  const insert = doc("insert", clean(100, 84) + "GAATTC" + clean(300, 85) + "AAATCTAGAAA" + clean(100, 86), false);
  const damPlus = hostMethylation("");
  const damMinus = hostMethylation("JM110");

  const blockedVec = digest(vector, ["EcoRI", "XbaI"], damPlus);
  const ins = digest(insert, ["EcoRI", "XbaI"], damPlus)[1];
  assert.equal(blockedVec.length, 1, "Dam stops XbaI cutting, leaving the vector linearised at EcoRI only");
  assert.equal(ligateInsert(blockedVec[0], ins).length, 0, "EcoRI/EcoRI vector ends cannot ligate to an EcoRI/XbaI insert");

  const cutVec = digest(vector, ["EcoRI", "XbaI"], damMinus);
  assert.equal(cutVec.length, 2, "JM110 (dam-) lets XbaI cut the vector");
  const products = ligateInsert(largest(cutVec)!, ins);
  assert.equal(products.length, 1);
  assert.equal(products[0].flipped, false);
});

test("Golden Gate: per-part methylation blocks sites in a dcm+ strain and cuts in a dcm- strain", () => {
  const clean = (n: number, seed: number) => filler(n, seed).replace(/GGGAC|GTCCC|CCAGG|CCTGG/g, "ACGTA");
  // BsmFI is GGGAC(10/14) and Dcm blocks it at b0 (CCAGGGAC).
  const [o1, o2] = ["AATG", "GCTT"];
  const pad10 = "ACGTACGTAC"; // 10 bases between site and 4-base overhang
  const bb = clean(400, 91);
  const drop = clean(150, 92);
  const gene = clean(250, 93);
  const vector = doc("vector", bb + o1 + pad10 + "GTCCC" + drop + "GGGAC" + pad10 + o2, true);
  // Part's left BsmFI site overlaps a Dcm site (CCAGGGAC); its right site is clean.
  const part = doc("part", clean(100, 94) + "CCAGGGAC" + pad10 + o1 + gene + o2 + pad10 + "GTCCC" + clean(100, 95), true);

  const blocked = goldenGate(
    [
      { name: "vector", data: vector, methylation: hostMethylation("DH5a") },
      { name: "part", data: part, methylation: hostMethylation("DH5a") }
    ],
    "BsmFI"
  );
  assert.equal(blocked.product, null);
  assert.match(blocked.problems.join(" "), /No fragment of part has two BsmFI ends and no remaining BsmFI site/);

  const assembled = goldenGate(
    [
      { name: "vector", data: vector, methylation: hostMethylation("DH5a") },
      { name: "part", data: part, methylation: hostMethylation("JM110") }
    ],
    "BsmFI"
  );
  assert.deepEqual(assembled.problems, []);
  assert.ok(sameCircle(assembled.product!.sequence, bb + o1 + gene + o2));
});

// ---------- a CDS cut by a simulated digest, PCR or trim: its codons and its translation ----------
//
// A cut that takes the first bases of a CDS leaves it starting mid-codon. The bases that are
// left still pair into the codons they had, so the CDS has to say where its first whole
// codon is (/codon_start). What it must read is worked out here from the CDS's parts alone,
// not with the code that reads a CDS, so that code is what these tests check. The bases are
// made up.

const N = 300;

interface Shape {
  label: string;
  circular: boolean;
  /** The CDS's parts as a file lists them, along the sequence; one may cross a circle's origin. */
  parts: Range[];
  strand: 1 | -1;
  codonStart?: unknown;
}

const FORWARD: Shape = { label: "forward", circular: false, parts: [{ start: 100, end: 198 }], strand: 1 };
const REVERSE: Shape = { ...FORWARD, label: "reverse", strand: -1 };
const SHAPES: Shape[] = [
  FORWARD,
  REVERSE,
  { label: "forward in two parts", circular: false, parts: [{ start: 100, end: 130 }, { start: 160, end: 198 }], strand: 1 },
  { label: "reverse in two parts", circular: false, parts: [{ start: 100, end: 130 }, { start: 160, end: 198 }], strand: -1 },
  { label: "forward from its second base", circular: false, parts: [{ start: 100, end: 198 }], strand: 1, codonStart: ["2"] },
  { label: "reverse from its third base", circular: false, parts: [{ start: 100, end: 198 }], strand: -1, codonStart: [3] },
  { label: "forward on a circle", circular: true, parts: [{ start: 100, end: 198 }], strand: 1 },
  { label: "reverse on a circle", circular: true, parts: [{ start: 100, end: 198 }], strand: -1 },
  { label: "forward across the origin", circular: true, parts: [{ start: 280, end: 78 }], strand: 1 },
  { label: "reverse across the origin", circular: true, parts: [{ start: 280, end: 78 }], strand: -1, codonStart: ["2"] },
  { label: "forward in two parts round the origin", circular: true, parts: [{ start: 270, end: 299 }, { start: 20, end: 70 }], strand: 1 },
  { label: "reverse in two parts round the origin", circular: true, parts: [{ start: 270, end: 299 }, { start: 20, end: 70 }], strand: -1, codonStart: 2 }
];

const wrap = (p: number) => ((p % N) + N) % N;
const partLength = (r: Range) => wrap(r.end - r.start) + 1;
const within = (w: Range) => (p: number) => (w.start <= w.end ? p >= w.start && p <= w.end : p >= w.start || p <= w.end);

/** Every position of the CDS, along the sequence and in the order it is read. */
function positionsOf(shape: Shape): { along: number[]; read: number[] } {
  const along = shape.parts.flatMap(r => Array.from({ length: partLength(r) }, (_, i) => wrap(r.start + i)));
  return { along, read: shape.strand === 1 ? along : [...along].reverse() };
}

const cdsOf = (shape: Shape, id = "cds"): SeqFeature => ({
  id,
  name: id,
  type: "CDS",
  strand: shape.strand,
  start: shape.parts[0].start,
  end: shape.parts[shape.parts.length - 1].end,
  ...(shape.parts.length > 1 ? { locations: shape.parts } : {}),
  notes: { product: ["a made-up protein"], ...(shape.codonStart === undefined ? {} : { codon_start: shape.codonStart }) },
  raw: {}
});

/** The bases a CDS has before its first whole codon, by GenBank's /codon_start as a file gives it. */
const givenSkip = (shape: Shape) => {
  const given = Number(Array.isArray(shape.codonStart) ? shape.codonStart[0] : shape.codonStart);
  return given === 2 || given === 3 ? given - 1 : 0;
};

/** The codons a CDS reads, each as the positions of its three bases: whole ones only, from its first, and only those that `keep` holds all three of. */
function wholeCodons(shape: Shape, keep: (p: number) => boolean = () => true): number[][] {
  const read = positionsOf(shape).read.slice(givenSkip(shape));
  const codons: number[][] = [];
  for (let i = 0; i + 2 < read.length; i += 3) codons.push(read.slice(i, i + 3));
  return codons.filter(codon => codon.every(keep));
}

/** The codons a product's CDS reads, each as the positions of its bases on the template (`back` maps a product's to it). */
function codonsRead(d: SeqData, cds: SeqFeature, back: (q: number) => number): number[][] {
  const positions = codingPositions(cds, d.sequence.length).map(back);
  const codons: number[][] = [];
  for (let i = 0; i + 2 < positions.length; i += 3) codons.push(positions.slice(i, i + 3));
  return codons;
}

/** A window that takes `lead` bases off the start of the CDS's reading and `trail` off its end, with room to spare on a side where nothing is cut. */
function windowFor(shape: Shape, lead: number, trail: number): Range {
  const { read } = positionsOf(shape);
  const first = read[lead];
  const last = read[read.length - 1 - trail];
  const margin = 12;
  return shape.strand === 1
    ? { start: lead ? first : wrap(first - margin), end: trail ? last : wrap(last + margin) }
    : { start: trail ? last : wrap(last - margin), end: lead ? first : wrap(first + margin) };
}

/** Leading cuts to try: a few bases, and for a CDS in parts the same just beyond its first part, so that a gap is not counted. */
function leadsFor(shape: Shape): number[] {
  const first = partLength(shape.strand === 1 ? shape.parts[0] : shape.parts[shape.parts.length - 1]);
  return [0, 1, 2, 3, 4, 5, ...(shape.parts.length > 1 ? [first, first + 1, first + 2, first + 3] : [])];
}

/** What cutting `template` down to `window` must leave of its CDS `id`, checked on `product`. */
function assertCut(shape: Shape, template: SeqData, product: SeqData, window: Range, context: string, id = "cds") {
  const keep = within(window);
  const back = (q: number) => wrap(window.start + q);
  assert.equal(product.circular, false, `${context}: linear`);
  assert.equal(product.sequence, basesIn(template.sequence, window), `${context}: its bases`);
  const { along, read } = positionsOf(shape);
  const cds = product.features.find(f => f.id === id);
  const left = along.filter(keep);
  if (!left.length) {
    assert.equal(cds, undefined, `${context}: a CDS with no base left is gone`);
    return;
  }
  assert.ok(cds, `${context}: the CDS is kept`);
  assert.equal(featureBases(product.sequence, cds), left.map(p => template.sequence[p]).join(""), `${context}: the CDS's bases`);
  assert.deepEqual(codonsRead(product, cds, back), wholeCodons(shape, keep), `${context}: the codons it reads`);
  // Only /codon_start changes, and only when the cut moved the first whole codon. (A /translation
  // goes when the bases change: the tests of that look at it.)
  const was = template.features.find(f => f.id === id)!;
  const cut = read.findIndex(keep);
  const plain = ({ translation: _text, ...rest }: Record<string, unknown>) => rest;
  if (cut % 3 === 0) assert.deepEqual(plain(cds.notes), plain(was.notes), `${context}: its qualifiers`);
  else {
    assert.deepEqual({ ...plain(cds.notes), codon_start: null }, { ...plain(was.notes), codon_start: null }, `${context}: its qualifiers`);
    assert.deepEqual(cds.notes.codon_start, [String((((givenSkip(shape) - cut) % 3) + 3) % 3 + 1)], `${context}: its /codon_start`);
  }
}

test("a cut that takes the start of a CDS leaves the codons it had", () => {
  const sequence = filler(N, 11);
  for (const shape of SHAPES) {
    const template = doc("template", sequence, shape.circular, [cdsOf(shape)]);
    for (const lead of leadsFor(shape)) {
      for (const trail of [0, 1, 2, 4]) {
        const window = windowFor(shape, lead, trail);
        assertCut(shape, template, wholeFragment(template, window).data, window, `${shape.label}, ${lead} bases off its start and ${trail} off its end`);
      }
    }
  }
});

test("a digest that cuts into a CDS leaves the codons it had, on a line and on a circle", () => {
  const plant = (s: string, at: number, site: string) => s.slice(0, at) + site + s.slice(at + site.length);
  for (const circular of [false, true]) {
    for (const strand of [1, -1] as const) {
      for (let into = 0; into <= 5; into++) {
        const shape: Shape = { label: `${strand === 1 ? "forward" : "reverse"} ${circular ? "circle" : "line"}`, circular, parts: [{ start: 100, end: 198 }], strand };
        // EcoRI cuts G^AATTC: the piece on the right of its top cut starts at the site's second base, the one on the left ends at its last.
        let sequence = plant(filler(N, 11), strand === 1 ? 99 + into : 194 - into, "GAATTC");
        if (circular) sequence = plant(sequence, 250, "AAGCTT");
        const template = doc("template", sequence, circular, [cdsOf(shape)]);
        const enzymes = circular ? ["EcoRI", "HindIII"] : ["EcoRI"];
        assert.equal(cutsFor(sequence, circular, enzymes).length, enzymes.length, `${shape.label}: one site each`);
        const fragments = digest(template, enzymes);
        assert.equal(fragments.length, 2);
        for (const f of fragments) {
          const window = { start: f.source.start, end: wrap(f.source.start + f.source.length - 1) };
          assertCut(shape, template, f.data, window, `${shape.label}, EcoRI ${into} bases into the CDS`);
        }
      }
    }
  }
});

test("protein regions keep their residues when a cut leaves a CDS mid-codon", () => {
  const region = (name: string, start: number, end: number): ProteinRegion => ({ name, kind: "Domain", start, end, accession: "", sourceStart: start, sourceEnd: end, predicted: false });
  const sequence = filler(N, 11);
  for (const shape of SHAPES) {
    const all = wholeCodons(shape);
    const regions = [region("head", 1, 4), region("middle", 10, 12), region("tail", all.length - 2, all.length)];
    const cds = { ...cdsOf(shape), notes: withRegions(cdsOf(shape).notes, regions) };
    const template = doc("template", sequence, shape.circular, [cds]);
    // Cuts at the start only: a region left between codons at the end has its own rule (`codingBases`).
    for (const lead of [0, 1, 2, 3, 4, 5, 12, 13, 14]) {
      const window = windowFor(shape, lead, 0);
      const context = `${shape.label}, ${lead} bases off its start`;
      const product = wholeFragment(template, window).data;
      const kept = wholeCodons(shape, within(window));
      const first = all.findIndex(codon => codon[0] === kept[0][0]);
      const got = product.features[0];
      const back = (q: number) => wrap(window.start + q);
      const found = regionsOf(got);
      const want = regions.flatMap(r => {
        const from = Math.max(r.start, first + 1);
        const to = Math.min(r.end, first + kept.length);
        return from <= to ? [{ name: r.name, start: from - first, end: to - first, positions: all.slice(from - 1, to).flat().sort((a, b) => a - b) }] : [];
      });
      assert.deepEqual(found.map(r => r.name), want.map(r => r.name), `${context}: the regions that are left`);
      for (const w of want) {
        const r = found.find(x => x.name === w.name)!;
        assert.deepEqual([r.start, r.end], [w.start, w.end], `${context}: ${w.name}'s residues`);
        const positions = regionSpans(got, r, product.sequence.length).flatMap(s => Array.from({ length: s.end - s.start + 1 }, (_, i) => back(s.start + i)));
        assert.deepEqual(positions.sort((a, b) => a - b), w.positions, `${context}: ${w.name}'s bases`);
      }
    }
  }
});

test("deleting bases in the editor leaves a CDS's reading frame as it was", () => {
  // Only a simulated cut re-frames a CDS. An edit the user makes does not: the edit card shows
  // what it does to the frame, and a protein change is the point of some of them.
  for (const circular of [false, true]) {
    const template = doc("template", filler(N, 11), circular, [{ ...cdsOf(FORWARD), notes: { product: ["a made-up protein"], translation: ["MAAA"] } }]);
    for (const range of [{ start: 90, end: 101 }, { start: 150, end: 160 }, { start: 250, end: 12 }]) {
      if (!circular && range.start > range.end) continue;
      const edited = deleteRange(template, range);
      const clipped = clipRange(template, range);
      assert.equal(edited.features[0].notes, template.features[0].notes, "a deletion leaves its qualifiers alone");
      assert.equal(clipped.sequence, edited.sequence);
      const place = ({ notes: _notes, ...rest }: SeqFeature) => rest;
      assert.deepEqual(clipped.features.map(place), edited.features.map(place));
    }
  }
});

test("trimming 3′ overhangs for an assembly keeps the codons of a CDS it cuts into", () => {
  // Four bases of a 3′ overhang come off each end, as a PstI or KpnI cut leaves them.
  const stored = filler(N, 21);
  const a: Shape = { label: "starts in the left overhang", circular: false, parts: [{ start: 0, end: 98 }], strand: 1 };
  const b: Shape = { label: "starts in the right overhang", circular: false, parts: [{ start: 201, end: 299 }], strand: -1 };
  const c: Shape = { label: "in the middle", circular: false, parts: [{ start: 150, end: 200 }], strand: 1 };
  const translated = (shape: Shape, id: string): SeqFeature => ({ ...cdsOf(shape, id), notes: { ...cdsOf(shape, id).notes, translation: [`M${id.toUpperCase()}`] } });
  const piece: Fragment = {
    data: doc("piece", stored, false, [translated(a, "a"), translated(b, "b"), translated(c, "c")]),
    left: { kind: "3'", bases: stored.slice(0, 4), enzyme: "PstI" },
    right: { kind: "3'", bases: stored.slice(N - 4), enzyme: "KpnI" },
    source: { name: "piece", start: 0, length: N, flipped: false }
  };
  const trimmed = assemblyBases(piece);
  const window = { start: 4, end: N - 5 };
  assert.deepEqual([trimmed.left.kind, trimmed.right.kind], ["blunt", "blunt"]);
  assertCut(a, piece.data, trimmed.data, window, "left trim", "a");
  assertCut(b, piece.data, trimmed.data, window, "right trim", "b");
  assertCut(c, piece.data, trimmed.data, window, "no CDS cut", "c");
  const translation = (id: string) => trimmed.data.features.find(f => f.id === id)?.notes.translation;
  assert.deepEqual([translation("a"), translation("b"), translation("c")], [undefined, undefined, ["MC"]], "only the CDS it did not touch keeps its translation");
});

// The /translation a CDS was imported with is the protein of the bases it had. Once a cut
// changes them it is stale, and the app can't tell what it should say: it must not be
// carried, and no other qualifier is made up in its place.

/** A CDS with the translation a database gave it. The text is made up: nothing here reads it. */
const imported = (shape: Shape, id: string, protein: string): SeqFeature => ({ ...cdsOf(shape, id), notes: { ...cdsOf(shape, id).notes, translation: [protein] } });
const translationOf = (d: SeqData, id: string) => {
  const f = d.features.find(x => x.id === id);
  assert.ok(f, `${id} is in the product`);
  return f.notes.translation;
};
const PROTEIN_A = `M${"A".repeat(32)}`;
const PROTEIN_B = `M${"B".repeat(26)}`;
const BEHIND: Shape = { label: "reverse, behind it", circular: false, parts: [{ start: 210, end: 290 }], strand: -1 };

test("a fragment keeps a CDS's imported translation while its coding bases are the same", () => {
  const linear = doc("t", filler(N, 11), false, [imported(FORWARD, "a", PROTEIN_A), imported(BEHIND, "b", PROTEIN_B)]);
  const both = (d: SeqData) => [translationOf(d, "a"), translationOf(d, "b")];
  const whole = wholeFragment(linear, { start: 50, end: 295 });
  assert.deepEqual(both(whole.data), [[PROTEIN_A], [PROTEIN_B]]);
  assert.deepEqual(both(flip(whole).data), [[PROTEIN_A], [PROTEIN_B]], "turned round");
  assert.deepEqual(both(wholeFragment(linear).data), [[PROTEIN_A], [PROTEIN_B]], "the whole molecule");
  // On a circle, rotated and opened elsewhere, including a CDS that crosses the origin.
  const across: Shape = { label: "across the origin", circular: true, parts: [{ start: 280, end: 78 }], strand: 1 };
  const circle = doc("c", filler(N, 12), true, [imported(across, "a", PROTEIN_A), imported({ ...BEHIND, circular: true, parts: [{ start: 150, end: 230 }] }, "b", PROTEIN_B)]);
  for (const window of [{ start: 140, end: 100 }, { start: 250, end: 249 }, { start: 100, end: 99 }]) {
    const f = wholeFragment(circle, window);
    assert.deepEqual(both(f.data), [[PROTEIN_A], [PROTEIN_B]], `opened at ${window.start}`);
    assert.deepEqual(both(flip(f).data), [[PROTEIN_A], [PROTEIN_B]], `opened at ${window.start}, turned round`);
  }
  // A digest that leaves the CDS whole.
  const cutAfter = doc("t", filler(N, 11).slice(0, 20) + "GAATTC" + filler(N, 11).slice(26), false, [imported(FORWARD, "a", PROTEIN_A)]);
  assert.equal(digest(cutAfter, ["EcoRI"]).length, 2);
  assert.deepEqual(translationOf(digest(cutAfter, ["EcoRI"])[1].data, "a"), [PROTEIN_A]);
});

test("a fragment that cuts into a CDS drops the translation it was imported with, and adds no qualifier", () => {
  const linear = doc("t", filler(N, 11), false, [imported(FORWARD, "a", PROTEIN_A), imported(BEHIND, "b", PROTEIN_B)]);
  const cut = (start: number, end: number) => wholeFragment(linear, { start, end }).data;
  assert.equal(translationOf(cut(50, 150), "a"), undefined, "its end cut off");
  assert.equal(translationOf(cut(150, 295), "a"), undefined, "its start cut off");
  assert.equal(translationOf(cut(50, 250), "b"), undefined, "a reverse CDS's start cut off");
  assert.equal(translationOf(cut(250, 295), "b"), undefined, "a reverse CDS's end cut off");
  // What it did not cut keeps it, and everything else about the CDS stays.
  assert.deepEqual(translationOf(cut(50, 250), "a"), [PROTEIN_A]);
  assert.deepEqual(translationOf(cut(150, 295), "b"), [PROTEIN_B]);
  const notes = (d: SeqData, id: string) => Object.keys(d.features.find(f => f.id === id)!.notes).sort();
  assert.deepEqual(notes(cut(50, 150), "a"), ["product"], "no /codon_start where the frame did not change");
  assert.deepEqual(notes(cut(150, 295), "a"), ["codon_start", "product"], "only the /codon_start a cut at its start needs");
});

test("a cut that only takes bases outside a CDS's whole codons keeps its translation", () => {
  // A partial CDS from a database: GenBank's /codon_start=2 says its first base ends a codon before it,
  // and 100 coding bases make 33 codons and one base over.
  const partial: Shape = { label: "partial", circular: false, parts: [{ start: 100, end: 200 }], strand: 1, codonStart: ["2"] };
  const linear = doc("t", filler(N, 11), false, [imported(partial, "p", PROTEIN_A)]);
  const cds = (start: number, end: number) => wholeFragment(linear, { start, end }).data.features.find(f => f.id === "p")!;
  assert.deepEqual(cds(101, 250).notes.translation, [PROTEIN_A], "its skipped first base");
  assert.deepEqual(cds(101, 250).notes.codon_start, ["1"], "it starts on a codon now");
  assert.equal(cds(102, 250).notes.translation, undefined, "a base of its first codon");
  assert.deepEqual(cds(50, 199).notes.translation, [PROTEIN_A], "its base after the last codon");
  assert.equal(cds(50, 198).notes.translation, undefined, "the last codon's last base");
});

test("a translation that is kept is the text it was imported with, whatever the amber setting", () => {
  // TAG is a codon here: the app reads it as Q or as a stop by its setting, but an imported text is not read.
  const gene = "ATGTAGGCTAAATGA";
  const sequence = filler(N, 11).slice(0, 100) + gene + filler(N, 12).slice(0, N - 100 - gene.length);
  const linear = doc("t", sequence, false, [imported({ label: "gene", circular: false, parts: [{ start: 100, end: 114 }], strand: 1 }, "g", "MQAK")]);
  for (const amber of [false, true]) {
    useAmberSuppression(amber);
    try {
      assert.deepEqual(translationOf(wholeFragment(linear, { start: 90, end: 130 }).data, "g"), ["MQAK"], `amber ${amber}: whole gene`);
      assert.equal(translationOf(wholeFragment(linear, { start: 90, end: 112 }).data, "g"), undefined, `amber ${amber}: cut gene`);
    } finally {
      useAmberSuppression(false);
    }
  }
});
