# Automatic feature detection: plan

Status: built (November 2026), all five parts below. Each was one branch and one PR. Licence terms in "Sources" were read on 2 November 2026; they are a reading of
published terms, not legal advice, and each one should be checked again before the catalog
is built.

## What we want

The biggest gap against SnapGene. A plain FASTA or a sparsely annotated GenBank file opens
with a bare map, an empty row on Home and no markers on the Info tab, although most of
what is in a plasmid is well known: promoters, resistance genes, origins, tags,
fluorescent proteins.

- **Everything on the computer.** Detection fetches nothing at run time and uploads
  nothing. The catalog ships with the app.
- **Nothing changes a file by itself.** Suggestions are shown; they become features only
  when accepted, as one undo step, and the file on disk changes only when it is saved.
- **No copy of SnapGene's feature database.** Its terms for redistribution couldn't be
  confirmed, so neither its records nor anything derived from them go in. Every entry comes
  from a source with clear terms, and records which one.
- **Each entry carries its source**, so the catalog can be audited and a single entry
  dropped if its terms turn out to be unclear.
- [pLannotate](https://github.com/mmcguffi/pLannotate) (GPL-3.0) is the comparison for how
  detection can work. Its published method is worth following; its feature database, which
  is derived from SnapGene's, is not used.

## What the code already gives us

- **The core has the search.** `crates/seqcore/src/align.rs` has a k-mer index
  (`KmerIndex`, `unique_kmers`, `seeds`, `longest_chain`) and Smith-Waterman-Gotoh with
  traceback (`local_align`); `crates/seqcore/src/dna.rs` has `reverse_complement`. Finding
  a catalog entry in a plasmid is the same shape of problem as placing a read, and the
  crate is dependency-free and tested on its own.
- **Doubling a circular sequence** so a hit across the origin isn't missed is what the
  Sanger path already does (`crates/seqcore/src/sanger.rs`).
- **Home reads features, not sequence.** `readConstruct` in `src/home.ts` calls
  `describeContents` (`src/lib/constructs.ts`), which sorts names through
  `detectFromFeatures` (`src/lib/labinfo.ts`). Only features saved in the file reach Home,
  and results are cached by size and date.
- **The Info tab** calls `detectFromFeatures` on the live document
  (`legacyFeatures` in `src/doc/document.ts`), so accepted features show up there at once.
- **One undo step** is `store.apply(next, label, selection?)` with no `key`.
- **A task with a start and an end is a dialog** (`openDialog` in `src/ui/modal.ts`, see
  `src/views/primerDialogs.ts`), not a sixth view.

**Traps, because the catalog's names and types decide what users see:**

- `detectFromFeatures` matches names case-insensitively, so a *repressor* called "TetR"
  would be counted as tetracycline resistance on Home and in Info. It has to be named
  something else, such as "tetR repressor".
- `describeContents` puts CDS features first, as "usually the insert", so a tag typed as
  CDS would push the real insert out of the five names shown. Tags are `misc_feature`,
  as `src/lib/constructs.test.ts` already assumes for 6xHis.
- A type of `promoter`, `rep_origin` and so on is what puts a part in the right group,
  so types follow the GenBank feature table, not our own words. A transfer origin takes
  `oriT`, not `rep_origin`, or Info would list it as a replication origin.
- A marker whose name that table doesn't know disappears from both Home and Info with no
  error anywhere: `aph(3')-IIa` has to be `NeoR`, since `NeoR/KanR` matches nothing.
- Saving as FASTA drops features after a yes/no question (`save` in
  `src/doc/document.ts`). Accepted features are lost that way, so the message has to be
  plain about it.

## Sources

### Used

| Source | Used for | Terms | What we must do |
| --- | --- | --- | --- |
| [NCBI](https://www.ncbi.nlm.nih.gov/home/about/policies/) GenBank / RefSeq | Origins, promoters, terminators, natural genes, by accession and coordinates | NCBI "places no restrictions on the use or distribution of the data", but submitters may hold rights | Prefer records of natural sources (phage, virus, organism) over vendor-submitted vector records; review anything else by hand |
| [AMRFinderPlus](https://github.com/ncbi/amr) reference gene catalog | Resistance genes | A "United States Government Work"; NLM "have not placed any restriction on its use or reproduction" | Cite Feldgarden et al. 2019 |
| [UniProtKB/Swiss-Prot](https://ftp.uniprot.org/pub/databases/uniprot/LICENSE) | Cas9, MBP, GST and others — **protein entries only**, so from part 4 | CC BY 4.0, which the FSF lists as compatible with every version of the GPL | Reproduce UniProt's copyright statement in the catalog |
| [FPbase](https://www.fpbase.org/terms) | Fluorescent proteins — **protein entries only**, so from part 4 | Data "free of all copyright restrictions", for non-commercial and commercial use | Attribute the original authors named on each protein's page |
| A paper or DOI | Short synthetic or defined elements: tags, phage promoters, *loxP*, 2A peptides | The sequence is a published fact, belonging to no database | The citation is required, and the generator refuses a row without one |
| pLannotate | Its published method (scoring, overlap trimming, fragments) | GPL-3.0, like Strandivo | Method only; its feature database is not used, and neither are its curation tables (see below) |

Entries are fetched by accession and coordinates with NCBI's E-utilities, which serves a
slice of a record directly (`efetch.fcgi?db=nuccore&id=J01749&seq_start=…&seq_stop=…`), so
the generator takes the exact bases of a named part out of the record that first described
it rather than out of anyone's vector collection.

pLannotate's curation tables (`selection_markers.csv`, `ori_copy_number.csv`) are GPL-3.0
and hold real work — copy numbers, selection agents, host ranges — but every row is keyed
to a SnapGene identifier (`AmpR_(2)`, `R6K_gamma_ori_(2)`), so copying them would pull
SnapGene's feature set and naming in through the back door. They cite their sources as
PMIDs, so where we want the same facts we take them from the cited paper and key them to
our own entries.

FPbase also notes that "some data may be covered by patents or other rights" and that it
"cannot provide unrestricted permission"; NCBI says the same of submitters' rights. So
entries are the sequences of well-known parts from the records above, each with its
accession, and `docs/feature-catalog.md` lists every source with what it asks for.

### Not used

- **SnapGene's feature database.** Redistribution couldn't be confirmed. That also rules
  out pLannotate's SnapGene set and the GenoLIB compilation behind it.
- **Addgene.** Its terms allow downloading content "for your informational, noncommercial
  use only" and forbid using "automated systems or software to extract data from our Site
  for commercial purposes". A non-commercial limit can't be carried into a GPL-3.0
  repository, so no Addgene record goes into the catalog or into `testdata/`. Opening a
  file you downloaded yourself to see how detection does on it is a different thing, and
  fine; it just stays off the repository.
- **PlasMapper 3.0's FeatureDB.** No licence for the data and no bulk download found; the
  paper itself is CC BY-NC, which says nothing about the database either way.
- **CARD.** Free only for academic, government and non-profit use; anyone else needs a
  licence from McMaster. AMRFinderPlus covers the same genes without that.
- **ResFinder.** No licence text found on DTU's own pages or in its repository, so its
  terms are unverified. AMRFinderPlus covers the same ground.
- **iGEM Registry.** The only terms page found is an undated proposal to move from
  CC BY-SA 3.0 to CC BY 3.0, and the live page can't be read without a browser. Left out
  until the current terms are clear.
- **Rfam (CC0).** The terms are fine, but its covariance models need an Infernal-style
  search the core doesn't have. Worth revisiting for ncRNA parts.

## How it works

**The search runs in the core.** A new `crates/seqcore/src/annotate.rs` indexes the
plasmid, looks each catalog entry's k-mers up in that index, and runs a full alignment only
where seeds land, on both strands. `src-tauri/src/annotate.rs` passes requests as JSON the
way `src-tauri/src/sanger.rs` does, behind a `detect_features` command.

**Placing a part is not the same problem as placing a read**, and the Sanger path's
machinery can't simply be reused:

- `unique_kmers` keeps only k-mers that occur **once** ("repeats can't place a read"), so
  calling it on a sequence doubled across the origin returns an *empty* map — every k-mer
  then appears twice. The index must be built on one copy, with the origin handled by
  extending the search window rather than by doubling the text.
- `local_align` and `KmerIndex::best_window` each return a single result, and a read has
  one true position whereas a part may have several: two `loxP` sites, a repeated
  terminator, both halves of tdTomato. Detection needs every window above the threshold,
  not the best one.

**The catalog is a TSV** included with `include_str!`, so a build needs no network and the
app reads no file at run time. It is generated by a script a maintainer runs, and the
result is committed.

**Hits are called** following pLannotate's method, not its data. Its `_filter.py` is the
reference, since the paper's summary leaves out the thresholds and is easy to misread:

1. **Score** = identity × coverage × aligned length, where coverage is the fraction of the
   catalog entry the hit covers, capped at 100% so a hit longer than the entry earns
   nothing extra. An exact, full-length match is multiplied by 10, so a perfect hit beats
   a longer ragged one.
2. **Floors.** Keep a hit only at ≥95% identity, the same floor pLannotate gives blastn for
   its DNA database; below that a DNA search produces more noise than signal, and divergent
   homologues are the protein search's job instead. Drop anything whose aligned length is
   under `MIN_BASES`.
3. **Overlap.** Sort by score, then drop a lower-scoring hit when its interval *trimmed by
   15% at each end* meets the **full** interval of a better one — the trimming applies to
   the hit being dropped, not to the better one, so a short part abutting a long one
   survives. Only hits **of the same feature type** are ever compared, which is what keeps
   an MCS inside a lacZ and two genes inside one origin.
4. **Fragments.** A hit covering less than 95% of its entry is a fragment, shown as
   "partial" rather than hidden. "Confident" means ≥95% identity and ≥95% coverage.
5. **What the file already has.** Drop a suggestion that overlaps an existing feature of
   the same type on the same strand. Not by name: real files write the same thing many
   ways — `pIB2-SEC13-mEGFP.dna` says `NeoR/KanR`, and GenBank's current standard is
   `regulatory` with a `/regulatory_class`, not `promoter`, which is what pBR322's own
   record (J01749) uses.

**In a browser** there is no detection unless the page defines `window.__strandivoDetect`,
exactly as alignment needs `window.__strandivoAlign` (`src/platform.ts`). The e2e tests
drive the real app, so they get the real thing.

## Parts

### 1. The catalog and where each entry comes from
`feat/feature-catalog` — `tools/catalog-sources.tsv`, `tools/build-catalog.mjs`,
`crates/seqcore/data/parts.tsv`, `crates/seqcore/src/parts.rs`,
`crates/seqcore/tests/catalog.rs`, `src/lib/catalog.test.ts`, `docs/feature-catalog.md`

**`tools/catalog-sources.tsv` is the curation, and the real work of this part.** The
generator is mechanical: it reads that list, fetches the sequences and writes
`crates/seqcore/data/parts.tsv`. Each row gives id, name, GenBank type, molecule, where
the sequence comes from, a citation and a note.

For a gene the row names an accession and a *selector* (`ncbi:J01749:gene=bla`) so the
coordinates are read out of the record's own feature table rather than typed; a
`TYPE@a..b` form asserts the location as well, so a revised record fails loudly. Short
elements carry their own sequence and a PMID, and may give the peptide they must translate
to, which catches a typo. **A paper or DOI is a valid source**: the sequence of the T7
promoter or the FLAG tag is a published fact and belongs to no database.

Boundaries may **never** come from a SnapGene annotation, `testdata/snapgene/*.dna`
included. Those files are a yardstick for what we find, never a source. No test can detect
a breach after the fact, which is why it is written down.

A `molecule` column from the start, `dna` or `protein`, because a good part of the catalog
can only be protein and a later format change would be worse: a tag's DNA depends on the
codons whoever ordered it chose, and fluorescent proteins, Cas9, MBP and GST have **no
usable DNA source at all** — FPbase holds only amino acids, Swiss-Prot is protein, and
EGFP's DNA is a codon-optimized sequence living in vendor vector records rather than in
the *Aequorea* record its protein came from. Those entries wait for part 4.

So this part's DNA entries are: origins, natural promoters and terminators, resistance
genes, the *lac* parts, the common tags and recombination sites — a few dozen checked by
hand, growing toward 150–300 as each remaining boundary is decided. Entries whose extent
is ours rather than a record's (origins, since every record marks one as a single base)
are tagged separately and carry the citation they rest on.

`docs/feature-catalog.md` records every source and its terms, how to re-run the generator,
and the naming rules. `crates/seqcore/tests/catalog.rs` checks the file offline;
`src/lib/catalog.test.ts` ties the names to `detectFromFeatures` and `describeContents`,
where a marker named wrongly would silently vanish from Home and Info.

### 2. Detection in the core
`feat/detect-core` — `crates/seqcore/src/annotate.rs`, `crates/seqcore/src/lib.rs`,
`src-tauri/src/annotate.rs`, `src-tauri/src/lib.rs`, `src/platform.ts`

The search returning **all** windows above the threshold, the scoring, overlap resolution,
fragments, and dropping what the file already has; the `detect_features` command and its
TypeScript types. Tested with `cargo test` against `testdata/`:

- pUC19 with its features stripped must come back with AmpR, the *lac* operator, the CAP
  site, `ori` and a partial lacZ, at the right positions and on the right strands. A
  smoke test of the catalog against pUC19 already gives AmpR at 1626 (−), the operator at
  503 (−), the CAP site at 570 (−) and `ori` at 867 (+) at 98%, so these are measured
  expectations rather than guesses. **pUC19 carries no f1/M13 origin** — only the M13
  primer sites near the MCS — so it must *not* be reported; pUC118/119 are the vectors
  that have one. And lacZ must come back as a fragment, since a pUC vector holds only the
  α fragment.
- **Several copies of one part**: a sequence with two `loxP` sites must report both, which
  is what a single-best-window search would miss.
- **Across the origin**: a part straddling base 1 of a circular plasmid must be found once,
  with coordinates that wrap, and not twice.
- **Near-identical entries**: the pUC and pBR322 origins differ by about 2%, so with both
  in the catalog exactly one must win, by score, rather than both being suggested.
- `testdata/snapgene/*.dna` check that we find what SnapGene annotated without using its
  database. The test records which parts we miss, since the catalog is smaller.
- A shuffled sequence of the same length and GC content must come back with nothing. That
  is the false-positive floor, and on its own it tests none of the cases above.

### 3. Reviewing and accepting suggestions
`feat/detect-dialog` — `src/views/detectDialog.ts`, `src/lib/detect.ts` (and its test),
`src/doc/document.ts`, `src-tauri/src/lib.rs`, `e2e/run.mjs`

Tools → Detect Features… and a toolbar button open a dialog: the suggestions grouped by
kind, each row with its name, type, position, identity, "partial" when it is a fragment,
and the source it came from. Checkboxes, with the confident ones already ticked. Add
selected features applies them in one `store.apply`, so one undo removes all of them, and
selects the first. `src/lib/detect.ts` holds the pure parts (grouping, labels, which
suggestions are new) so `npm test` covers them. An e2e check opens a stripped FASTA, runs
detection through `command()` and asserts the features that appear.

### 4. Finding codon-optimized parts
`feat/detect-protein` — `crates/seqcore/src/annotate.rs`, `tools/catalog-sources.tsv`,
`tools/build-catalog.mjs`, `crates/seqcore/data/parts.tsv`

**Before the Home work, not after it.** Almost anything ordered in the last decade is
codon-optimized, and until protein search exists the catalog cannot hold a fluorescent
protein, Cas9, MBP or GST at all. Home shows its contents unprompted and caches them, so
doing it the other way round would fill the library with confidently incomplete answers.

Six-frame translation of the plasmid, a seeded search against the catalog's `protein`
entries with BLOSUM-scored extension, hits mapped back to DNA coordinates and whole codons.
Tags are matched as **exact peptides**, which is the only reliable way to find one: a
6xHis in a synthesised construct can use any of a dozen codon patterns, and the DNA entries
cover two. Fluorescent proteins, Cas9, MBP, GST and the 2A peptides gain protein entries
from FPbase and Swiss-Prot; the DNA entries stay, since they place a part exactly.

### 5. Offering it on open, and on Home
`feat/detect-on-open` — `src/doc/document.ts`, `src/home.ts`, `src/lib/constructs.ts`,
`src/constructLibrary.ts`, `src/settings.ts`, `src/settingsWindow.ts`

When a file opens with far fewer features than its length suggests (none at all, or under
about one per 2 kb), a quiet offer appears — never a dialog that interrupts, and nothing
applied by itself. **A dismissal is remembered per file**, or a sparse plasmid would ask
again every time it is opened.

Home does the same for files with no features of their own, so an unannotated FASTA still
shows what it carries, marked as detected rather than read from the file (a new field on
`ConstructInfo`). Its cache must key on the **catalog's version**, not just a raised
`CACHE_VERSION`: bumping that once would leave every detected result stale after the next
catalog update. A setting turns the offer off.

## Checking work

- `npm run check` before every push, as always.
- Detection itself is tested in the core:
  `cargo test --release --manifest-path crates/seqcore/Cargo.toml` — real files in,
  expected features out, nothing out of a shuffled sequence.
- In the app (`npm run app:dev`): open a stripped pUC19 FASTA, run Detect Features…,
  accept, and check the map shows AmpR, the lac operator and ori where pUC19 has them, that
  one undo removes all of them, and that the file on disk is unchanged until it is saved.
- `AGENTS.md` gains what the code can't say: that the catalog is generated and committed,
  that detection runs in the core with no browser fallback, that names and types are
  chosen for `describeContents` and `detectFromFeatures`, and that an entry without a
  recorded source doesn't go in.
