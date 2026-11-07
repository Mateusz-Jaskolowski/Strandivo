# The alignment and detection core: guide for coding agents

Read this before changing long-read alignment, feature detection or the parts catalog,
including the interface's side of detection (`src/detectOffer.ts`) and
`tools/build-catalog.mjs`.

**Keep this guide true** (and `AGENTS.md`'s rules apply here too): a change that makes
something here wrong updates it in the same commit. Paths are from the repository's root,
and CI checks that they exist.

## Conventions

- **Long reads**: a read without a trace over 1.6 kb is nanopore to the core (`align_long`
  in `crates/seqcore/src/sanger.rs`; a trace makes it Sanger, whatever its length, as raw
  Sanger reads can pass 1.4 kb): no quality trimming, and aligned along a
  chain of seeds that occur once in the reference, with only the gaps between them filled
  in. A read reaching 80% of a circular reference is a whole plasmid: it is turned to start
  at the origin, so its ends join and it comes back as one stretch; `readPos` then counts
  from there, not from the file's first base. A long read's indel of one or two bases in a
  run of five or more of one base (`in_homopolymer`) is never confident, unless a Sanger
  read shows it too. That run length is a guess until real reads are in `testdata/`.
- **Feature detection** (`crates/seqcore/src/annotate.rs`) is not the Sanger path with a
  different input, and must not be built from its pieces. A read has one position; a part
  may have several, so every window above the threshold is returned and the index keeps
  **all** positions of a k-mer — `unique_kmers` keeps only those occurring once, and on a
  sequence doubled across the origin it returns nothing at all. What is left of a window is
  searched again after a hit, while it has room for another whole copy: tandem copies closer
  together than `BAND` vote for diagonals near enough to be grouped, so one alignment of
  that window would report one of three tandem promoters. Hits follow pLannotate's
  `_filter.py`: score is identity × coverage × aligned length, ten times that for an exact
  full-length match, and where two hits **of the same feature type** collide the
  lower-scoring one is dropped if its interval trimmed by 15% at each end still meets the
  better hit's whole interval. A *partial* hit must also be at least `MIN_FRAGMENT_BASES`
  long: pUC19 carries 36 exact bases of pBR322's rop and 77 of lacI's tail, neither of
  which means that gene is there, while lacZ-alpha's 167 do. Trimming the lower hit is what lets a short part sit beside
  a long one; comparing within a type is what keeps a polylinker inside a `lacZ`. A
  suggestion is dropped against an existing feature by type, strand and how much of the
  suggestion that feature covers (`SUPPRESS_SHARE`), never by name: files write the same
  marker many ways (one testdata file says "NeoR/KanR"), and GenBank's own type for a
  promoter is `regulatory`. Touching is not covering, or a CDS that merely abuts AmpR would
  suppress it. Types are matched in families, and the gene family is **asymmetric**: a
  file's `gene` or `misc_feature` covers our `CDS`, since that is how software with no type
  for a marker writes one, but a file's `CDS` does not cover our `misc_feature` — tags are
  typed that way, and reading it both ways would hide every His tag inside an annotated
  gene. **Protein entries are searched in all
  six frames**, because a codon-optimized insert matches nothing at the DNA level and
  fluorescent proteins have no usable DNA source at all; extension there is ungapped,
  since a synthesised gene encodes the *same* protein, so a real match differs by
  substitutions and an indel means a different protein. It is **grown from its seed**, not
  laid against the whole frame: a frame runs the length of the sequence, so measured over
  all of it coverage is always 100% and no protein hit could ever be partial, while a
  truncated entry or one in a fusion has its identity diluted by the stretch that doesn't
  match and falls under the floor. Growing it stops at a stop codon, so a CDS suggestion
  can't cover a sequence that isn't an open frame. A protein hit scores on its span
  in bases, so it and a DNA hit compare on one scale, and it says "protein identity" in
  the dialog rather than claiming the DNA matched.
- **Offering detection** (`src/detectOffer.ts`): a file with far fewer features than its
  length suggests gets a quiet strip under the toolbar, never a dialog, and a dismissal is
  remembered by path or a sparse plasmid would ask every time it opened. Home works out
  the contents of a file that annotates **nothing** itself and marks them "detected"; a
  file with its own features is left alone, since what its author wrote beats a guess. Its
  cache keys on `catalogVersion` (`catalog_version` in `crates/seqcore/src/parts.rs`), not
  just `CACHE_VERSION`: raising that once would leave every detected result stale after
  the next catalog change.
- **The parts catalog** (`crates/seqcore/data/parts.tsv`) is generated by
  `tools/build-catalog.mjs` from the curated list in `tools/catalog-sources.tsv` and built
  in with `include_str!`, so detection fetches nothing and reads no file at run time. Never
  edit the generated file by hand. An entry without a recorded source doesn't go in: the
  app is GPL-3.0, so a source that allows only non-commercial use can't be used at all,
  which is why SnapGene's feature database, Addgene's records and CARD are out. An entry's
  **name and type are not cosmetic**, because `detectFromFeatures` and `describeContents`
  match on the name and group by the type: an entry named `TetR` would be counted as
  tetracycline resistance whatever it was, a marker whose name that table doesn't know
  disappears from Home and Info, and a tag typed as a CDS pushes the real insert out of
  Home's five names. `docs/feature-catalog.md` has the sources, their terms and the naming
  rules; `src/lib/catalog.test.ts` ties the names to that code and
  `crates/seqcore/tests/catalog.rs` checks the file itself.
