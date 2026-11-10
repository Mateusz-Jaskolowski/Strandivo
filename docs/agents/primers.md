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
- **Protein regions around a primer** are template annotations: show every region in the
  visible sequence window, including nearby boundaries, using `regionSpans` and the shared
  renderer in `src/views/regionTracks.ts`. The panel's Regions button shares the Sequence
  view's visibility setting; the map stays independent. A region click selects that
  region's bases while keeping the same primer in view. Neither region tracks nor a
  primer's non-annealing tail imply that the tail binds the template there.
- **Translation selection** in both sequence panels uses `src/views/translationHit.ts`:
  click for one codon, drag for whole codons in the starting CDS, ⌘/Ctrl-click to toggle
  separate codons, and Shift to extend from the last clicked residue (with ⌘/Ctrl to keep
  other picks). A double-click or the feature name selects the whole feature. A gesture
  remembers its original picks so dragging back shrinks the span; pointer capture means
  the codon under a moving pointer comes from `elementFromPoint`, not the event's target.
  The bases of a split codon exclude introns. Keep the primer's window in place throughout.

## Decisions (and why)

- **The lab primer library** is kept by the app, not in documents (`src/primerLibrary.ts`,
  in local storage like the settings, with an app event so every window sees changes).
  Export/Import of a tab-separated list is the backup and the way to share it.

## Traps

- **Primer positions** cover the bases the primer pairs with, changes included; a 5′ tail
  hangs off beyond them and is not part of the range.
- **Designed primers are named by the region's direction**, as labs do: on a feature that
  runs right to left, `-F` is the primer at its start codon, which binds the top strand (a
  "reverse" primer for the plasmid) and gets the start site (NdeI). The PCR product picker
  and `src/lib/pcr.ts` speak of plasmid forward/reverse.
