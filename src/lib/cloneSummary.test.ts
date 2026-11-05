// What a plate of clones adds up to, from made-up clones of pUC19. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { byRecurrence, cloneSummary, mutationRate, sitesAlong, summaryText, type SummaryClone } from "./cloneSummary.ts";
import { cloneVariants, degenerateCodons } from "./variants.ts";
import type { ClonePeaks } from "./mixes.ts";
import type { CloneDifference, CloneResult, Feature } from "./types.ts";
import { parseDesign } from "./variable.ts";

const gb = readFileSync(new URL("../../testdata/e2e/pUC19-annotated.gb", import.meta.url), "utf8");
const REF = gb.split("ORIGIN")[1].replace(/[^acgtn]/gi, "").toUpperCase();
const n = REF.length;
const AMPR: Feature = { name: "AmpR", type: "CDS", start: 1625, end: 2485, strand: -1, forward: false };
const FEATURES: Feature[] = [AMPR];

const diff = (d: Partial<CloneDifference> & Pick<CloneDifference, "kind" | "refPos">): CloneDifference => ({ refBases: "", readBases: "", readPos: 0, quality: 40, confident: true, reads: [0], ...d });
const sub = (p: number, base: string) => diff({ kind: "substitution", refPos: p, refBases: REF[p], readBases: base });
/** A base other than the reference's, a transition or a transversion. */
const TRANSITION: Record<string, string> = { A: "G", G: "A", C: "T", T: "C" };
const TRANSVERSION: Record<string, string> = { A: "C", C: "A", G: "T", T: "G" };
const ts = (p: number) => sub(p, TRANSITION[REF[p]]);
const tv = (p: number) => sub(p, TRANSVERSION[REF[p]]);

/** A clone read over `span` (half-open), with the reference as its consensus but for `bases`. */
function clone(differences: CloneDifference[], span: [number, number] = [1600, 2500], bases?: (consensus: string[]) => void): CloneResult {
  const [a, b] = span;
  const consensus = [...REF.slice(a, b)];
  bases?.(consensus);
  return {
    key: "c",
    reads: [0],
    pieces: [{ refFrom: a, refTo: b, gappedReference: REF.slice(a, b), gappedConsensus: consensus.join(""), qualities: consensus.map(() => 40), depth: [] }],
    differences,
    conflicts: []
  };
}
const made = (name: string, c: CloneResult, features = FEATURES, peaks?: ClonePeaks): SummaryClone => ({ name, variants: cloneVariants(c, REF, true, features, 20, peaks) });
const summary = (clones: SummaryClone[], features = FEATURES) => cloneSummary(clones, REF, features);
const mix: ClonePeaks = { mixed: 0.3, poor: false, unreliable: new Set(), mixedRegions: new Set() };

test("identical clones are one different clone, and count as such in the shares", () => {
  const s = summary([made("A", clone([ts(1999)])), made("B", clone([ts(1999)])), made("C", clone([])), made("D", clone([tv(1900)]))]);
  assert.deepEqual([s.total, s.counted, s.different], [4, 4, 3]);
});

test("stops and frameshifts are counted among the clones that count", () => {
  const stop = sub(1998, "T"); // W163 TGG → TAG or TGA on AmpR's strand, read from 1999 down.
  const v = made("A", clone([stop]));
  assert.ok(v.variants.flags.includes("stop"), v.variants.flags.join());
  const frameshift = diff({ kind: "deletion", refPos: 2100, refBases: REF[2100] });
  const s = summary([v, made("B", clone([frameshift])), made("C", clone([])), made("D", clone([]))]);
  assert.equal(s.broken, 2);
});

test("a mix tells nothing about one plasmid: it is counted as a mix and left out of the rest", () => {
  const s = summary([made("mix", clone([ts(1999)]), FEATURES, mix), made("none", { ...clone([]), pieces: [] }), made("A", clone([]))]);
  assert.deepEqual([s.total, s.mixed, s.unaligned, s.counted, s.different], [3, 1, 1, 1, 1]);
  assert.deepEqual([s.sites, s.changes], [[], 0]);
});

test("the mutation rate counts every clone's changes over the bases it read", () => {
  // Clones without a change each count: as one clone they would make the rate look high.
  const plain = Array.from({ length: 9 }, (_, i) => made(`P${i}`, clone([], [1000, 2000])));
  const s = summary([made("A", clone([ts(1500)], [1000, 2000])), ...plain]);
  assert.deepEqual([s.changes, s.bases], [1, 10000]);
  assert.equal(mutationRate(s), 0.1);
  assert.equal(mutationRate(summary([])), null);
});

test("variable regions and calls among double peaks don't count as bases that could change", () => {
  const region: Feature = { name: "cdr", type: "misc_feature", start: 1200, end: 1299, variable: { kind: "any" } };
  const peaks: ClonePeaks = { ...mix, mixed: null, unreliable: new Set([1100, 1101, 1102]) };
  // A change in the region and one among double peaks: neither counts.
  const s = summary([made("A", clone([tv(1250), ts(1100)], [1000, 2000]), [AMPR, region], peaks)], [AMPR, region]);
  assert.equal(s.bases, 1000 - 100 - 3);
  assert.equal(s.changes, 0);
});

test("transitions and transversions count each change once across identical clones", () => {
  const s = summary([made("A", clone([ts(1100), tv(1200)], [1000, 2000])), made("B", clone([ts(1100), tv(1200)], [1000, 2000])), made("C", clone([ts(1300)], [1000, 2000]))]);
  assert.deepEqual([s.transitions, s.transversions], [2, 1]);
  // Insertions and deletions are neither.
  const indel = summary([made("A", clone([diff({ kind: "deletion", refPos: 1100, refBases: REF[1100] })], [1000, 2000]))]);
  assert.deepEqual([indel.transitions, indel.transversions], [0, 0]);
});

test("a site counts different clones, of those that read it", () => {
  const s = summary([
    made("A", clone([ts(1999)])),
    made("A2", clone([ts(1999)])),
    made("B", clone([ts(1999), tv(1700)])),
    made("C", clone([tv(1999)])),
    made("E", clone([])),
    // Reads none of it: says nothing about the site.
    made("D", clone([], [100, 900]))
  ]);
  const site = s.sites.find(x => x.refPos === 1999)!;
  // A and A2 are one; B has the same change, C another at the same place.
  assert.deepEqual([site.different, site.read], [3, 4]);
  const first = byRecurrence(s.sites)[0];
  assert.equal(first.site, site);
  assert.deepEqual(first.mutation.clones, ["A", "A2", "B"]);
  assert.equal(first.mutation.different, 2);
  // A site in a CDS is its codon, named by the codon's first base.
  assert.equal(s.sites.find(x => x.refPos !== 1999)!.read, 4);
});

test("a site can be placed along a CDS, by codon, on either strand", () => {
  const s = summary([made("A", clone([ts(1999)])), made("B", clone([ts(1000)], [900, 1100]))]);
  assert.deepEqual(sitesAlong(s.sites, null, n).points.map(p => p.at), [1000, 1999]);
  const along = sitesAlong(s.sites, AMPR, n);
  assert.equal(along.length, Math.floor((2485 - 1625 + 1) / 3));
  // W163, with the site outside AmpR left out.
  assert.deepEqual(along.points.map(p => p.at), [162]);
});

// AmpR's positions in its own direction, so a region's bases are written as it reads.
const nnkRegion = (first: number, codons: number, design: string): Feature => ({
  name: "site",
  type: "misc_feature",
  start: 2485 - (first + codons) * 3 + 1,
  end: 2485 - first * 3,
  strand: -1,
  forward: false,
  variable: parseDesign(design)
});
const COMP: Record<string, string> = { A: "T", C: "G", G: "C", T: "A" };
const revcomp = (s: string) => [...s].reverse().map(b => COMP[b]).join("");

test("the codons a pattern lets vary", () => {
  const f = nnkRegion(10, 2, "NNK");
  const sites = degenerateCodons(f, REF, FEATURES);
  assert.deepEqual(sites.map(c => [c.number, c.pattern, c.allowed.length, c.refPos]), [[11, "NNK", 32, 2455], [12, "NNK", 32, 2452]]);
  assert.ok(sites[0].allowed.includes("TAG") && !sites[0].allowed.includes("TAA"));
  // Outside a CDS, or without a pattern, there are none.
  assert.deepEqual(degenerateCodons({ ...f, start: 100, end: 105, forward: true, strand: 1 }, REF, FEATURES), []);
  assert.deepEqual(degenerateCodons({ ...f, variable: { kind: "any" } }, REF, FEATURES), []);
});

test("fixed codons of a pattern aren't sites", () => {
  const sites = degenerateCodons(nnkRegion(10, 3, "NNKGCTNDT"), REF, FEATURES);
  assert.deepEqual(sites.map(c => [c.number, c.pattern, c.allowed.length]), [[11, "NNK", 32], [13, "NDT", 12]]);
});

test("a parent's own IUPAC codes spell out the sites", () => {
  const f: Feature = { ...nnkRegion(10, 1, "any") };
  const sequence = REF.slice(0, f.start) + "MNN" + REF.slice(f.end + 1);
  const sites = degenerateCodons(f, sequence, FEATURES);
  assert.deepEqual(sites.map(c => [c.pattern, c.allowed.length]), [["NNK", 32]]);
});

test("codons seen are set against what chance would show, identical clones counted once", () => {
  const f = nnkRegion(10, 1, "NNK");
  const features = [AMPR, f];
  // A clone with `codon` at the site, read on AmpR's strand; the top strand has its reverse complement.
  const withCodon = (codon: string): CloneResult => {
    const top = revcomp(codon);
    const variable = [...top].flatMap((b, i) => (b === REF[f.start + i] ? [] : [sub(f.start + i, b)]));
    return { ...clone([], [1600, 2500], c => [...top].forEach((b, i) => (c[f.start + i - 1600] = b))), variable };
  };
  const s = summary([made("A", withCodon("GCT"), features), made("B", withCodon("GCT"), features), made("C", withCodon("GCG"), features), made("D", withCodon("AAA"), features)], features);
  assert.equal(s.codons.length, 1);
  const c = s.codons[0];
  assert.deepEqual([c.region, c.number, c.pattern, c.allowed], ["site", 11, "NNK", 32]);
  // GCT and GCG, with A and B being one clone; AAA isn't NNK.
  assert.deepEqual(c.seen, [{ codon: "GCG", aminoAcid: "A", clones: 1 }, { codon: "GCT", aminoAcid: "A", clones: 1 }]);
  assert.deepEqual([c.read, c.outside], [3, 1]);
  assert.ok(Math.abs(c.expected - 32 * (1 - (31 / 32) ** 3)) < 1e-9);
  assert.ok(c.expected > 2.9 && c.expected < 3);
});

test("a codon read below the quality threshold, or of another length, says nothing", () => {
  const f = nnkRegion(10, 1, "NNK");
  const features = [AMPR, f];
  const low = clone([], [1600, 2500]);
  low.pieces[0].qualities = low.pieces[0].qualities.map(() => 5);
  const longer = clone([], [1600, 2500]);
  const piece = longer.pieces[0];
  const cut = f.start + 1 - 1600;
  piece.gappedReference = `${piece.gappedReference.slice(0, cut)}---${piece.gappedReference.slice(cut)}`;
  piece.gappedConsensus = `${piece.gappedConsensus.slice(0, cut)}AAA${piece.gappedConsensus.slice(cut)}`;
  piece.qualities = [...piece.gappedReference].map(() => 40);
  const c = summary([made("A", low, features), made("B", longer, features)], features).codons[0];
  assert.deepEqual([c.read, c.seen, c.outside], [0, [], 0]);
  assert.equal(c.expected, 0);
});

test("the summary reads as notes for a lab notebook", () => {
  const f = nnkRegion(10, 1, "NNK");
  const s = summary([made("A", clone([ts(1999)]), [AMPR, f]), made("B", clone([ts(1999)]), [AMPR, f]), made("C", clone([ts(1999)]), [AMPR, f], mix)], [AMPR, f]);
  const text = summaryText(s, "pUC19", "2026-10-30");
  assert.match(text, /^Clones of pUC19, 2026-10-30\n/);
  assert.match(text, /Clones: 3 \(1 mixed, left out below\)/);
  assert.match(text, /Different clones: 1 of 2 \(50%\)/);
  assert.match(text, /Stops or frameshifts: 0 of 2 \(0%\)/);
  assert.match(text, /Mutations: 1\.11 per kb \(2 in 1\.8 kb read, outside variable regions\)/);
  assert.match(text, /AmpR W163R: 1 of 1 \(A, B\)/);
  assert.match(text, /site codon 11 \(NNK\): /);
});
