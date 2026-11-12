# November 2026 code review: plan

Status: proposed (12 November 2026). The fixes for 0.4.0 are not started, and the product
decisions below are recommendations still waiting for a decision.

## Where this comes from

On 11 November 2026 five automated reviews of the code were merged into one list of 63
claims, each checked against the code and then audited again with probes (small scripts
that run the real functions on made-up inputs). The reviews, the checks and the probes
are kept outside the repository; the IDs below (A06, DS05, …) are theirs, so findings can
be traced back.

The reviews looked at commit 8744a93, which already holds both commits of PR #61, so
none of its fixes are among the findings. On 12 November the probes were run again on
`main` at 22aa334 (after PRs #60 and #62 to #73) and every finding below still
reproduced.

## Before 0.4.0

The browser version goes live with 0.4.0, so the list leans towards what loses work or
gives a wrong answer with confidence. Two pull requests:

**1. Keep edits and grouping safe** (TypeScript)

- **A06, Save during a save.** A second Save while a file is being written returns
  without a word, and Close → Save followed by an edit during the write closes the tab
  with that edit unsaved. A second Save should wait for the first; after a Save chosen
  from Close, check `isDirty()` again (lab fields included) and keep the tab open if
  anything is still unsaved. Test with a delayed writer: edits to bases and to Info
  fields, a failed write, Cancel, and Save and Close overlapping.
- **DS05, Reverse complement with Select All.** The sequence turns, but features, primers
  and sources that cross the origin stay where they were. A full-length selection should
  do exactly what reverse-complementing the whole document does, in the helper itself, so
  every caller gets it.
- **DS01 and DS04, joined complements on circular records.**
  `join(complement(70..80),complement(20..30))` imports with its exons in the wrong order
  and spanning the wrong arc, while the equivalent `complement(join(20..30,70..80))` is
  right. Fix it where locations are read, keeping a join's declared order; never sort
  locations, which would break features that really cross the origin.
- **DS02, clone groups in multi-record files.** Check files and remembered reads key a
  read by its file's path, so two clone groups made from one four-record FASTA come back
  as one group of four. Key each read by its record (its position in the file, checked
  against its name and sequence), version the check file, and keep reading old ones. If
  this makes the pull request too big, it goes in its own.
- **M03, upload keys kept between visits.** Map rotation and the dismissed detection
  offer are stored under `upload:` keys, whose numbers start again on every visit, so a
  later upload can inherit them. Keep those for the visit only and drop any already
  stored. Small, and it matters because the browser version goes live.
- **M04, test gap.** Add a save round trip for source qualifiers (text, numbers, web
  addresses, after an edit, and a source spanning the whole record).

**2. Trustworthy alignments and primer design**

- **S15, alignment gaps too big to align.** When a gap between seeds is too large for the
  matrix, the aligner falls back to one deletion and one insertion. A read identical to a
  68,100-base reference with a long repeat is reported with a confident 8,078-base
  deletion and insertion, in the read and in the clone. For 0.4.0: align gaps whose two
  sides are identical exactly, without a matrix, and mark every other fallback call as
  not confident, so it never becomes a mutation or an edit made by "Open clone as file".
  A proper "not aligned here" result through the JSON and the Reads tab can follow. Both
  probe cases become tests in `crates/seqcore/`.
- **DS06, slow primer design.** Since 8744a93 design builds full binding-site details for
  every candidate only to count them, about 120 times slower on repetitive sequence. This
  hasn't been released, so fix it before it is: count sites without the details, with
  the same hits and the same ranking. Watch A02 (below) at the same time.

Each needs a bullet under `## Unreleased` in `CHANGELOG.md` and an e2e check where users
would see the change.

## After 0.4.0

Still open, in the order the audit suggests:

| ID | What's wrong |
| --- | --- |
| A02 | One IUPAC base in a primer (an N) finds no binding site, though the primer aligns. |
| A03 | `rangeWithin` gets containment wrong when the outer range is the whole circle. |
| A04 | Whether one CDS continues another ignores the origin, splicing and `/codon_start`. |
| M01, S01 | U kept from a file hides enzyme sites and Tm; a U on the reverse strand is lost. |
| G10 | A region's violation is reported one base too late after an insertion. |
| G14 | Above 250,000 reference bases (no alignment strings) an indel hides a mixed clone. Until it is fixed, say mix analysis isn't available there. |
| G01 | Results in the Reads tab stay aligned to the sequence before an edit. |
| G02, G09 | Home keeps a read error after the file is readable again, and a folder that fails to list loses its cached rows. |
| DS03 | Primer report takes over a second on 1 kb of poly-A (`tailMatches`). |
| DS07 | Gel bands merge fragments further apart than the resolution allows. |
| A01 | A closed tab's pending alignment can still show a message and save remembered reads. |
| G08 | A failed regrouping leaves no failed state and no Retry. |
| S04 | The detection dialog can add suggestions made for the sequence before an Undo. |
| A10 | Coordinates the file parser corrects (an end past the sequence) are corrected silently; show its warnings once on opening. |
| S03 | Changing read quality, trimming or amber suppression re-aligns reads in tabs not shown. |
| S13 | Lab fields aren't part of the document's Undo. |
| G06 | The cloning legend counts overlap bases in each piece; label them as including overlaps. |
| C06 | Delete messages are worded differently in different places. |

## Decisions to make

Each has a recommendation and why; none is decided yet. Once one is, the code follows
and, where it sets a rule, `AGENTS.md` or the area's guide says so.

1. **A05, reads without quality scores.** Calls from them count as confident today.
   *Recommended:* keep them, label them "Quality unknown", count them apart from calls
   with Phred scores, and don't count them as confirmed mutations. A FASTA read from a
   sequencing provider is real data, so dropping it would make a clone look unread, but
   calling it confident claims evidence it doesn't have.
2. **Q01, editing the span of a feature in parts.** The parts (exons) are merged into one
   silently. *Recommended:* keep the parts; where an edit can't map them (a part or the
   span crossing the origin), refuse it with a one-line reason. Exons are data and the
   loss survives saving; a deliberate "Merge parts" can come later if wanted.
3. **C05, Delete in the map, Primers and the outline.** *Recommended:* yes, but it only
   removes the clicked feature, primer or region, never bases. That extends the rule that
   a first Delete removes the thing clicked, and bases are only deleted where they can be
   seen, in the Sequence tab.
4. **DS08, a palindromic primer "binds in 2 places".** Both hits are at one location, on
   opposite strands. *Recommended:* say "1 location, both strands" and keep both hits for
   PCR and design. The words become true and no result changes.
5. **G03, dragging across the origin in the Sequence tab.** *Recommended:* leave it to
   the map. A drag in the text that sometimes picks the other arc would surprise people,
   the map already does it, and nobody has asked; a "Select other arc" command could
   come later.
6. **G04, complete coverage with a deletion.** *Recommended:* keep coverage meaning every
   position was read, and add a separate length or frameshift flag if the clone summary
   doesn't show one. The deletion is the finding, and a frameshift is what a biologist
   needs to see.
7. **G05, fragment sizes.** Cloning counts overhang bases; digest and gel give top-strand
   bp. *Recommended:* top-strand bp everywhere, with the end beside it ("5′ AATT
   overhang"). Those sizes add up to the plasmid, and two numbers for one fragment look
   like a bug. The fragments used by the simulator don't change.
8. **G07, an assembly with more than one possible order.** *Recommended:* show the
   preview as "One possible product", with the warning naming the ambiguous pieces.
   Withholding it doesn't help, and a chooser is a lot of work for a rare case.
9. **S10, methylation sensitivity.** *Recommended:* not for 0.4.0. If added, a note in
   the tooltip from a curated source (Dam, Dcm, CpG) that never hides a cut. Wrong
   sensitivity data is worse than none, and users know their strains.
10. **S11, naming the Tm method for overlaps.** Already shown ("Overlaps · Tm by the
    Wallace rule"). *Recommended:* close it.
11. **Rules inside defects.**
    - *U (M01):* read U as T for every analysis, and leave the file's text alone unless
      the user edits it. Pasting and Find already do this since PR #61.
    - *Overlaps made only of N (G12):* call them unresolved and say why, rather than
      offering a product; unknown bases are no evidence that two pieces join.
    - *Gel bands (DS07):* group fragments by their spread from the band's largest one,
      and use the mean only to place the band. That keeps the promise in the code, that
      fragments in a band are within the resolution of one another.

## Left as they are

- **Working as intended, or the claim was wrong:** C01, C02, C03, C04, C07, C08, C09, Q02,
  Q03, G11, S02 and S14.
- **Hardening, or needing evidence first:** A07, A08, A09, G13, M02, S05, S06, S07, S08,
  S09 and S12. Some need an experiment before anything changes: a power-loss test for
  A07, the native order of key and menu events for S08, a typing profile for S12. Take
  them up when their area is next worked on.
