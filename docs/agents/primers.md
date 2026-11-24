# Primers: guide for coding agents

Read this before changing how primers are placed, checked, drawn, paired, designed or kept
in the lab library (`src/lib/primerAlign.ts`, `src/lib/primerPairs.ts`,
`src/lib/mutagenesis.ts`, `src/views/primerDraw.ts`, the primer dialogs and
`src/primerLibrary.ts`).

**Keep this guide true** (and `AGENTS.md`'s rules apply here too): a change that makes
something here wrong updates it in the same commit. Paths are from the repository's root,
and CI checks that they exist.

## Conventions

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
  The pairs are worked out once per document via `documentPrimerPairs` in `src/doc/analysis.ts`
  (shared by `src/views/primersView.ts` and the inspector's Pairs section), and invalidated
  automatically when Tm settings change, as the document is then the same but the Tms are not.
  Pairs whose Tms are further apart than the limit beside the list (`withinTmLimit`, 5 °C
  until changed, kept with the list's sort) are hidden, never dropped from the cache, and
  the note says how many with Show all; a pair with an unknown Tm always shows. The
  difference is compared as the list rounds it, so a pair shown 5.0 °C apart is within
  5 °C. The PCR product dialog's warning keeps the fixed `TM_APART`, as it judges one pair.
  The dialog also says where to anneal, in whole degrees as NEB's calculator shows it
  (`annealingTemp`), and gives a cycling program (`src/lib/pcrProgram.ts`) for the
  polymerase picked there (AGENTS.md says why it has its own menu). With 5′ tails whose
  whole primers anneal 5 °C or more higher, the program may use two stages: five cycles
  on the pairing parts, the rest on the whole primers, which pair from the third cycle on.
  It is offered, never the default, as one stage is what NEB's calculator gives, and only
  when the gain is 5 °C as NEB gives it to 0.1 °C, not as shown. A primer with changes
  gets no offer: its whole length doesn't pair, so it has no Tm to anneal at. A menu entry
  stands for products that share a Tm rule, not a protocol, so a program is for the product
  its protocol names (its number is shown), and its ⓘ warns that the others may differ.
  A colony is extended as a plasmid is, for NEB counts E. coli among the simple templates;
  only genomic DNA and cDNA take the complex rates.
  What the dialog decides before drawing (the starting polymerase, the strip that says its
  Tms differ from Settings, the whole primers' annealing temperature) is in
  `src/lib/pcrPlan.ts`, so tests reach it.
  The **overview** above it is of the final linear product, tails and primer changes
  included (`src/lib/pcrOverview.ts`), so its positions are the product's own; the template
  row keeps the plasmid's, and a site says how often its enzyme cuts each. Its enzyme list
  and filter start from the document's and then go their own way, following only a change
  of membership, through `ViewOptions`. The filter chooses what is drawn, not what is
  suggested: a digest is looked for in the whole list, one enzyme first and a pair only
  where no single one tells its fragments apart (`DISTINCT_DIGEST`, this suggestion's own
  bar, which no digest with a fragment below the smallest band of the gel's ladders,
  100 bp today, reaches). Sizes are top-strand lengths, as `src/lib/gel.ts` gives them, and a cut that is not
  complete on both strands is left out (the sites drawn on the product count cuts the same
  way, `selectSites`), and overlapping cuts make no suggestion. An
  enzyme that cuts on both sides of its site (BcgI) contributes both complete cuts. Beside the
  suggestion a gel runs up to four lanes in the order they would be loaded: the template
  uncut and cut by that digest, then the product uncut and cut, drawn by the renderer the
  Digest dialog uses (`src/views/gelDraw.ts`). The template is there because carry-over
  from the reaction is what an extra band in a product usually is, and it is cut too
  because every site inside the product is in the template as well, unless a 5′ tail
  brought it in. It is the open file, so it is drawn for a plasmid or a colony, which
  holds the plasmid, and left out for genomic DNA or cDNA, where that plasmid isn't in the
  tube: the dialog passes the Template menu's choice on, so the gel never shows a template
  the reaction doesn't have. Its sizes come from the same digest the Digest dialog runs
  (`templateDigestSizes`, kept while the template and the enzymes stay the same, as the
  dialog is drawn again on every change); a circular template cut once gives one fragment
  of its whole length. A digest that can't be simulated on the template (NlaIII's two
  sites in CATGCATG leave their overhangs touching) has no lane, as an enzyme that doesn't
  cut it has none, so `templateDigestProblem` tells them apart and the overview says why in
  the Digest dialog's words under the key; it draws no lane or band in its place, and the
  gate for a lane is the same. Which lanes exist is `pcrGelLanes`, not the view: a circular
  template runs supercoiled, and cut only when the digest cuts it; a linear one runs uncut
  only when its length differs from the product's and cut only in two pieces or more, as a
  lane that would only repeat the one above it is left out. Fragments within the gel's
  resolution of a band's largest run as one band (`bands`), so a run of close sizes doesn't
  chain into one; lanes are numbered and named in a key beside the gel, and
  the ladder is the one chosen in either dialog, kept for as long as the window is open.
  Until one is chosen the Digest dialog opens on the first, and this gel on the first that
  reaches its smallest band (`ladderReaching`, in `src/lib/gel.ts`), or on the one that goes
  lowest when none does, following the digest chosen, as the 1 kb ladder draws every band
  of 312 bp or less on the bottom edge.
  Brightness is a band's share of its own lane, so the gel says where things run, not how
  much of each was loaded. Names stack in `MAX_LABEL_LANES` lanes at most: a
  multiple cloning site holds a dozen enzymes within a few bases, and a lane each pushed
  the product, its GC and the digest out of the dialog, so the sites past those lanes keep
  their marks where they cut and a chip over each crowd counts them, naming them under the
  strip when it is clicked. The site described under the map is the one clicked, if it is
  still drawn, and otherwise one the chosen digest uses (`pickSite`), so `ProductViewChoice`
  keeps only a click, never the default, or a later digest would leave it on the first one's. Which sites have a name of their own therefore depends on the
  width, so the dialog measures the map as soon as its body is in the page rather than a
  frame later, or focus would go looking for a control the first drawing didn't have. It says what to expect on a gel, never that the
  product is the right one or that two enzymes share a buffer. What is said about the
  polymerase comes from `src/lib/pcrGuidance.ts` alone (the ends it leaves, NEB's longest
  product, the GC enhancer), and only where NEB's row for it has been read: the Ends row
  then says "No end guidance for this polymerase yet", there is no length limit or
  enhancer to name, and nothing is taken from another member of its Tm family. The GC
  sentence is about the product, so every polymerase gets it, with the enhancer named
  only where there is one. GC is the whole product's, to the one decimal the header shows,
  against NEB's 65% (`HIGH_GC`), as the enhancer is described for an amplicon, while the strip
  shows where it runs high inside; a colony is a simple template, being E. coli, so only
  genomic DNA or cDNA takes the complex limit.
  The **program**'s line is schematic: its widths and slopes are neither time nor ramp
  rate. Temperatures, times and cycle counts are text fields, in both stages, and the last
  step holds until stopped. What is typed lives in a draft (`src/lib/pcrProgramEdit.ts`)
  and survives a redraw, unfinished text and all, while Copy is off until every field
  reads; a temperature outside `MIN_TEMP`–`MAX_TEMP`, a cycle count past `MAX_CYCLES` or a
  step past `MAX_SECONDS` is a slip, not a program, and one message (`PROGRAM_LIMITS`)
  gives all the limits. A comma is refused, not read as a decimal point, since the app
  reads commas as thousands. A value
  counts as entered when the field is left or Enter is pressed, not on the browser's change
  event alone, as a field drawn anew mid-edit fires none; Escape then goes back to that
  value instead of closing the dialog. An edited program stays, with the protocol and the
  setup it was made for (`programContext`: template, length, annealing temperatures and
  stages, which the strip over it and Copy name), when the inputs change, and only what `pcrProgram` is given counts
  as an input (`programInputKey`), so a primer renamed elsewhere doesn't say the setup has
  moved. Regenerate and Reset build it again from the current inputs, change no setting,
  and hand focus to Copy program, as each takes itself away. Every control needs its own
  `aria-label` or `data-focus`; a redraw puts back the caret as well as the focus, passes
  over a control that came back disabled, and the two ResizeObservers are disconnected when
  the dialog is drawn again or closed.
  The **reaction mix** (`src/lib/pcrMix.ts`, drawn by `src/views/pcrMixView.ts`) is the
  setup table on the same NEB protocol page the cycling conditions come from, so a
  polymerase has both or neither and `src/lib/pcrMix.test.ts` holds the two lists to each
  other. Volumes are written as µl in NEB's 50 µl reaction and scaled, and that test builds
  both of NEB's own columns back out of them: change a number only from the protocol page.
  Phusion's smaller column is 20 µl where the others are 25, which is why the dialog starts
  at the recipe's own `volumes[0]` rather than a volume of its own; the other volumes offered
  keep NEB's concentrations and say so. A primer's volume follows the stock the user keeps it
  at, to the final concentration in NEB's table, which is the same default number
  `src/lib/polymerases.ts` holds for the Tm (a test pins them together; Settings' editable
  primer concentration moves the Tm, not the mix). A component NEB names without an amount
  gets no row, as OneTaq's High GC Enhancer does; OneTaq's table footnote for 3–6 kb
  amplicons (`longEnzyme`) is shown when the product falls in that range. What is not NEB's
  says so in a comment: the order of the rows, which is the order a bench adds them in, and
  `SMALL_VOLUME`, under which a volume is called out as too little to pipette — with NEB's
  own sentence about diluting the enzyme where its protocol has one, and only about what is
  actually pipetted, so making more mix answers it. `mixText` appends any warnings to the
  copied mix. The mix holds everything but the template, as the template is what the tubes
  differ in, and an extra over the reactions counts for nothing at one tube, since nobody
  makes 1.1 of them. The volume, the extra, the primer stock and the template volume (0
  included) are habits of the bench, kept app-wide in `src/pcrMixPrefs.ts`; how many
  reactions, what else goes in and whether the section is open last while the window does,
  and it starts folded, as the mix is wanted at the bench rather than while a product is
  being looked over. Only the table and the notes are drawn again when a field changes, so a
  field keeps its focus; each mix control also carries a `data-focus` key for full-dialog
  redraws, and the fold is the one thing that builds the section anew.
  **Printable PCR plan** (`src/lib/pcrPrint.ts`, `src/views/pcrPrintDialog.ts`): **Print
  PCR plan…** captures one `PcrPlanSnapshot` of what the dialog shows (the program as
  edited, the digest or `NO_DIGEST`, `currentLadder`, `effectivePcrMix` even while the mix
  is folded), and nothing is worked out again after that: rendering must never change it,
  which `src/lib/pcrPrint.test.ts` checks. The sheet has two builders: DOM in
  `src/views/pcrPrintDialog.ts`, for the preview and for a copy on `document.body`
  (`.sv-print-sheet`) that is all `@media print` shows while the preview is open, and a string
  in `pcrPlanHtml` for the saved file, with its own stylesheet (`PCR_PLAN_SHEET_CSS`, as the
  file must work offline). A change to one goes into the other: the test holds the two stylesheets'
  sheet rules together, and the web e2e compares the printed page's words with the saved
  file's and their page counts on A4 and Letter. `pcrPlanMarkdown` is the third output; it
  escapes every text, user's and ours, in one pass (`mdText`), so a name stays literal in
  its table cell, and keeps notes as typed with hard line breaks. The sheet is light in any
  theme (`color-scheme: light` on the printed page), keeps its columns on paper (the
  narrow-window rule is screen only), keeps short sections and blank writing lines whole,
  and writes the mix total as the table's last row, as a browser repeats a `tfoot` on
  each page. A stale program or a hard-to-read digest is said in its section, or among the
  warnings when that section is left out (`planWarnings`). One preview is open at a time,
  and while Print… or Save as PDF… runs the copy being printed is held still and kept
  until it ends, even if the preview closes; the page title is the plan's meanwhile. Title,
  date and notes are never kept; the sections chosen and the PDF paper are
  (`strandivo.pcrPrintSections`, `strandivo.pcrPrintPaper`), written when the plan is
  printed, copied or saved (once a path is chosen), never on Cancel. Print… goes through
  `printWindow()` to `print_window` (wry's print) or `window.print()` in a browser; Save as
  PDF… (desktop only) through `saveWindowPdf()` to `src-tauri/src/pdf.rs`, which writes
  beside the destination under a hidden name of the export's own and moves the file in once
  it holds something. After 2 minutes without an answer it stops waiting and says nothing
  was saved: the job may go on, but a late answer only removes its file, which no retry
  shares. Its engines: WKWebView run modally
  (`src-tauri/src/pdf_macos.rs`; measured by the author on 21 Nov 2026 with a small wry
  program that is not in the repository: A4 and Letter at their sizes, 9.5 mm margins, the
  main thread free), WebView2's `PrintToPdf` (`src-tauri/src/pdf_windows.rs`; type-checked
  by the author against the locked webview2-com and windows-core outside the repository,
  compiled by CI's Windows job in `.github/workflows/checks.yml`, never run), and WebKitGTK
  printing to the file printer, named as GTK's translations name it (not yet tried). No
  test runs a native engine (the e2e stands in for printing and PDF export with hooks, see
  AGENTS.md's "Checking work"), so a smoke test of each engine is left for later. The sheet
  has no footer: one ran onto a second US Letter page in WebKit, which sets type taller than
  Chromium, so the snapshot note and the export date ride on the header's kicker and
  template lines. Measured on 21 Nov 2026 (WebKit through that wry program, Chromium through
  headless printing): the default plan is one page on A4 and on Letter in both, and in
  Chromium so is every variant tried (sections left out, an edited program, no protocol, the
  dark theme) but long names with 14 lines of notes, which take two. In `openPcrDialog`,
  Product map, Simulated gel and Cycling program fold, kept in `strandivo.pcrDialogFolds`
  (`src/pcrDialogFolds.ts`); the mix's fold lasts the session, as before. Each fold
  button's accessible name says which section it folds.
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
- **A PCR product's document** (`productDocument` in `src/lib/pcr.ts`: what Open as new
  file… in the PCR dialog saves, and what cloning's amplified pieces use) is the template
  cut to the product the way a digest fragment is cut (`clipRange`, and `AGENTS.md`'s
  Reading a CDS), so a gene the primers cut into keeps its codons through `/codon_start`,
  and one whose whole codons a primer cut or changed loses the `/translation` its file
  came with.
- **Protein regions around a primer** are template annotations: show every region in the
  visible sequence window, including nearby boundaries, using `regionSpans` and the shared
  renderer in `src/views/regionTracks.ts`. The panel's Regions button shares the Sequence
  view's visibility setting; the map stays independent. A region click selects that
  region's bases while keeping the same primer in view. Neither region tracks nor a
  primer's non-annealing tail imply that the tail binds the template there.
- **Translation selection** in both sequence panels uses `src/views/translationHit.ts`:
  click for one codon, drag for whole codons in the starting CDS, ⌘/Ctrl-click to toggle
  separate codons, and Shift to extend from the last clicked residue (with ⌘/Ctrl to keep
  other picks). A double-click on them or a click on the feature name selects the whole
  feature; in the Sequence tab a double-click on the name opens Protein details. A gesture
  remembers its original picks so dragging back shrinks the span; pointer capture means
  the codon under a moving pointer comes from `elementFromPoint`, not the event's target.
  The bases of a split codon exclude introns. Keep the primer's window in place throughout.
- **Exact 3′ partial off-target sites** (`findPartialOffTargetSites` in `src/lib/primers.ts`):
  secondary priming sites where at least 8 contiguous bases at the primer's 3′ end match
  exactly (`PARTIAL_SITE_SEED`, zero internal mismatches, stopping at the first mismatch so
  `meltingTemp` is exact across all 5 Tm methods) and whose Tm meets
  `max(45 °C, primaryTm − 15 °C)` (`PARTIAL_SITE_MIN_TM`, `PARTIAL_SITE_TM_DROP`). They
  deduplicate against `findBindingSites` and the primer's stored site, surface as a
  `"Partial off-target"` warning in `primerReport().checks`, and never enter `findBindingSites`
  or PCR pairing.
- **A primer with no Tm** says why (`primerReport`). The Tm comes from the bases that pair,
  or from the 3′ arm of a primer with changes. If those include a base other than A, C, G
  or T the check is "Not ACGT"; if there are fewer than two, as when a change is the last
  base or the one before it, it is "Short 3′ arm" (a primer with changes) or "Few bases
  pair", as "other bases" would mislead. The Tm itself, and what a primer or product
  accepts, are as before.
- **Primer inspector & unified Primer Dialog** (`src/views/inspector.ts`,
  `src/views/primerDialog.ts`, `src/lib/primerInsert.ts`): the inspector is read-first
  (colour badge popover, hoisted warnings matching `report.checks`, styled sequence + Copy,
  `sv-facts`, wrapped alignment, Checks, compatible Pairs opening `openPcrDialog` with `p:<id>`
  keys, and editable Note). Creating (`⌘R` forward, `⇧⌘R` reverse on desktop; `Align Sequencing
  Reads…` moved to `⇧⌘A`; right-click; toolbar; `Add by sequence…`) and editing (`Edit primer…`,
  double-click on a primer) share `openPrimerDialog`. Keep the draft's `savedSite` (coordinates
  + strand) separate from preview site navigation so inspecting a partial off-target never
  moves the saved site or shifts `primerReport`'s reference. Library persistence preserves
  `color` (`parseLibraryJson` in `src/lib/library.ts`) and deduplicates by name + sequence
  (`libraryMatch`, matching `newEntries`).

## Decisions (and why)

- **Designed ends move outward, never inward** (`moveEnds` in `src/lib/design.ts`, the
  dialog's "Move ends"): a primer pinned to the region's own edge may be stuck on an
  AT-rich or GC-rich stretch, with nothing to do but grow longer. With a distance it may
  start up to that many bases outside the region instead, which only lengthens the product,
  so the region asked for is amplified either way. Each base moved costs a little, so the
  pair on the edges wins whenever a moved one is no better, and GC outside 40–60% costs a
  little too, on the thresholds `primerReport` warns at. An end with a 5′ addition never
  moves: a site is added to land on that edge (NdeI on a start codon), and bases between
  the two would undo it. Assembly keeps the default of 0 for the same reason — its tails
  are the neighbour's own end bases. Looking for mispriming is a scan of the template, so
  with the ends moving only the best candidates at each end are scanned, never the hundreds
  of positions tried.
- **The lab primer library** is kept by the app, not in documents (`src/primerLibrary.ts`,
  in local storage like the settings, with an app event so every window sees changes).
  Export/Import of a tab-separated list is the backup and the way to share it.

## Traps

- **Primer positions** cover the bases the primer pairs with, changes included; a 5′ tail
  hangs off beyond them and is not part of the range.
- **A primer's site across the origin** (`start > end` on a circle) is saved as an ordered
  join, as a feature's is (`partsOut` in `src/doc/convert.ts`); the primer's own bases are
  saved with it, not read from the template. Both Make linear controls now use
  `linearize` through `withTopology` (`src/lib/seqdata.ts`), leaving out a primer whose
  site crosses the origin, with a message and Undo. What should become of it is
  undecided; the tests record what the code does, not that it is right.
- **Designed primers are named by the region's direction**, as labs do: on a feature that
  runs right to left, `-F` is the primer at its start codon, which binds the top strand (a
  "reverse" primer for the plasmid) and gets the start site (NdeI). The PCR product picker
  and `src/lib/pcr.ts` speak of plasmid forward/reverse.
- **Assembly primers are named after their piece**, `<piece>-F` and `<piece>-R`
  (`planAssembly` in `src/lib/cloning.ts`), so pieces given the same name would have
  oligos sharing one. `distinctNames` fixes that before anything is written: the first
  keeps its name and a later one becomes "insert 2", "insert 3" (a name already taken is
  skipped), and the plan's pieces, joins, notes, layout and primers all use those names.
  Names that already differ are left alone, and no oligo's bases or place change. Golden
  Gate has no primers and keeps the names it was given.
