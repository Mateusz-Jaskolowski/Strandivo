// Copyright (C) 2026 Mateusz Jaskolowski and Strandivo contributors
// SPDX-License-Identifier: GPL-3.0-or-later

// UniProt entries placed on a CDS. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { accessionOf, alignProteins, describeAlignment, parseAccession, parseEntry, placeFeatures, translationForMatch, withAccession } from "./uniprot.ts";

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

test("a /db_xref is read in the ways files write it, and others are kept", () => {
  assert.equal(accessionOf({ db_xref: ["GeneID:26266", "UniProtKB/Swiss-Prot:Q9UKG4"] }), "Q9UKG4");
  assert.equal(accessionOf({ db_xref: "UniProtKB/TrEMBL:A0A024R161" }), "A0A024R161");
  assert.equal(accessionOf({ db_xref: ["GeneID:26266"] }), null);
  assert.equal(accessionOf(undefined), null);
  assert.deepEqual(withAccession({ db_xref: ["GeneID:1", "UniProtKB/TrEMBL:A0A024R161"], gene: ["x"] }, "Q9UKG4", true), { db_xref: ["GeneID:1", "UniProtKB/Swiss-Prot:Q9UKG4"], gene: ["x"] });
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
  assert.equal(placed[2].placement, "clipped");
  assert.equal(placed[1].placement, "whole");
  assert.deepEqual(placed[3].region && [placed[3].region.start, placed[3].region.end], [108, 128]);
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
