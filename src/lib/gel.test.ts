// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Virtual digests and gels. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { bandY, bands, digestSequence, fragmentName, fragmentSize, fragmentSpan, ladderReaching, LADDERS } from "./gel.ts";
import { reverseComplement, setOrigin, type SeqData } from "./seqdata.ts";
import { reactionCounts } from "./enzymes.ts";
import { PCR_DNA } from "./methylation.ts";

const puc19 = (): SeqData => {
  const gb = readFileSync(new URL("../../testdata/e2e/pUC19-annotated.gb", import.meta.url), "utf8");
  const sequence = gb.split("ORIGIN")[1].replace(/[^acgtn]/gi, "").toUpperCase();
  return { name: "pUC19", description: "", circular: true, sequence, features: [], primers: [], sources: [] };
};

test("digest: pUC19 with EcoRI and HindIII, largest first, adding up to the plasmid", () => {
  const d = puc19();
  const r = digestSequence(d, ["EcoRI", "HindIII"]);
  assert.equal(r.uncut, false);
  assert.deepEqual(r.fragments.map(fragmentSize), [2635, 51]);
  assert.equal(fragmentName(r.fragments[1], "pUC19"), "pUC19 EcoRI–HindIII 51 bp");
  // The small fragment's top strand runs from EcoRI's cut to HindIII's.
  assert.deepEqual(fragmentSpan(r.fragments[1], d.sequence.length), { start: 396, end: 446 });
  // The large one crosses the origin.
  const big = fragmentSpan(r.fragments[0], d.sequence.length);
  assert.deepEqual(big, { start: 447, end: 395 });
});

test("digest: 3′ overhangs and blunt ends still add up", () => {
  const d = puc19();
  const sizes = digestSequence(d, ["PvuI", "PvuII"]).fragments.map(fragmentSize);
  assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a));
  assert.equal(sizes.reduce((a, b) => a + b, 0), d.sequence.length);
  assert.deepEqual(digestSequence(d, ["PstI"]).fragments.map(fragmentSize), [d.sequence.length]);
});

test("digest: uncut plasmid, and a linear sequence stays whole", () => {
  const d = puc19();
  assert.deepEqual(digestSequence(d, []), { fragments: [], uncut: true });
  const linear = digestSequence({ ...d, circular: false }, []);
  assert.equal(linear.uncut, false);
  assert.deepEqual(linear.fragments.map(fragmentSize), [d.sequence.length]);
  const cut = digestSequence({ ...d, circular: false }, ["EcoRI"]).fragments.map(fragmentSize);
  assert.equal(cut.reduce((a, b) => a + b, 0), d.sequence.length);
});

test("gel: bigger runs higher, within the gel", () => {
  for (const ladder of LADDERS) {
    const ys = [50000, ...ladder.bands, 10].map(s => bandY(s, ladder));
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] >= ys[i - 1], `${ladder.name}: ${ys}`);
    assert.ok(ys.every(y => y > 0 && y < 1));
  }
});

test("digest reports crossed cuts in linear sequences and across a circular origin", () => {
  const sequence = "A".repeat(70) + "GGTCTCTGCAG" + "A".repeat(12);
  for (const d of [{ ...puc19(), sequence, circular: false }, setOrigin({ ...puc19(), sequence }, 79)]) {
    const result = digestSequence(d, ["PstI", "BsaI"]);
    assert.deepEqual(result.fragments, []);
    assert.equal(result.uncut, false);
    assert.match(result.problem ?? "", /cuts overlap/);
  }
});

test("digest includes both sets of cuts for BcgI on either strand", () => {
  const sequence = "AT".repeat(41) + "CGAAAAAAATGC" + "AT".repeat(41);
  for (const bases of [sequence, reverseComplement(sequence)]) {
    const result = digestSequence({ ...puc19(), sequence: bases, circular: false }, ["BcgI"]);
    assert.deepEqual(result.fragments.map(fragmentSize), [72, 70, 34]);
    assert.equal(result.fragments.reduce((n, f) => n + fragmentSize(f), 0), 176);
  }
  const nearEnd = "AT".repeat(41) + "CGAAAAAAATGC";
  const edgeSizes = (sequence: string) => digestSequence({ ...puc19(), sequence, circular: false }, ["BcgI"]).fragments.map(fragmentSize);
  assert.deepEqual(edgeSizes(nearEnd), [72, 22]);
  assert.deepEqual(edgeSizes(reverseComplement(nearEnd)), [70, 24]);
  const count = reactionCounts({ ...puc19(), sequence: nearEnd, circular: false }, ["BcgI"], PCR_DNA);
  assert.equal(count.sites.get("BcgI"), 1);
  assert.equal(count.cuts.get("BcgI"), 1);
});

test("gel: fragments of nearly the same size run as one band", () => {
  const b = bands([1000, 3000, 1010, 500]);
  assert.deepEqual(b.map(x => x.fragments), [[1], [2, 0], [3]]);
  assert.equal(b[1].mass, 2010);
  assert.equal(b[1].size, 1005);
});

test("gel: a band takes fragments within the resolution of its largest, so close sizes don't chain into one", () => {
  // Each is 1.5% under the one before it, but the last is 6% under the first.
  const b = bands([1000, 985, 970, 955, 940]);
  assert.deepEqual(b.map(x => x.fragments), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(b.map(x => x.size), [992.5, 962.5, 940]);
  // Exactly 2.0% under the largest is one band and 2.1% is two, with fragments between or not.
  assert.deepEqual(bands([1000, 980]).map(x => x.fragments), [[0, 1]]);
  assert.deepEqual(bands([1000, 979]).map(x => x.fragments), [[0], [1]]);
  assert.deepEqual(bands([1000, 990, 980]).map(x => x.fragments), [[0, 1, 2]]);
  assert.deepEqual(bands([1000, 990, 979]).map(x => x.fragments), [[0, 1], [2]]);
  // The indexes are the lane's list, in whatever order it came, and the resolution can be changed.
  assert.deepEqual(bands([940, 1000, 955, 985, 970]).map(x => x.fragments), [[1, 3], [4, 2], [0]]);
  assert.deepEqual(bands([100, 90], 0.1).map(x => x.fragments), [[0, 1]]);
  assert.deepEqual(bands([100, 89], 0.1).map(x => x.fragments), [[0], [1]]);
  assert.deepEqual(bands([]), []);
});

test("gel: it opens on the first ladder that reaches the smallest band, else the first", () => {
  const smallest = (id: string) => Math.min(...LADDERS.find(l => l.id === id)!.bands);
  assert.equal(smallest("1kb"), 500);
  // Big bands are as well off on the first, the 1 kb ladder, as on any.
  assert.equal(ladderReaching(5000).id, "1kb");
  assert.equal(ladderReaching(500).id, "1kb");
  // A band under its smallest takes the first ladder that goes lower: the 1 kb ladder puts everything of 312 bp or less on the edge.
  assert.equal(ladderReaching(499).id, "1kb-plus");
  assert.equal(ladderReaching(314).id, "1kb-plus");
  assert.equal(ladderReaching(100).id, "1kb-plus");
  assert.equal(bandY(300, LADDERS[0]), 0.99);
  // The first one that reaches, not the best fit: it is the order of LADDERS that decides.
  const [a, b] = [{ ...LADDERS[0], id: "a", bands: [900, 300] }, { ...LADDERS[0], id: "b", bands: [900, 100] }];
  assert.equal(ladderReaching(400, [b, a]).id, "b");
  assert.equal(ladderReaching(400, [a, b]).id, "a");
  // Under every ladder's smallest band nothing reaches, so the first that goes lowest stands:
  // the 1 kb Plus ladder (100 bp, as the 100 bp ladder, which comes after it), not the 1 kb.
  assert.equal(ladderReaching(99).id, "1kb-plus");
  assert.equal(ladderReaching(39).id, "1kb-plus");
  assert.equal(ladderReaching(1).id, "1kb-plus");
  assert.equal(ladderReaching(50, [a, b]).id, "b");
  assert.equal(ladderReaching(50, [b, a]).id, "b");
  // Wherever one reaches, the smallest band is drawn clear of the bottom edge.
  for (let size = 100; size <= 20000; size += 7) assert.ok(bandY(size, ladderReaching(size)) < 0.99, `${size} bp`);
});
