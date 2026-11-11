// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// Run with: npm test  (Node 22+, no dependencies needed)
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compactChromatogram,
  orientChromatogram,
  reverseComplementChromatogram,
  sliceChromatogram,
  usableQualities
} from "./chromatogram.ts";
import {
  consequenceIn,
  describeDifference,
  featureCoverage,
  featurePositions,
  featuresAt,
  translateCodon,
  useAmberSuppression
} from "./genetics.ts";
import { basename, extension, formatForPath, isTraceFile, suggestedSaveName } from "./files.ts";
import { columnOfReferencePosition, rowSpan, stackAlignments } from "./msa.ts";
import { BLOCK_END, BLOCK_START, detectFromFeatures, formatComments, gcPercent, parseComments } from "./labinfo.ts";
import type { Chromatogram, Difference, Feature, ReadResult } from "./types.ts";

const chrom: Chromatogram = {
  aTrace: Int16Array.of(0, 9, 0, 0, 0, 0),
  cTrace: Int16Array.of(0, 0, 0, 8, 0, 0),
  gTrace: Int16Array.of(0, 0, 0, 0, 0, 7),
  tTrace: Int16Array.of(1, 1, 1, 1, 1, 1),
  basePos: [1, 3, 5],
  baseCalls: ["A", "C", "G"],
  qualNums: [30, 20, 10]
};

test("reverse complement of a chromatogram", () => {
  const rc = reverseComplementChromatogram(chrom);
  assert.deepEqual(rc.baseCalls, ["C", "G", "T"]);
  assert.deepEqual(rc.basePos, [0, 2, 4]);
  assert.deepEqual(rc.qualNums, [10, 20, 30]);
  // The G peak (index 5) becomes a C peak at index 0.
  assert.equal(rc.cTrace[0], 7);
  // The A peak at 1 becomes a T peak at 4.
  assert.equal(rc.tTrace[4], 9);
  // Twice gives back the original.
  const back = reverseComplementChromatogram(rc);
  assert.deepEqual(back.baseCalls, chrom.baseCalls);
  assert.deepEqual(back.basePos, chrom.basePos);
  assert.deepEqual(back.aTrace, chrom.aTrace);
});

test("slice and orient", () => {
  const s = sliceChromatogram(chrom, 1, 3);
  assert.deepEqual(s.baseCalls, ["C", "G"]);
  assert.deepEqual(s.basePos, [3, 5]);
  assert.deepEqual(s.qualNums, [20, 10]);
  assert.equal(s.aTrace.length, 6);
  assert.deepEqual(orientChromatogram({ ...chrom, baseCalls: ["a", "-", "G"] }, false).baseCalls, ["A", "N", "G"]);
});

test("chromatograms keep 16-bit traces and drop per-base copies", () => {
  const raw = {
    aTrace: [0, 9, 0], cTrace: [0, 0, 8], gTrace: [-1, 0, 0], tTrace: [32767, 1, 1],
    basePos: [1, 2], baseCalls: ["A", "C"], qualNums: [30, 20],
    baseTraces: [{ aTrace: [0, 9] }, { cTrace: [0, 8] }]
  };
  const c = compactChromatogram(raw);
  assert.ok(c.aTrace instanceof Int16Array);
  assert.deepEqual([...c.tTrace], [32767, 1, 1]);
  assert.deepEqual([...c.gTrace], [-1, 0, 0]);
  assert.deepEqual(c.basePos, [1, 2]);
  assert.deepEqual(c.qualNums, [30, 20]);
  assert.equal("baseTraces" in c, false);
  assert.equal(compactChromatogram({ ...raw, qualNums: [] }).qualNums, undefined);
});

test("a plate of library reads fits in memory", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const { parseReadFile } = await import("../doc/fileio.ts");
  const dir = new URL("../../testdata/library/", import.meta.url);
  const names = readdirSync(dir).filter(n => n.endsWith(".ab1"));
  assert.equal(names.length, 3);
  for (const name of names) {
    const [read] = await parseReadFile(new Uint8Array(readFileSync(new URL(name, dir))), name);
    const c = read.chromatogram!;
    assert.equal("baseTraces" in c, false);
    // About 16,300 trace points per channel on a 3730: 130 kB of traces, so 192 reads stay
    // well under 30 MB.
    const bytes = c.aTrace.byteLength + c.cTrace.byteLength + c.gTrace.byteLength + c.tTrace.byteLength;
    assert.ok(bytes > 100_000 && bytes < 150_000, `${name}: ${bytes} bytes of traces`);
    assert.equal(c.basePos.length, c.baseCalls.length);
    // Each called base sits on a peak of its own trace.
    const key = { A: "aTrace", C: "cTrace", G: "gTrace", T: "tTrace" } as const;
    const onPeak = c.baseCalls.filter((b, i) => b in key && c[key[b as "A"]][c.basePos[i]] > 0).length;
    assert.ok(onPeak / c.baseCalls.length > 0.95, `${name}: ${onPeak} of ${c.baseCalls.length} calls on a peak`);
  }
});

test("quality placeholders are ignored", () => {
  assert.deepEqual(usableQualities({ ...chrom, qualNums: [0, 1, 1] }), []);
  assert.deepEqual(usableQualities(chrom), [30, 20, 10]);
});

test("codon table", () => {
  assert.equal(translateCodon("ATG"), "M");
  assert.equal(translateCodon("TAA"), "*");
  assert.equal(translateCodon("TGG"), "W");
  assert.equal(translateCodon("GGN"), "X");
  assert.equal(translateCodon("aaa"), "K");
  // Amber suppressor strains read TAG as glutamine; the other stops stay stops.
  useAmberSuppression(true);
  try {
    assert.equal(translateCodon("TAG"), "Q");
    assert.equal(translateCodon("TAA"), "*");
  } finally {
    useAmberSuppression(false);
  }
  assert.equal(translateCodon("TAG"), "*");
});

// Reference: 10 bp of filler, then a forward CDS ATG AAA TGG TAA (12 bp) at 10..21.
const ref = "CCCCCCCCCC" + "ATGAAATGGTAA" + "GGGGGGGGGG";
const fwd: Feature = { name: "orf", type: "CDS", start: 10, end: 21, forward: true };
const sub = (pos: number, from: string, to: string): Difference => ({
  kind: "substitution", refPos: pos, refBases: from, readBases: to, readPos: 0, quality: 40, confident: true
});

test("missense, silent and nonsense on the forward strand", () => {
  // AAA (codon 2, K) -> AGA (R)
  assert.equal(consequenceIn(fwd, sub(14, "A", "G"), ref).label, "K2R");
  // AAA -> AAG (still K)
  assert.equal(consequenceIn(fwd, sub(15, "A", "G"), ref).severity, "silent");
  // TGG (W3) -> TAG (stop)
  const c = consequenceIn(fwd, sub(17, "G", "A"), ref);
  assert.equal(c.severity, "nonsense");
  assert.equal(c.label, "W3* (stop)");
});

test("substitutions in one codon are read together", () => {
  // AAA (K2) -> TGG (W): each change alone would read as a different amino acid.
  const group = [sub(13, "A", "T"), sub(14, "A", "G"), sub(15, "A", "G")];
  for (const d of group) assert.equal(consequenceIn(fwd, d, ref, group).label, "K2W");
  // A change in the next codon doesn't join in.
  assert.equal(consequenceIn(fwd, sub(14, "A", "G"), ref, [sub(17, "G", "A")]).label, "K2R");
  // On the minus strand too: AAA on the coding strand is TTT at 16..18 on the top; GGA is G.
  const r = "CCCCCCCCCC" + "TTACCATTTCAT" + "GGGGGGGGGG";
  const rev: Feature = { name: "rev", type: "CDS", start: 10, end: 21, forward: false };
  const both = [sub(18, "T", "C"), sub(17, "T", "C")];
  assert.equal(consequenceIn(rev, both[0], r, both).label, "K2G");
});

test("reverse-strand CDS", () => {
  // Reverse complement of ATGAAATGGTAA is TTACCATTTCAT; put it at 10..21 and annotate on the minus strand.
  const r = "CCCCCCCCCC" + "TTACCATTTCAT" + "GGGGGGGGGG";
  const rev: Feature = { name: "rev", type: "CDS", start: 10, end: 21, forward: false };
  assert.deepEqual(featurePositions(rev, r.length).slice(0, 3), [21, 20, 19]);
  // Codon 2 (AAA) occupies 18,17,16 on the minus strand; base at 17 is T (A on the coding strand).
  // Read shows C at 17 on the top strand => G on coding strand => AGA => R.
  assert.equal(consequenceIn(rev, sub(17, "T", "C"), r).label, "K2R");
});

test("indels in coding sequence", () => {
  const del1: Difference = { kind: "deletion", refPos: 13, refBases: "A", readBases: "", readPos: 0, quality: 40, confident: true };
  assert.equal(consequenceIn(fwd, del1, ref).severity, "frameshift");
  const del3: Difference = { ...del1, refBases: "AAA" };
  assert.equal(consequenceIn(fwd, del3, ref).label, "in-frame deletion of 1 aa at codon 2");
});

test("features at a position and coverage", () => {
  const n = ref.length;
  const features: Feature[] = [fwd, { name: "promoter", type: "promoter", start: 0, end: 9 }];
  assert.equal(featuresAt(features, n, sub(14, "A", "G")).length, 1);
  const read = {
    status: "aligned",
    refStart: 5,
    refSpan: 10,
    differences: [sub(12, "G", "A")]
  } as unknown as ReadResult;
  const cov = featureCoverage(features, n, [read]);
  assert.equal(cov[0].covered, 5); // 10..14 of the CDS
  assert.equal(cov[0].differences, 1);
  assert.equal(cov[1].covered, 5); // 5..9 of the promoter
});

test("origin-spanning feature", () => {
  const f: Feature = { start: 28, end: 2, forward: true };
  assert.deepEqual(featurePositions(f, 30), [28, 29, 0, 1, 2]);
});

test("difference descriptions are 1-based", () => {
  assert.equal(describeDifference(sub(14, "A", "G"), 100), "A15G");
  assert.equal(
    describeDifference({ kind: "insertion", refPos: 0, refBases: "", readBases: "GG", readPos: 0, quality: 30, confident: true }, 100),
    "ins GG after 100"
  );
  assert.equal(
    describeDifference({ kind: "deletion", refPos: 9, refBases: "ACG", readBases: "", readPos: 0, quality: 30, confident: true }, 100),
    "del 10–12 (3 bp)"
  );
});

test("stacking alignments with different insertions", () => {
  const ref = "ACGTACGT";
  const s = stackAlignments(ref, [
    // read 1: covers 2..6, inserts "TT" before ref[4]
    { gappedReference: "ACGT--ACGT", gappedRead: "--GTTTAC--" },
    // read 2: covers 0..7, inserts "G" before ref[4] and "C" at the very end
    { gappedReference: "ACGT-ACGT-", gappedRead: "ACGTGACGTC" }
  ]);
  assert.equal(s.reference, "ACGT--ACGT-");
  assert.deepEqual(s.rows, ["--GTTTAC---", "ACGTG-ACGTC"]);
  for (const r of s.rows) assert.equal(r.length, s.reference.length);
  assert.equal(s.reference.replace(/-/g, ""), ref);
  assert.equal(s.rows[0].replace(/-/g, ""), "GTTTAC");
  // No reads: the reference is unchanged.
  assert.equal(stackAlignments(ref, []).reference, ref);
  assert.throws(() => stackAlignments(ref, [{ gappedReference: "ACG", gappedRead: "ACG" }]));
});

test("alignment columns and row spans", () => {
  assert.deepEqual(columnOfReferencePosition("AC--GT-"), [0, 1, 4, 5, 7]);
  assert.deepEqual(rowSpan("--GTT-AC---"), { firstColumn: 2, lastColumn: 7 });
  assert.deepEqual(rowSpan("----"), { firstColumn: -1, lastColumn: -1 });
});

test("file names", () => {
  assert.equal(basename("C:\\data\\pUC19.dna"), "pUC19.dna");
  assert.equal(extension("/a/b/read.AB1"), "ab1");
  assert.ok(isTraceFile("x.ab1"));
  assert.equal(formatForPath("/x/y.gbk"), "genbank");
  assert.equal(formatForPath("/x/y.dna"), null);
  assert.equal(suggestedSaveName("/x/pUC19.dna", "", "genbank"), "pUC19.gb");
  assert.equal(suggestedSaveName(null, "my/seq", "fasta"), "my_seq.fasta");
});

test("lab fields round-trip through GenBank comments", () => {
  const fields: [string, string][] = [
    ["Stored at", "-80 °C, box 3, A4"],
    ["Sequence verified", "Yes"],
    ["Empty", "  "],
    ["Notes", "line one\nline two with a \\ backslash :: and colons"]
  ];
  const lines = formatComments(fields, ["Original comment"]);
  assert.equal(lines[0], "Original comment");
  assert.equal(lines[1], BLOCK_START);
  assert.equal(lines[lines.length - 1], BLOCK_END);
  assert.ok(!lines.some(l => l.startsWith("Empty")));
  const parsed = parseComments(lines.map(l => "  " + l + " ")); // parsers may pad lines
  assert.deepEqual(parsed.otherComments, ["  Original comment "]);
  assert.deepEqual(parsed.fields, [
    ["Stored at", "-80 °C, box 3, A4"],
    ["Sequence verified", "Yes"],
    ["Notes", "line one\nline two with a \\ backslash :: and colons"]
  ]);
  assert.deepEqual(formatComments([], ["x"]), ["x"]);
});

test("detects markers, origins and promoters from features", () => {
  const d = detectFromFeatures([
    { name: "AmpR", type: "CDS", start: 0, end: 1 },
    { name: "kanMX", type: "CDS", start: 0, end: 1 },
    { name: "bla", type: "gene", start: 0, end: 1 },
    { name: "ori", type: "rep_origin", start: 0, end: 1 },
    { name: "f1 ori", type: "misc_feature", start: 0, end: 1 },
    { name: "T7 promoter", type: "promoter", start: 0, end: 1 },
    { name: "catalase", type: "CDS", start: 0, end: 1 }
  ]);
  assert.deepEqual(d.resistance, ["Ampicillin", "Kanamycin"]);
  assert.deepEqual(d.origins, ["ori", "f1 ori"]);
  assert.deepEqual(d.promoters, ["T7"]);
  assert.equal(Math.round(gcPercent("GGCCAATT")), 50);
});

test("SnapGene's marker names: NeoR/KanR is both, TcR is tetracycline, TetR the repressor", () => {
  const drugs = (name: string) => detectFromFeatures([{ name, type: "CDS", start: 0, end: 1 }]).resistance;
  assert.deepEqual(drugs("NeoR/KanR"), ["Kanamycin", "Neomycin/G418"]);
  assert.deepEqual(drugs("TcR"), ["Tetracycline"]);
  assert.deepEqual(drugs("TetR"), []);
  assert.deepEqual(drugs("KanR"), ["Kanamycin"]);
});

test("reads primers from SnapGene files", async () => {
  const { readFileSync } = await import("node:fs");
  const { snapgenePrimers } = await import("./snapgene.ts");
  const { reverseComplement } = await import("./seqdata.ts");
  const file = (name: string) => new Uint8Array(readFileSync(new URL(`../../testdata/snapgene/${name}`, import.meta.url)));

  // The bases, from the file's DNA block (type 0: a flags byte, then the sequence).
  const dna = (bytes: Uint8Array) => {
    for (let i = 0; i + 5 <= bytes.length; ) {
      const len = ((bytes[i + 1] << 24) >>> 0) + (bytes[i + 2] << 16) + (bytes[i + 3] << 8) + bytes[i + 4];
      if (bytes[i] === 0) return new TextDecoder().decode(bytes.subarray(i + 6, i + 5 + len)).toUpperCase();
      i += 5 + len;
    }
    return "";
  };
  // Each primer's 3′ part pairs with the bases where it is placed.
  const pairs = (seq: string, p: { start: number; end: number; forward: boolean; bases: string }) => {
    const site = seq.slice(p.start, p.end + 1);
    const bound = p.bases.slice(-(p.end - p.start + 1)).toUpperCase();
    return (p.forward ? site : reverseComplement(site)) === bound;
  };

  const egfpFile = file("pIB2-SEC13-mEGFP.dna");
  const egfp = snapgenePrimers(egfpFile);
  assert.ok(egfp.length >= 4, `found ${egfp.length}`);
  const rev = egfp.find(p => p.name === "A206K.REV")!;
  assert.equal(rev.start, 2252);
  assert.equal(rev.end, 2290);
  for (const name of ["SEC13.FOR", "SEC13.REV", "A206K.FOR", "A206K.REV"]) assert.ok(pairs(dna(egfpFile), egfp.find(p => p.name === name)!), name);
  assert.equal(rev.forward, false);
  assert.equal(rev.bases, "GTTGGGGTCTTTGCTCAGCTTGGACTGGGTGCTCAGGTA");
  assert.equal(rev.description, "For introducing the monomerizing A206K mutation");

  // A primer with a 5' tail: only the 3' part anneals.
  const tailedFile = file("sample-hybridization-params.dna");
  const tailed = snapgenePrimers(tailedFile);
  const xho = tailed.find(p => p.name === "XhoI-hht2(US)-Fwd")!;
  assert.equal(xho.forward, true);
  assert.equal(xho.end - xho.start + 1, 19);
  assert.equal(xho.bases.length, 25);
  assert.ok(pairs(dna(tailedFile), xho));
  assert.ok(pairs(dna(tailedFile), tailed.find(p => p.name === "XmaI-hht2(Cter)-Rev")!));

  assert.deepEqual(snapgenePrimers(file("pFA-KanMX4.dna")), []);
});
