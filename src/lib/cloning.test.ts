// Cloning simulation: digests, ligation, overlap assembly and Golden Gate. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { compatible, cutsFor, digest, findOverlap, flip, fragmentWith, goldenGate, GIBSON, IN_FUSION, largest, ligateInsert, planAssembly, selfLigates, wholeFragment } from "./cloning.ts";
import { regionsOf, withRegions } from "./regions.ts";
import { featureBases, reverseComplement, setOrigin, type SeqData, type SeqFeature } from "./seqdata.ts";

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
  // Without overlaps or PCR, nothing joins.
  const none = planAssembly([{ name: "x", fragment: wholeFragment(doc("x", x, false)) }, { name: "z", fragment: wholeFragment(doc("z", filler(300, 15), false)) }], GIBSON);
  assert.equal(none.product, null);
  assert.match(none.problems[0], /don't overlap/);
  assert.equal(findOverlap("AAAACCCCGGGG", "CCGGGGTTTT", 4), 6);
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

test("opening a circle inside a CDS renumbers the regions of the piece it keeps", () => {
  const region = (name: string, start: number, end: number) => ({ name, kind: "Transmembrane", start, end, accession: "", sourceStart: start, sourceEnd: end, predicted: false });
  // 30 bases from 51 round to 20: 9 before the origin, 21 after it, which is the piece kept.
  const f: SeqFeature = { ...feature("cds", 51, 20), notes: withRegions({}, [region("TM1", 1, 3), region("TM2", 8, 10)]) };
  const kept = wholeFragment(doc("p", filler(60, 7), true, [f])).data.features[0];
  assert.deepEqual([kept.start, kept.end], [0, 20]);
  assert.deepEqual(regionsOf(kept).map(r => [r.name, r.start, r.end]), [["TM2", 5, 7]]);
});
