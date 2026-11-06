# Strandivo: guide for coding agents

Strandivo is a free (GPL-3.0) desktop app for plasmid maps, sequence editing, primers and
sequence verification. It is a Tauri v2 app: a TypeScript interface (Vite, no UI
framework) over a small Rust shell and a dependency-free Rust core. Users are biologists,
mostly on Mac and Windows; Linux builds too, and it is where CI runs. Priorities: map and
editing, then sequence verification, then primers, then cloning simulation. `README.md`
describes the app for users, and `CONTRIBUTING.md` how people take part and who maintains
it.

**Keep this file true.** A change that makes something here wrong updates it in the same
commit. Write down what the code can't tell you (conventions, decisions, traps), not what
it can (lists of files or features). CI checks that every path in backticks here exists.

## How the code is organised

- `src/main.ts` decides what a window shows: the main window (`src/mainWindow.ts`),
  Settings (`src/settingsWindow.ts`) or the primer library (`src/libraryWindow.ts`).
- `src/mainWindow.ts` is the one main window: an app bar with Home (`src/home.ts`, the
  construct library) and a tab per open file, the window title, keys, native menu, dropped
  files and closing. It passes what is meant for a file to that file's tab.
- `src/doc/document.ts` builds an open file's tab (`openDocument`): toolbar with five views
  (Map, Sequence, Primers, Reads, Info), outline on the left, inspector on the right, status
  bar. It also owns saving, the `command()` handler (menus and shortcuts) and the test hook.
- `src/doc/store.ts` holds the document: immutable `SeqData` snapshots, the selection and
  undo history. Views get a `DocContext` (`src/doc/context.ts`) and subscribe to changes.
- `src/views/` has one class per part of the window (map, sequence, primers, reads with its
  canvas trace view, outline, inspector, search). Each builds its own DOM or SVG.
- `src/lib/` is pure logic with unit tests: the sequence model and edits
  (`src/lib/seqdata.ts`), primers and Tm, enzymes, primer design, PCR products, primer
  lists, alignment layout, codon effects, construct summaries for Home, cloning simulation
  (`src/lib/cloning.ts`), mutagenesis primers (`src/lib/mutagenesis.ts`), ORFs
  (`src/lib/orfs.ts`), digests and gels (`src/lib/gel.ts`).
  No DOM here, so `npm test` can run it in plain Node.
- `src/sanger/readSet.ts` loads reads, groups them into clones, has them aligned and
  summarises the results.
- `src/platform.ts` is the only code that talks to the shell, with plain-browser fallbacks.
- `src-tauri/src/lib.rs`: windows, native menus, file associations, file commands, listing
  the library's folders. Its alignment and detection commands hand typed requests to
  `crates/seqcore-json/`.
- `crates/seqcore-json/` is what the interface sees of the core: the requests and
  responses of alignment and detection, with their JSON field names, and `align_json` and
  `detect_json` for callers that pass strings. The shell uses it and so will the
  WebAssembly build, so the two can't disagree about a field. It needs serde, which is why
  it is not part of `crates/seqcore/`.
- `crates/seqcore/`: .ab1 reading, quality trimming, seeded Smith-Waterman-Gotoh
  alignment, alignment of long reads along a chain of seeds, difference calling and each
  clone's consensus (`crates/seqcore/src/consensus.rs`), the catalog of common plasmid
  parts (`crates/seqcore/src/parts.rs`) and the search that finds them in a sequence
  (`crates/seqcore/src/annotate.rs`). No dependencies; tested against `testdata/`.

## Conventions

- **Coordinates** are 0-based and inclusive. On a circular sequence a range with
  `start > end` crosses the origin; every function on ranges must handle that. The
  interface shows positions 1-based.
- **Edits** go through `store.apply(next, label, selection?, key?)` with a new `SeqData`;
  never change `store.data` or arrays it holds in place. Steps with the same `key` within
  1.5 s merge into one undo step (typing). Views compare data by reference, so the same
  goes for read results: replace lists, don't mutate them.
- **Features in parts** (exons, SnapGene segments) keep their parts in `locations`, with
  `start`/`end` spanning them; every edit maps each part. GenBank "source" features live in
  `SeqData.sources`: never shown, but edited along with the sequence and saved.
- **Where things go**: the app bar holds what is about the app (Home, a tab per open file,
  the primer library and Settings); the bar under it is the file's own (its five views,
  search, editing tools). Views show the document (Map, Sequence, Primers, Reads, Info), and
  there are five; a task with a start and an end (design primers, a PCR product, adding
  from the library) is a dialog (`openDialog` in `src/ui/modal.ts`, see
  `src/views/primerDialogs.ts`); something not tied to one file gets its own window, like
  Settings and the primer library (in a browser, which can't open windows reliably, the main
  window shows them over its tabs: `showWindowsInPage`), or lives on Home; the inspector shows only what is
  selected. This keeps windows from getting crowded.
- **Cloning** works on fragments (`src/lib/cloning.ts`): a linear `SeqData` holding every
  base on either strand, written as the top strand, plus each end (blunt, 5′ or 3′
  overhang). Two ends ligate when kind and bases match; joining writes the shared bases
  once. The dialog (`src/views/cloningDialog.ts`) takes the open file as the vector and
  other open files (`DocContext.otherSequences`) as inserts; products open as new unsaved
  tabs (`DocContext.openNew`), which count as edited until saved.
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
  changes and flags, so TGA and TAG are different clones though both are W163*.
- **Variable regions**: a feature with a `/strandivo_variable` qualifier (anything, a pattern
  such as NNK, or named versions; `src/lib/variable.ts`) is a part a library varies. The
  core aligns reads with these regions as N, so their edges come out right, but calls
  differences against the real bases. The read set then moves the differences in a region
  (bases inserted right next to it included) from `differences` to `variable`, on reads and
  clones alike, so whatever counts changes leaves them out. `cloneVariants` reads each
  region's contents from the consensus, and still uses `variable` for proteins, the clone's
  key and "Open clone as file". Code that uses differences must decide which list it means.
- **Regions of a protein** (`src/lib/regions.ts`): transmembrane helices, topological domains
  and signal peptides stay inside their CDS, in its `/strandivo_regions` qualifier, instead
  of being features: a membrane protein should stay one feature. So they are
  not `locations`, which say what the feature is made of and would be all that gets
  translated. They are numbered in residues of the CDS, so rotating, turning round and
  cloning need no code; only what changes the CDS's length or first base does (`carryRegions`):
  edits (from `mapAnnotations`), moving an end or turning it round in the inspector, and a
  fragment that opens a circle inside it (`unwrap` in `src/lib/cloning.ts`). Ends round to the nearest
  codon, not down: replacing a base is a deletion and an insertion, and rounding down would
  creep everything downstream a residue per base typed over. A replacement across a region's
  edge can still move that edge, as it clips a feature's own end. Each also keeps the
  entry's numbers, which is what the interface shows, as a fusion's differ. "Add as feature"
  makes a real one for files going to other software.
- **UniProt** (`src/lib/uniprot.ts`) is one of the two things the page fetches from the
  internet, and only when asked to (`fetchUniprotEntry` in `src/platform.ts`, the page's
  own `fetch`; the API allows any origin); the other is a feedback report the user sends
  (below). `connect-src` in the Content Security Policy names both, so the page can reach
  nothing else. The update check is the shell's, not the page's (below). A construct's protein is rarely the entry's (both mRNAs Q9UKG4
  cites differ from it, one in length), so residues are never taken at face value: the
  CDS's translation is aligned locally with gaps, and regions are carried across. Under
  `MIN_IDENTITY` nothing is placed, since a wrong accession would otherwise mark the wrong
  bases. The entry goes in `/db_xref` as `UniProtKB/Swiss-Prot:…`, as ENA's records have it,
  so those files fill the field in themselves.
- **Updates** (`src/updates.ts`, `src-tauri/src/updates.rs`): the page asks the shell to
  check, download and restart, but can't install: Restart quits the way ⌘Q does, so the
  main window asks about unsaved tabs, and the update is installed only once the last
  window has closed. A cancelled quit keeps the download, and an ordinary quit doesn't
  install it. So the updater and opener plugins' own commands stay out of the capability,
  and a version's notes on strandivo.com (`/changes#v<version>`, which every copy opens,
  so it must keep working: each version's section has that id) are opened from a
  version the shell checks, never an address from the page. What's new shows the short
  notes as text: before updating they come from latest.json (`shortNotes` in
  `src/lib/changelog.ts` cuts them short and drops them if they name an address, as
  latest.json isn't signed and tampered notes could point to a look-alike site), after updating
  from the copy's own `CHANGELOG.md`, on the first start of the new version. Development builds don't update themselves. On Linux the AppImage replaces
  itself and a .deb copy installs the release's .deb (`linux-x86_64-deb` in latest.json,
  which the plugin looks for before `linux-x86_64`) with `pkexec`, so the system asks for a
  password; no .rpm is built, so an .rpm copy is told to download instead. A check says nothing unless it finds something or the user asked; an offer is a
  strip under the app bar, never a dialog. e2e fakes the shell with
  `window.__strandivoUpdate`, so it never reaches the server.
- **Feedback** (Help → Send Feedback… and Report a Bug…, `src/views/feedbackDialog.ts`):
  the page posts the report to `feedback.strandivo.com` (`services/feedback/`), which
  files it as a GitHub issue with a token that can only write issues. Issues are public,
  so **the reporter's email address and an attached file never go in one**: the Worker
  emails them to the maintainer alone (Email Routing, to a verified address kept as a
  secret), and what the reporter wrote is fenced as plain text, so it can't mention
  anyone or link anywhere. What a report may hold is `src/lib/feedback.ts`, which the
  Worker bundles too, so the two can't disagree; change it and deploy the Worker in the
  same PR. Everything sent is shown in the dialog first; recent errors (`src/feedback.ts`,
  in memory only: uncaught errors, rejected promises and failed shell commands) and the
  open file are off until ticked, and errors lose their file paths (`scrubPaths`, which
  takes a path under a home or volume folder to the end of its line, as folder names have
  spaces). The shell opens only addresses it builds: an issue from its number, an email
  to feedback@strandivo.com with the page's text as subject and body. e2e fakes the
  service with `window.__strandivoFeedback`. On a Mac, Welcome and Check for Updates stay
  in the app menu, where 0.2.0's notes put them; the Help menu has the rest.
- **The welcome window** (`src/welcome.ts`) opens on first launch as a dialog over the
  main window, not a window of its own, since what it asks acts on the main window (Home's
  folders, holding back the update check, which waits for it). A choice users must make,
  such as usage statistics, is added to `WELCOME_PARTS` in `src/lib/welcome.ts` with the
  next version: that raises `WELCOME_VERSION`, and people who saw the older window are
  asked only the new part. Closing it any way keeps the choices as shown; "Reset all
  settings" leaves it seen. The e2e run starts as a fresh install, so it closes the window
  first.
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
  in step with the traces' scroller, whose own bar would sit under the last row.
- **Long reads**: a read without a trace over 1.6 kb is nanopore to the core (`align_long`
  in `crates/seqcore/src/sanger.rs`; a trace makes it Sanger, whatever its length, as raw
  Sanger reads can pass 1.4 kb): no quality trimming, and aligned along a
  chain of seeds that occur once in the reference, with only the gaps between them filled
  in. A read reaching 80% of a circular reference is a whole plasmid: it is turned to start
  at the origin, so its ends join and it comes back as one stretch; `readPos` then counts
  from there, not from the file's first base. A long read's indel of one or two bases in a
  run of five or more of one base (`in_homopolymer`) is never confident, unless a Sanger
  read shows it too. That run length is a guess until real reads are in `testdata/`.
- **Keeping a check**: the app remembers each file's reads by path (`src/readChecks.ts`,
  local storage) and adds them again when the file opens. A check file (`.svcheck`,
  `src/lib/readCheck.ts`) holds paths relative to itself. Both keep only the groups the
  user made; the rest are guessed again from the names. Reads picked in a browser have no
  path, so they are neither remembered nor saved.
- **Order of reads**: `LoadedRead.rank` is the user's order; the list, the coverage map,
  the alignment and the clones follow it through `ReadSet.order()`, and check files keep it.
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
- **Primers** (`src/lib/primerAlign.ts`): a primer's `start..end` is the stretch of
  template it pairs with, from its 5′-most paired base to its 3′ end, changes included, as
  SnapGene stores a binding site; its 5′ tail is whatever lies beyond. What happens inside is
  worked out by aligning the primer to it (`alignPrimer`, cached by `primerAlignment` in
  `src/doc/analysis.ts`), never stored, so files from other software work as they are and
  typing over a base in a site shows as a mismatch. So never take the tail as
  `bases.length − rangeLength`: an insertion or deletion makes that wrong. `findBindingSites`
  crosses a change of up to 6 bases when 10 bases pair beyond it, so a mutagenic primer's 5′
  arm binds rather than being a tail, and a primer with changes takes its Tm from its 3′ arm,
  which must anneal for the first cycle. It seeds on the 3′ end alone, so "Binds once" means
  once by the 3′ end; a 5′ tail is searched apart (`tailMatches`, every window of 15 bases,
  either strand), as a Gibson overlap or a tail copied from the vector primes too. Left out
  is only the primer's own 5′ arm, which a change too big to cross leaves outside the site
  and so counted as tail: a match on the primer's own strand lying before the site in the
  primer's own direction, by a gap no wider than the primer (template it skips) or running
  into the site by no more than its own length (extension). A match on the 3′ side is a
  second place however close it lies, as no 5′ arm can be there. `primerReport` needs the
  site passed to tell them apart, and every view passes it. A primer can skip far more
  template than it is long, so editing its sequence goes through `placeEdited`, which keeps
  the site it had while the new bases still lie along the whole of it (no tail, both ends on
  it, the 3′ end annealing and most of it pairing) and searches for the sequence otherwise:
  a deletion over six bases would shrink the site onto the 3′ arm and the arm would read as
  a tail that primes elsewhere. A sequence with no such history (Add by sequence, a file)
  can only be searched for, so a long deletion arriving that way is still placed on its 3′
  arm and warns; move the site by hand or type the bases into a primer that has one. On a circle a match across the origin is found again from the part after
  it, so matches are compared around the circle, not by raw coordinates. One renderer draws primers in the Sequence tab and
  the Primers tab's panel (`src/views/primerDraw.ts`): the primer's own bases against the
  strand it pairs with, the ruler between the strands, the name and changes in a band raised
  off it and the tail half a box off it. The name stays at the 3′ end and inside the row,
  beside a change rather than over it (`tabLeft`), and lanes make room for wherever it goes.
  Changes are always red, so the colours users can give a primer
  (`PRIMER_COLOURS`) leave red out; the primer library keeps a primer's colour.
  Under the tab's list a switch shows either the primers or the **pairs** they make
  (`src/lib/primerPairs.ts`): every forward with every reverse, the product from
  `pcrProduct` so a pair and the PCR product dialog can't disagree, shortest first. On a
  circle any two face each other going round, so `MAX_PRODUCT` is what bounds the list; a
  pair whose span is past that even after both sites are allowed for is dropped before the
  product is built, as a primer only shortens a product by template its own site covers.
  The pairs are worked out once per document, like each primer's report, and both are
  dropped when Settings change, as the document is then the same but the Tms are not.
- **Mutagenesis primers** (`src/lib/mutagenesis.ts`, the dialog in
  `src/views/mutagenesisDialog.ts`) are stored like any primer: the site covers the bases
  they change, so the renderer, `primerReport` and PCR products need nothing of their own.
  A change is bases on the top strand (`SdmChange`), trimmed of bases it leaves alone, so a
  codon change is only the bases that differ. Back to back (Q5 SDM): the forward primer's
  site starts at the change (after it for a deletion, whose gap is between the primers; an
  insertion is its 5′ tail, split between both tails past `SPLIT_INSERTION`), and the
  reverse primer ends just before it, so their product is the whole mutant opened at the
  change. Overlapping (QuikChange): one primer and its reverse complement on one site. Each
  3′ arm is sized to a Tm with `meltingTemp`, so Settings apply; arms are 15 bases at least,
  as `findBindingSites` needs 15 at the 3′ end or the checks would say "No site". A codon is
  chosen by fewest changes, then not rare in E. coli, which is only a tie-break; TAG counts
  as a stop even with amber suppression on, as a plasmid made that way works in one strain.
- **Selection** changes go through `store.select(…, source)`; `source` names the view that
  made it, so that view can skip scrolling to itself.
- **Picked enzymes** (`src/lib/enzymePick.ts`, `src/doc/pickEnzyme.ts`): ⌘-click (Ctrl-click
  outside macOS, where Ctrl-click is a right-click) on a cut site in the map, the Sequence
  tab or the outline picks its enzyme for a digest; the selection keeps them in `enzymes`
  (two or more), and any other selection drops them. Enzymes are picked, not sites, as a
  digest uses every site. Every site of a picked enzyme, or of the selected site's enzyme,
  is marked, so a dual cutter shows where else it cuts. A right-click on one of their sites
  keeps the pick and digests with them all.
- **Map labels** say what they name by their colour, font and leader: a feature's name on a
  tint of its colour (solid leader), a primer's after an arrow pointing its way (dashed), an
  enzyme's in small grey monospace with no mark (dotted), darker when it cuts once. Marks on
  enzymes were tried and made the map busy; their positions are in the tooltip and outline.
- **Right-click menus**: `src/lib/contextMenu.ts` decides what each menu offers (as data,
  unit-tested) and `src/doc/contextMenu.ts` runs it with the inspector's and toolbar's own
  functions. A view selects what was clicked first (`menuTargetAt`), then calls
  `ctx.contextMenu`; the Primers tab's sequence panel selects bases the same way as the
  Sequence tab. The Reads tab's menus (`readsMenu`) are about reads, not the document, so
  its view runs them. The app shows native menus (`showContextMenu` in `src/platform.ts`);
  the web view's own menu (Reload, Look Up…) is turned off outside text fields.
- Views draw only when visible (`setVisible`) and only what is on screen.
- **Files** are read and written with TeselaGen's bio-parsers (`src/doc/fileio.ts`);
  `src/doc/convert.ts` turns them into `SeqData` and back, keeping fields we don't model
  in `raw`. SnapGene `.dna` is read but saved as GenBank. Lab fields from the Info tab live
  in GenBank COMMENT lines (`src/lib/labinfo.ts`).
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
- **Styles**: design tokens are CSS variables in `src/styles.css`; document styles are
  `sv-*` classes in `src/doc/document.css`, the app bar's and Home's in `src/mainWindow.css`.
  Older `ps-*` classes remain for the Settings and Info screens. Dark tokens exist but no
  setting turns them on yet.
- **Interface text** is plain and short, sentence case, says what happens ("Add reads…",
  "Use read base"), with ranges as 1,700–2,400 and an ellipsis on commands that open a
  dialog. New screens follow the ones there are: their spacing, `sv-*` components and the
  design tokens in `src/styles.css`.
- **Commits**: Conventional Commits (`feat(scope): summary` and a short body saying what
  and why), one logical change each, under your own name. Never rewrite pushed commits.
- **Licence headers**: every `.ts`, `.mjs`, `.css`, `.rs` and `.sh` file starts with the
  copyright and `SPDX-License-Identifier: GPL-3.0-or-later` lines (`CONTRIBUTING.md`),
  checked by `.github/scripts/check-headers.sh`. A new file copies them from any other.

## Checking work

- `npm test` (unit tests in `src/lib/`), `npm run typecheck`, `npm run build`.
- `cd crates/seqcore && cargo test --release` for the alignment core, and the same in
  `crates/seqcore-json/` for the JSON it answers with.
- `node tools/build-catalog.mjs` rebuilds the parts catalog. It needs the network, so it
  is not part of `npm run check` and is never run by the app or CI; commit the curated
  list and the regenerated catalog together.
- `node tools/build-icon.mjs` draws the app icon and writes every file made from it: the
  PNGs, `src-tauri/icons/icon.ico` and `src-tauri/icons/icon.icns`, and the website's icon
  and favicon. Change the drawing there, never the images (the SVGs beside them are its
  output too). Sizes of 32 px and under get a plainer drawing, as the full one blurs. It
  needs macOS for the .icns.
- `npm run check` runs all of the above, the agent guide's path check, a syntax check of
  the e2e script and clippy: what CI
  checks except the e2e, in a minute or two. Run it before every push where Rust is
  installed; CI stays the final word and the only place the e2e runs. A change to nothing
  but docs, Markdown, the website or `CITATION.cff` needs only `npm run check:quick` (the
  guide's paths, the licence headers and the website's security.txt, in seconds), as CI
  then runs only that too.
- In a browser, `npm run dev` (or any static server on the built `dist` folder) shows Home,
  and opens a file in a tab with `?open=<path or URL>`. Reads only align there if the page
  defines `window.__strandivoAlign` (returning `{ reads, clones }` as the core does), and Home lists folders only if it defines
  `window.__strandivoListFolder` (see `src/platform.ts`); in the app Rust does both. A
  UniProt is asked for real unless the page defines `window.__strandivoUniprot`, which e2e
  tests do, in the app too. A
  right-click menu is drawn in the page there, or handed to `window.__strandivoMenu` if
  defined, which is how e2e tests pick items (WebDriver can't click native menus).
- **Checks** (`.github/workflows/checks.yml`) runs on every pull request and push to
  `main`, on Linux only, except one that changes only docs, Markdown, the website or
  `CITATION.cff` (its `paths-ignore`; keep the two lists, and the rule above, the same).
  The guide and header checks run apart, on every change
  (`.github/workflows/quick-checks.yml`), as a docs change is what breaks the guide's
  paths. Checks itself runs tests,
  type check, clippy, a debug build, then `e2e/run.mjs` clicks through the real app with
  WebDriver and pushes screenshots and a report to the `e2e-results` branch (for a pull
  request from a fork, whose token can't push, they are the run's artifact). Add an e2e
  check when you add something users do. It drives the window through `window.__strandivo`:
  the main window's own actions (open, tabs, Home's folders, `saveSettings`) plus those of
  the file in the current tab (store, `command()`, adding reads, saving and `saveCheck`
  without a file dialog).
- Steps run through `.github/scripts/run.sh`, which repeats a failing step's output as an
  annotation, readable with `gh api repos/<owner>/<repo>/check-runs/<job id>/annotations`.
  The manual **Diagnostics** workflow runs any command on any OS and posts its output the
  same way; delete any branch it pushes afterwards.
- Installers (`.github/workflows/build.yml`) are built for a version tag, which also drafts a
  release, or when a maintainer runs the workflow; not on every push, as a full set takes
  most of an hour. Both use `.github/actions/build-app/action.yml`. A tag's builds are
  signed and make the update files; a manual run's are not
  (`src-tauri/tauri.unsigned.conf.json`, which `npm run app:build` uses too, since a build
  with update files stops when there is no key).
- **Releases and the update key**: the key that signs updates is a secret of the `release`
  environment only (`v*` tags may use it, a maintainer approves each run, and the "Protect
  release tags" ruleset lets only admins create, move or delete `v*` tags). Never give it
  to `.github/workflows/checks.yml`, a `pull_request_target` workflow or a manual run, and
  keep the release jobs' third-party actions pinned to commits, as they run beside it.
  `.github/CODEOWNERS` names who reviews what runs beside it or reaches users without a
  release (the site, the updates Worker); a new file of that kind goes in it too.
  Losing the key strands every install: it is backed up outside GitHub. A release is a
  `CHANGELOG.md` section (its first paragraph the short notes the app shows, in two or
  three plain sentences), `npm run version <x.y.z>` (which won't run without that section),
  a commit, a `v<x.y.z>` tag on it, approving the run, then publishing the draft;
  `check-version` in `.github/scripts/release.mjs` fails a tag that doesn't match the three
  files or has no notes, `latest-json` writes the manifest from the `.sig` files the builds
  made, and the section becomes the release's text. `download-copies` gives each
  installer a second name without the version, which is what the website's Download page
  links to (`releases/latest/download/…`, the newest published release), so the page
  needs no change per release. The script reads the changelog with
  `src/lib/changelog.ts`, so it runs with `--experimental-strip-types`. After a release's
  section is written, run `npm run site` too, or the quick checks fail.
- **`updates.strandivo.com`** is built into every copy (`plugins.updater` in
  `src-tauri/tauri.conf.json`), so it must never change; the Worker behind it
  (`services/updates/`) hands over the published release's latest.json, or 204 for no
  update when there is none. The app's version, OS and processor come in the query for
  counting (part 5 of `docs/updates-feedback-usage-plan.md`); the Worker keeps nothing else
  and logs nothing. Deploy it with
  `npx wrangler@4 deploy --config services/updates/wrangler.toml`.
- **`feedback.strandivo.com`** is built into every copy from the release that adds it (`FEEDBACK_URL` in
  `src/platform.ts`), so it must keep answering. Its Worker (`services/feedback/`) needs
  a fine-grained token with only Issues: write on this repository and the maintainer's
  address, both as Worker secrets, never in the repository; its README says how to set
  it up. Deploy it with `npx wrangler@4 deploy --config services/feedback/wrangler.toml`.
- **The website**, `strandivo.com`, is the plain files in `site/` on Cloudflare Pages (a
  project named `strandivo`), with no build step, so its Content Security Policy
  (`site/_headers`) allows only its own images, stylesheet and one script,
  `site/download.js`, which puts the visitor's own system's download first. That script
  only shows what the page already holds, hidden: without it every download shows, and it
  sends and stores nothing (the Privacy page says so; keep both true). A browser can't
  tell an Apple silicon Mac from an Intel one, so Macs get Apple silicon first, with Intel
  just under it. Its colours copy the
  app's tokens, as the site can't load `src/styles.css`. Its pages are written by
  `tools/build-site.mjs` (`npm run site`) and committed: What's new from `CHANGELOG.md`,
  Privacy from `docs/privacy.md`, and Home, Download and the 404 page from
  `tools/site/`, each with the same header and footer. Edit those, never the HTML in
  `site/`; the quick checks fail when the two differ. `docs/privacy.md` is the one list of
  what the app sends, so whatever makes the app send something new changes it in the same
  PR. Its Markdown is a small subset (headings, paragraphs, `-` lists, links, `code`,
  bold), and the generator fails on anything else rather than show it wrong; links may
  only be https, mail or the site's own. Cloudflare builds it from this repository, but
  only for a push that changes something in `site/` (the project's build watch paths, a
  dashboard setting): on `main` it goes live, and other branches get a preview address.
  Other pushes, the e2e-results branch's included, show as skipped. The project is
  connected to GitHub, so never deploy it with wrangler, which would be overwritten by
  the next push. Cloudflare's
  email obfuscation rewrites addresses on the proxied domain (not on `pages.dev`) into
  a script the policy blocks, so a page's body sits inside `<!--email_off-->` comments;
  a new page needs them too, or its addresses read "[email protected]".
  `site/.well-known/security.txt` repeats `SECURITY.md` for scanners, and its `Expires`
  must be moved on by hand each year: `.github/scripts/check-security-txt.mjs` fails the
  quick checks from 30 days before it.
- From a cloud session the npm and crates registries may be blocked: Rust in `src-tauri/`
  then only compiles in CI, and CI is the final word.

## Decisions (and why)

- **Own views instead of TeselaGen's Open Vector Editor** (removed Oct 2026): we needed
  control over editing, selection and undo, and it cut the window's code from 4.1 MB to
  0.7 MB.
- **ORFs are found, not stored**: worked out from the sequence on every change (cached in
  `src/doc/analysis.ts`, like cut sites) and never saved; "Add as feature" turns one into a
  CDS that is. In each frame an ORF starts at the first start codon after a stop, so
  shorter ORFs nested in the same frame aren't shown, as SnapGene does. A selected ORF is
  a `Focus` of kind `"orf"` with id `<strand>:<start codon position>`.
- **Digest sizes are top-strand lengths**, so a plasmid's fragments add up to its length;
  `Fragment.data` also holds the overhang bases (`fragmentSize` in `src/lib/gel.ts`).
- **Tabs by default, split view optional**: one big view at a time was preferred.
- **One window, a tab per file** (Oct 2026), replacing a window per file, so the window
  stays tidy as features are added. The shell sends every file to open to the main window;
  until its page asks for its files (`window_info`), they wait in a queue, so none is lost
  while it loads. Side-by-side files in two windows are not possible yet.
- **The construct library** (Home) lists folders the user adds; their files stay where they
  are. The folders, what was read from each file (read again only when its size or date
  changes) and the notes typed on Home are kept by the app (`src/constructLibrary.ts`),
  so a note never changes a file. The Info tab's Notes field, which is in the file, shows
  when no note was typed on Home.
- **Cloning products open as unsaved tabs**, not files, so trying a variant costs nothing.
  Gibson splits a missing overlap between two amplified neighbours
  (NEBuilder's way); In-Fusion puts all 15 bases on the insert's primers (Takara's).
- **Read alignment in Rust** (`crates/seqcore/`), so it is fast and testable on its own.
- **A frameshift stops a read's translation**: chosen over translating on
  with a marker, which could be missed when a real frameshift matters so much. It comes
  from `cloneVariants`, so the row, the list and the Clones table can't disagree, and it
  stops every read of the clone: a read starting past it would otherwise look clean, so it
  says "After L54fs" instead. A stop codon from a substitution keeps the frame, so
  translation carries on dimmed.
- **Tm**: SantaLucia 1998 with primer3's default conditions by default, so numbers match
  primer3. Settings can choose Breslauer 1986 (primer3's older method), the Wallace rule or
  a basic GC formula, and the conditions. Each window applies the choice with `useTmSettings`
  (`src/main.ts`), so `meltingTemp` without arguments follows it; tests pass settings.
- **Amber suppression** (TAG read as Q, for phage display in TG1 or XL1-Blue) is a setting
  applied the same way (`useAmberSuppression`), so everything that translates through
  `translateCodon` follows it. ORF stops get it in `OrfOptions`, and caches of
  translations must include it in their key.
- **The lab primer library** is kept by the app, not in documents (`src/primerLibrary.ts`,
  in local storage like the settings, with an app event so every window sees changes).
  Export/Import of a tab-separated list is the backup and the way to share it.
- **Enzymes**: a curated list of common commercial enzymes (`src/lib/enzymes.ts`), not every
  isoschizomer.
- **Bases in upper case** by default; Settings can show them as in the file.

## Traps

- **Content Security Policy** (`csp` and `devCsp` in `src-tauri/tauri.conf.json`): scripts
  only from the app's own files, so no inline `<script>`, `on…` attributes, `javascript:`
  links or `eval`. Inline styles are allowed, as `style` attributes are used throughout;
  Tauri is told not to add nonces to `style-src` (`dangerousDisableAssetCspModification`),
  as a nonce there turns `'unsafe-inline'` off. An address the app talks to goes into
  `connect-src` in both policies, or the shell blocks it. Text from files reaches the page
  only as text: `h()` in `src/ui/dom.ts` can't set HTML, and `innerHTML` is for constant
  markup only. Code scanning (CodeQL) looks for this on every pull request.
- **Undo can arrive twice**: the page sees ⌘Z/Ctrl+Z and so does the native menu item,
  in either order depending on the platform. `fromMenu` in `src/doc/document.ts` skips a
  menu command the page just handled. Keep that in mind when adding shortcuts.
- **macOS title bar**: the main window uses an overlay title bar, so the app bar is the drag
  area (`data-tauri-drag-region="deep"`; buttons and fields are excluded automatically).
  Mark other controls in it with `data-tauri-drag-region="false"`, as the file tabs are. On
  Mac, `sv-mac-titlebar` leaves room for the window buttons.
- **Only the current tab is in the page**: other files' views are taken out (`setActive`),
  so `document.querySelector` in tests finds the current file's elements. A document must
  not measure or draw while inactive, and anything it subscribes to outside itself
  (settings, the primer library) must be undone in `dispose`, or closed tabs leak.
- **Primer positions** cover the bases the primer pairs with, changes included; a 5′ tail
  hangs off beyond them and is not part of the range.
- **Designed primers are named by the region's direction**, as labs do: on a feature that
  runs right to left, `-F` is the primer at its start codon, which binds the top strand (a
  "reverse" primer for the plasmid) and gets the start site (NdeI). The PCR product picker
  and `src/lib/pcr.ts` speak of plasmid forward/reverse.
- **The inspector rebuilds on every change**, so a field edited live (a primer's sequence)
  would lose focus to its own edit: mark it `data-keep` and `render()` in
  `src/views/inspector.ts` moves focus, caret and unapplied keystrokes to the new one.
- **Hidden views** have zero size: measure and draw when they become visible.
- **`ch` units follow each element's own font**: a label in a smaller font placed with
  `left: 40ch` lands somewhere else than the bases. Rows of bases place things by the
  measured base width in pixels (`src/views/primerContext.ts`) or correct for the font
  (the ruler in `src/views/sequenceView.ts`).
- **Cut sites** are updated around each edit (`rescanSites` in `src/lib/enzymes.ts`), not
  searched again, so typing stays fast in long sequences. A randomised test compares the
  result with a full search; keep it passing if you touch either.
- **SnapGene files** need fixing up after the generic parser (`src/doc/fileio.ts` with
  `src/lib/snapgene.ts`): it skips primers (whose binding sites, unlike features, are
  0-based), and it keeps a feature's `type="gap"` segments (introns) as parts of it.
- **Saving** must not lose anything: `src/lib/saving.test.ts` saves and reopens every file
  in `testdata/`, also after edits. Add a file there when you meet one that breaks.
- **Chromatograms are kept light** so a plate of reads fits in memory: `compactChromatogram`
  (`src/lib/chromatogram.ts`) keeps the four traces as `Int16Array` and drops the parser's
  `baseTraces`, which took about 90% of a read's 1.6 MB. Typed arrays become objects in
  JSON, so turn traces into plain lists before sending them to Rust.
- Files in `testdata/` have their own licences, listed in `testdata/README.md`.
