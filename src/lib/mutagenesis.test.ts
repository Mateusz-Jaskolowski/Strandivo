// Primers for site-directed mutagenesis. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { applyChange, changeName, codonAt, codonChoices, designMutagenesis, residueAt, SPLIT_INSERTION, trimChange, type SdmChange, type SdmDesign } from "./mutagenesis.ts";
import { alignPrimer } from "./primerAlign.ts";
import { DEFAULT_TM, meltingTemp, primerReport, useTmSettings } from "./primers.ts";
import { pcrProduct } from "./pcr.ts";
import { basesIn, reverseComplement, setOrigin, type SeqData, type SeqFeature } from "./seqdata.ts";

// A made-up plasmid: the same bases on every run, without long repeats.
function made(n: number, seed: number): string {
  let x = seed;
  let out = "";
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out += "ACGT"[(x >> 16) & 3];
  }
  return out;
}
const seq = made(3000, 7);
const doc = (sequence = seq, features: SeqFeature[] = []): SeqData => ({ name: "p", description: "", circular: true, sequence, features, primers: [], sources: [] });
const cds = (start: number, end: number, strand: 1 | -1): SeqFeature => ({ id: "c", name: "gene", type: "CDS", start, end, strand, notes: {}, raw: {} });

/** What the pair amplifies, as the plasmid read from the forward primer's 5′ end. */
function product(d: SdmDesign, sequence = seq, circular = true) {
  const name = (x: string) => ({ name: x });
  return pcrProduct(sequence, circular, { ...name("F"), ...d.forward }, { ...name("R"), ...d.reverse });
}
/** The mutant, turned to start where the back-to-back product starts. */
function mutantFrom(c: SdmChange, at: number) {
  return setOrigin(applyChange(doc(), c), at).sequence;
}

test("a change keeps none of the bases it leaves as they are", () => {
  const codon = seq.slice(300, 303);
  const other = codon[1] === "A" ? "C" : "A";
  assert.deepEqual(trimChange(seq, true, { start: 300, length: 3, bases: codon[0] + other + codon[2] }), { start: 301, length: 1, bases: other });
  assert.equal(trimChange(seq, true, { start: 300, length: 3, bases: codon }), null);
  // Replacing two bases with three of which two are the same is an insertion.
  assert.deepEqual(trimChange(seq, true, { start: 300, length: 2, bases: seq.slice(300, 302) + "G" }), { start: 302, length: 0, bases: "G" });
  // Around the origin of a circular sequence.
  const wrap = trimChange(seq, true, { start: 2998, length: 4, bases: seq.slice(2998) + "TT" });
  assert.ok(wrap && wrap.start <= 1 && wrap.length <= 2);
});

test("back to back: the change on the forward primer's 5′ end, the reverse primer's 5′ end beside it", () => {
  const c: SdmChange = { start: 1000, length: 1, bases: seq[1000] === "A" ? "G" : "A" };
  const d = designMutagenesis(seq, true, c, "back-to-back")!;
  assert.ok(d);
  assert.equal(d.forward.start, 1000);
  assert.equal(d.reverse.end, 999);
  assert.equal(d.forward.bases[0], c.bases);
  const fa = alignPrimer(d.forward, seq);
  assert.equal(fa.substitutions, 1);
  assert.equal(fa.tail, "");
  assert.equal(fa.changeFrom3, d.forward.bases.length - 1);
  assert.equal(fa.ops[0].kind, "mismatch");
  const ra = alignPrimer(d.reverse, seq);
  assert.equal(ra.substitutions + ra.insertions + ra.deletions, 0);
  assert.equal(d.reverse.bases, reverseComplement(basesIn(seq, d.reverse)));
  // Each arm near the target Tm, the two close together.
  for (const p of [d.forward, d.reverse]) assert.ok(p.tm3 !== null && Math.abs(p.tm3 - 60) < 3, String(p.tm3));
  assert.equal(d.forward.tm5, null);
  // The product is the whole mutant plasmid, opened at the change.
  assert.equal(product(d)!.sequence, mutantFrom(c, 1000));
});

test("back to back: a deletion is the gap between the primers, an insertion their tails", () => {
  const del = designMutagenesis(seq, true, { start: 1200, length: 30, bases: "" }, "back-to-back")!;
  assert.equal(del.forward.start, 1230);
  assert.equal(del.reverse.end, 1199);
  assert.equal(alignPrimer(del.forward, seq).deletions, 0);
  assert.equal(product(del)!.sequence, mutantFrom(del.change, 1200));
  assert.equal(product(del)!.length, 2970);

  const short = designMutagenesis(seq, true, { start: 1200, length: 0, bases: "CAT" }, "back-to-back")!;
  assert.equal(alignPrimer(short.forward, seq).tail, "CAT");
  assert.equal(alignPrimer(short.reverse, seq).tail, "");
  assert.equal(product(short)!.sequence, mutantFrom(short.change, 1200));

  const his = "CATCACCATCACCATCAC";
  assert.ok(his.length > SPLIT_INSERTION);
  const long = designMutagenesis(seq, true, { start: 1200, length: 0, bases: his }, "back-to-back")!;
  const ft = alignPrimer(long.forward, seq).tail;
  const rt = alignPrimer(long.reverse, seq).tail;
  assert.equal(reverseComplement(rt) + ft, his);
  assert.ok(Math.abs(ft.length - rt.length) <= 1);
  // The product opens in the middle of the insertion; joining its ends makes it whole.
  assert.equal(product(long)!.sequence, mutantFrom(long.change, 1200 + his.length - ft.length));
});

test("overlapping: complementary primers with the change in the middle", () => {
  const c: SdmChange = { start: 1500, length: 3, bases: "GCA" };
  const d = designMutagenesis(seq, true, c, "overlapping")!;
  assert.equal(d.reverse.bases, reverseComplement(d.forward.bases));
  assert.equal(d.forward.start, d.reverse.start);
  assert.equal(d.forward.end, d.reverse.end);
  const fa = alignPrimer(d.forward, seq);
  const ra = alignPrimer(d.reverse, seq);
  assert.equal(fa.substitutions, d.change.length);
  assert.equal(ra.substitutions, d.change.length);
  assert.equal(fa.tail + ra.tail, "");
  // Each primer's 3′ arm is the other's 5′ arm.
  assert.equal(d.forward.tm3, d.reverse.tm5);
  assert.equal(d.forward.tm5, d.reverse.tm3);
  for (const p of [d.forward, d.reverse]) assert.ok(p.tm3 !== null && Math.abs(p.tm3 - 55) < 3 && fa.arms[0].length >= 15, String(p.tm3));
  // A deletion is skipped in the middle.
  const del = designMutagenesis(seq, true, { start: 1500, length: 6, bases: "" }, "overlapping")!;
  assert.equal(alignPrimer(del.forward, seq).deletions, 6);
  assert.equal(alignPrimer(del.reverse, seq).deletions, 6);
});

test("designed primers pass the primer checks, the change well away from the 3′ end", () => {
  for (const layout of ["back-to-back", "overlapping"] as const) {
    for (const c of [
      { start: 400, length: 1, bases: seq[400] === "T" ? "C" : "T" },
      { start: 900, length: 0, bases: "GGATCC" },
      { start: 2000, length: 9, bases: "" }
    ]) {
      const d = designMutagenesis(seq, true, c, layout)!;
      const [f, r] = [d.forward, d.reverse].map(p => primerReport(p.bases, alignPrimer(p, seq), seq, true));
      for (const rep of [f, r]) {
        const warned = rep.checks.filter(x => x.level === "warn").map(x => x.short);
        assert.ok(!warned.includes("3′ change") && !warned.includes("No site") && !warned.some(w => / sites$/.test(w)), `${layout} ${changeName(seq, d.change)}: ${warned}`);
        assert.ok(!warned.includes("Low Tm") && !warned.includes("High Tm"), `${layout}: ${warned}`);
      }
    }
  }
});

test("the arms follow the Tm method in Settings", () => {
  const c: SdmChange = { start: 1000, length: 1, bases: seq[1000] === "A" ? "G" : "A" };
  const nn = designMutagenesis(seq, true, c, "back-to-back", { tm: 60, minArm: 10, maxArm: 35 })!;
  try {
    useTmSettings({ ...DEFAULT_TM, method: "wallace" });
    const wallace = designMutagenesis(seq, true, c, "back-to-back", { tm: 60, minArm: 10, maxArm: 35 })!;
    assert.ok(Math.abs(wallace.forward.tm3! - 60) <= 4);
    assert.equal(wallace.forward.tm3, meltingTemp(alignPrimer(wallace.forward, seq).arms[0]));
    assert.notEqual(wallace.forward.bases.length, nn.forward.bases.length);
  } finally {
    useTmSettings(DEFAULT_TM);
  }
});

test("no room near the end of a linear sequence", () => {
  assert.equal(designMutagenesis(seq, false, { start: 5, length: 1, bases: "A" }, "back-to-back"), null);
  assert.equal(designMutagenesis(seq, false, { start: 2995, length: 1, bases: "A" }, "overlapping"), null);
  assert.ok(designMutagenesis(seq, false, { start: 1000, length: 1, bases: seq[1000] === "A" ? "C" : "A" }, "overlapping"));
  // Across the origin of a circular one is fine.
  const d = designMutagenesis(seq, true, { start: 3, length: 1, bases: seq[3] === "A" ? "C" : "A" }, "back-to-back")!;
  assert.ok(d.reverse.start > d.reverse.end);
  assert.equal(product(d)!.sequence, mutantFrom(d.change, 3));
});

test("codons: the fewest bases changed, then not rare in E. coli", () => {
  // Residues 2 and 3 of a forward CDS are GCT (Ala) and ATA (Ile).
  const s = seq.slice(0, 100) + "ATGGCTATA" + seq.slice(109);
  const f = cds(100, 399, 1);
  const site = codonAt(s, f, 2)!;
  assert.deepEqual(site, { residue: 2, codon: "GCT", aa: "A", positions: [103, 104, 105], strand: 1 });
  assert.equal(residueAt(s, f, 104), 2);
  assert.equal(residueAt(s, f, 99), null);
  assert.equal(codonAt(s, f, 101), null);
  // Ala → Asp: GAT is one base away (GAC two).
  const asp = codonChoices(s, site, "D");
  assert.deepEqual(asp.map(c => [c.codon, c.changes]), [["GAT", 1], ["GAC", 2]]);
  assert.deepEqual(asp[0].change, { start: 104, length: 1, bases: "A" });
  assert.equal(codonChoices(s, site, "R")[0].codon, "CGT");
  // Ile (ATA) → Leu: TTA and CTA are both one base away, and CTA is rare.
  const leu = codonChoices(s, codonAt(s, f, 3)!, "L");
  assert.deepEqual(leu.slice(0, 2).map(c => [c.codon, c.changes, c.rareInEColi]), [["TTA", 1, false], ["CTA", 1, true]]);
  // Ala → Ala: the other codons, but never the one there now.
  assert.ok(!codonChoices(s, site, "A").some(c => c.codon === "GCT"));
  // Ala → Trp changes all three.
  const trp = codonChoices(s, site, "W")[0];
  assert.equal(trp.codon, "TGG");
  assert.deepEqual(trp.change, { start: 103, length: 3, bases: "TGG" });
  // Gly (GGT, after mutating) → Ala: GCT keeps the outer bases.
  const glySite = codonAt(applyChange(doc(s), { start: 104, length: 1, bases: "G" }).sequence, f, 2)!;
  assert.equal(glySite.codon, "GGT");
  assert.deepEqual(codonChoices(s, glySite, "A")[0].change, { start: 104, length: 1, bases: "C" });
});

test("codons of a reverse CDS are changed on the top strand as their complement", () => {
  // Read right to left: the codon at 197..199 is the reverse complement of the top strand.
  const s = seq.slice(0, 197) + reverseComplement("ATG") + seq.slice(200);
  const f = cds(100, 199, -1);
  const site = codonAt(s, f, 1)!;
  assert.equal(site.codon, "ATG");
  assert.deepEqual(site.positions, [199, 198, 197]);
  const leu = codonChoices(s, site, "L")[0];
  assert.equal(leu.codon, "CTG");
  assert.deepEqual(leu.change, { start: 199, length: 1, bases: "G" });
  const mutant = applyChange(doc(s), leu.change);
  assert.equal(codonAt(mutant.sequence, f, 1)!.aa, "L");
  // TAG stays a stop whatever the amber setting.
  assert.ok(codonChoices(s, site, "*").some(c => c.codon === "TAG"));
  assert.ok(!codonChoices(s, site, "Q").some(c => c.codon === "TAG"));
});

test("changes are named as on the top strand", () => {
  const s = "ACGTACGTAC";
  assert.equal(changeName(s, { start: 1, length: 1, bases: "T" }), "C2T");
  assert.equal(changeName(s, { start: 1, length: 3, bases: "AAA" }), "2_4delinsAAA");
  assert.equal(changeName(s, { start: 1, length: 2, bases: "" }), "2_3del");
  assert.equal(changeName(s, { start: 4, length: 1, bases: "" }), "5del");
  assert.equal(changeName(s, { start: 4, length: 0, bases: "GG" }), "4_5insGG");
  // Short, for primer names: long insertions as their length.
  assert.equal(changeName(s, { start: 4, length: 0, bases: "CATCACCATCAC" }, true), "4_5ins12");
  assert.equal(changeName(s, { start: 4, length: 0, bases: "CATCAC" }, true), "4_5insCATCAC");
});
