// A read's translation in a coding frame. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { layoutAlignment, type AlignedTrack, type AlignmentLayout } from "./alignLayout.ts";
import { continuesFrame, frameChains, useAmberSuppression } from "./genetics.ts";
import { indelColumns, translateTrack, type ReadFrame, type TranslationOptions } from "./readTranslation.ts";
import type { Chromatogram, Difference, ReadResult } from "./types.ts";

// ATG GCT AAA GAT TGG CTG GAA CCG TAT CAT TAA, with flanks of 6.
const CDS = "ATGGCTAAAGATTGGCTGGAACCGTATCATTAA";
const REF = `CCCCCC${CDS}CCCCCC`;
const PROTEIN = "MAKDWLEPYH*";

const RC: Record<string, string> = { A: "T", C: "G", G: "C", T: "A", "-": "-" };
const revcomp = (s: string) => [...s].reverse().map(b => RC[b] ?? b).join("");

const forwardFrame: ReadFrame = { name: "cds", forward: true, positions: Array.from({ length: CDS.length }, (_, i) => i + 6) };
const reverseFrame = (n: number): ReadFrame => ({ name: "cds", forward: false, positions: Array.from({ length: CDS.length }, (_, i) => n - 7 - i) });

function result(over: Partial<ReadResult>): ReadResult {
  return { name: "r", status: "aligned", message: null, strand: "forward", readLength: 0, qualityEstimated: false, trimStart: 0, trimEnd: 0, refStart: 0, refSpan: 0, wrapsOrigin: false, matches: 0, mismatches: 0, insertedBases: 0, deletedBases: 0, ambiguous: 0, identity: 1, score: 0, differences: [], segments: [], ...over };
}

function chromatogram(bases: string, quals: number[]): Chromatogram {
  return { baseCalls: [...bases], basePos: [...bases].map((_, i) => i * 10), qualNums: quals, aTrace: new Int16Array(bases.length * 10), cTrace: new Int16Array(bases.length * 10), gTrace: new Int16Array(bases.length * 10), tTrace: new Int16Array(bases.length * 10) } as unknown as Chromatogram;
}

/** A track from a gapped reference and read; `quals` per base of the read. */
function track(gappedReference: string, gappedRead: string, quals?: number[]): { track: AlignedTrack; layout: AlignmentLayout } {
  const bases = gappedRead.replace(/-/g, "");
  const r = result({ segments: [{ readFrom: 0, readTo: bases.length, refFrom: 0, refTo: 0, gappedReference, gappedRead }] });
  const res = layoutAlignment(gappedReference.replace(/-/g, ""), [r], [{ chromatogram: quals ? chromatogram(bases, quals) : null }]);
  assert.ok(res && "layout" in res);
  return { track: res.layout.tracks[0], layout: res.layout };
}

const options = (over: Partial<TranslationOptions> = {}): TranslationOptions => ({ minQuality: 20, confirmed: new Set(), frameshift: null, ...over });
const protein = (codons: { aa: string }[]) => codons.map(c => c.aa).join("");
const blank = (s: string, from: number, to: number) => s.slice(0, from) + "-".repeat(to - from) + s.slice(to);

test("a read of the whole feature reads as the reference", () => {
  const t = track(REF, REF);
  const r = translateTrack(t.track, t.layout, forwardFrame, options());
  assert.equal(protein(r.codons), PROTEIN);
  assert.ok(r.codons.every(c => c.state === "same"));
  assert.equal(r.codons[0].c0, 6);
  assert.equal(r.codons[0].cm, 7);
  assert.equal(r.stop, null);
});

test("a read starting inside the feature keeps the reference's frame", () => {
  const t = track(REF, blank(REF, 0, 13)); // first base read is the 8th of the feature
  const r = translateTrack(t.track, t.layout, forwardFrame, options());
  assert.equal(protein(r.codons), PROTEIN.slice(3));
  assert.equal(r.codons[0].c0, 15);
});

test("a noisy start is skipped until a good stretch", () => {
  const read = `TTTTTTTTTTTT${REF.slice(12)}`;
  const t = track(REF, read);
  const r = translateTrack(t.track, t.layout, forwardFrame, options());
  assert.equal(protein(r.codons), PROTEIN.slice(2));
});

test("low-quality bases don't start a translation, and are dimmed in one", () => {
  const quals = [...REF].map((_, i) => (i < 15 || i === 27 ? 5 : 40));
  const t = track(REF, REF, quals);
  const r = translateTrack(t.track, t.layout, forwardFrame, options());
  assert.equal(r.codons[0].c0, 15);
  assert.deepEqual(r.codons.filter(c => c.state === "weak").map(c => c.c0), [27]);
});

test("a substitution marks its codon", () => {
  const read = REF.slice(0, 18) + "C" + REF.slice(19); // TGG → CGG: W5R
  const t = track(REF, read);
  const r = translateTrack(t.track, t.layout, forwardFrame, options());
  assert.equal(protein(r.codons), "MAKDRLEPYH*");
  assert.deepEqual(r.codons.filter(c => c.state === "differs").map(c => c.aa), ["R"]);
});

test("after a stop from a substitution the rest is dimmed", () => {
  const read = REF.slice(0, 20) + "A" + REF.slice(21); // TGG → TGA
  const t = track(REF, read);
  const r = translateTrack(t.track, t.layout, forwardFrame, options());
  assert.equal(protein(r.codons), "MAKD*LEPYH*");
  assert.equal(r.codons[4].state, "differs");
  assert.ok(r.codons.slice(5).every(c => c.state === "afterStop"));
});

test("a reverse feature is read right to left, on the other strand", () => {
  const ref = `CCCCCC${revcomp(CDS)}CCCCCC`;
  const t = track(ref, ref);
  const r = translateTrack(t.track, t.layout, reverseFrame(ref.length), options());
  assert.equal(protein(r.codons), PROTEIN);
  assert.equal(r.codons[0].c1, ref.length - 7);
});

test("a read covering only the 3′ part of a reverse feature keeps its frame", () => {
  const ref = `CCCCCC${revcomp(CDS)}CCCCCC`;
  const t = track(ref, blank(ref, 20, ref.length)); // left part only: the feature's end
  const r = translateTrack(t.track, t.layout, reverseFrame(ref.length), options());
  assert.ok(PROTEIN.endsWith(protein(r.codons)) && r.codons.length > 1, protein(r.codons));
});

test("an uncertain deletion keeps the frame: the codon reads X and the rest is unchanged", () => {
  const gapped = `${REF.slice(0, 19)}-${REF.slice(20)}`;
  const t = track(REF, gapped);
  const r = translateTrack(t.track, t.layout, forwardFrame, options());
  assert.equal(protein(r.codons), "MAKDXLEPYH*");
  assert.deepEqual(r.uncertain, [19]);
  assert.equal(r.codons[4].state, "weak");
});

test("uncertain inserted bases are left out", () => {
  const ref = `${REF.slice(0, 19)}-${REF.slice(19)}`;
  const read = `${REF.slice(0, 19)}A${REF.slice(19)}`;
  const t = track(ref, read);
  const r = translateTrack(t.track, t.layout, forwardFrame, options());
  assert.equal(protein(r.codons), PROTEIN);
  assert.deepEqual(r.uncertain, [19]);
});

test("a confident in-frame deletion reads across it", () => {
  const gapped = `${REF.slice(0, 18)}---${REF.slice(21)}`; // no TGG
  const t = track(REF, gapped);
  const d: Difference = { kind: "deletion", refPos: 18, refBases: "TGG", readBases: "", readPos: 0, quality: 40, confident: true };
  const r = translateTrack(t.track, t.layout, forwardFrame, options({ confirmed: indelColumns([d], t.layout) }));
  assert.equal(protein(r.codons), "MAKDLEPYH*");
});

test("a confident in-frame insertion adds a marked amino acid", () => {
  const ref = `${REF.slice(0, 18)}---${REF.slice(18)}`;
  const read = `${REF.slice(0, 18)}GCC${REF.slice(18)}`;
  const t = track(ref, read);
  const d: Difference = { kind: "insertion", refPos: 18, refBases: "", readBases: "GCC", readPos: 0, quality: 40, confident: true };
  const r = translateTrack(t.track, t.layout, forwardFrame, options({ confirmed: indelColumns([d], t.layout) }));
  assert.equal(protein(r.codons), "MAKDAWLEPYH*");
  assert.equal(r.codons[4].state, "differs");
  assert.equal(r.codons[5].state, "same");
});

test("the clone's frameshift ends the translation there, with its name", () => {
  const t = track(REF, REF);
  const r = translateTrack(t.track, t.layout, forwardFrame, options({ frameshift: { refPos: 18, label: "W5fs" } }));
  assert.equal(protein(r.codons), "MAKD");
  assert.deepEqual(r.stop, { column: 18, label: "W5fs", past: false });
});

test("a read past the clone's frameshift says so instead of looking clean", () => {
  const t = track(REF, blank(REF, 0, 24));
  const r = translateTrack(t.track, t.layout, forwardFrame, options({ frameshift: { refPos: 18, label: "W5fs" } }));
  assert.deepEqual(r.codons, []);
  assert.deepEqual(r.stop, { column: 24, label: "W5fs", past: true });
});

test("on a reverse feature the frameshift stops what comes after it in reading order", () => {
  const ref = `CCCCCC${revcomp(CDS)}CCCCCC`;
  const frame = reverseFrame(ref.length);
  const t = track(ref, ref);
  const r = translateTrack(t.track, t.layout, frame, options({ frameshift: { refPos: frame.positions[12], label: "W5fs" } }));
  assert.equal(protein(r.codons), "MAKD");
  assert.equal(r.stop?.column, frame.positions[12]);
});

test("variable regions are never marked as changed", () => {
  const read = REF.slice(0, 18) + "C" + REF.slice(19);
  const t = track(REF, read);
  const r = translateTrack(t.track, t.layout, forwardFrame, options({ variable: p => p >= 18 && p <= 20 }));
  assert.equal(protein(r.codons), "MAKDRLEPYH*");
  assert.ok(r.codons.every(c => c.state === "same"));
});

test("a variable feature of its own is translated from the read's bases", () => {
  // TGG CTG GAA CCG in place of the reference's Ns, read in the feature's own frame.
  const ref = `${"C".repeat(9)}${"N".repeat(12)}${"G".repeat(9)}`;
  const read = `${"C".repeat(9)}TGGCTGGAACCG${"G".repeat(9)}`;
  const frame: ReadFrame = { name: "cdr", forward: true, positions: Array.from({ length: 12 }, (_, i) => i + 9) };
  const t = track(ref, read);
  const r = translateTrack(t.track, t.layout, frame, options({ variable: p => p >= 9 && p <= 20 }));
  assert.equal(protein(r.codons), "WLEP");
  assert.ok(r.codons.every(c => c.state === "same"));
});

test("Ns in the reference count as variable without a marked feature", () => {
  const ref = `${"C".repeat(9)}${"N".repeat(12)}${"G".repeat(9)}`;
  const t = track(ref, `${"C".repeat(9)}TGGCTGGAACCG${"G".repeat(9)}`);
  const frame: ReadFrame = { name: "cdr", forward: true, positions: Array.from({ length: 12 }, (_, i) => i + 9) };
  const r = translateTrack(t.track, t.layout, frame, options());
  assert.equal(protein(r.codons), "WLEP");
  assert.ok(r.codons.every(c => c.state === "same"));
});

test("a reverse variable feature is read on the other strand", () => {
  const ref = `${"C".repeat(9)}${"N".repeat(12)}${"G".repeat(9)}`;
  const read = `${"C".repeat(9)}${revcomp("TGGCTGGAACCG")}${"G".repeat(9)}`;
  const frame: ReadFrame = { name: "cdr", forward: false, positions: Array.from({ length: 12 }, (_, i) => 20 - i) };
  const t = track(ref, read);
  assert.equal(protein(translateTrack(t.track, t.layout, frame, options({ variable: p => p >= 9 && p <= 20 })).codons), "WLEP");
});

test("low-quality bases in a variable feature don't start a translation", () => {
  const ref = "N".repeat(30);
  const read = "TGGCTGGAACCGTGGCTGGAACCGTGGCTG";
  const frame: ReadFrame = { name: "cdr", forward: true, positions: Array.from({ length: 30 }, (_, i) => i) };
  const t = track(ref, read, [...Array(12).fill(5), ...Array(18).fill(40)]);
  const r = translateTrack(t.track, t.layout, frame, options({ variable: () => true }));
  assert.equal(protein(r.codons), "WLEPWL");
});

test("a feature shorter than the good stretch is translated from what follows it", () => {
  const frame: ReadFrame = { name: "short", forward: true, positions: Array.from({ length: 6 }, (_, i) => i + 6) };
  const t = track(REF, REF);
  assert.equal(protein(translateTrack(t.track, t.layout, frame, options()).codons), "MA");
  const end = track(REF, blank(REF, 14, REF.length));
  assert.equal(protein(translateTrack(end.track, end.layout, frame, options()).codons), "", "the read ends too soon to be sure of it");
});

test("a read in a good stretch before the feature reads on, past weak bases", () => {
  const flank = "C".repeat(12);
  const ref = `${flank}${"N".repeat(12)}${"G".repeat(9)}`;
  const read = `${flank}TGGCTGGAACCG${"G".repeat(9)}`;
  const frame: ReadFrame = { name: "cdr", forward: true, positions: Array.from({ length: 12 }, (_, i) => i + 12) };
  const quals = [...read].map((_, i) => (i === 14 || i === 19 ? 5 : 40));
  const t = track(ref, read, quals);
  const r = translateTrack(t.track, t.layout, frame, options({ variable: p => p >= 12 && p <= 23 }));
  assert.equal(protein(r.codons), "WLEP");
  assert.deepEqual(r.codons.map(c => c.state), ["weak", "same", "weak", "same"]);
});

test("a read reaching the feature on bad bases doesn't read on", () => {
  const flank = "C".repeat(12);
  const ref = `${flank}${"N".repeat(12)}${"G".repeat(9)}`;
  const read = `${flank}TGGCTGGAACCG${"G".repeat(9)}`;
  const frame: ReadFrame = { name: "cdr", forward: true, positions: Array.from({ length: 12 }, (_, i) => i + 12) };
  const quals = [...read].map((_, i) => (i < 12 || i === 14 || i === 19 ? 5 : 40));
  const t = track(ref, read, quals);
  const r = translateTrack(t.track, t.layout, frame, options({ variable: p => p >= 12 && p <= 23 }));
  assert.equal(protein(r.codons), "P", "only from where ten good bases follow");
});

test("a variable region carries on a neighbouring CDS's frame", () => {
  const fr1 = { start: 0, end: 74, strand: 1 };
  const fr2 = { start: 105, end: 146, strand: 1 };
  const region = { start: 75, end: 104, strand: 1 };
  assert.ok(continuesFrame(region, [fr1, fr2]));
  assert.ok(continuesFrame(region, [fr2]), "touching only the next one");
  assert.ok(!continuesFrame({ ...region, end: 103 }, [fr1, fr2]), "not whole codons");
  assert.ok(!continuesFrame(region, [{ ...fr1, end: 73 }]), "the CDS isn't whole codons");
  assert.ok(!continuesFrame({ start: 80, end: 91, strand: 1 }, [fr1, fr2]), "touches neither");
  assert.ok(!continuesFrame({ start: 30, end: 41, strand: 1 }, [fr1]), "already inside a CDS");
  assert.ok(!continuesFrame({ ...region, strand: -1 }, [fr1, fr2]), "runs the other way");
});

test("features that touch in whole codons share a frame, in reading order", () => {
  const seq = "GCT".repeat(30);
  const f = (name: string, start: number, end: number, strand = 1) => ({ name, start, end, strand });
  const names = (features: ReturnType<typeof f>[], s = seq, circular = true) => frameChains(features, s, circular).map(c => c.map(x => x.name));
  assert.deepEqual(names([f("b", 9, 17), f("c", 18, 26), f("a", 0, 8)]), [["a", "b", "c"]]);
  assert.deepEqual(names([f("a", 0, 8, -1), f("b", 9, 17, -1)]), [["b", "a"]], "right to left");
  assert.deepEqual(names([f("a", 0, 8), f("b", 9, 17, -1)]), [["a"], ["b"]], "other direction");
  assert.deepEqual(names([f("a", 0, 7), f("b", 8, 16)]), [["a"], ["b"]], "not whole codons");
  assert.deepEqual(names([f("a", 0, 8), f("b", 12, 20)]), [["a"], ["b"]], "a gap between them");
  assert.deepEqual(names([f("a", 0, 8), f("b", 9, 17)], `GCTGCTTAA${seq}`), [["a"], ["b"]], "ends in a stop");
  assert.deepEqual(names([f("b", 0, 8), f("a", 81, 89)]), [["a", "b"]], "across the origin");
  assert.deepEqual(names([f("b", 0, 8), f("a", 81, 89)], seq, false), [["b"], ["a"]], "a linear sequence has no origin to cross");
  assert.equal(frameChains([f("a", 0, 44), f("b", 45, 89)], seq, true).flat().length, 2, "around a whole plasmid");
});

test("a read outside the frame has no translation", () => {
  const t = track(REF, blank(REF, 3, REF.length));
  assert.deepEqual(translateTrack(t.track, t.layout, forwardFrame, options()), { codons: [], uncertain: [], stop: null });
});

test("amber suppression follows the setting", () => {
  const read = REF.slice(0, 19) + "AG" + REF.slice(21); // TGG → TAG
  const t = track(REF, read);
  assert.equal(protein(translateTrack(t.track, t.layout, forwardFrame, options()).codons), "MAKD*LEPYH*");
  useAmberSuppression(true);
  try {
    assert.equal(protein(translateTrack(t.track, t.layout, forwardFrame, options()).codons), "MAKDQLEPYH*");
  } finally {
    useAmberSuppression(false);
  }
});
