# User-facing text in Strandivo

Every string the app shows to users — dialog titles, notes, labels, hints, toasts, error
messages, button labels, placeholders, empty states and tooltips — listed by file with line
numbers. Use this as a map when reviewing or rewriting the copy.

Line numbers point to the string in the source; a string built from several parts is shown
assembled, with the line of the first part.

---

## Welcome window — `src/welcome.ts`

| Line | Where | Text |
|------|-------|------|
| 57 | dialog title (upgrade) | "New settings" |
| 57 | dialog title (first) | "Welcome to Strandivo" |
| 59 | dialog note (upgrade) | "New options in this version of Strandivo." |
| 60 | dialog note (first) | "Plan, build and check your plasmids. Your files and sequences stay on your computer." |
| 85 | section title | "Updates" |
| 86 | option label | "Check for updates automatically" |
| 86 | option note | "Checks once a day; updates install only when you choose." |
| 90 | section title | "Usage statistics" |
| 93 | option label | "Share anonymous usage statistics" |
| 94 | option note | "Which features are used and on which operating systems. Never your files, sequences, names or anything that identifies you." |
| 96 | button | "What is sent" |
| 100 | section title | "Your constructs" |
| 101 | paragraph | "Home lists the plasmid files in folders you choose and shows what each construct carries." |
| 104 | button | "Add a folder…" |
| 105 | fallback (no folder support) | "This browser can't keep folders between visits: Home lists only the files opened in this tab. Use Chrome, Edge or the desktop app to keep folders." |
| 113 | option label | "Start with common sequencing primers" |
| 113 | option note | "M13, T7, T3, SP6, CMV, BGH and other standard core-facility primers." |
| 115 | section title | "Primer library" |
| 116 | paragraph | "Each plasmid you open shows which of your lab's primers bind it." |
| 118 | button | "Import a list…" |
| 125 | note below all parts | "You can change all of this in Settings." |
| 126 | primary button (upgrade) | "Done" |
| 126 | primary button (first) | "Start using Strandivo" |

---

## Feedback dialog — `src/views/feedbackDialog.ts`

| Line | Where | Text |
|------|-------|------|
| 32 | placeholder (bug) | "Brief summary of what went wrong" |
| 33 | placeholder (idea) | "What you'd like Strandivo to do" |
| 34 | placeholder (question) | "What you'd like to know" |
| 42 | dialog title | "Send feedback" |
| 42 | dialog note | "Posts a public issue on Strandivo's GitHub. No GitHub account needed." |
| 48 | placeholder (details, crash) | "What you were doing when it quit, if you remember" |
| 48 | placeholder (details) | "What you did and what happened, or anything else that helps" |
| 49 | summary pre-filled (crash) | "Strandivo quit unexpectedly" |
| 50 | placeholder (email) | "you@lab.org" |
| 100 | status while sending | "Sending…" |
| 110 | retry button | "Try again" |
| 119 | toast (copied) | "Copied the report" |
| 120 | toast (copy failed) | "Couldn't copy the report" |
| 127 | toast (email fail) | "Couldn't open your mail app. Write to feedback@strandivo.com." |
| 132 | confirmation | "Thanks — sent as #…." |
| 133 | follow-up | "You can follow replies on GitHub." |
| 135 | warning (email not forwarded) | "Your email address or attached file couldn't be delivered. To get a reply, email feedback@strandivo.com with the issue number." |
| 154 | email hint | "Optional, if you'd like a reply. Shared only with the maintainer, never in the public issue." |
| 158 | section title | "Included with the report" |
| 160 | crash option label | "Crash details" |
| 160 | crash option note | "The crash log with file paths removed, shown below." |
| 161 | errors option note | "App errors from the past week, with file paths removed." |
| 163 | file option note | "Sent privately to the maintainer as GenBank, never in the public issue. Attach only sequences you're allowed to share." |

---

## Crash strip — `src/crash.ts`

| Line | Where | Text |
|------|-------|------|
| 42 | strip message | "Strandivo quit unexpectedly last time." |
| 43 | primary button | "Report it…" |
| 44 | button | "Dismiss" |

---

## Updates — `src/updates.ts`

| Line | Where | Text |
|------|-------|------|
| 59 | dialog title | "What's new in Strandivo …" |
| 60 | fallback when no notes | "Release notes for this version are on strandivo.com." |
| 62 | button | "More on strandivo.com" |
| 93 | strip (ready) | "Strandivo … is ready to install." |
| 94 | buttons | "Restart now" / "Later" |
| 98 | strip (available) | "Strandivo … is available." |
| 99 | buttons | "What's new…" / "Install and restart" / "Skip this version" / "Later" |
| 142 | toast (browser) | "Automatic updates are only in the desktop app." |
| 150 | toast (up to date) | "Strandivo is up to date." |
| 182 | strip (just updated) | "Strandivo was updated to …." |

---

## Settings — `src/settingsWindow.ts`

| Line | Where | Text |
|------|-------|------|
| 173 | section heading | "Maps" |
| 175 | setting label | "Label size" |
| 176 | setting hint | "Font size of labels on the circular map." |
| 180 | setting label | "Sequence letters" |
| 184 | option labels | "As in file" / "UPPER" / "lower" |
| 193 | setting label | "Show when opening a file" |
| 194 | setting hint | "Default visibility for newly opened files." |
| 207 | setting label | "Sidebar" |
| 208 | setting hint | "Order of sections in the left sidebar." |
| 222 | button | "Reset order" |
| 227 | setting label | "Open reading frames" |
| 228 | setting hint | "From a start codon to the next stop, on both strands. Shorter ORFs inside a longer one in the same frame are not shown." |
| 253 | checkbox | "Also start at GTG and TTG" |
| 257 | setting label | "Amber stop codon" |
| 258 | setting hint | "For amber suppressor strains such as TG1 and XL1-Blue (phage display). Applies to translations, ORFs and read differences." |
| 259 | checkbox | "Read TAG as Q" |
| 262 | setting label | "Feature detection" |
| 263 | setting hint | "Offer to scan for common plasmid parts when opening a file with few features." |
| 264 | checkbox | "Offer when a file looks unannotated" |
| 270 | section heading | "Primers" |
| 271 | setting label | "Tm method" |
| 271 | setting hint | "Used for all primer Tm calculations and primer design." |
| 273 | setting label | "Reaction conditions" |
| 274 | setting hint | "Used by the SantaLucia and Breslauer methods. Defaults match primer3." |
| 288 | button | "Reset to defaults" |
| 296 | section heading | "Sequencing results" |
| 298 | setting label | "Minimum quality" |
| 299 | setting hint | "Differences supported by bases below this Phred score are marked uncertain (Q20 = 1 error in 100)." |
| 313 | setting label | "Quality trimming" |
| 314 | setting hint | "How much of the noisy start and end of each read is ignored." |
| 321 | section heading | "Plasmid info" |
| 322 | setting label | "Lab fields" |
| 322 | setting hint | "Shown on every plasmid's Info tab, one per line. Values are saved inside each file." |
| 335 | button | "Restore default fields" |
| 342 | section heading | "Updates and privacy" |
| 344 | setting label | "Updates" |
| 345 | setting hint | "Checks updates.strandivo.com once a day and installs updates only when you choose." |
| 346 | checkbox | "Check for updates automatically" |
| 349 | setting label | "Usage statistics" |
| 350 | setting hint | "Which features are used and on which operating systems — never your files, sequences, names or anything that identifies you." |
| 354 | checkbox | "Share anonymous usage statistics" |
| 355 | button | "What is sent" |
| 367 | browser note | "These settings are saved in this browser, separate from the desktop app." |
| 383 | button | "Reset all settings" |

---

## Inspector — `src/views/inspector.ts`

| Line | Where | Text |
|------|-------|------|
| 280 | toast (position error) | "Enter a position from 1 to …." |
| 321 | protein warning | "Length isn't a multiple of 3 (… bp)." |
| 322 | protein note | "Doesn't start with ATG." |
| 497 | variable hint (pattern) | "IUPAC codes, repeated over the region (NNK: K is G or T). Bases the pattern doesn't allow are flagged." |
| 505 | variable hint (alternatives) | "One per line, as name: bases. Each clone is matched to the closest; differences from it are mutations." |
| 507 | variable hint (any) | "Clones can have any sequence or length here. Each clone's sequence is shown in its own column rather than called as mutations." |
| 516 | toast (delete feature) | "Deleted … (sequence bases kept)." |
| 566 | toast (site moved) | "This primer now binds … places; its site wasn't moved." / "This primer no longer binds the sequence; its site wasn't moved." |
| 670 | toast (saved to library) | "Saved … to the lab library." |
| 674 | toast (delete primer) | "Deleted …." |
| 725 | site note (1 cut) | "Cuts this sequence once" |
| 725 | site note (n cuts) | "Cuts this sequence … times" |
| 755 | orf note | "Detected from the sequence and not saved in the file. Add it as a feature to save it." |
| 847 | hint (nothing selected) | "Click a feature, primer or cut site to inspect it, or drag across the map or sequence to select bases." |
| 849 | status | "Cursor at … of …." |

---

## Home (construct library) — `src/home.ts`

| Line | Where | Text |
|------|-------|------|
| 94 | no-folders note | "This browser can't keep folders between visits: Home lists only the files opened in this tab. Use Chrome, Edge or the desktop app to keep folders." |
| 148 | hint | "Drop files anywhere to open them. To check sequencing results, open a construct and drop .ab1 files on it." |
| 299 | locked folder tooltip | "Allow access to read this folder again." |
| 306 | empty folders | "None yet." |
| 307 | link | "Add folder…" |
| 321 | empty recent | "Files you open appear here." |
| 343 | empty heading | "Construct library" |
| 345 | empty body (folders) | "Add the folders where you keep plasmid files (GenBank, SnapGene, FASTA) to browse them and their features." |
| 346 | empty body (no folders) | (same as line 94) |
| 382 | locked folder | "Showing cached files — allow access to refresh." / "Allow access to read this folder again." |
| 414 | allow button | "Allow access…" |
| 425 | note placeholder | "Add a note" |
| 427 | note tooltip | "A short note, kept in Strandivo. The Info tab's Notes field is saved in the file." |
| 437 | unreadable file | "Couldn't be read" |

---

## Detect features dialog — `src/views/detectDialog.ts`

| Line | Where | Text |
|------|-------|------|
| 29 | dialog title | "Detect features" |
| 30 | dialog note | "Common plasmid parts found in …." |
| 41 | progress | "Looking for known parts…" |
| 75 | empty heading | "No known parts found that aren't already annotated." |
| 76 | empty note | "The catalog holds the parts most plasmids carry; genes are also matched by the protein they encode." |
| 103 | toast (added) | "Added … features." |
| 110 | missing desktop | "Feature detection is only available in the desktop app." |
| 122 | stale sequence | "The sequence changed while searching. Close this and try again." |

---

## Primer dialogs — `src/views/primerDialogs.ts`

### Add from library

| Line | Where | Text |
|------|-------|------|
| 65 | dialog title | "Add from library" |
| 65 | dialog note | "Primers from your lab's library that bind …." |
| 66 | placeholder | "Search the library" |
| 79 | empty library | "Your primer library is empty. Add common sequencing primers or import a list." |
| 128 | no match | "No binding primer matches “…”." / "None of the library primers bind this sequence." |

### Copy for ordering

| Line | Where | Text |
|------|-------|------|
| 181 | toast (no primers) | "There are no primers to copy." |
| 184 | dialog title | "Copy for ordering" |
| 184 | dialog note | "Copy primer names and sequences to paste into a vendor order form or spreadsheet." |

### Add by sequence

| Line | Where | Text |
|------|-------|------|
| 274 | dialog title | "Add a primer by its sequence" |
| 274 | dialog note | "Finds where the primer binds on either strand, allowing 5′ tails and mismatches." |
| 286 | status (short) | "… bases; at least 15 at the 3′ end must match the sequence." |
| 287 | status (no bind) | "Doesn't bind this sequence (needs at least 15 matching bases at the 3′ end)." |
| 308 | toast (multiple) | "Binds … sites; added at the first (…)." |

### PCR product

| Line | Where | Text |
|------|-------|------|
| 375 | dialog title | "PCR product" |
| 375 | dialog note | "Check the product amplified from … by two primers." |
| 419 | hint (pick primers) | "Choose a forward and a reverse primer to see the product." |
| 421 | no product (circular) | "These primers don't make a product here." |
| 421 | no product (linear) | "These primers point away from each other on this linear sequence, so they make no product." |

### Design primers

| Line | Where | Text |
|------|-------|------|
| 506 | dialog title | "Design primers" |
| 506 | dialog note | "Design a primer pair with matched Tms and optional 5′ restriction sites." |
| 596 | no result | "No pair fits here (on a linear sequence the region may be too close to an end). Try a wider Tm or length range." |

---

## Cloning dialog — `src/views/cloningDialog.ts`

| Line | Where | Text |
|------|-------|------|
| 46 | method note (restriction) | "Cut the vector and the insert, then ligate the matching ends." |
| 47 | method note (gibson) | "Fragments join across 20 bp overlaps; PCR primers add any missing overlap, half on each side." |
| 48 | method note (infusion) | "The insert's primers carry 15 bases of each vector end." |
| 49 | method note (golden gate) | "A Type IIS enzyme cuts every part; their overhangs set the order." |
| 123 | dialog title | "Simulate cloning" |
| 123 | dialog note | "Assemble inserts into …." |
| 353 | empty source hint | "Open the insert's file in another tab, or choose a file." |
| 472 | ligation problem | "The insert's ends don't match the vector's, so they can't be ligated. Pick enzymes with matching overhangs, or blunt ends on both." |
| 486 | direction note | "The insert can ligate in either orientation — screen colonies by digest or sequencing." |
| 488 | self-ligation note | "The vector ends are compatible and may self-ligate; consider dephosphorylating the vector." |

---

## Digest dialog — `src/views/digestDialog.ts`

| Line | Where | Text |
|------|-------|------|
| 53 | dialog title | "Digest" |
| 53 | dialog note | "Choose enzymes to see the fragments and how they would run on a gel." |
| 337 | gel note | "Band brightness is proportional to fragment mass. Fragments within ~2% in size co-migrate as a single band." |

---

## Mutagenesis dialog — `src/views/mutagenesisDialog.ts`

| Line | Where | Text |
|------|-------|------|
| 57 | dialog title | "Mutagenesis primers" |
| 57 | dialog note | "Design whole-plasmid site-directed mutagenesis primers." |
| 34 | layout note (back-to-back) | "Q5-style (inverse PCR): 5′ ends meet at the mutation on the forward primer, followed by KLD (kinase-ligase-DpnI) circularization." |
| 35 | layout note (overlapping) | "QuikChange-style: complementary primers carry the mutation in the middle; DpnI digests the parental template." |
| 228 | warning (no room) | "The mutation is too close to the end of this linear sequence to place primers." |
| 242 | warning (linear) | "Both layouts are designed for circular plasmids, and this sequence is linear." |

---

## UniProt dialog — `src/views/uniprotDialog.ts`

| Line | Where | Text |
|------|-------|------|
| 37 | dialog title | "Get regions from UniProt" |
| 38 | dialog note | "Transmembrane helices, topological domains and signal peptides for …." |
| 104 | match note | "… identity across … of … residues." |
| 106 | identity warning | "Low sequence identity — check that this is the right UniProt entry." |
| 116 | empty | "UniProt lists no membrane regions or signal peptides for this entry." |
| 118 | citation | "Residue numbers are from UniProtKB (CC BY 4.0)." |
| 125 | input error | "Enter a UniProt accession, such as Q9UKG4, or a link to the entry." |
| 132 | not found | "UniProt has no sequence for …, so it may have been deleted or merged." |
| 139 | no match | "… doesn't match … (…), so its regions can't be mapped." |

---

## Toolbar and document — `src/doc/document.ts`

| Line | Where | Text |
|------|-------|------|
| 311 | tooltip | "Split view: map and sequence side by side" |
| 312 | tooltip | "Show sidebar: features, primers and enzymes" |
| 313 | tooltip | "Show inspector" |
| 328 | tooltip | "Add feature for the selection" |
| 329 | tooltip | "Detect common features…" |
| 330 | tooltip | "Add primer for the selection" |
| 331 | tooltip | "Digest…" |
| 332 | tooltip | "Simulate cloning…" |
| 333 | tooltip | "Export GenBank or FASTA" |
| 360 | detection offer (few features) | "This file has few features for its size. Look for known parts?" |
| 360 | detection offer (no features) | "This file has no features. Look for known parts?" |
| 361 | button | "Detect features…" |
| 362 | button | "Not now" |
| 487 | meta text | "… bp · circular/linear · … · edited" |
| 527 | status (cursor, empty) | "Type to insert bases on the Sequence tab" / "Empty sequence" |
| 547 | toast (no selection for feature) | "Select a region on the map or sequence first." |
| 567 | toast (no selection for primer) | "Select 10–80 bases to create a primer." |
| 612 | toast (format can't save) | "… files can't be written yet — saving a GenBank copy instead." |
| 622 | confirm (fasta loses data) | "FASTA files store only the sequence, so features and primers won't be saved. Save as FASTA anyway?" |
| 648 | toast (saved) | "Saved …" |
| 658 | toast (exported) | "Exported …" |
| 665 | choose title | "Export" |
| 665 | choose note | "Save a copy of this sequence in another format." |
| 706 | reads offer (browser ask) | "Allow browser access to load the reads previously aligned to this file." |
| 734 | reads offer (choose) | "Select the read files for this check — Strandivo will match them by filename." |
| 749 | toast (missing reads) | "… reads … couldn't be found (moved or deleted?): …" |
| 757 | toast (save first) | "Save this sequence first, so the check can point to it." |
| 761 | toast (no read files) | "Only reads loaded from files can be saved in a check." |
| 771 | toast (saved check) | "Saved …. Open it to see these reads again, here or on another computer." |
| 890 | toast (cross-origin revcomp) | "Selections that cross the origin can't be reverse-complemented." |
| 899 | toast (linear no origin) | "Only circular sequences have an origin." |
| 900 | toast (no caret for origin) | "Place the cursor where the sequence should start." |
| 1009 | confirm close title | "Save changes to …?" |
| 1010 | confirm close body | "Your changes will be lost if you don't save them." |
| 1093 | error heading | "Couldn't open …" |
| 1095 | error hint | "Supported: SnapGene .dna, GenBank (.gb/.gbk), FASTA, SBOL, GFF, Geneious, TeselaGen JSON and .ab1 traces." |
| 1096 | error follow-up | "If this is a valid file, please report it so the parser can be fixed." |

---

## Info tab — `src/doc/info.ts`

| Line | Where | Text |
|------|-------|------|
| 67 | toast (no reads yet) | "No reads are aligned yet — add them on the Reads tab." |
| 73 | toast (fill from reads) | "Filled in from sequencing results." |
| 119 | placeholder | "Description" |
| 237 | section heading | "Found in the features" |
| 238 | chip labels | "Resistance" / "Origins" / "Promoters" |
| 238 | chip empty | "none detected" |
| 259 | lab record note | "Saved in the GenBank file. Customize fields in Settings." |
| 274 | sequencing empty | "No reads aligned yet. Drop .ab1 files on the window to check this construct." |
| 286 | sequencing ok | "No confident differences from this sequence." |

---

## Primers tab — `src/views/primersView.ts`

| Line | Where | Text |
|------|-------|------|
| 120 | section title | "Binding sites" |
| 120 | note | "Forward primers above the line, reverse below" |
| 297 | footer (pairs) | "Forward and reverse primers that face each other. Tm: …." |
| 298 | footer (list) | "Lower-case bases are 5′ tails that don't bind. Tm: …." |
| 346 | pairs empty (< 2) | "Add at least one forward and one reverse primer to see pairs." |
| 347 | pairs empty (no pair) | "No forward and reverse primers face each other to form a PCR product." |
| 464 | list empty | "No primers yet. Add primers using the buttons above, or select bases on the map or sequence." |
| 471 | list note | "… primers · click a heading to sort, right-click a primer for more" |
| 473 | filter empty | "No primer matches “…”. " |
| 530 | checks pass | "All good" |

---

## Reads tab — `src/views/readsView.ts`

| Line | Where | Text |
|------|-------|------|
| 266 | empty heading | "Check sequencing reads against this sequence" |
| 267 | empty body | "Drop .ab1, .seq or FASTQ files anywhere on the window to align them and check for mutations." |
| 333 | no alignment | "No reads aligned to this sequence." |

### Clone flags

| Line | Where | Text |
|------|-------|------|
| 73 | unaligned | "No read aligned" |
| 74 | stop | "Stop" |
| 75 | frameshift | "Frameshift" |
| 76 | design | "Breaks design" |
| 77 | conflict | "Reads disagree" |
| 78 | mixed | "Mixed" |
| 79 | poor | "Poor read" |
| 80 | partial | "Partly covered" |

---

## Outline (sidebar) — `src/views/outline.ts`

| Line | Where | Text |
|------|-------|------|
| 293 | features empty | "No features yet. Select bases and press +." |
| 301 | primers empty | "No primers yet." |
| 311 | enzymes empty (none) | "Enzymes are hidden." |
| 311 | enzymes empty (filter) | "No matching enzymes." |
| 311 | enzymes empty (lab error) | "The enzyme library couldn't be loaded." |
| 311 | enzymes empty (lab empty) | "Your lab enzyme library is empty." |
| 311 | enzymes empty (no cuts) | "None of these enzymes cut." |

---

## Search — `src/views/search.ts`

| Line | Where | Text |
|------|-------|------|
| 51 | placeholder | "Find bases, features, primers" |
| 150 | results count | "… matches · Enter for next" / "No matches" |

---

## Primer library window — `src/libraryWindow.ts`

| Line | Where | Text |
|------|-------|------|
| 64 | paste placeholder | "Paste a list: one primer per line, name and sequence (and notes) separated by tabs or commas. FASTA works too." |
| 99 | toast (bad sequence) | "Enter a sequence of at least 6 bases." |
| 124 | toast (export) | "Exported … primers." |
| 131 | confirm (remove) | "Remove …? Plasmids that already use this primer will keep their copy." |
| 150 | toast (bad bases) | "A sequence needs at least 6 bases (A, C, G, T or IUPAC codes)." |
| 172 | empty | "Add your lab's primers to automatically see where they bind on any plasmid you open." |
| 179 | empty note | "Includes M13, T7, T3, SP6, CMV, BGH, pBAD, pGEX, EGFP and other standard core-facility primers." |
| 232 | subtitle (desktop) | "Your lab's primers." |
| 232 | subtitle (browser) | "Your lab's primers (saved in this browser — Export… to keep a backup)." |

---

## Enzyme library window — `src/enzymeLibraryWindow.ts`

| Line | Where | Text |
|------|-------|------|
| 63 | toast (unknown enzyme) | "Unknown enzyme “…”. Choose a standard name from the list." |
| 93 | guidance | "Pick the exact isoschizomer for the cut site and overhang (e.g. Acc65I vs. KpnI), and put the vendor name or HF version in Product / supplier." |
| 112 | import dialog | "Add … stock records to your current list, or replace all …?" |
| 139 | confirm (remove) | "Remove …? Remove this enzyme from your lab's stock list?" |
| 143 | confirm (start new) | "The unreadable file will be kept alongside the new list as a backup." |
| 232 | empty | "Track your lab's restriction enzymes and freezer locations. Select “Lab enzymes” on a map to show only their cut sites." |
| 250 | unknown enzyme in list | "Not in this version's enzyme list" |
| 286 | subtitle (desktop) | "Your lab's restriction enzyme stock." |
| 286 | subtitle (browser) | "Your lab's restriction enzyme stock (saved in this browser — Export… to keep a backup)." |

---

## Primer checks — `src/lib/primers.ts`

| Line | Where | Text |
|------|-------|------|
| 543 | 3′ change (at end) | "The 3′ end base doesn't pair with the template, so extension may fail." |
| 543 | 3′ change (near end) | "A change … bases from the 3′ end may stop extension." |
| 547 | not ACGT | "Contains bases other than A, C, G and T, so the Tm can't be calculated." |
| 548 | low Tm | "Tm is … °C — below 52 °C may anneal poorly." |
| 549 | high Tm | "Tm is … °C — above 72 °C." |
| 553 | Tm mismatch | "Tm differs from its partner by … °C (aim for under 5 °C)." |
| 558 | low/high GC | "GC content is …% (aim for 40–60%)." |
| 563 | no 3′ G/C | "No G or C in the last two bases at the 3′ end." |
| 564 | GC-rich 3′ | "More than three G/C in the last five bases can cause mispriming." |
| 568 | long run | "Has a run of … identical bases." |
| 572 | self-dimer | "The 3′ end can pair with itself over … bases." |
| 577 | no site | "Doesn't bind this sequence." |
| 578 | multi-site | "Binds … places in this sequence." |
| 593 | tail binds | "… bases of the 5′ tail also match this sequence at …, so the primer may prime there as well." |

---

## Tm methods — `src/lib/primers.ts`

| Line | Where | Text |
|------|-------|------|
| 39 | label | "SantaLucia 1998 (default)" |
| 41 | about | "Nearest-neighbour method. Gives the same Tm as primer3, and close to NEB's and most current calculators." |
| 45 | label | "Breslauer 1986" |
| 47 | about | "An older nearest-neighbour method (early primer3 versions, some vendors). Usually a few °C higher." |
| 51 | label | "Wallace rule (quick estimate)" |
| 53 | about | "2 °C for each A or T and 4 °C for each G or C. For short primers; ignores salt and concentration." |
| 57 | label | "Basic GC formula" |
| 59 | about | "64.9 + 41 × (G+C − 16.4) / length, or the Wallace rule below 14 bases. Ignores salt and concentration." |

---

## Feedback report validation — `src/lib/feedback.ts`

| Line | Where | Text |
|------|-------|------|
| 169 | validation | "The report is empty." |
| 172 | validation | "Choose bug, idea or question." |
| 173 | validation | "Add a summary." |
| 174 | validation | "Keep the summary to one line of 150 characters." |
| 175 | validation | "Keep the details under 8000 characters." |
| 176 | validation | "That email address doesn't look right." |

---

## App menu — `src/lib/appMenu.ts`

| Line | Where | Text |
|------|-------|------|
| 26 | File menu | "New Sequence" / "Open…" / "Save" / "Save As…" / "Export GenBank…" / "Export FASTA…" / "Close Tab" / "Settings…" |
| 41 | Edit menu | "Undo" / "Redo" / "Select All" / "Find…" / "Reverse Complement" / "Set Origin at Cursor" |
| 55 | View menu | "Map" / "Sequence" / "Primers" / "Sequencing Reads" / "Plasmid Info" / "Map and Sequence Side by Side" / "Show or Hide Sidebar" / "Show or Hide Inspector" |
| 68 | Tools menu | "Add Feature from Selection" / "Add Primer from Selection" / "Detect Features…" / "Digest…" / "Simulate Cloning…" / "Align Sequencing Reads…" |
| 80 | Window menu | "Home: Constructs" / "Primer Library" / "Enzyme Library" |
| 88 | Help menu | "Send Feedback…" / "Report a Bug…" / "Welcome to Strandivo…" / "Strandivo Website" / "Strandivo on GitHub" |

---

## Context menus — `src/lib/contextMenu.ts`

| Line | Where | Text |
|------|-------|------|
| 121 | selection | "Copy" / "Copy reverse complement" / "Add forward primer" / "Add reverse primer" / "Design primers to amplify…" / "Mutagenesis primers…" / "Add feature" / "Reverse-complement selection" / "Delete bases" |
| 139 | feature | "Copy DNA" / "Copy protein" / "Design primers to amplify…" / "Rename…" / "Delete feature" |
| 169 | primer | "Copy sequence" / "Copy for ordering" / "Show on map" / "Show in sequence" / "Show in Primers tab" / "PCR product…" / "Save to library" / "In the lab library" / "Make it a reverse primer" / "Make it a forward primer" / "Rename…" / "Delete primer" |
| 188 | cut site | "Copy recognition site" / "Digest with …" |
| 190 | ORF | "Copy DNA" / "Copy protein" / "Add as feature" |
| 193 | cursor | "Select all" / "Set origin here" / "Reverse-complement sequence" |
| 222 | reads: read | "Copy sequence" / "Move to clone" / "Take out of clone" / "Remove read" |
| 231 | reads: clone | "Copy consensus" / "Open clone as file" / "Split into single reads" / "Remove clone" |
| 240 | reads: many | "Group into one clone" / "Remove … reads" |
