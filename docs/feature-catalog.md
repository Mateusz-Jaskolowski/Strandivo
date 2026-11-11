# The parts catalog

`crates/seqcore/data/parts.tsv` is the list of common plasmid parts that feature detection
searches for. It is **generated**: `tools/build-catalog.mjs` reads the curated list in
`tools/catalog-sources.tsv`, fetches the bases, and writes the catalog. Never edit the
generated file by hand — `crates/seqcore/tests/catalog.rs` will usually catch it, and the
next run would overwrite it anyway.

The plan this belongs to, including what is deliberately not used, is
`docs/feature-detection-plan.md`.

## The rule

**An entry without a recorded source doesn't go in.** Every row carries the database it
came from, the accession and coordinates, a licence tag and a citation, so the catalog can
be audited and a single entry dropped if its terms turn out to be unclear. The tests
enforce this; the generator refuses to write a row that can't say where it came from.

For an `ncbi`, `defined` or `amrfinder` row the generator actually fetches the accession,
so the row's bases are the record's by construction.

**A citation has to name the paper it claims to.** This was worth building a check for,
because the failure is invisible: bases can be perfectly right while the reference beside
them belongs to someone else's work, and nothing about the row looks wrong. So where a
reference is typed by hand — a `literal` row, or the extent of a `defined` one —
`tools/catalog-sources.tsv` also records that paper's first author, year and journal, and
the generator looks the PMID up on PubMed (or the DOI on Crossref) and **refuses to build
unless the author and year agree**. Where the source carries its own reference the
generator takes it from there instead, so an `ncbi` row cites the record's own paper, a
`uniprot` row the entry's, and an `fpbase` row the DOI FPbase gives for that protein —
right by construction, with nothing to mistype. `crates/seqcore/tests/catalog.rs` then
checks offline that every shipped reference is a well-formed PMID or DOI.

And **no boundary may come from a SnapGene annotation**, including the
`.dna` files in `testdata/`. Those files are legitimately in the repository and are useful
as a *yardstick* — "did we find what SnapGene found?" — but never as a *source*. Reading a
feature's extent out of them would be copying the database we have deliberately excluded,
and no test can detect it after the fact.

## Sources and their terms

Terms were read on 2 November 2026. This is a reading of published terms, not legal
advice, and should be checked again before the catalog grows.

| Licence tag | Source | Terms | What we do about it |
| --- | --- | --- | --- |
| `ncbi-unrestricted` | GenBank records, by accession | NCBI "places no restrictions on the use or distribution of the data"; submitters may hold rights it can't assess | Take bases from the record that first described the part — pBR322 (J01749), the *lac* operon (J01636), pACYC184 (X06403) — not from a modern vendor vector record |
| `usgov-public-domain` | NCBI AMRFinderPlus reference gene catalog (`AMR_CDS.fa`) | A "United States Government Work"; NLM "have not placed any restriction on its use or reproduction" | Cite Feldgarden et al. 2019 (PMID 31427293). The citation is in the generated file's header, and a test fails if it is removed |
| `published-sequence` | Short elements whose sequence is defined by a published paper: promoters, terminators, tags, recombination sites | The sequences themselves are published facts, cited per row | A `reference` and a matching `citation` are both required, and the generator checks the one against the other |
| `defined-extent` | Origins: a record's bases, but an extent we decided (see below) | The bases are GenBank's; the boundaries are ours | Both the accession and a checked citation justifying the extent are required, and the tag keeps it distinct from a record's own annotation |
| `cc-by-4.0` | UniProtKB/Swiss-Prot, by accession: proteins | CC BY 4.0, which the FSF lists as compatible with every version of the GPL | UniProt's copyright statement is reproduced in the generated file's header, and a test fails if it is removed. Each row cites the paper the entry itself cites for the sequence |
| `fpbase-open` | [FPbase](https://www.fpbase.org/terms), by name: fluorescent proteins | Data "free of all copyright restrictions", for non-commercial and commercial use | Credit the original authors of each protein: the generator takes FPbase's own `doi` for that protein into the `reference` column |

Why Strandivo's own licence decides this: the app is GPL-3.0, so anyone may sell it or
ship it inside something they sell. A source that allows only non-commercial use can't go
in at all, because that restriction would travel with every copy. That one test rules out
SnapGene's feature database, Addgene's records and CARD; `docs/feature-detection-plan.md`
has the full list and the reasoning.

## Why the bases come from a record's own feature table

For a gene, `tools/catalog-sources.tsv` names the accession and a selector rather than
coordinates:

```
ampr	AmpR	CDS	ncbi:J01749:gene=bla
```

The generator fetches J01749, finds the CDS whose `/gene` is `bla`, and reads
`complement(3293..4153)` out of the record. So the coordinates are the record's, not
something typed by hand, and the written accession (`J01749.1:3293-4153(-)`) says exactly
what was taken. The row's citation comes out of the same record — J01749 cites Sutcliffe
1978 on the ampicillin resistance gene — so the paper and the bases can't drift apart. The
`TYPE@a..b` form asserts the location as well, so a re-run fails loudly if a record is
ever revised:

```
p15a-ori	p15A ori	rep_origin	ncbi:X06403:rep_origin@581..1493
```

For short elements there is nothing to fetch — the sequence of the T7 promoter or the FLAG
tag is the published fact itself — so those rows carry their bases, a PMID or DOI, and the
citation it has to resolve to. To catch a typo in the bases, a row may also give the
peptide it should translate to, and the generator fails if it doesn't:

```
flag3	3xFLAG	misc_feature	literal	GACTAC…GACAAG	DYKDHDGDYKDHDIDYKDDDDK	PMID 10769759	Hernan 2000 Biotechniques
```

## Origins: why their extent is ours, and how it was decided

Every primary record marks a replication origin as a **single base**, never as a region:
J01749 has `rep_origin 2535` for pBR322, ColE1's own record (J01566) has `rep_origin 1197`.
The few hundred bases that a vector map labels "ori" are therefore a convention with no
authoritative extent to copy. Those entries are tagged `defined-extent`, and this is the
reasoning behind each.

**`ori` — ColE1/pMB1, shared by pBR322 and the pUC vectors. J01749:2534–3122, 589 bp.**
The origin is where RNase H cleaves the RNA II transcript to leave a primer for
leading-strand synthesis, so the useful region is the RNA II transcript up to that
cleavage site. Itoh and Tomizawa mapped RNA II initiation to 555 nucleotides upstream of
the origin (PMID 6156450), which puts the far end of the region a little over 550 bases
from J01749's origin base at 2535 — and 3086 − 2534 = 552. The extent is also what NEB
publishes for pBR322, in the same coordinate frame as J01749 (both put *rop* at
1915–2106), which is a useful independent check rather than the source of the numbers.
Detection finds it in pUC19 at 98% identity, the difference being the point mutation in
RNA II that raises the pUC copy number.

**`f1 ori` — phage f1. V00606:5501–6005, 505 bp.** The f1 origins sit in the intergenic
region between gene IV and gene II, which is what vectors carry as "f1 ori". The record
itself puts gene IV at 4220..5500 and gene II at `join(6006..6407,1..831)`, so the extent
is read off those two boundaries rather than chosen: everything between them
(PMID 6282703, the sequence the record is from).

**`p15A ori` is not in this group.** pACYC184's record annotates `rep_origin 581..1493`
as a real range, so that entry is the record's own and tagged `ncbi-unrestricted`. Where a
record gives a range, we use it.

## DNA or protein

Each row says which it is in its `molecule` column, and both are searched: DNA against the
sequence, protein against all six translations of it. Protein entries exist because a good
deal of the catalog can only ever be protein:

- **A tag's DNA depends on the codons whoever ordered it chose.** 6xHis is in twice
  (`CACCAC…` and `CATCAC…`) and that covers only two common choices. The peptide `HHHHHH`
  matches all of them; the DNA rows stay because they place a tag exactly.
- **Fluorescent proteins, Cas9, MBP and GST have no DNA source we can use.** FPbase holds
  amino acids and nothing else, Swiss-Prot is protein by definition, and EGFP's DNA is a
  codon-optimized sequence that lives in vendor vector records rather than in the
  *Aequorea victoria* record its protein came from. There is no DNA shortcut for them.
- A codon-optimized insert is the normal case for anything ordered recently, so for a good
  part of what people now open, the protein is the only way in.

The length floors differ because the alphabets do: 15 bases, but 6 residues
(`MIN_BASES` and `MIN_RESIDUES` in `crates/seqcore/src/parts.rs`). Six residues is about one
in 64 million by chance, and it is what the commonest tags need — `HHHHHH`, `ENLYFQG` and
`PKKKRKV` are all at or below seven.

A protein hit is grown from the seed that found it, not laid against the whole frame, so an
entry only partly present is reported as partial rather than dropped, and a hit stops at a
stop codon. Its identity floor is 90%, against 95% for DNA: a synthesised gene encodes the
*same* protein, so a real match differs only by substitutions, and a relative is not a
match. That is also why MBP and SUMO carry a note saying the entry is the full natural
protein — a construct using the mature form matches part of it, and is now reported as
exactly that.

## What has been checked against a record

A citation that resolves says the paper exists, not that the bases beside it are right.
These were checked separately, by taking the sequence and looking for it in the organism's
own record:

| Entry | Found in |
| --- | --- |
| T7 promoter, T7 terminator | bacteriophage T7, V01146 (5906 and 24163) |
| T3 promoter | bacteriophage T3, X17255 (14325) |
| SP6 promoter | *Salmonella* phage SP6, AY288927 (12542) |
| loxP | bacteriophage P1, NC_005856 — **across the record's origin**: its arms sit at 94,784 and 5 of a 94,800 bp genome, so the site spans the join |
| FRT | yeast 2-micron plasmid, NC_001398 (690) |
| HA | influenza A/Aichi/2/1968 H3 hemagglutinin, P03437 (residue 114). The epitope is an H3 sequence: it is absent from H1 strains such as A/PR/8/34 |
| Myc | human MYC, P01106 (residue 425) |
| V5 | parainfluenza virus 5 P/V, P11207 (residue 95) |
| SV40 NLS | SV40 large T antigen, P03070 (residue 126) |
| P2A | porcine teschovirus-1 polyprotein, Q9WJ28 — the core, without the added GSG |
| T2A | Thosea asigna virus, Q6A561 — likewise |
| TEV site | tobacco etch virus polyprotein, P04517 — ENLYFQ at 2786, whose own P1' is **S**; the G is the engineered form |

**Four are synthetic and have no record to check against**: FLAG, 6xHis and 8xHis,
Strep-Tag II, and the thrombin site — the last is a consensus recognition sequence, and
LVPR appears in neither prothrombin nor any fibrinogen chain. For these the citation is the
only provenance there is.

A DNA tag entry is verified through its peptide: the generator fails the build unless the
bases translate to the peptide the row claims, and the peptide is what was checked above.

The two defined origin extents were re-derived rather than taken on trust:

- **f1 ori** needs no judgement at all. V00606 puts gene IV at 4220..5500 and gene II at
  `order(6006..6407,1..831)`, so 5501..6005 is simply what lies between them.
- **ori** holds on four counts: the extent contains the RNA I gene (2976..3083), the RNA II
  5' end (3086) and the record's own origin base (2535), and RNA II's start sits 552 bases
  from that origin where Itoh and Tomizawa measured 555.

## Names and types are not cosmetic

What the user sees goes through `detectFromFeatures` and `describeContents`
(`src/lib/labinfo.ts`, `src/lib/constructs.ts`), which match on a feature's **name** and
group by its **type**. So:

- **A name that reads as a marker will be counted as one.** `detectFromFeatures` matches
  names exactly but case-insensitively. `TetR` is not counted, since it is the repressor in
  Tet-On plasmids (SnapGene names the resistance `TcR`); the efflux protein is named `TetA`.
- **Markers have to use the names that table knows.** `aph(3')-IIa` is in the catalog as
  `NeoR`; a name `RESISTANCE` doesn't know would silently disappear from Home and the Info
  tab.
- **Tags are `misc_feature`, never CDS.** `describeContents` lists coding sequences first,
  as they are usually the insert, so a 6xHis typed as a CDS would take one of the five
  places Home shows.
- **The type puts a part in its group** (`promoter`, `rep_origin`, `protein_bind`,
  `misc_recomb`), and decides its colour in `src/doc/analysis.ts`.

`src/lib/catalog.test.ts` ties all of this down: every marker must name the right drug,
nothing else may be read as a marker, and tags must stay out of Home's contents.

## Running the generator

Needs the network; the app never runs it.

```bash
node tools/build-catalog.mjs
```

Useful flags: `--only ampr,kanr` to rebuild a few rows, `--cache <dir>` to reuse
downloaded records (NCBI is rate-limited to about three requests a second, which the
generator respects), `--out <file>` to write somewhere else. Then run the tests and commit
both `tools/catalog-sources.tsv` and the regenerated catalog together.

## What is in it

62 entries so far. 37 are DNA: three origins (`ori`, `p15A ori`, `f1 ori`), the pBR322 genes (`AmpR`,
`TetA`, `Rop`), the *lac* operon's own `lacI`, `lacZ`, operator and CAP site, seven
resistance markers from AMRFinderPlus, the T7/T3/SP6 promoters and T7 terminator, the
common purification and epitope tags, two protease sites, the SV40 NLS, P2A and T2A, and
`loxP` and `FRT`.

The other 25 are protein: nine fluorescent proteins from FPbase (EGFP, mNeonGreen,
mCherry, mScarlet, mRuby3, EYFP, mTurquoise2, TagBFP and tdTomato), six Swiss-Prot
proteins (Cas9, MBP, GST, Cre, T7 RNA polymerase and SUMO), and the common tags and 2A
peptides as peptides, which is the only way to find one whatever codons were chosen.

`lacZ` is the whole gene, so in a pUC vector it matches only its first few hundred bases
and will be reported as a fragment ("partial") rather than as SnapGene's `lacZ-alpha`.
That is deliberate: the α fragment's extent is another convention, and a partial match
against the real gene says the same thing without inventing one.

Entries are at least 15 bases (`MIN_BASES` in `crates/seqcore/src/parts.rs`); shorter than
that and chance matches take over.

## Still to add, and what each one needs first

- **pSC101 and R6K γ origins.** Both are real gaps. pSC101's record (NC_002056) annotates
  no origin at all, and neither has an extent that can be read off a record or derived
  from a mapping as clearly as ColE1's and f1's were, so each needs its own literature
  decision rather than a guess. R6K also behaves differently by host (copy number depends
  on the π initiator), which is worth a note on the entry when it is added.
- **Eukaryotic selection markers** — `hph` (hygromycin), `pac` (puromycin), `bsd`
  (blasticidin), `nat1` (nourseothricin) and Sh *ble* (zeocin). AMRFinderPlus is a
  **pathogen** catalog: it was checked, and carries none of them, so each needs its own
  verified GenBank accession. Sh *ble* matters most, because the `BleoR` entry we do have
  is AMRFinderPlus's bacterial `bleO` and will not match the Sh *ble* that eukaryotic
  zeocin vectors carry. The entry is named for what it is rather than for what a user
  might hope it covers.
- **Mammalian promoters and terminators** — CMV, EF-1α, SV40, U6, bGH poly(A), WPRE. All
  exist in primary records, but the regions used in vectors are conventions, like the
  origins; each needs a decided extent.
- **sfGFP** — FPbase has no protein under that exact name, so it needs looking up another
  way. Until then a superfolder GFP matches `EGFP` at about 97%, which is right about the
  sequence but wrong about the label.
- **mEGFP, EGFP's monomeric A206K variant**, is reported as `EGFP` at about 99.6%. Whether
  that wants an entry of its own is a judgement about how much precision is worth the
  extra near-identical entries.
- **More alleles** of the markers already here (`catA2`, `aadA2`, `tet(B)`, `tet(C)`),
  which would raise recall at the cost of overlapping suggestions.
