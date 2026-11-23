// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// UniProt entries placed on a CDS. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { accessionOf, accessionsOf, alignmentLines, alignProteins, CDS_ONLY, describeAlignment, ENTRY_ONLY, PAIR, parseAccession, parseAccessions, parseEntry, placeFeatures, regionColumns, regionIdentity, regionMatch, translationForMatch, wellSupported, withAccession } from "./uniprot.ts";

// The entry as the API gives it, and the protein of an mRNA that UniProt cites for it.
const fixture = JSON.parse(readFileSync(new URL("../../testdata/uniprot/Q9UKG4.json", import.meta.url), "utf8"));
const entry = parseEntry(fixture)!;
const egfr = parseEntry(JSON.parse(readFileSync(new URL("../../testdata/uniprot/P00533.json", import.meta.url), "utf8")))!;
const protein = entry.sequence;
const GFP = "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITLGMDELYK";

const place = (cds: string) => {
  const a = alignProteins(cds, entry.sequence)!;
  return { placed: placeFeatures(entry, a), match: describeAlignment(a) };
};
const regions = (cds: string) => place(cds).placed.flatMap(p => (p.region ? [[p.region.start, p.region.end]] : []));

test("an accession is found in what people type or paste", () => {
  assert.equal(parseAccession("Q9UKG4"), "Q9UKG4");
  assert.equal(parseAccession(" q9ukg4 "), "Q9UKG4");
  assert.equal(parseAccession("https://www.uniprot.org/uniprotkb/Q9UKG4/entry"), "Q9UKG4");
  assert.equal(parseAccession("P00533-2"), "P00533-2");
  assert.equal(parseAccession("A0A024R161"), "A0A024R161");
  assert.equal(parseAccession("SLC13A4"), null);
  assert.equal(parseAccession(""), null);
});

test("several accessions can be typed or pasted at once", () => {
  assert.deepEqual(parseAccessions("Q62205, D0E0C2"), ["Q62205", "D0E0C2"]);
  assert.deepEqual(parseAccessions("https://www.uniprot.org/uniprotkb/Q62205/entry https://rest.uniprot.org/uniprotkb/d0e0c2.json q62205"), ["Q62205", "D0E0C2"]);
  assert.deepEqual(parseAccessions("SLC13A4 and P00533-2"), ["P00533-2"]);
  assert.deepEqual(parseAccessions("nothing here"), []);
});

test("a /db_xref is read in the ways files write it, and others are kept", () => {
  assert.equal(accessionOf({ db_xref: ["GeneID:26266", "UniProtKB/Swiss-Prot:Q9UKG4"] }), "Q9UKG4");
  assert.equal(accessionOf({ db_xref: "UniProtKB/TrEMBL:A0A024R161" }), "A0A024R161");
  assert.equal(accessionOf({ db_xref: ["GeneID:26266"] }), null);
  assert.equal(accessionOf(undefined), null);
  assert.deepEqual(accessionsOf({ db_xref: ["UniProtKB/Swiss-Prot:Q62205", "GeneID:1", "UniProt:D0E0C2", "UniProtKB/Swiss-Prot:Q62205"] }), ["Q62205", "D0E0C2"]);
  // Another entry's cross-reference stays: a chimera's CDS can have had one before.
  assert.deepEqual(withAccession({ db_xref: ["GeneID:1", "UniProtKB/TrEMBL:A0A024R161"], gene: ["x"] }, "Q9UKG4", true), { db_xref: ["GeneID:1", "UniProtKB/TrEMBL:A0A024R161", "UniProtKB/Swiss-Prot:Q9UKG4"], gene: ["x"] });
  // The same entry's is replaced, as an entry moves from TrEMBL to Swiss-Prot.
  assert.deepEqual(withAccession({ db_xref: ["UniProtKB/TrEMBL:Q9UKG4", "GeneID:1"] }, "Q9UKG4", true), { db_xref: ["GeneID:1", "UniProtKB/Swiss-Prot:Q9UKG4"] });
  assert.deepEqual(withAccession({}, "A0A024R161", false), { db_xref: ["UniProtKB/TrEMBL:A0A024R161"] });
});

test("an entry's features are read with their evidence", () => {
  assert.equal(entry.accession, "Q9UKG4");
  assert.equal(entry.reviewed, true);
  assert.equal(entry.title, "SLC13A4");
  assert.equal(entry.features.length, 12);
  assert.deepEqual(entry.features[2], { name: "TM3", kind: "Transmembrane", start: 77, end: 97, predicted: true });
  assert.deepEqual(egfr.features.map(f => f.kind), ["Signal peptide", "Topological domain", "Transmembrane", "Topological domain"]);
  assert.deepEqual(egfr.features[1].name, "Extracellular");
});

test("unknown ends are skipped, and an entry with no sequence is no entry", () => {
  assert.equal(parseEntry({ primaryAccession: "P1", entryType: "Inactive" }), null);
  const e = parseEntry({
    primaryAccession: "P12345",
    entryType: "UniProtKB unreviewed (TrEMBL)",
    sequence: { value: "MAAA" },
    features: [
      { type: "Transmembrane", location: { start: { value: -1, modifier: "UNKNOWN" }, end: { value: 3 } } },
      { type: "Binding site", location: { start: { value: 1 }, end: { value: 1 } } }
    ]
  })!;
  assert.equal(e.reviewed, false);
  assert.equal(e.features.length, 0);
});

test("domains and other protein regions are offered alongside membrane annotations", () => {
  const e = parseEntry({ primaryAccession: "P12345", sequence: { value: "M".repeat(100) }, features: ["Domain", "Region", "Repeat", "Motif", "Coiled coil", "Signal", "Binding site"].map(type => ({ type, description: `${type} annotation`, location: { start: { value: 10 }, end: { value: 30 } } })) })!;
  assert.deepEqual(e.features.map(f => f.kind), ["Domain", "Region", "Repeat", "Motif", "Coiled coil", "Signal peptide"]);
  const mapped = placeFeatures(e, alignProteins(e.sequence, e.sequence)!);
  assert.equal(mapped[0].region!.sourceKey, "Domain:10-30");
});

test("the entry's own protein puts every helix where UniProt says", () => {
  const { placed, match } = place(protein);
  assert.equal(match.identity, 1);
  assert.ok(placed.every(p => p.placement === "whole"));
  assert.deepEqual(regions(protein)[2], [77, 97]);
});

test("a stop is not part of the match", () => {
  assert.equal(translationForMatch("MAA*"), "MAA");
  assert.equal(translationForMatch("MA*A"), "MA*A");
});

test("a substitution changes no numbers", () => {
  const cds = protein.slice(0, 244) + "R" + protein.slice(245);
  const { placed, match } = place(cds);
  assert.ok(match.ok);
  assert.ok(placed.every(p => p.placement === "whole"));
  assert.deepEqual(regions(cds), regions(protein));
});

test("an extra residue moves only what is after it", () => {
  const cds = protein.slice(0, 200) + "D" + protein.slice(200);
  const after = regions(cds);
  assert.deepEqual(after[3], [113, 133]);
  assert.deepEqual(after[4], [275, 295]);
  assert.ok(place(cds).placed.every(p => p.placement === "whole"));
});

test("a fusion keeps UniProt's numbers as well as its own", () => {
  const { placed, match } = place(GFP + protein);
  assert.ok(match.ok);
  assert.deepEqual([placed[0].region!.start, placed[0].region!.end], [GFP.length + 13, GFP.length + 33]);
  assert.deepEqual([placed[0].region!.sourceStart, placed[0].region!.sourceEnd], [13, 33]);
});

test("a tagged truncation says what is whole, clipped and absent", () => {
  const { placed } = place("MHHHHHHENLYFQG" + protein.slice(39, 560));
  assert.deepEqual(placed.map(p => p.placement), ["absent", "whole", "whole", "whole", "whole", "whole", "whole", "whole", "whole", "whole", "clipped", "absent"]);
  const clipped = placed[10].region!;
  assert.deepEqual([clipped.sourceStart, clipped.sourceEnd], [543, 560]);
  assert.equal(clipped.end - clipped.start, 560 - 543);
});

test("a helix split by a deletion is still placed, and says it isn't whole", () => {
  const { placed } = place(protein.slice(0, 85) + protein.slice(90));
  // Both ends of TM3 (77–97) line up, but five residues inside face a gap.
  assert.equal(placed[2].placement, "gapped");
  assert.deepEqual([placed[2].match.pairs, placed[2].match.length, placed[2].match.inserted], [16, 21, 0]);
  assert.equal(placed[2].pastLimit, false);
  assert.equal(placed[1].placement, "whole");
  assert.deepEqual(placed[3].region && [placed[3].region.start, placed[3].region.end], [108, 128]);
});

test("each region says how alike it is and how much of it lines up", () => {
  // TM3 (77–97) exact; TM4 (113–133) with two substitutions.
  const cds = protein.slice(0, 115) + "WW" + protein.slice(117);
  const { placed } = place(cds);
  const exact = placed[2].match;
  assert.deepEqual([exact.pairs, exact.same, exact.length, exact.inserted], [21, 21, 21, 0]);
  assert.equal(regionIdentity(exact), 1);
  const changed = placed[3].match;
  assert.deepEqual([changed.pairs, changed.same, changed.length], [21, 19, 21]);
  assert.equal(placed[3].placement, "whole");
  assert.ok(wellSupported(placed[3]));
  assert.ok(Math.abs(regionIdentity(changed) - 19 / 21) < 1e-9);
});

test("residues the CDS has inside a region make it gapped, though all of the entry's line up", () => {
  // Five residues more in the middle of TM3 (77–97).
  const cds = protein.slice(0, 86) + "GGGGG" + protein.slice(86);
  const tm3 = place(cds).placed[2];
  assert.equal(tm3.placement, "gapped");
  assert.deepEqual([tm3.match.pairs, tm3.match.length, tm3.match.inserted], [21, 21, 5]);
  assert.deepEqual([tm3.region!.start, tm3.region!.end, tm3.region!.sourceStart, tm3.region!.sourceEnd], [77, 102, 77, 97]);
  assert.equal(wellSupported(tm3), false);
});

test("the alignment under a region is what placed it, gaps and all", () => {
  const cds = protein.slice(0, 85) + "GG" + protein.slice(90);
  const a = alignProteins(cds, entry.sequence)!;
  // The path walks both proteins from where the alignment starts to where it ends.
  const counts = [0, 0, 0];
  for (const column of a.path) counts[column]++;
  assert.equal(a.cdsStart + counts[PAIR] + counts[CDS_ONLY], describeAlignment(a).cdsTo);
  assert.equal(a.entryStart + counts[PAIR] + counts[ENTRY_ONLY], describeAlignment(a).entryTo);
  const columns = regionColumns(a, 77, 97);
  assert.equal(columns.filter(c => c.entry !== null).length, 21);
  assert.equal(columns.filter(c => c.cds === null).length, 21 - regionMatch(a, 77, 97).pairs);
  assert.equal(columns.filter(c => c.entry === null).length, regionMatch(a, 77, 97).inserted);
  const lines = alignmentLines(a, columns, 10);
  assert.equal(lines.length, Math.ceil(columns.length / 10));
  assert.equal(lines.map(l => l.entry.replace(/-/g, "")).join(""), entry.sequence.slice(76, 97));
  assert.equal(lines[0].entryFrom, 77);
  assert.equal(lines[0].cdsFrom, 77);
  assert.equal(lines.at(-1)!.entryTo, 97);
  assert.match(lines.map(l => l.cds).join(""), /-/);
  assert.match(lines.map(l => l.marks).join(""), /^\|+/);
});

test("a substitution shows as a mark of its own", () => {
  const cds = protein.slice(0, 80) + "W" + protein.slice(81);
  const a = alignProteins(cds, entry.sequence)!;
  const [line] = alignmentLines(a, regionColumns(a, 77, 97), 60);
  assert.equal(line.marks, "||||·||||||||||||||||");
  assert.equal(line.cds[4], "W");
});

test("residues of a region past the alignment's ends face gaps", () => {
  const a = alignProteins("MHHHHHHENLYFQG" + protein.slice(39, 560), entry.sequence)!;
  const columns = regionColumns(a, 543, 570);
  assert.equal(columns.length, 28);
  assert.deepEqual(columns.slice(-10).map(c => c.cds), Array(10).fill(null));
  const line = alignmentLines(a, columns, 60)[0];
  assert.equal(line.entryFrom, 543);
  assert.equal(line.entryTo, 570);
  assert.equal(line.cdsTo, line.cdsFrom! + 17);
});

test("limiting the search to part of the CDS keeps the CDS's own numbers", () => {
  const cds = GFP + protein;
  const within = { start: GFP.length + 1, end: GFP.length + 320 };
  const a = alignProteins(cds, entry.sequence, within)!;
  assert.deepEqual(a.within, within);
  const placed = placeFeatures(entry, a);
  assert.deepEqual([placed[0].region!.start, placed[0].region!.end], [GFP.length + 13, GFP.length + 33]);
  assert.equal(placed[4].placement, "whole");
  // TM6 (309–329) runs past the limit: clipped there, and said to be.
  assert.equal(placed[5].placement, "clipped");
  assert.equal(placed[5].pastLimit, true);
  assert.deepEqual([placed[5].region!.end, placed[5].region!.sourceEnd], [GFP.length + 320, 320]);
  // What lies wholly past the limit isn't here, and may be past it.
  assert.equal(placed[6].placement, "absent");
  assert.equal(placed[6].pastLimit, true);
  // A limit covering the whole CDS is no limit, and an empty one finds nothing.
  assert.equal(alignProteins(cds, entry.sequence, { start: 1, end: cds.length })!.within, null);
  assert.equal(alignProteins(cds, entry.sequence, { start: 10, end: 5 }), null);
});

test("a region cut by the limit says so; one the construct itself cuts short doesn't", () => {
  // TM3 is 77–97; limit the search to end at its 90th residue.
  const limited = placeFeatures(entry, alignProteins(protein, entry.sequence, { start: 1, end: 90 })!)[2];
  assert.equal(limited.placement, "clipped");
  assert.equal(limited.pastLimit, true);
  assert.deepEqual([limited.region!.start, limited.region!.end, limited.region!.sourceEnd], [77, 90, 90]);
  // The same helix cut short in the construct, with the CDS ending there.
  const short = placeFeatures(entry, alignProteins(protein.slice(0, 90), entry.sequence)!)[2];
  assert.equal(short.placement, "clipped");
  assert.equal(short.pastLimit, false);
});

test("two regions of a kind over the same residues keep keys of their own", () => {
  const e = parseEntry({ primaryAccession: "P12345", sequence: { value: "M".repeat(60) }, features: ["Disordered", "Interaction with X"].map(description => ({ type: "Region", description, location: { start: { value: 10 }, end: { value: 30 } } })) })!;
  const placed = placeFeatures(e, alignProteins(e.sequence, e.sequence)!);
  assert.deepEqual(placed.map(p => p.key), ["Region:10-30", "Region:10-30#2"]);
  assert.deepEqual(placed.map(p => p.region!.sourceKey), ["Region:10-30", "Region:10-30#2"]);
});

test("a large insert in a loop leaves the helices on both sides", () => {
  const cds = protein.slice(0, 220) + GFP + protein.slice(220);
  const { placed } = place(cds);
  assert.ok(placed.every(p => p.placement === "whole"));
  assert.deepEqual(regions(cds)[4], [274 + GFP.length, 294 + GFP.length]);
});

test("an unrelated protein is refused", () => {
  const { match } = place(GFP);
  assert.equal(match.ok, false);
});

test("a protein too long to compare says so", () => {
  assert.equal(alignProteins("A".repeat(9000), "A".repeat(9000)), null);
  assert.equal(alignProteins("", "A"), null);
});
