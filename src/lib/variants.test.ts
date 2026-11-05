// A clone's mutations, flags and identity from its consensus. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { translateCodon, useAmberSuppression } from "./genetics.ts";
import { cloneSequence, cloneVariants, coveredRanges } from "./variants.ts";
import type { CloneDifference, CloneResult, Conflict, Feature } from "./types.ts";
import type { SeqData } from "./seqdata.ts";

const gb = readFileSync(new URL("../../testdata/e2e/pUC19-annotated.gb", import.meta.url), "utf8");
const REF = gb.split("ORIGIN")[1].replace(/[^acgtn]/gi, "").toUpperCase();
const n = REF.length;
// As annotated in the file: AmpR runs right to left, so W163 is TGG read from 2000 down.
const FEATURES: Feature[] = [
  { name: "lacZ-alpha", type: "CDS", start: 145, end: 468, strand: -1, forward: false },
  { name: "MCS", type: "misc_feature", start: 395, end: 453, strand: 1, forward: true },
  { name: "AmpR", type: "CDS", start: 1625, end: 2485, strand: -1, forward: false },
  // Made up, outside both CDSs.
  { name: "ori", type: "rep_origin", start: 1100, end: 1300, strand: 1, forward: true }
];
const COMP: Record<string, string> = { A: "T", C: "G", G: "C", T: "A" };

const diff = (d: Partial<CloneDifference> & Pick<CloneDifference, "kind" | "refPos">): CloneDifference => ({
  refBases: "",
  readBases: "",
  readPos: 0,
  quality: 40,
  confident: true,
  reads: [0],
  ...d
});
const sub = (p: number, base: string) => diff({ kind: "substitution", refPos: p, refBases: REF[p], readBases: base });
const del = (p: number, length: number) => diff({ kind: "deletion", refPos: p, refBases: REF.slice(p, p + length) });
const ins = (p: number, bases: string) => diff({ kind: "insertion", refPos: p, readBases: bases });

function clone(differences: CloneDifference[], spans: [number, number][] = [[1600, 2500]], conflicts: Conflict[] = []): CloneResult {
  return {
    key: "c",
    reads: [0],
    pieces: spans.map(([a, b]) => ({ refFrom: a, refTo: b, gappedReference: REF.slice(a, b), gappedConsensus: REF.slice(a, b), qualities: [], depth: [] })),
    differences,
    conflicts
  };
}
const variants = (c: CloneResult) => cloneVariants(c, REF, true, FEATURES);
const labels = (c: CloneResult) => variants(c).mutations.map(m => `${m.feature} ${m.label}`);

test("a change in a CDS is named by its amino acid, on either strand", () => {
  // The e2e read's A2000G: AmpR W163R.
  const v = variants(clone([sub(1999, "G")]));
  // Its position is the codon's first base in reading order.
  assert.deepEqual(v.mutations, [{ label: "W163R", feature: "AmpR", kind: "missense", refPos: 1999 }]);
  assert.deepEqual(v.flags, []);
});

test("two changes in one codon are one amino-acid change", () => {
  // W163's codon is TGG on AmpR's strand, at 1999, 1998 and 1997 on the top strand.
  const c = clone([sub(1999, "G"), sub(1998, "A")]);
  const codon = COMP.G + COMP.A + COMP[REF[1997]];
  assert.deepEqual(labels(c), [`AmpR W163${translateCodon(codon)}`]);
});

test("stops, silent changes and amber suppression", () => {
  // TGG → TGA (top strand C → T at 1997).
  const stop = variants(clone([sub(1997, "T")]));
  assert.deepEqual(stop.mutations.map(m => [m.label, m.kind]), [["W163*", "nonsense"]]);
  assert.deepEqual(stop.flags, ["stop"]);
  // TGG → TAG reads as Q in suppressor strains.
  const amber = clone([sub(1998, "T")]);
  assert.deepEqual(labels(amber), ["AmpR W163*"]);
  useAmberSuppression(true);
  try {
    assert.deepEqual(labels(amber), ["AmpR W163Q"]);
    assert.deepEqual(variants(amber).flags, []);
  } finally {
    useAmberSuppression(false);
  }
  // A change that keeps the amino acid is listed as silent.
  const third = 2485 - 3 * 99; // first base of codon 100 on the top strand
  const codon = [third, third - 1, third - 2].map(p => COMP[REF[p]]).join("");
  const alternatives = ["A", "C", "G", "T"].filter(b => b !== codon[2] && translateCodon(codon.slice(0, 2) + b) === translateCodon(codon));
  if (alternatives.length) {
    const v = variants(clone([sub(third - 2, COMP[alternatives[0]])]));
    assert.deepEqual(v.mutations.map(m => m.kind), ["silent"]);
    assert.match(v.mutations[0].label, /^[A-Z]100=$/);
  }
});

test("frameshifts and in-frame indels", () => {
  const fs = variants(clone([del(2100, 1)]));
  assert.deepEqual(fs.flags, ["frameshift"]);
  assert.equal(fs.mutations.length, 1);
  assert.match(fs.mutations[0].label, /^[A-Z]129fs$/);
  // Three bases inside codon 129 change it into two amino acids.
  const plus3 = variants(clone([ins(2100, "GCA")]));
  assert.deepEqual(plus3.flags, []);
  assert.equal(plus3.mutations[0].kind, "inframe");
  assert.match(plus3.mutations[0].label, /^[A-Z]1(29|28_[A-Z]129|29_[A-Z]130)(delins|ins)[A-Z]{1,2}$/);
  // A whole codon between codons 129 (ends at 2099) and 130: an insertion, not delins.
  // GCA on the top strand reads TGC, Cys, on AmpR's.
  const between = variants(clone([ins(2099, "GCA")]));
  assert.match(between.mutations[0].label, /^[A-Z]129_[A-Z]130insC$/);
  // Deleting a whole codon (codon 129 is 2101, 2100, 2099 on the top strand).
  const minus3 = variants(clone([del(2099, 3)]));
  assert.match(minus3.mutations[0].label, /^[A-Z]129del$/);
  // Two whole codons (129 and 130): a range.
  const minus6 = variants(clone([del(2096, 6)]));
  assert.match(minus6.mutations[0].label, /^[A-Z]129_[A-Z]130del$/);
});

test("changes outside a CDS are DNA changes", () => {
  const v = variants(clone([sub(1000, "A" === REF[1000] ? "C" : "A")], [[900, 1100]]));
  assert.deepEqual(v.mutations.map(m => [m.label, m.kind, m.feature]), [[`${REF[1000]}1001${"A" === REF[1000] ? "C" : "A"}`, "dna", null]]);
  // In a feature that isn't coding, it says which.
  const ori = variants(clone([sub(1200, REF[1200] === "A" ? "C" : "A")], [[1100, 1300]]));
  assert.deepEqual(ori.mutations.map(m => [m.kind, m.feature]), [["dna", "ori"]]);
  // The MCS lies in lacZα, so a change there is a lacZα amino-acid change.
  const mcs = variants(clone([sub(420, REF[420] === "A" ? "C" : "A")], [[100, 500]]));
  assert.equal(mcs.mutations[0].feature, "lacZ-alpha");
});

test("parts no read covered are never unchanged", () => {
  // Reads over half of AmpR: partly covered, and its protein has X where not read.
  const half = variants(clone([], [[2000, 2500]]));
  assert.deepEqual(half.flags, ["partial"]);
  const amp = half.proteins.find(p => p.feature === "AmpR")!.protein;
  assert.ok(amp.startsWith("MSIQHFRVALIPF"), amp.slice(0, 20));
  assert.ok(amp.endsWith("X"), amp.slice(-5));
  // All of AmpR: the whole protein, up to its stop.
  const whole = variants(clone([], [[1500, 2600]]));
  assert.deepEqual(whole.flags, []);
  assert.ok(whole.proteins[0].protein.endsWith("*") && !whole.proteins[0].protein.includes("X"));
  assert.deepEqual(whole.uncovered, [{ start: 2600, end: 1499 }]);
  assert.deepEqual(variants(clone([], [])).flags, ["unaligned"]);
});

test("good reads that disagree flag the clone", () => {
  const c = clone([], [[1500, 2600]], [{ kind: "base", refPos: 2100, refBases: REF[2100], calls: [] }]);
  assert.deepEqual(variants(c).flags, ["conflict"]);
});

test("identical clones share a key, differently read ones don't", () => {
  const a = variants(clone([sub(1999, "G")], [[1500, 2600]]));
  const b = variants(clone([sub(1999, "G")], [[1400, 2650]]));
  const partial = variants(clone([sub(1999, "G")], [[1900, 2600]]));
  const other = variants(clone([sub(1997, "T")], [[1500, 2600]]));
  assert.equal(a.key, b.key);
  assert.notEqual(a.key, partial.key);
  assert.notEqual(a.key, other.key);
  // The same protein change from different DNA is a different clone.
  const tga = variants(clone([sub(1997, "T")], [[1500, 2600]]));
  const tag = variants(clone([sub(1998, "T")], [[1500, 2600]]));
  assert.deepEqual([tga.mutations[0].label, tag.mutations[0].label], ["W163*", "W163*"]);
  assert.notEqual(tga.key, tag.key);
  // Uncertain differences don't make a clone different.
  const unsure = variants(clone([sub(1999, "G"), { ...sub(2200, "A"), confident: false }], [[1500, 2600]]));
  assert.equal(unsure.key, a.key);
});

test("covered ranges join across the origin", () => {
  const c = clone([], [[0, 300], [2400, n]]);
  assert.deepEqual(coveredRanges(c, n, true), [{ start: 2400, end: 299 }]);
  assert.deepEqual(coveredRanges(c, n, false), [{ start: 0, end: 299 }, { start: 2400, end: n - 1 }]);
});

test("a clone as a sequence keeps the reference where no read reached", () => {
  const data: SeqData = {
    name: "pUC19",
    description: "",
    circular: true,
    sequence: REF,
    features: [{ id: "amp", name: "AmpR", type: "CDS", start: 1625, end: 2485, strand: -1, notes: {}, raw: {} }],
    primers: [],
    sources: []
  };
  const c = clone([sub(1999, "G"), ins(2100, "GCA"), del(2200, 3), sub(2200, "T")].slice(0, 3));
  const out = cloneSequence(data, c);
  assert.equal(out.sequence.length, n);
  assert.equal(out.sequence[1999], "G");
  assert.equal(out.sequence.slice(2100, 2103), "GCA");
  assert.equal(out.sequence.slice(0, 1999), REF.slice(0, 1999));
  assert.equal(out.sequence.slice(2206), REF.slice(2206));
  // AmpR still spans the same bases: three in, three out.
  assert.deepEqual([out.features[0].start, out.features[0].end], [1625, 2485]);
  // Uncertain differences are left as the reference.
  const unsure = cloneSequence(data, clone([{ ...sub(1999, "G"), confident: false }]));
  assert.equal(unsure.sequence, REF);
});

// ---------- variable regions, on the nanobody library's parent ----------

const libGb = readFileSync(new URL("../../testdata/library/library-parent.gb", import.meta.url), "utf8");
const LIB = libGb.split("ORIGIN")[1].replace(/[^acgtn]/gi, "").toUpperCase();
// As annotated in the file (0-based here); the CDRs are Gly stuffers the library replaces.
const VHH = {
  fr1: { name: "FR1", type: "CDS", start: 2096, end: 2170, forward: true },
  cdr1: { name: "cdr1", type: "CDS", start: 2171, end: 2200, forward: true },
  fr2: { name: "FR2", type: "CDS", start: 2201, end: 2242, forward: true },
  cdr2: { name: "cdr2", type: "CDS", start: 2243, end: 2272, forward: true },
  fr3: { name: "FR3", type: "CDS", start: 2273, end: 2383, forward: true },
  cdr3: { name: "cdr3", type: "variation", start: 2384, end: 2416, forward: true },
  fr4: { name: "FR4", type: "CDS", start: 2417, end: 2449, forward: true }
} satisfies Record<string, Feature>;
const ANY = { kind: "any" } as const;
// A01's CDR1 and CDR3 as its read gives them (CDR3 has 18 more bases than the stuffer).
const A01_CDR1 = "GCCCGAACCTTTTCCTCTTACGCTATGGCG";
const A01_CDR3 = "GCAGCGCGTCTGCACAGCGCCGTTGTACCGACGGAAGGAGACTATGGCTAT";

/**
 * A clone of the library's parent as the core reports it: each edit replaces `start..end`
 * with `bases`, extra bases inserted before the region and missing ones deleted at its end.
 */
function libClone(edits: { start: number; end: number; bases: string; quality?: number }[], from = 1990, to = 2700): CloneResult {
  let gref = "";
  let gcon = "";
  const quals: number[] = [];
  const differences: CloneDifference[] = [];
  for (let p = from; p < to; ) {
    const e = edits.find(x => x.start === p);
    if (!e) {
      gref += LIB[p];
      gcon += LIB[p];
      quals.push(40);
      p++;
      continue;
    }
    const q = e.quality ?? 40;
    const len = e.end - e.start + 1;
    const extra = e.bases.length - len;
    if (extra > 0) {
      gref += "-".repeat(extra);
      gcon += e.bases.slice(0, extra);
      quals.push(...new Array(extra).fill(q));
      differences.push(diff({ kind: "insertion", refPos: p, readBases: e.bases.slice(0, extra), quality: q, confident: q >= 20 }));
    }
    const paired = e.bases.slice(Math.max(0, extra));
    for (let i = 0; i < len; i++) {
      const r = LIB[p + i];
      const b = paired[i] ?? "-";
      gref += r;
      gcon += b;
      quals.push(q);
      if (b !== "-" && b !== r) differences.push(diff({ kind: "substitution", refPos: p + i, refBases: r, readBases: b, quality: q, confident: q >= 20 }));
    }
    if (extra < 0) differences.push(diff({ kind: "deletion", refPos: p + len + extra, refBases: LIB.slice(p + len + extra, p + len), quality: q, confident: q >= 20 }));
    p += len;
  }
  return { key: "c", reads: [0], pieces: [{ refFrom: from, refTo: to, gappedReference: gref, gappedConsensus: gcon, qualities: quals, depth: [] }], differences, conflicts: [] };
}
const libFeatures = (marks: Partial<Record<keyof typeof VHH, Feature["variable"]>>) =>
  Object.entries(VHH).map(([k, f]) => (marks[k as keyof typeof VHH] ? { ...f, variable: marks[k as keyof typeof VHH] } : f));
const libVariants = (c: CloneResult, marks: Partial<Record<keyof typeof VHH, Feature["variable"]>>) => cloneVariants(c, LIB, true, libFeatures(marks));

test("a variable region's bases are the clone's contents, not mutations", () => {
  const c = libClone([{ start: 2171, end: 2200, bases: A01_CDR1 }]);
  // Unmarked, the stuffer's replacement reads as a row of mutations.
  assert.ok(libVariants(c, {}).mutations.length > 5);
  const v = libVariants(c, { cdr1: ANY });
  assert.deepEqual(v.mutations, []);
  assert.deepEqual(v.flags, []);
  assert.deepEqual(v.regions, [{ feature: "cdr1", bases: A01_CDR1, protein: "ARTFSSYAMA", read: "all", alternative: null, mutations: [], violations: [], mixed: false }]);
  // The clone's proteins and its sequence have its CDR.
  assert.ok(v.proteins.find(p => p.feature === "cdr1")?.protein.startsWith("ARTFSSYAMA"));
});

test("a longer loop is expected; a length change that isn't whole codons is a frameshift", () => {
  // CDR3 is not coding in the file, so it shows as bases; its extra bases sit before it.
  const longer = libVariants(libClone([{ start: 2384, end: 2416, bases: A01_CDR3 }]), { cdr3: ANY });
  assert.deepEqual(longer.mutations, []);
  assert.deepEqual(longer.flags, []);
  assert.equal(longer.regions[0].bases, A01_CDR3);
  assert.equal(longer.regions[0].protein, null);
  const shifted = libVariants(libClone([{ start: 2171, end: 2200, bases: A01_CDR1 + "G" }]), { cdr1: ANY });
  assert.deepEqual(shifted.flags, ["frameshift"]);
  assert.match(shifted.mutations[0].label, /fs$/);
});

test("another loop length inside a larger CDS is expected too", () => {
  // The VHH as one CDS with CDR1 inside it, three codons longer.
  const vhh: Feature = { name: "VHH", type: "CDS", start: 2096, end: 2449, forward: true };
  const cdr1: Feature = { ...VHH.cdr1, type: "misc_feature", variable: ANY };
  const v = cloneVariants(libClone([{ start: 2171, end: 2200, bases: "GCAGCGGCG" + A01_CDR1 }]), LIB, true, [vhh, cdr1]);
  assert.deepEqual(v.mutations, []);
  assert.deepEqual(v.flags, []);
  assert.equal(v.regions[0].protein, "AAAARTFSSYAMA");
});

test("a frameshift runs on through features that touch it", () => {
  const edits = [{ start: 2215, end: 2215, bases: "" }, { start: 2300, end: 2300, bases: "T" }];
  const v = libVariants(libClone(edits), { cdr1: ANY, cdr2: ANY, cdr3: ANY });
  assert.deepEqual(v.flags, ["frameshift"]);
  // Only where it starts, numbered in its feature, and not what comes after it.
  assert.deepEqual(v.mutations.map(m => [m.feature, m.kind]), [["FR2", "frameshift"]]);
  assert.match(v.mutations[0].label, /^[A-Z]5fs$/);
  assert.deepEqual(v.proteins.map(p => p.feature), ["FR1", "cdr1", "FR2"]);
});

test("a frameshift in a region between two CDSs counts, and a stop there too", () => {
  const shifted = libVariants(libClone([{ start: 2384, end: 2416, bases: `A${A01_CDR3}` }]), { cdr3: ANY });
  assert.deepEqual(shifted.flags, ["frameshift"]);
  assert.deepEqual(shifted.mutations.map(m => m.feature), ["cdr3"]);
  assert.ok(!shifted.proteins.some(p => p.feature === "FR4"));
  const stopped = libVariants(libClone([{ start: 2384, end: 2416, bases: `TAA${LIB.slice(2387, 2417)}` }]), { cdr3: ANY });
  assert.deepEqual(stopped.flags, ["stop"]);
  assert.deepEqual(stopped.mutations, []);
  // Unchanged, it is translated with the rest.
  const same = libVariants(libClone([]), { cdr3: ANY });
  assert.deepEqual(same.proteins.map(p => p.feature), ["FR1", "cdr1", "FR2", "cdr2", "FR3", "cdr3", "FR4"]);
});

test("where two features meet, an indel belongs to their frame", () => {
  const inserted = libVariants(libClone([{ start: 2201, end: 2201, bases: `A${LIB[2201]}` }]), {});
  assert.deepEqual(inserted.flags, ["frameshift"]);
  assert.deepEqual(inserted.mutations.map(m => [m.feature, m.kind]), [["FR2", "frameshift"]]);
  // Three bases across the seam keep the frame, though neither feature keeps its own.
  const deleted = libVariants(libClone([{ start: 2200, end: 2202, bases: "" }]), {});
  assert.deepEqual(deleted.flags, []);
  assert.deepEqual(deleted.mutations.map(m => m.kind), ["inframe"]);
});

test("a framework read out of frame between two loops is not an expected length", () => {
  const edits = [{ start: 2171, end: 2200, bases: `A${LIB.slice(2171, 2201)}` }, { start: 2243, end: 2272, bases: LIB.slice(2243, 2272) }];
  const v = libVariants(libClone(edits), { cdr1: ANY, cdr2: ANY });
  assert.deepEqual(v.mutations.map(m => m.kind), ["inframe"]);
});

test("a CDS ending in a stop doesn't run on into the next", () => {
  const seq = "ATGGCTTAA" + "ATGAAACCC" + "GGGGGG";
  const features: Feature[] = [
    { name: "one", type: "CDS", start: 0, end: 8, forward: true },
    { name: "two", type: "CDS", start: 9, end: 17, forward: true }
  ];
  const c: CloneResult = {
    key: "c",
    reads: [0],
    pieces: [{ refFrom: 0, refTo: seq.length, gappedReference: `${seq.slice(0, 3)}-${seq.slice(3)}`, gappedConsensus: `${seq.slice(0, 3)}A${seq.slice(3)}`, qualities: [], depth: [] }],
    differences: [diff({ kind: "insertion", refPos: 3, readBases: "A" })],
    conflicts: []
  };
  const v = cloneVariants(c, seq, false, features);
  assert.deepEqual(v.mutations.map(m => m.feature), ["one"]);
  assert.deepEqual(v.proteins.map(p => p.feature), ["one", "two"]);
});

test("bases a pattern doesn't allow break the design", () => {
  // NNK at every codon of CDR2: an A as a third base is not allowed.
  const bases = "GGT".repeat(10).split("");
  bases[5] = "A";
  const v = libVariants(libClone([{ start: 2243, end: 2272, bases: bases.join("") }]), { cdr2: { kind: "pattern", pattern: "NNK" } });
  assert.deepEqual(v.flags, ["design"]);
  assert.deepEqual(v.regions[0].violations, ["A at 2249 not allowed by NNK"]);
  assert.deepEqual(v.mutations, []);
});

test("a region with versions shows the closest one and differences from it", () => {
  // FR2 comes in two versions: v1 (the parent's) and v2, three codons apart.
  const fr2v1 = LIB.slice(2201, 2243);
  const codons = fr2v1.match(/.../g)!;
  const fr2v2 = codons.map((c, i) => ({ 1: "GTT", 9: "CTG", 11: "TGC" })[i] ?? c).join("");
  const design = { kind: "alternatives" as const, options: [{ name: "v1", bases: fr2v1 }, { name: "v2", bases: fr2v2 }] };
  const same = libVariants(libClone([{ start: 2201, end: 2242, bases: fr2v2 }]), { fr2: design });
  assert.equal(same.regions[0].alternative, "v2");
  assert.equal(same.regions[0].protein, "WVRQAPGKELECVA");
  assert.deepEqual(same.mutations, []);
  // v2 with A5T: one mutation, numbered in FR2.
  const changed = fr2v2.slice(0, 12) + "A" + fr2v2.slice(13);
  const v = libVariants(libClone([{ start: 2201, end: 2242, bases: changed }]), { fr2: design });
  assert.equal(v.regions[0].alternative, "v2");
  assert.deepEqual(v.mutations.map(m => `${m.feature} ${m.label}`), ["FR2 A5T"]);
});

test("uncertain bases in a region are lower case, and X in its protein", () => {
  const v = libVariants(libClone([{ start: 2171, end: 2200, bases: A01_CDR1, quality: 12 }]), { cdr1: ANY });
  assert.equal(v.regions[0].bases, A01_CDR1.toLowerCase());
  assert.equal(v.regions[0].protein, "XXXXXXXXXX");
  assert.deepEqual(v.mutations, []);
});

test("a region the reads don't reach is not read, never unchanged", () => {
  const v = libVariants(libClone([], 1990, 2190), { cdr1: ANY, cdr3: ANY });
  assert.deepEqual(v.regions.map(r => [r.feature, r.read, r.bases]), [["cdr1", "part", ""], ["cdr3", "none", ""]]);
  assert.ok(v.flags.includes("partial"));
});

test("clones with other CDRs are different clones, and open with their CDRs", () => {
  const a = libClone([{ start: 2171, end: 2200, bases: A01_CDR1 }]);
  const b = libClone([{ start: 2171, end: 2200, bases: A01_CDR1.replace("GCCCGA", "GGCATG") }]);
  assert.notEqual(libVariants(a, { cdr1: ANY }).key, libVariants(b, { cdr1: ANY }).key);
  // The read set keeps region differences apart; the clone's sequence still has them.
  const split: CloneResult = { ...a, differences: [], variable: a.differences };
  const data = { name: "lib", description: "", circular: true, sequence: LIB, features: [], primers: [], sources: [] } as SeqData;
  assert.equal(cloneSequence(data, split).sequence.slice(2171, 2201), A01_CDR1);
});

test("calls among double peaks are left out, and a mix is named", () => {
  // A deletion in FR4 that only noisy reads show: not a frameshift.
  const c = libClone([{ start: 2171, end: 2200, bases: A01_CDR1 }, { start: 2430, end: 2430, bases: "" }]);
  assert.ok(libVariants(c, { cdr1: ANY }).flags.includes("frameshift"));
  const unreliable = new Set(Array.from({ length: 30 }, (_, i) => 2420 + i));
  const noisy = cloneVariants(c, LIB, true, libFeatures({ cdr1: ANY }), 20, { mixed: null, poor: false, unreliable, mixedRegions: new Set() });
  assert.deepEqual(noisy.flags, []);
  assert.deepEqual(noisy.mutations, []);
  assert.equal(noisy.leftOut.length, 1);
  // A mix: flagged, with its share, and its region's bases aren't checked against the design.
  const features = libFeatures({ cdr1: { kind: "pattern", pattern: "NNK" } });
  assert.ok(cloneVariants(c, LIB, true, features).flags.includes("design"));
  const peaks = { mixed: 0.3, poor: false, unreliable, mixedRegions: new Set(["2171:2200"]) };
  const mixed = cloneVariants(c, LIB, true, features, 20, peaks);
  assert.deepEqual(mixed.flags, ["mixed"]);
  assert.equal(mixed.mixed, 0.3);
  assert.equal(mixed.regions[0].mixed, true);
  assert.deepEqual(mixed.regions[0].violations, []);
});

test("a parent's IUPAC codes hold on a region read from the bottom strand too", () => {
  const region: Feature = { name: "site", type: "misc_feature", start: 2453, end: 2455, strand: -1, forward: false, variable: { kind: "any" } };
  // NNK on the top strand is MNN on AmpR's: AAA there reads TTT, and M allows no T.
  const parent = `${REF.slice(0, 2453)}NNK${REF.slice(2456)}`;
  const c = clone([]);
  const piece = c.pieces[0];
  piece.gappedConsensus = `${REF.slice(1600, 2453)}AAA${REF.slice(2456, 2500)}`;
  piece.gappedReference = parent.slice(1600, 2500);
  piece.qualities = [...piece.gappedConsensus].map(() => 40);
  const v = cloneVariants(c, parent, true, [FEATURES[2], region]);
  assert.deepEqual(v.regions[0].violations, ["T at 2456 not allowed by M"]);
});
