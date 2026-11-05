// Virtual digests and gels. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { bandY, bands, digestSequence, fragmentName, fragmentSize, fragmentSpan, LADDERS } from "./gel.ts";
import type { SeqData } from "./seqdata.ts";

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

test("gel: fragments of nearly the same size run as one band", () => {
  const b = bands([1000, 3000, 1010, 500]);
  assert.deepEqual(b.map(x => x.fragments), [[1], [2, 0], [3]]);
  assert.equal(b[1].mass, 2010);
  assert.equal(b[1].size, 1005);
});
