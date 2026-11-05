# Test data

Real files used by the automated tests (`crates/seqcore/tests/real_data.rs`). They are
included under their original licences, all compatible with this project's GPL-3.0.

| File | Source | Licence |
| --- | --- | --- |
| `sanger/sage-sample.ab1`, `sanger/sage-sample-reference.fa` | [gear-genomics/sage](https://github.com/gear-genomics/sage) (`server/sample.*`) | GPL-3.0 |
| `sanger/310.ab1`, `sanger/3100.ab1`, `sanger/3730.ab1`, `sanger/A6_1-DB3.ab1` | [Biopython](https://github.com/biopython/biopython) `Tests/Abi` | Biopython License / BSD-3-Clause |
| `sanger/teselagen-example1.ab1` | [TeselaGen tg-oss](https://github.com/TeselaGen/tg-oss) bio-parsers test data | MIT |
| `sanger/pUC19.gb` | GenBank L09137 (public record), via [pydna](https://github.com/pydna-group/pydna) tests | Public sequence record |
| `library/*.ab1`, `library/library-parent.gb` | Mateusz Jaskolowski's lab, contributed for Strandivo (October 2026) | GPL-3.0-or-later, like Strandivo |
| `snapgene/pFA-KanMX4.dna`, `snapgene/sample-d.dna`, `snapgene/sample-e.dna` | Biopython `Tests/SnapGene` | Biopython License / BSD-3-Clause |
| `snapgene/pIB2-SEC13-mEGFP.dna` | TeselaGen tg-oss bio-parsers test data | MIT |

| `uniprot/Q9UKG4.json`, `uniprot/P00533.json` | [UniProtKB](https://www.uniprot.org), REST API, release 2026_03: the fields `src/platform.ts` asks for | CC BY 4.0 |
| `uniprot/SLC13A4-BC030689.gb` | ENA/GenBank BC030689, its CDS and sequence only, with UniProt's cross-reference | Public sequence record |

`teselagen-example1.ab1` is an ABI pGEM control read. Aligned to pUC19 it correctly shows
the SP6 promoter that pGEM carries next to its polylinker as a ~30 bp insertion.

`library/` holds clones from a synthetic nanobody library and their parent, a phagemid
whose CDRs the library replaces. Its names are kept generic (FR1–FR4, CDR1–CDR3, FR2's
versions as v1 and v2).
`2026-10-13_C01_MJG5PRIMER.ab1` is a single clone; `2026-10-13_A02_MJE4PRIMER.ab1` an
almost equal mix of two plasmids, and `2026-10-13_A01_MJF3PRIMER.ab1` a mix whose second
plasmid is weaker (about 30%), both clearest in CDR1. `docs/clone-checking.md` has what
they show.

**Still needed: a real whole-plasmid read.** Everything testing long reads is made up, so
the core's homopolymer rule rests on what is published, not on data. A maintainer will add
a Plasmidsaurus result (the assembled sequence with its reference, and the raw FASTQ if there
is one) when there is one; `docs/clone-checking.md` (phase 6) lists what to check against it.

`e2e/pUC19-whole.fastq` is a made-up whole-plasmid read of `e2e/pUC19-annotated.gb`, turned to
start at base 1,001, every base Q40. It has 12 bases inserted before base 101, one T less in
the run of seven at 1,407–1,413 (a homopolymer indel) and A2000G.

`e2e/pUC19-annotated.gb` is the pUC19 record above with lacZα, MCS and AmpR annotated (from
its open reading frames). `e2e/bla-check.fasta` is pUC19 1700–2400 reverse-complemented with
one substitution (A2000G), which should be reported as AmpR W163R. `e2e/c7_bla-F.fasta` and
`e2e/c7_bla-R.fasta` are two reads of one made-up clone: pUC19 1650–2250 forward and
1950–2550 reverse-complemented, both with A2000G; the reverse read also has A2100C, so the
two disagree there.
