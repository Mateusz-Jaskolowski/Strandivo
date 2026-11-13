# Reads and sequence verification: guide for coding agents

Read this before changing how reads are loaded, aligned, grouped into clones, translated,
summarised or shown in the Reads tab (`src/sanger/`, `src/views/readsView.ts`,
`src/views/traceView.ts`, and the read logic in `src/lib/`). How the core aligns long
reads is in `crates/seqcore/AGENTS.md`.

**Keep this guide true** (and `AGENTS.md`'s rules apply here too): a change that makes
something here wrong updates it in the same commit. Paths are from the repository's root,
and CI checks that they exist.

## Conventions

- **Clones**: reads of one clone (forward and reverse, or several primers) are checked
  together. `src/lib/clones.ts` guesses clones from the reads' names, taken all together;
  a read the user moves (the clone picker in the inspector, the menu or dragging) keeps
  that choice in `LoadedRead.clone`. Each read goes to the core with its clone key, and the core returns
  `clones` beside `reads`: a consensus per clone, its differences and its conflicts (good
  reads that disagree, never reported as a change). What counts differences (Reads tab,
  Info, coverage in the inspector) counts the clones', so a change two reads show counts
  once; a read's own differences are only shown for that read. A clone of one read is
  shown as the read. Clone results refer to reads by index, so regrouping or removing a
  read drops them until aligned again.
- **Mutations of a clone** come from `src/lib/variants.ts`, which reads the consensus codon
  by codon in each CDS (two changes in one codon are one amino-acid change) and names
  them short, HGVS-style: W163R, W163*, L54=, L54fs, G50_S52del, T7_L8insYLG, …delins…
  (amino acids an in-frame change leaves alone are trimmed from both ends); outside a CDS
  they are the app's DNA changes (A2000G). Identical clones share a key made of their DNA
  changes and flags, so TGA and TAG are different clones though both are W163*, and of
  the bases of each variable region read whole, in place of its differences: a vector with
  Ns in its CDRs gives none there, and a longer CDR3 is only "ins 18 bp".
- **Variable regions**: a feature with a `/strandivo_variable` qualifier (anything, a pattern
  such as NNK, or named versions; `src/lib/variable.ts`) is a part a library varies. The
  core aligns reads with these regions as N, so their edges come out right, but calls
  differences against the real bases. The read set then moves the differences in a region
  (bases inserted right next to it included) from `differences` to `variable`, on reads and
  clones alike, so whatever counts changes leaves them out. `cloneVariants` reads each
  region's contents from the consensus, and still uses `variable` for proteins, the clone's
  key and "Open clone as file". Code that uses differences must decide which list it means.
  A protein region attached to a CDS can also carry a library design. The document projects
  it with `variableProteinFeatures` in `src/lib/regions.ts` into the same feature list,
  as a noncoding annotation in the parent's frame; never make it a second CDS.
  Versions can be amino acids (`protein:` before them in the qualifier), matched to the
  region's translation. That is the user's choice, never guessed from the letters: a FLAG
  tag, DYKDDDDK, is all IUPAC base codes.
- **Translation of reads** (`src/lib/readTranslation.ts`, the alignment's Translation chip):
  the frame comes from the reference's CDS (or a selected ORF), not the read, so a read's
  start and strand don't matter; it starts at the first in-frame codon of 10 good matching
  bases, which may run on past the feature so short ones work, or at the feature's first
  codon if such a stretch comes before it in the read (frameworks and CDRs are often a CDS
  each), and follows the CDS's direction, on a reverse CDS right to left. In a variable
  region or over Ns any clear good
  base counts, so a CDR annotated as its own CDS is translated from the read. A variable
  region that isn't a CDS but touches one in whole codons (`continuesFrame`) gets a frame
  too, as CDR3 often is a `variation` between two frameworks. Features that touch in one
  frame (`frameChains` in `src/lib/genetics.ts`: same direction, whole codons, the first
  not ending in a stop) are one frame, here and in `cloneVariants`: a frameshift runs on
  through them, an indel at their seam counts, and codons still number in each feature. An
  indel only
  counts if the clone is confident of it (`cloneCalls` in `src/views/readsView.ts`); others
  leave the frame alone and get a tick, so one miscalled base doesn't redo the row.
- **Double peaks** (`src/lib/mixes.ts`): each read keeps the second peak's share of the
  first at every base (`peakRatios`, worked out once when it is added). A clone is mixed
  when a variable region, or a change, has double peaks after clean bases; calls where
  every read with a trace has double peaks around them are left out (`leftOut`) and read
  as N, which drops a read's noisy ends. Peaks are looked at past quality trimming too,
  counting on from the alignment's ends, since trimming cuts a mix short. Thresholds come
  from the library's real reads; change them only against those.
- **Summary of clones** (`src/lib/cloneSummary.ts`, the Reads tab's Summary view): mixed and
  unaligned clones are only counted as such, since they say nothing about one plasmid.
  Identical clones count once for recurring mutations, transitions and transversions, and
  codons at degenerate sites, so one colony picked twice isn't a hot spot; the mutation rate
  and the share of broken clones count them all, or a plate of unchanged clones would count
  as one clone and the rate would look high. Bases counted for the rate are read, outside
  variable regions and not among double peaks. A column's quality is 0 for reads without
  scores, so don't use it to tell which bases were read.
- **The Reads tab** shows one view at a time in its middle column: Coverage, Clones,
  Differences or Summary. Under Coverage the alignment always shows; under the others a
  table fills the column, and selecting a read, clone, difference or mutation opens the
  alignment under it (`openAlignment`), with a divider between them, as stacked
  panes left the traces too little room. Coverage takes the height
  its reads need, up to half the column or what the divider chose (kept apart from the
  tables' height, as a good height differs); its ruler and features stay while the read
  rows scroll. The alignment has zero size
  while closed, so anything that scrolls it opens it first. The reads' own actions (Align
  again, Save check…, Clear) sit under the list, and what is about the results in the
  view's header. Over the alignment an up-and-down wheel only ever moves the rows
  (`installWheel` in `src/views/traceView.ts`); moving along it is for sideways scrolling,
  Shift or the scroll bar. A wheel that turned sideways at the last row was tried and
  found confusing. That scroll bar (`fitBar`) is a separate element under the rows, kept
  in step with the traces' scroller, whose own bar would sit under the last row. The
  alignment's ruler, features, translation and reference are a strip with its own canvas,
  pinned over the rows (`pin`) unless it would take over 40% of the pane. Pinning watches
  the whole view, not the part that scrolls: `fitBar` changes that part's height inside a
  resize observer, which WebKit reports as a loop. The reads' canvas covers only the rows
  near the pane (`readsSpan`), as a plate of traces drawn whole took hundreds of megabytes
  and WebKit draws a canvas above 268 million pixels blank. Read names leave out the
  start every read shares, such as a date (`sharedPrefix` in `src/lib/readNames.ts`); the
  full name is each row's tooltip and `data-name`, which tests read.
- **Keeping a check**: the app remembers each file's reads by path (`src/readChecks.ts`,
  local storage) and adds them again when the file opens. A check file (`.svcheck`,
  `src/lib/readCheck.ts`) holds paths relative to itself. Both keep only the groups the
  user made; the rest are guessed again from the names. Reads picked in a browser have no
  path, so they are neither remembered nor saved.
- **Order of reads**: `LoadedRead.rank` is the user's order; the list, the coverage map,
  the alignment and the clones follow it through `ReadSet.order()`, and check files keep it.
  The Clones table does too until a heading sorts it (`sortedGroups` in
  `src/views/readsView.ts`); ties keep the user's order, and a third click goes back to it.
  Read indices stay as they were: `results` and the clones hold them, and reordering
  shouldn't mean aligning again. So never loop over `reads` where the order shows. A check
  lists files, so reads from one FASTA file come back in the file's order.
- **Dragging reads**: `src/lib/readDrag.ts` says what a drop means (a join, a move between
  rows or within a clone) and the view only says where the pointer is. It uses pointer
  events on the window, not HTML5 dragging, as the shell's native file drop can get in the
  way. A whole clone only reorders; merging is left to the menu, as a slip would merge two
  clones and align everything again.
- **Several reads** (`src/lib/readSelection.ts`): ⌘ on Mac, Ctrl elsewhere, or Shift picks
  rows of the Reads tab's list, by read id and clone key since realigning changes indices.
  One row left is an ordinary selection. Ctrl-click can't be used on a Mac: it is a
  right-click there. Removing more than one read asks first, as it can't be undone.

## Decisions (and why)

- **A frameshift stops a read's translation**: chosen over translating on
  with a marker, which could be missed when a real frameshift matters so much. It comes
  from `cloneVariants`, so the row, the list and the Clones table can't disagree, and it
  stops every read of the clone: a read starting past it would otherwise look clean, so it
  says "After L54fs" instead. A stop codon from a substitution keeps the frame, so
  translation carries on dimmed.

## Traps

- **Chromatograms are kept light** so a plate of reads fits in memory: `compactChromatogram`
  (`src/lib/chromatogram.ts`) keeps the four traces as `Int16Array` and drops the parser's
  `baseTraces`, which took about 90% of a read's 1.6 MB. Typed arrays become objects in
  JSON, so turn traces into plain lists before sending them to Rust.
