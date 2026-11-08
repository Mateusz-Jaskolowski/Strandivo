# Cloning and assembly design: plan

Status: notes, nothing decided. Written November 2026 after working through a widely used
commercial assembly designer, then revised after an outside review that corrected several
claims in the first draft. Nothing here is committed to.

The subject is the cloning dialog (`src/views/cloningDialog.ts`), the planner behind it
(`src/lib/cloning.ts`) and the primers it designs (`src/lib/design.ts`).

Two findings below were defects in code we ship rather than matters of design taste: a
shared repeat between neighbours was silently collapsed (section A) and the overlap Tm
threshold did not mean what it was taken from (section B). **Both are fixed** — see those
sections. Everything else here is still open.

## What the code already gives us

- **The overlap planner works.** `planAssembly` with `GIBSON` adds a 20 bp overlap and
  splits it half on each neighbour's primer; `IN_FUSION` puts all 15 on one side.
- **Overlaps that are already there are found, not redesigned.** `findOverlap` checks each
  pair of neighbours for 15 bases or more of shared sequence first.
- **Primer quality is already measured.** `designPairs` scores the distance from the Tm
  window, the match between the pair's Tms, the 3′ GC clamp (`hasGoodClamp`) and 3′ dimers
  (`threePrimeComplementarity`), the last computed over the whole oligo including its tail.
  `src/lib/primers.ts` also has `gcContent` and `longestRun`.
- **The assembly's shape is already computed.** `joinFragments` returns a `Layout` with
  every piece's position and length and every junction's position and length.
- **Primers can already be copied for ordering.** `openOrderDialog` in
  `src/views/primerDialogs.ts` offers tab-separated and FASTA output, reachable from the
  Primers tab and its context menu, and `exportPrimerList` exists beside it.
- **A digested vector can already go into an overlap assembly.** When the vector is opened
  with enzymes, `src/views/cloningDialog.ts` passes the backbone straight to `planAssembly`.
- **Products open as unsaved tabs**, so trying a variant costs nothing. Settled, and
  recorded in `AGENTS.md`.

**What we do not match, contrary to the first draft of this document.** Our half-and-half
split is a fixed length rule. The published algorithm it was taken from applies two
separate constraints: the two halves *together* must reach a minimum Tm, and their
**lengths** come out roughly — but not necessarily exactly — equal. It also extends the
overlap further when its 5′ end falls in a low-complexity or repeated region. Note that
neither constraint asks the two halves to have equal Tms; reading it that way would be a
third rule that is not there. Ours coincided with it on the example used to check it,
which is not the same as implementing it.

## Worth taking

### 1. An annealing temperature for each pair

We report a Tm per primer and stop. The number wanted at the bench belongs to a pair in a
reaction, and we never produce one.

This is not simply the lower Tm plus a constant. An annealing temperature depends on the
polymerase, the buffer and the primer concentration, and has to be consistent with the Tm
calculation underneath it. Ours defaults to 50 nM primer (`DEFAULT_CONDITIONS` in
`src/lib/primers.ts`); the tool examined for comparison defaults to 500 nM for its own
polymerase, which is worth about 3 °C on the sequences tested here. An offset lifted from
one baseline and applied to the other would be wrong by more than it is worth.

So: a validated preset per polymerase, carrying the conditions it assumes, naming the
polymerase in the interface, and shown only where that preset applies. A confidently wrong
annealing temperature wastes a PCR, which is worse than showing none.

**Verdict: yes, and still the item with the widest reach** — the Primers tab and the
library want it too. But it is a calculation to get right, not a display change, and the
estimate should be presented as a starting point for optimisation rather than an answer.

### 2. Showing primer problems, not just scoring them

Everything in `designPairs` feeds one `score` that sorts candidates and is then discarded.
It picks the best of a bad lot and says nothing when the best is still bad, which is when
the user most needs to know.

Most of the measurement exists. Missing: runs of two- and three-base units (`longestRun`
counts single bases only) and self-structure within one primer, as distinct from the pair
dimers we already compute.

One caution on where warnings attach. A 5′ overlap tail does not change the Tm or the 3′
clamp of the annealing segment — those belong to the 3′ binding portion. What a tail does
change is whole-oligo structure, dimer formation and the length being ordered. Those are
the effects to score, and attributing them to the annealing segment would be wrong.

**Verdict: yes, the cheapest real win,** and shared rather than cloning-specific. Worth
saying plainly: more warnings help only if they separate problems worth acting on from
ordinary designs that will work. A design that trips three notes and amplifies fine
teaches users to ignore all of them.

### 3. Letting an ordered fragment carry the overlap

When neither neighbour of a junction is amplified, `planAssembly` gives up and says to
amplify one of them. If one of them has not been ordered yet, that is the wrong advice:
the overlap can go into the sequence being ordered instead of onto a primer.

**"Being ordered" is two states, not one.** A fragment whose sequence can still be changed
is not the same as one already ordered or sitting in the freezer, and extending the second
would quietly invalidate the reagent the user actually has. Only the first may be extended,
and the model has to tell them apart — today a piece is either amplified
(`AssemblyInput.pcr`) or taken as it is, which collapses both.

An earlier draft said the extra bases "cost nothing". They do: synthesis has length limits
and sequences it will refuse, and length moves both the price and the delivery date. The
argument is that extending a sequence not yet ordered is usually cheaper than adding a PCR,
not that it is free.

**Verdict: yes, once the piece model distinguishes those two states.**

### 4. A record of the assembly, and a check before ordering

These are two needs, and the first draft ran them together.

**The check comes first.** Before anything is ordered, the question is whether the molecule
being designed is the intended one: is the fusion in frame, is there a stop codon left in
the middle of it, did the start survive, is the insert the right way round. That wants a
junction preview showing local sequence and the intended coding frame, and the Sequence
view is the natural thing to reuse. It is wanted at design time and answered then.

The first draft claimed this could be had by writing the layout onto the product as
features, and that "translation comes free". **That is wrong.** Translation in
`src/views/sequenceView.ts` is drawn under CDS features — it is gated on `isCds` from
`src/doc/analysis.ts` — so generic piece and junction features would produce no
translation at all. There is an ORF overlay, but no free-standing six-frame display of an
arbitrary region. The claim did not survive checking.

The feature-per-piece plan is also poor on its own terms. A six-piece assembly would add
twelve annotations on top of the genes, regulatory elements, primers and enzyme labels
already on the map, whole-backbone features sit badly beside functional ones, and repeated
rounds of cloning compound it. And an overlap is shared by two reagents: its sequence
usually cannot say which one supplied a given base, so a feature marking it should not be
read as established provenance.

**What to build instead:** one versioned assembly record holding source identity and
coordinates, orientation, how each piece was prepared, the reagent sequences, the primers,
the overlap decisions and the calculation settings — bound to the product's sequence
version, so that later edits cannot quietly turn a design record into apparent
confirmation of what is now in the file. A structured block in the GenBank COMMENT lines
we already write (`src/lib/labinfo.ts`) is a plausible portable form. A map overlay drawn
from that record, and plain annotations on export, can both come later and are optional.

**Verdict: yes to both, with the junction check first.** This supersedes section E below:
the record there and the provenance here are the same object.

### 5. Ordering from the assembly

The first draft said there was no export of any kind. That was wrong — `openOrderDialog`
has offered tab-separated and FASTA output from the Primers tab for some time.

The real gap is narrower and still worth closing: finishing an assembly leaves you to open
the product tab, go to Primers and copy from there. For a single experiment that is
administration. The existing dialog should be reachable from the assembly result.

**Verdict: yes, and smaller than it looked.** Reuse `openOrderDialog`; do not build a
second ordering path, and do not route it through the primer library.

### 6. Regenerating a cut site across a junction

Whether the enzyme's site is rebuilt at the junction, eliminated, or left to chance.

The first draft postponed this on the grounds that digested fragments cannot enter an
overlap assembly. That reason was wrong — a digested *vector* already can; only digested
inserts cannot. The feature is still niche, but its justification for being postponed is
weaker than stated.

**Verdict: not now, but the reason is priority, not impossibility.**

## Where we differ

### A. An overlap found, or an overlap declared

**Ours:** `findOverlap` checks whether neighbours already share 15 bases or more and joins
on that; only otherwise does it design one. **The alternative:** the user says how every
fragment is produced — though not purely, since it will also use an existing overlap on a
synthetic fragment and will try to use a custom primer's 5′ tail as part of an overlap. The
first draft's "nothing is inferred" was wrong.

**The real problem with ours is not silence, it is ambiguity.** When fragment A ends with
sequence R and fragment B begins with R, two different molecules are consistent with that:
one shared copy of R, or two copies in series because each part carries its own. Sequence
identity cannot distinguish them, and we always choose the first.

Verified with the current planner: two fragments of 36 and 35 bases sharing a 16 base
linker produce a 55 base product, the join is reported as already present, and `problems`
is empty. Keeping both copies would give 71. Either answer can be the intended one. A
Gly-Ser linker at the end of one part and the start of the next is an ordinary way to meet
this, as are repeated tags and regulatory elements.

A warning that a found overlap is shorter than the target does not help. A long, high-Tm,
entirely convincing match can still be the wrong molecule.

**Verdict: keep discovery, stop guessing the intent.** **Done, in part.** `planAssembly`
now returns `notes` and `reused`, and every join built on shared bases says which two
pieces shared them, how many, that one copy is kept, the product's length and what it
would be with both. The cloning dialog shows those notes. It is a note and not a problem
on purpose: reusing an overlap is usually right, and a warning on every correct design is
one users learn to skip past.

**The first version of that note gave advice that did not work**, and it is worth recording
why. It said to trim the shared bases from one piece and let the primers add the overlap
back. A designed overlap is built out of bases the neighbours already carry, so it adds
nothing to the product: trimming the linker off one piece and amplifying both gives the
same 570 bp, and loses the note into the bargain, because the join is then designed rather
than found. Keeping both copies means putting them side by side, and a tandem repeat gives
the join two registers to anneal at, so the reaction cannot be relied on to pick one.

**The second version was not right either**, and the reason sharpens what the note has to
say. It advised putting both copies inside one piece, or moving the join into unrepeated
sequence, as though those were two ways to the same place. They are not. Grouping the
copies says where the *copies* go; what has to be unique is the *overlap*. Where the
overlap is not split across the junction — In-Fusion puts all 15 bases on one side — it is
taken whole from one piece's end, so a piece that ends in a tandem repeat hands the join an
overlap that occurs twice within it. A 340 bp piece ending in two copies of a 20 bp linker
gives the 15 bp overlap `CGGTAGCGGTGGCGG` at positions 305 and 325, with no problem and no
note. The product length is right and the two-register risk is untouched. Gibson escapes
*that* arrangement only because a split overlap is half of each neighbour, so it reads
nowhere in either input region — though it does read in both finished amplicons, which is
the pairing the design intends. Geometry, not a check.

**And the geometry is not In-Fusion's alone.** Splitting needs two sets of primers to split
across. Where only one neighbour is amplified — the ordinary case of an insert going into an
opened vector — Gibson takes the overlap whole from the vector's start, exactly as In-Fusion
does. A vector beginning with two copies of a 20 bp linker gives a designed overlap that
occurs twice in it under both methods, with no problem and no note. Nor does the repeat have
to be long enough to be noticed: a 12 bp period, below `minOverlap`, repeated four times,
puts a 15 bp overlap inside itself twice.

Both of those share nothing between neighbours, so the shared-overlap note cannot fire for
either, however it is worded. That was the measure of what advice could do here: it covers
the one entry point where two pieces happen to arrive carrying the same bases, and nothing
else. Which is why the note is no longer the main defence — the uniqueness check below is,
and it reports all three arrangements. The note stays for what only it can say: which of the
two molecules a shared overlap built, and what the other would have been.

So the note now says both copies have to go inside one piece **and** the join has to sit
past them, in sequence that occurs once. **The test follows the advice and checks the
product is the molecule the note describes**, rather than matching the note's wording — the
earlier test asserted only that the words "keeps one copy" appeared, which is exactly why
the advice could be wrong without anything failing. It now also counts how often the
generated overlap occurs in the piece it was taken from, under both methods, since product
length alone was what let the second version through.

**If a "keep both copies" control is built, it must redesign the reagents, not just
concatenate.** Joining two fragments on shared bases is physically what those reagents
would do; keeping both copies is a different molecule, and simulating it by concatenating
the pieces as they are would predict a product the reagents in the tube cannot make. The
option has to extend a primer tail or a synthetic fragment's end so that the overlap falls
somewhere unique, and then say what to order. Without that it is not a display option, it
is a wrong prediction.

That is also why the uniqueness check below is the more useful next step: a repeat at a
junction is a poor design for this chemistry whichever molecule was meant.

**Repeated overlap sequence in the predicted product: now reported.** This started as the
largest gap on the list and it is the one case where chasing the problem through three wrong
fixes paid for itself, because each wrong fix was advice and the evidence kept saying advice
cannot reach it.

**What the check actually does, stated narrowly**, because the loose version of this claim is
easy to write and wrong: `overlapMatches` finds every place each join's overlap reads the
same in the product that plan builds, on either strand, and reports a join whose overlap
reads the same in more than one place. Repeated sequence is what makes a second pairing
*possible*, so the message says another copy could pair with the join, not that it will. It
is a sequence audit of one predicted molecule, not a model of the reaction.

Counting on the product rather than on the input regions is what makes it one check instead
of several: the product holds every piece and every primer tail, so a repeat inside one
piece, two junctions sharing an overlap, and a copy contributed by a tail are all the same
count. Case is folded on both sides, since a file keeps its own capitalisation and that says
nothing about the bases. A palindrome counts once per place, not twice. On a circular product
the seam is searched, so a copy across the origin is not missed. And each join's overlap must
appear somewhere in the product it builds: when it does not, the plan contradicts itself and
says so rather than passing as checked.

The subtlety worth recording is that copies of a tandem repeat **overlap each other**. Two
registers 12 bases apart, with a 15 bp overlap, are two places to land — and `split()` or a
global regex, which resume after each match, report only one. Stepping forward a single base
is what makes the check see the case it exists for. Both scratch scripts written while
verifying this got it wrong in exactly that way before the test caught it.

**What it does not do**, kept explicit because a check that is trusted past its scope is
worse than none:

- It does not establish that each physical pair of ends is unique. That needs the reaction's
  own fragments — amplicons with their tails, and the digest fragments actually chosen — and
  a distinction between the partner a join expects and any further match. Three pieces where
  the middle one is wholly contained in its neighbours' shared homology collapse to one locus
  in the product, so the audit sees one overlap where the tube has several candidate pairings.
  That arrangement loses the distinction between participants; it does not predict a wrong
  final sequence, and should not be described as if it did.
- Self-closure, pairings between ends that are not meant to meet, and partial homologies long
  enough to prime are unassessed.
- Sequence in a parent template outside the amplified region is not considered. A repeat
  there is a question about what the PCR produces, which belongs with primer specificity.
- It does not extend an overlap until it reads uniquely. The published help for this
  chemistry describes extending for stability and away from low-complexity sequence; it is
  not evidence of a guarantee of globally unique overlaps, and this document should not claim
  one on its behalf.

Two traps came out of the degenerate end of this, both worth keeping in mind when adding a
message anywhere near it. `meltingTemp` returns null for an overlap under two bases *and* for
one holding anything but A, C, G or T, so a branch on null alone reported known bases as
ambiguous; the two causes are told apart before anything is said. And a one-base overlap reads
the same in 134 places in a 300 bp product, so any list of positions needs a bound — the
message names the first six and the total. An overlap of no bases at all is not a short
overlap but invalid input: it is reported and no product is built, because preserving every
base of nothing does not make an assembly.

### B. An absolute Tm window, or a matched pair and a reported temperature

**Ours:** `DEFAULT_DESIGN` targets 58–62 °C, penalises anything outside and stops at 30
bases. **The alternative:** no narrow window exposed, but not nothing either — the
annealing segment is extended until a target Tm is reached, so it is a different
formulation rather than an absence of one. The first draft overstated this difference.

The window is defensible as a target. Matching a pair alone is not sufficient either: two
equally poor primers can match each other perfectly.

**What is not defensible is the first draft's claim that the window means every primer we
design works at one standard temperature.** The code cannot promise that. `designPairs`
returns the best available pair including one outside the window, and the 30 base ceiling
can decide the outcome as much as the template does. The window is a target we can fail
silently, and the first draft presented it as a guarantee.

The argument that differing temperatures mean "more than one PCR" also conflated two
things. Separate amplicons are separate reactions regardless; what differing annealing
temperatures actually cost is separate programmes, or positions on a gradient.

**Verdict: keep the window as an adjustable target, and stop claiming more for it.** Report
when it could not be met, allow a longer annealing segment or a different endpoint where
that helps, add the reported annealing temperature from item 1, and offer a shared-programme
objective for users who want one.

**A defect, not a preference — now fixed.** `GIBSON.minTm` is 48, taken from a published
criterion that measures Tm by the empirical rule of 4 °C per G/C and 2 °C per A/T. The
check called `meltingTemp`, which defaults to nearest-neighbour under our own conditions
and is *user-configurable in Settings*. On the same 25-mer those give 65.9 °C and 74.0 °C;
under Breslauer, 81.7 °C. The threshold therefore meant something different from its
source, and different again depending on a display preference set for unrelated reasons.

`OverlapMethod` now carries the `tmMethod` its threshold was set for, both methods name
the Wallace rule, and the overlap check and the Tm it reports both use it whatever Settings
says. The dialog labels which method the figure is in, since it will not match the Tm shown
elsewhere. An overlap whose Tm cannot be computed — ambiguous bases — is now reported
rather than skipped by the `x.tm !== null` guard.

**What this fix does and does not claim.** It makes the threshold mean what it meant where
it came from, so the number and the rule agree. It says nothing about which calculation
better predicts whether an assembly works: that is an empirical question, and answering it
needs bench outcomes rather than a second opinion about formulae. If the evidence ever
says nearest-neighbour predicts better, the right change is a threshold restated for it —
not a quiet return to checking one method's number against another's rule.

The regression test for this asserts that the method changes the **decision**, not just the
figure: `src/lib/cloning.test.ts` uses one overlap at 50.0 °C by the Wallace rule and
45.9 °C by nearest-neighbour, and another at 46.0 °C and 50.2 °C, so each is warned about
under one method and not the other. Showing two calculations disagree somewhere above the
threshold, as an earlier draft did, demonstrates nothing a user would notice.

To be exact about what that decision is: it decides **whether a warning appears**, not
whether the assembly is allowed. Every combination still returns a product. A sub-threshold
overlap often works, so this stays advice; earlier wording here and in the acceptance cases
called it accepted or rejected, which claimed more than the code does.

### C. Ambiguous bases refused, or accepted

**The alternative** refuses anything but A, C, G and T. **Ours** accepts IUPAC codes
throughout, and library work (`src/lib/variable.ts`, `src/lib/variants.ts`) depends on it.

**Verdict: keep ours, and separate two cases the first draft ran together.** A deliberately
degenerate position in a library design is not the same as an unknown base in a sequence
someone pasted. Neither establishes physical homology: a run of Ns matching a run of Ns is
not an overlap, and `findOverlap` compares strings, so it would treat it as one.

What ambiguity may not do is stand in for evidence. An overlap is a claim that two
molecules will anneal, and a run of Ns matching a run of Ns is not that claim — so where
ambiguous bases fall in a region being used to *decide the product*, the decision should
be blocked rather than annotated.

That is narrower than "ambiguity in an annealing segment is an error", which an earlier
draft of this section slid into and which would be wrong: a deliberately degenerate primer
is a standard technique, and refusing it would put the cloning dialog at odds with the
library work the rest of the app supports. The distinction is between a mixture the user
designed and an unknown base standing where evidence should be.

**Done:** an overlap whose Tm cannot be computed is reported instead of slipping past the
`x.tm !== null` guard in `planAssembly`. The first attempt at that fix only worked for
Gibson: the check began `if (!method.minTm || ...) return`, and `IN_FUSION.minTm` is 0, so
In-Fusion skipped the whole thing and built a product from an N-containing overlap in
silence. Whether an overlap *can be judged* and whether it *meets a minimum* are two
questions, and only the second belongs to a threshold. They are now asked separately, and
both Gibson and In-Fusion are covered, linear and circular.

**Assessed, and not changed: should unknown-to-unknown homology produce a product at all?**
It should not, strictly — the sequence we would be predicting is one we cannot read. But
refusing outright would turn a note into a block for a case that is sometimes a user's own
degenerate design, and the reviewer's point against converting warnings into blocking
errors applies. The conservative half is done: the plan says there is no telling whether
the overlap will anneal. The other half is `findOverlap`, which compares strings and so
counts N against N as homology in the first place; that is the right place to fix it, and
it is listed under the gaps rather than slipped in here.

**Not a gap, contrary to an earlier draft:** primer design already declines candidates it
cannot measure — `candidates` in `src/lib/design.ts` keeps a candidate only `if (tm !== null)`,
so ambiguous bases in an annealing segment already stop that candidate being chosen. The
silent bypass was specific to the overlap check. Claiming otherwise here was the same
mistake as the ones this document was revised to correct: asserted from a search, not from
reading the function.

**Still open:** `findOverlap` compares strings, so Ns against Ns are still counted as an
overlap and the join is made on them. That is the case worth fixing next, and it needs
`findOverlap` to know about ambiguity rather than the Tm check to catch it afterwards.

### D. Overlap distribution fixed by the method, or chosen per junction

**Ours:** one `split` flag on `OverlapMethod`. **The alternative:** a per-junction choice,
disabled where it cannot apply.

The first draft argued for making the choice automatically and showing a control only when
our scoring noticed a problem, by analogy with `out.choice` in `src/views/cloningDialog.ts`,
which offers an insert direction only when the ends genuinely fit both ways.

**The analogy does not hold.** Insert direction appears when the chemistry permits two
outcomes — a mechanistic fact we can detect. Overlap distribution stays a legitimate choice
even when our score strongly prefers one arrangement, and the reasons for it are usually
invisible to us: standard fragment boundaries, a shorter oligo to order, matching another
construct. The clearest case is in the comparison tool's own documentation, which notes
that the whole overlap is often put on the insert's primer at a vector-insert junction so
that one set of vector primers can be reused across projects. Nothing about that design
trips a warning. Under a conditional-only control it would be unreachable.

A control that appears and disappears as a sequence is edited is also harder to learn and
harder to explain to a colleague.

**Verdict: a stable affordance at every junction, not a conditional one and not a drawer.**
Something compact — the current distribution, marked as recommended, with a way to change
it — expanding to show the alternatives and what they cost. Warnings can expand it
automatically. The first draft presented a false choice between a hidden control and an
invisible one.

**And the automation behind it needs more care than the first draft gave it.** Choosing
"whichever scores best" rests on a heuristic with no calibration: near-equal scores have no
established meaning, and each PCR pair is shaped by the junctions at *both* ends of its
fragment, so optimising junctions one at a time can miss the interaction between a
fragment's own forward and reverse primers. Worth exploring, not worth shipping as a
recommendation yet.

### E. Where the product goes

Folded into item 4. Products stay as unsaved tabs; the record of how one was designed is
the versioned assembly record described there, not a separate export.

## Gaps

Corrected and extended after review.

- **A digested insert cannot enter an overlap assembly.** The vector can — the dialog
  passes an enzyme-opened backbone straight to the planner — but every insert row is built
  with `wholeFragment`, so `InsertRow.enzymes` only ever reaches the restriction path.
  Narrower than the first draft claimed, and still worth closing.
- **Primer specificity is never checked against the template.** Annealing segments should
  be checked against the sequence they will actually amplify from, with a stated search
  scope. `findBindingSites` exists. Placing finished primers on the assembled product, which
  `planAssembly` already does, shows where they end up — not that they amplify one thing.
- **No functional check of the construct.** Orientation, reading frame across a fusion,
  retained start and stop codons, linker residues, intact expression elements. A product
  can be exactly the sequence we predicted and still be the wrong construct.
- **A primer you already have cannot be used.** Every primer is designed from scratch. A
  working primer in the freezer, or a standard sequencing primer, cannot be pinned with the
  rest designed to fit. A constraint the user brings is a different thing from a decision
  we make, and worth keeping separate from section D.
- **No spacer between pieces.** The first draft proposed treating a spacer as its own short
  piece in the list. **That is wrong at the bench:** a twelve-base linker is not a practical
  standalone reagent. Short spacers belong on a primer tail; only once a spacer is long
  enough to be worth ordering does it become a synthetic fragment. The comparison tool caps
  spacers at 100 nt for exactly this reason.
- **Method presets are too rigid.** `IN_FUSION` fixes 15 bp, but 20 bp is recommended for
  more than one insert; the kits this chemistry covers differ enough to need presets rather
  than two constants.
- **The amplicon length is never shown.** A PCR piece enters the tube longer than it appears
  in the assembly, by the length of its tails, and that is the length checked on a gel.
- **No bench handoff.** Amplicon lengths with tails, which template each piece comes from,
  preparation steps and molar quantities. Residual uncut vector and carried-over parental
  plasmid are the usual background problems, and advice to treat with DpnI only applies to a
  methylated template.
- **No verification plan.** Sequencing the junctions does not verify the amplified interiors
  of the pieces. The assembly record from item 4 is what should say what needs checking.
- **Nothing a plan says survives opening its product.** `problems` and `notes` live on the
  `AssemblyPlan` and are shown in the dialog; the product opens as a tab that carries none
  of them. Close the dialog and the warning that an overlap was reused, or melts below the
  guideline, is gone — which is the same loss of the plan described in item 4, and another
  reason the record there should exist.
- **`findOverlap` counts ambiguous bases as matching.** It compares strings, so a run of Ns
  against a run of Ns is homology as far as the planner is concerned, and the join is made
  on it. Reporting it afterwards, which is what happens now, treats a symptom.
- **The defaults rest on nothing recorded.** "The common case", the warning thresholds and
  any automatic distribution need to be checked against representative designs and bench
  outcomes before they are presented to users as recommendations. Note that all 416 unit
  tests, the type check and the build passed with both of the defects this document
  records as fixed still present; green is not evidence here.
