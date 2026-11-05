# Checking library clones: plan

Status: built one phase at a time (October 2026); each phase says when it was done and
what turned out differently. Tried on three real Sanger reads; see "Tried on real reads".
Phase 7 is only for if it is asked for, and phase 6 still needs a real whole-plasmid read.

## What we want

One feature for everyone who sequences many variants of one construct: nanobody and
antibody libraries, site-saturation, error-prone PCR, directed evolution, promoter
libraries.

- **The question it answers:** given the reference and N clones, how does each clone
  differ, which clones are the same, and what do they have in common?
- **Works with no setup:** open the parent, add reads, and you get a mutation list per
  clone (K12R, c.35A>G).
- **Gets better with annotation:** mark features or positions as variable, ideally with
  IUPAC codes (NNK) or a few known alternatives. They become columns of their
  own, and bases that break the design are flagged.
- **Grouping reads into clones with a consensus** comes first. It also delivers the
  roadmap's "consensus from overlapping reads" for ordinary plasmid checks.
- **It warns about** stops, frameshifts, mixed colonies (double peaks), synthesis errors
  and parts no read covered. "Not covered" is never shown as "unchanged".
- **Views across clones:** mutations that recur, and library QC (mutation rate, stop
  fraction, codon use at NNK sites).
- **Later:** whole-plasmid nanopore results (Plasmidsaurus), in the ordinary Reads tab
  too. Library clones are still mostly checked by Sanger; Plasmidsaurus is used more and
  more for confirming 2–3 clones after cloning.
- **Not in scope:** NGS or deep mutational scanning. This is for plates of Sanger clones.
- **Where it lives:** the Reads tab, one view at a time (Coverage, Clones, Differences,
  Summary), with the traces opening below when something is selected. Marking regions as
  variable belongs in the inspector. No sixth view.

The kinds of library it should serve, and what each needs to see:

| Kind of library | What you know in advance | What you want to see |
|---|---|---|
| Error-prone PCR, directed evolution | Nothing | A list of mutations per clone |
| Site-saturation, combinatorial | Specific positions (NNK at 3 sites) | The residue at each site, per clone |
| Antibody, nanobody, DARPin, peptide libraries | Regions (CDRs, loops) | The sequence of each region, per clone |
| Promoter, RBS, UTR libraries | Regions, but not coding | Bases instead of amino acids |
| Shuffling, recombination | Several parents | Which parent each segment came from |

## What the code already gives us

- **Degenerate bases in the reference already work in part.** `classify` in
  `crates/seqcore/src/sanger.rs` accepts any base an IUPAC code allows (K matches G or T),
  and a base outside the code counts as a mismatch. That's the "breaks the design" check,
  almost for free.
- **N in the reference** counts as ambiguous and is never reported as a difference. So a
  clone's actual bases in an NNN region aren't in `differences` at all. Region contents
  have to be read from the alignment itself (the gapped read in `segments`), not from the
  list of differences.
- **`src/lib/msa.ts`** already stacks reads under one reference. That's the right starting
  point for a consensus.
- **Effects of a change** come from `consequenceIn` in `src/lib/genetics.ts`, which can be
  reused for mutation names.
- **Reads live only in memory**, one `ReadSet` per tab (`src/doc/document.ts`). Fine for
  3 reads, painful for 96. See decision 1 below.
- **Whole-plasmid reads won't fit the current aligner.** `local_align` in
  `crates/seqcore/src/align.rs` uses one byte of memory per cell, so a 10 kb read against
  a 10 kb plasmid would need about 100 MB. That needs its own alignment path.

## Tried on real reads (October 2026)

Three reads of synthetic nanobody clones against their parent, a phagemid whose CDRs are
stuffers that get replaced entirely in the library: one single clone, one
almost equal mix, and one mix whose second plasmid is weaker. The aligner was
re-implemented in a Node script with seqcore's scores, since Rust wasn't installed
locally; CI remains the final word.

- **Alignment holds across replaced CDRs**, with seqcore's default scores, even with
  a CDR3 longer than the stuffer. But the CDR edges come out wrong: in the equal
  mix an indel landed inside CDR1, giving 29 bases and a stop. **Turning the variable
  regions into N before aligning** fixed it (30 bases, as designed) and raised every
  score. Inserted bases next to a variable region (CDR3's extra bases) were put on
  the framework side, so an insertion next to a variable region must count as part of it.
- **Double peaks separate clearly.** Second peak as a share of the first, per CDR:
  single clone 0.04 on average (never above 0.10); weaker mix 0.32–0.38, about half the
  bases at 0.3 or more; equal mix 0.45, two-thirds of the bases. That suggests about 30%
  and 40% of the second plasmid, matching what the lab saw. In a single clone the end of
  the read also has double peaks (73 of 615 bases past the VHH), so the check must look
  at regions, not single bases.
- **Quality trimming hides mixes.** The equal mix was trimmed at base 419, so its read
  stops before CDR3. Today it would look "partly covered", not "mixed". Peaks have to be
  checked before trimming, and a mix has to be named as the reason.
- **A mix of clones with different CDR3 lengths** stays out of register for the rest of
  the read. The weaker mix had double peaks through FR4 and pIII, and its base calls
  looked like a frameshift in FR4. Mutation calls downstream of where a mix starts
  must be marked as unreliable, not reported.
- **The second clone can't be read reliably from one read.** In an equal mix the taller
  peak belongs to either clone at random, and the weaker clone's calls in the other mix
  had stops. Report the mix and its rough share; don't promise its sequence.
- **A region can come in a few known versions** as well as having free content, so
  variable regions need named alternatives too (phase 3).
- **The vector has an amber stop** between the HA tag and pIII, read as Q in TG1, so
  reading TAG as Q is needed from the start (phase 2).
- **Memory:** a parsed .ab1 takes about 1.6 MB in the page. That is 155 MB for 96
  reads, or 310 MB for 96 clones read both ways. Dropping `baseTraces` (per-base copies
  of the traces that the app never uses) and keeping traces as `Int16Array` brings it to
  about 150 kB per read: 29 MB for 192 reads.
- **A custom qualifier survives** saving and reopening with bio-parsers:
  `/strandivo_variable="…"` came back unchanged, and other apps' qualifiers (`ApEinfo_*`,
  `benchling_*`) set the precedent.

## Phases

### 0. Lighter reads

Drop `baseTraces` after parsing and keep the four traces as `Int16Array`
(`src/doc/fileio.ts`, `src/lib/types.ts`), so a plate of reads fits comfortably. Worth
doing on its own, before anything else.

**Done** (October 2026), as planned: `compactChromatogram` in `src/lib/chromatogram.ts`.
A raw parse keeps about 1.5 MB per read; a compact one holds 130 kB of traces (16,300
points per channel on a 3730) and about 30 kB of calls, peaks and qualities. bio-parsers
reads trace points as signed 16-bit values, so `Int16Array` keeps them exactly.

### 1. Clones and consensus

- **Grouping:** a pure `src/lib/clones.ts` guesses clones from file names
  (`A01_M13F.ab1` + `A01_M13R.ab1` → A01; plate wells; `clone3-F`). Unit tests cover the
  naming styles of the main sequencing providers. Users can regroup ("Group as one
  clone", "Split").
- **Consensus in Rust** (`crates/seqcore/`, which has the qualities):
  - Reads are sent with a clone key in the same alignment request.
  - The response adds a consensus per clone, with a quality for each base and the places
    where reads disagree.
  - Differences are reported per clone. Two good reads that disagree become a
    "conflict", not a mutation.
- **The Reads tab** lists clones, each with its reads. A clone with one read looks the
  same as a read does today, so ordinary plasmid checking just gains the consensus.
- **Tests:** `cargo test` on synthetic forward/reverse pairs, unit tests for the
  grouping, and an e2e check that adds two reads of one clone.

**Done** (October 2026). What turned out differently:

- **Provider naming styles aren't published.** Genewiz/Azenta, Eurofins and the others
  build file names from their tracking fields plus the lab's sample and primer names, and
  none documents the pattern. So `guessClones` reads structure instead: known primers and
  directions (M13F, M13(-21), T7term, pGEX-5, -F, _rev…), dates, plate wells and running
  numbers. It tries a few readings and keeps the one that pairs most reads without putting
  two reads that differ in nothing else together. The three library reads stay three
  clones. Real file names from more providers would make good test cases.
- **Regrouping is a clone picker** in the selected read's inspector ("On its own", "With
  …"), plus "Split into single reads" for a clone, rather than selecting several reads and
  choosing "Group as one clone". No right-click menu on reads yet.
- **The consensus** is a quality-weighted vote at each reference position, both on the
  base and on what is inserted before it. A column's quality is the agreeing reads' minus
  the others' (at most 90). It comes back as covered stretches holding the gapped
  reference, the gapped consensus, a quality and a read count per column, which is what
  region contents (phase 3) and "Open clone as file" (phase 2) need. Conflicts are base
  or insertion conflicts, with what each read says.
- **Reads without scores** (FASTA, .seq) count as good, so two of them that disagree are a
  conflict, never a mutation.

### 2. The clone table and the mutation list

- **A pure `src/lib/variants.ts`** takes the consensus and produces:
  - mutations in protein notation inside a CDS, or DNA notation outside one;
  - frameshift and stop flags;
  - covered and uncovered ranges;
  - a key for spotting identical clones.
- **The Clones layout:** rows show the clone, how many times it was seen, its status (OK,
  stop, frameshift, conflict, partly covered) and its mutations. Clicking a row shows its
  traces below. Identical clones collapse into one row.
- **Getting results out:** "Copy table" (tab-separated, like the current summary),
  protein and DNA FASTA of the unique clones, and "Open clone as file". The last one
  opens an unsaved tab through `ctx.openNew`; parts no read covered stay as the
  reference. It also suits directed evolution rounds: one round's winner becomes the
  next round's reference.
- **Keeping a check** (decision 1):
  - The app remembers, per file, the reads' paths and how they were grouped (kept by the
    app like Home's notes, so the file itself doesn't change), and aligns them again when
    the file is opened. Reads that moved or were deleted are named, not silently dropped.
  - "Save check…" writes a small file next to the reads: the reference file, the reads
    (paths relative to it), the clone groups and the settings used. Opening it opens the
    reference with those reads, on any computer that has the files.
- **Amber stops:** a setting reads TAG as Q, for suppressor strains such as TG1 and
  XL1-Blue (phage display). It applies wherever the app translates and names a change's
  effect, so a clone with TAG in a CDR isn't reported as truncated.

**Done** (October 2026). What turned out differently:

- **No separate layout.** The top of the Reads tab switches between the coverage map
  and the clone table ("Coverage | Clones 12"), which shows by default from 8 clones.
  The traces stay below either way, and the list on the left keeps one card per clone.
- **Identical means the same DNA**, with the same flags: TGA and TAG are both W163* but
  two different clones. Uncertain differences don't count.
- **Mutation names** are short and HGVS-like: W163R, W163*, L54=, L54fs, G50_S52del,
  T7_L8insYLG, …delins…, read codon by codon from the consensus, so two changes in one codon (NNK
  sites) are one amino-acid change. Outside a CDS they are written as the app writes
  DNA changes elsewhere (A2000G), not c.35A>G.
- **"Partly covered"** means a CDS the reads reach isn't read end to end; a clone's
  proteins have X where no read reached. "None in what was read" is shown instead of
  "None" then.
- **Getting results out:** "Copy table", "DNA" and "Protein" copy to the clipboard, like
  "Copy summary", rather than saving files. The DNA FASTA has one record per stretch a
  clone's reads cover.
- **Keeping a check:** the check file is JSON with a `.svcheck` extension (the Open dialog
  offers it and installers register it). It also keeps the quality settings, which the
  opened check uses until Settings change. Only groups the user made are saved; the rest
  are guessed again from the names. Reads that can't be found are named in a message,
  then left out.
- **Amber suppression** also lets ORFs run through TAG.
- **Grouping fix:** a plate named by well and construct (A01_bla … A06_bla) was read as
  one clone; dropping a well now only groups reads made with different primers.

### 3. Variable regions and positions

- **Marking:** the inspector marks a feature as "Variable", saved in the file as
  `/strandivo_variable` (decision 2). Its value is the design:
  - `any` when the region is replaced entirely (as with stuffer CDRs);
  - a pattern such as `NNK` when the parent doesn't spell it out with IUPAC codes;
  - a few named alternatives (`v1:TGGTTT…|v2:TGGGTT…`). A clone's region is matched to the closest one; the column shows its name,
    and differences from it are reported as mutations.
- **Alignment:** variable regions are turned into N before aligning, so their edges come
  out right whatever the clone has there.
- **Region contents** come from the alignment, including insertions next to the region.
  They are translated if the region is inside a CDS, and shown as bases otherwise.
- **Length changes** inside a variable region (loops of different lengths) count as
  expected. A change that isn't a multiple of 3 is still a frameshift.
- **Design violations** become a kind of their own ("not allowed by NNK at 412"),
  separate from mutations.
- **The table** gains a column per region. Residues that differ from the most common
  clone are highlighted, and identical ones are shown as dots. Users can group by a
  chosen region.
- **To check:** can the sequence editor type and keep IUPAC codes?

**Done** (October 2026). What turned out differently:

- **Masking holds in the real aligner.** With the CDRs as N, CDR1 and CDR2 are 30 bases in
  all three reads, the equal mix's CDR1 too (29 unmasked), and every score went up. Only
  differences are called against the parent's real bases, so a clone's contents come back
  as ordinary differences, with qualities and conflicts, and the app sets them apart.
- **Inserted bases next to a region** can tie: A01's extra CDR3 bases landed two bases
  into the framework after it, since both end in the same two bases. The core moves such a run into the region
  when that scores the same.
- **Region contents** come from the consensus columns. Bases below the quality threshold
  are lower case, and X in the amino acids, so the two mixes show mostly X in their CDRs
  until phase 4 names them as mixes.
- **Translated** when the region is a CDS or lies in one. In the library's file CDR3 is a
  `variation`, so it shows as bases; making it a CDS shows amino acids.
- **Versions** are matched by edit distance. Differences from the closest are numbered in
  its CDS (FR2 A5T); a length difference is one change ("v2 +3 bp"). On the real reads
  each clone comes out as the version the lab saw.
- **Patterns** come from the design, or from the parent's own IUPAC codes when the design
  is "any" and the parent spells them out. A stop in a region flags the clone but isn't
  listed as a mutation; its column shows the `*`.
- **Highlighting** compares with contents that two clones or more share and that have no
  uncertain base; with no such contents (three different clones) they are shown in full.
  "Group by" a region with versions groups by version name.
- **IUPAC codes**: yes, the sequence editor types and keeps them (`DNA_CHARS` in
  `src/lib/seqdata.ts`).

### 4. Mixed peaks

- **Detection:** `src/lib/chromatogram.ts` works out, for each base, the ratio of the
  second-highest trace peak to the highest. The traces are already in the page, so this
  is pure TypeScript with unit tests.
- **Flags:** a clone gets "mixed" when double peaks fall at variable or mutated
  positions. Scattered double peaks everywhere get "poor read" instead. Peaks are
  checked over the whole read, before trimming, because trimming cuts mixes short.
- **Thresholds from the test reads:** a second peak of 0.2 or more of the first, at a
  quarter or more of a region's bases, means mixed. The median share at those bases
  gives a rough share of the second plasmid ("mixed, about 30%").
- **Mutations after a mix starts** are marked as unreliable, since a length difference
  keeps the two clones out of register.
- **In the trace view**, the double-peak positions are marked.

**Done** (October 2026). What turned out differently:

- **The thresholds hold** on the real reads, with the second peak taken as each trace's
  highest point within two samples of the base's peak. The single clone stays at 0.10 or
  less in every region; the mixes have 0.2 or more at 60–85% of their CDR bases. The equal
  mix's CDR3, which trimming cut off, shows them too when its position is counted on
  from the alignment's end.
- **A mix starts** where a variable region has double peaks at a quarter of its bases and
  the 20 bases before it, in the direction the read runs, don't. Without regions, a double
  peak at a change among clean bases is a mix too (a point mutant with its parent). A
  noisy read has double peaks before the region as well, so it isn't called mixed.
- **The share** is worked out from the median second peak (r) at the double-peak bases as
  r / (1 + r), since there the second peak is the minor plasmid over the major. Taking r
  as the share, as the plan put it, would have said 45% and 70%; this gives 30% and 40%,
  what the lab saw.
- **Unreliable calls** are those with double peaks at a quarter or more of the 21 bases
  around them, in every read with a trace that covers them, rather than everything after
  a mix starts: two plasmids of the same length stay in register, and this also drops a
  single clone's noisy read ends. C01's "pIII N132fs" and its lac operator deletion near
  the read's start went away this way. Left-out changes are counted under the mutations.
- **A mix's regions** show as "mixed": the contents are two plasmids' calls, so no version
  or design check is made on them. A region of the equal mix with double peaks at under
  a quarter of its bases still shows its version.
- **"Poor read"** is a read whose 50-base windows mostly have double peaks at a quarter of
  their bases or more, outside a mix. None of the three test reads is one.

### 5. Views across clones

- **Recurring mutations:** a bar per position along the reference (or the protein),
  counting independent clones changed there. Clicking a bar lists the clones.
- **Library QC:**
  - mutations per kb, counting covered bases only;
  - transitions vs transversions;
  - the share of clones with stops or frameshifts, and of unique clones;
  - codons seen vs expected at degenerate positions.
- **"Copy summary"** for a lab notebook.

**Done** (October 2026). What turned out differently:

- **A third view, not a new layout.** The top of the Reads tab switches between "Coverage",
  "Clones 12" and "Summary". Its "Copy summary" gives the numbers as text with the date;
  on Coverage the button still copies the table of reads.
- **Mixed and unaligned clones are left out** of every number, and the view says how many
  were. On the real reads that leaves only the single clone, C01: 1 of 1 different and no
  mutations in about 0.6 kb, since its changes are among double peaks.
- **Independent clones means different clones**, by the clone table's key. That suits
  recurring mutations, transitions and transversions, and codons, but not the rate: with
  identical clones counted once, 90 unchanged clones and 6 mutants would count as 7 clones
  and the rate would come out about 14 times too high. So the rate and the share of broken
  clones count every clone.
- **Mutations per kb count covered bases that could show a change**: outside variable
  regions, and not where a call would be left out for double peaks. Quality isn't used,
  since a column has quality 0 for reads without scores.
- **A bar is a place, in clones that read it.** In a CDS that is the codon, so W163R and
  W163* share a bar. The list gives "2 of 5": different clones with the mutation, of those
  that read it, so a part few clones reach doesn't look unchanged. Bars closer than 4 pixels
  are drawn as one; choosing a CDS under "Along" spreads them out, by codon.
- **Expected codons** are what that many clones would show if each codon the pattern allows
  were equally likely: m(1 − (1 − 1/m)ⁿ) for m codons and n clones. Twelve clones can't show
  32 NNK codons, so "seen of allowed" alone would always look poor. Only regions in a CDS
  have sites; a clone counts at a site when its region has the designed length and the
  codon is read for certain.
- **A fix from phase 3:** on a reverse-strand CDS, a parent's own IUPAC codes turned into N
  when complemented, so its design was lost.

### 6. Whole-plasmid reads (Plasmidsaurus and similar)

- **Input:** accept FASTQ as well as FASTA and GenBank.
- **Alignment:** the read is circular and starts at an arbitrary point, so it is rotated
  to the reference's origin. It is then aligned with a banded alignment along a chain of
  seeds, a new path in `seqcore`.
- **Report:** full coverage, size differences, and homopolymer indels flagged as the
  usual nanopore error.
- **Coverage:** applies to both the ordinary Reads tab and clones.

**Done** (October 2026), on made-up reads only. What turned out differently:

- **Still needed: a real Plasmidsaurus result.** None is in `testdata/` yet; a maintainer
  will add one. When it arrives, check against it:
  - the homopolymer rule below, the one guess in this phase: which runs and indel sizes
    really are errors in an assembled plasmid, and whether errors also sit at methylated
    sites (GATC, CCWGG), as has been reported for nanopore reads;
  - whether its FASTQ has a read per plasmid with useful qualities, as the app assumes;
  - that the 80% rule below and the raw-reads limit suit what the files look like.
- **Long means over 1.6 kb without a trace.** A 3 kb limit would have sent a small plasmid
  such as pUC19 down the Sanger path. Length alone won't do: raw Sanger reads in `testdata/`
  reach 1,451 bases, so a read with a trace is never long.
- **Rotating needs no separate step before aligning.** Seeds that occur once in the
  reference place the read, and the most common offset unrolls it round the circle; only
  then is it turned, using a seed past the origin. That joins its ends, so a change at the
  read's start is seen as one change, and bases inserted at the origin are kept.
- **Alignment** fills in only the gaps between seeds in a chain, so a 20 kb plasmid takes well
  under a second. A long read is not quality-trimmed: a plasmid's ends are joined, and the app
  would otherwise cut what the read is for. Long stretches that aren't a whole plasmid (a
  PCR product, say) use the same path with free ends.
- **A whole plasmid** is a long read reaching 80% of a circular reference. A clone that
  lost more than that, around the origin, is shown as a part with the rest not covered,
  not as a deletion.
- **Homopolymers:** an indel of one or two bases in a run of five or more of one base is
  flagged and never confident, so it is listed as uncertain and doesn't become a mutation,
  unless a Sanger read of the clone shows it too. A real slip in a run stays visible, but
  needs a Sanger read to count.
- **Files:** FASTQ reads can be dropped on the window or added; FASTA and GenBank go
  through "Add reads…", since dropping those opens them as files. A FASTQ file of over 200
  reads is refused as raw reads, with a message: the app doesn't assemble.
- **Size differences** show on the read's card ("2,697 bp (+11)") and in the inspector.

### 7. Specialist extras (only if asked)

Antibody numbering (IMGT/Kabat) and finding CDRs automatically, and mapping parents for
DNA shuffling (several whole parents, unlike a region's alternatives).

## Decisions

1. **Should a clone check survive closing the tab?** Decided (October 2026): both. The
   app remembers each file's reads and aligns them again on opening, and a check file
   saved next to the reads is for sharing and for another computer. Built in phase 2.
   Memory isn't the problem once reads are lighter (phase 0); losing a plate's work on
   closing is. The options were:
   - The app remembers each file's reads by path (like Home's notes) and aligns them
     again on opening, which takes seconds. Nothing new to save, but it's tied to one
     computer.
   - A small "check" file saved next to the reads, listing the reads, clone groups and
     settings. It can be shared with colleagues and opened on another computer.
   - Both: the app remembers, and the check file is for sharing.
2. **How "variable" is saved:** decided. A `/strandivo_variable` qualifier on the
   feature, so it travels with the GenBank file.
3. **Test data:** decided. Three real reads (a single clone, an equal mix, a weaker mix)
   and their parent are in `testdata/library/`, described in `testdata/README.md`.
4. **Several scaffolds:** decided. A framework that comes in versions is a variable
   region with named alternatives (phase 3), not a separate parent file.

Each phase updates `AGENTS.md` for the conventions it adds (clones, variable regions),
and adds an e2e check for what users do.
