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
| 58 | dialog title (upgrade) | "Something new to choose" |
| 58 | dialog title (first) | "Welcome to Strandivo" |
| 60 | dialog note (upgrade) | "This version of Strandivo asks about something it didn't before. Nothing changes until you choose." |
| 61 | dialog note (first) | "Plan, build and check your plasmids. Everything runs on your computer: your files and sequences never leave it." |
| 86 | section title | "Updates" |
| 86 | option label | "Check for updates automatically" |
| 86 | option note | "Once a day, Strandivo asks its server for the latest version. An update installs only when you choose." |
| 91 | section title | "Usage statistics" |
| 93 | option label | "Share anonymous usage statistics" |
| 94 | option note | "Which features are used, and on which systems, so work goes where it helps most. Never your files, sequences or names, and nothing that tells you apart." |
| 97 | button | "What is sent" |
| 101 | section title | "Your constructs" |
| 101 | paragraph | "Home lists the plasmid files in folders you choose, with what each one carries. The files stay where they are." |
| 105 | button | "Add a folder…" |
| 106 | fallback (no folder support) | "This browser can't keep folders: Home lists the files you open until you close the page. Chrome, Edge or the desktop app can list whole folders." |
| 113 | option label | "Start with common sequencing primers" |
| 113 | option note | "M13, T7, T3, SP6, CMV, BGH and others, as university sequencing cores list them." |
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
| 32 | placeholder (bug) | "What went wrong, in a line" |
| 33 | placeholder (idea) | "What you'd like Strandivo to do" |
| 34 | placeholder (question) | "What you'd like to know" |
| 42 | dialog title | "Send feedback" |
| 42 | dialog note | "It goes to Strandivo's maintainer as an issue on GitHub, which anyone can read. You don't need a GitHub account." |
| 48 | placeholder (details, crash) | "What you were doing when it quit, if you remember" |
| 48 | placeholder (details) | "What you did and what happened, or anything else that helps" |
| 49 | summary pre-filled (crash) | "Strandivo quit unexpectedly" |
| 50 | placeholder (email) | "you@lab.org" |
| 100 | status while sending | "Sending…" |
| 110 | retry button | "Try again" |
| 119 | toast (copied) | "Copied the report" |
| 120 | toast (copy failed) | "Couldn't copy the report" |
| 127 | toast (email fail) | "Couldn't open your mail app. Write to feedback@strandivo.com." |
| 132 | confirmation | "Thanks: sent as #…." |
| 133 | follow-up | "You can follow it on GitHub, where the maintainer answers." |
| 135 | warning (email not forwarded) | "Your email address or file couldn't be passed on to the maintainer. If you'd like an answer, write to feedback@strandivo.com and mention the issue's number." |
| 154 | email hint | "Only if you'd like an answer. It goes to the maintainer alone, never in the issue." |
| 158 | section title | "Sent with it" |
| 160 | crash option label | "Why it quit" |
| 160 | crash option note | "What Strandivo noted as it quit, with file paths removed. It is sent as shown below." |
| 161 | errors option note | "What went wrong in the app this past week, with file paths removed. Shown below when ticked." |
| 163 | file option note | "As GenBank, to the maintainer alone by email, not in the issue. Sequences can be confidential: attach only what you may share." |

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
| 60 | fallback when no notes | "The notes for this version are on strandivo.com." |
| 62 | button | "More on strandivo.com" |
| 93 | strip (ready) | "Strandivo … is ready to install." |
| 94 | buttons | "Restart now" / "Later" |
| 98 | strip (available) | "Strandivo … is available." |
| 99 | buttons | "What's new…" / "Install and restart" / "Skip this version" / "Later" |
| 143 | toast (browser) | "Updates come with the desktop app." |
| 150 | toast (up to date) | "Strandivo is up to date." |
| 182 | strip (just updated) | "Strandivo was updated to …." |

---

## Settings — `src/settingsWindow.ts`

| Line | Where | Text |
|------|-------|------|
| 176 | section heading | "Maps" |
| 177 | setting label | "Label size" |
| 177 | setting hint | "Circular map labels. The slider on the map changes it too." |
| 193 | setting label | "Sequence letters" |
| 194 | option labels | "As in file" / "UPPER" / "lower" |
| 195 | setting label | "Show when opening a file" |
| 196 | setting hint | "Each open file can still switch them with the buttons above its map and sequence." |
| 207 | setting label | "Sidebar" |
| 208 | setting hint | "The order of the sections left of a file. You can also drag a section's heading there, or click it to fold the section." |
| 222 | button | "Reset order" |
| 228 | setting label | "Open reading frames" |
| 228 | setting hint | "From a start codon to the next stop, on both strands. Shorter ORFs inside a longer one in the same frame are not shown." |
| 253 | checkbox | "Also start at GTG and TTG" |
| 257 | setting label | "Amber stop codon" |
| 258 | setting hint | "Suppressor strains such as TG1 and XL1-Blue, used for phage display, read TAG as glutamine. Applies to translations, ORFs and the effect of changes found in reads." |
| 259 | checkbox | "Read TAG as Q" |
| 263 | setting label | "Feature detection" |
| 264 | setting hint | "When a file opens with few features for its size, offer to look for common parts. The search runs on your computer, and nothing is added unless you choose it." |
| 265 | checkbox | "Offer when a file looks unannotated" |
| 270 | section heading | "Primers" |
| 271 | setting label | "Tm method" |
| 271 | setting hint | "Used for every Tm in the app: the inspector, the status bar, primer tables and primer design." |
| 274 | setting label | "Reaction conditions" |
| 274 | setting hint | "Your PCR's salt, Mg²⁺, dNTPs and primer concentration, used by the SantaLucia and Breslauer methods. The defaults are the ones primer3 uses." |
| 289 | button | "Reset to defaults" |
| 297 | section heading | "Sequencing results" |
| 299 | setting label | "Minimum quality" |
| 299 | setting hint | "Differences supported by bases below this Phred score are marked uncertain (Q20 = 1 error in 100)." |
| 313 | setting label | "Quality trimming" |
| 314 | setting hint | "How much of the noisy start and end of each read is ignored." |
| 322 | section heading | "Plasmid info" |
| 322 | setting label | "Lab fields" |
| 322 | setting hint | "Shown on every plasmid's Info tab, one per line. Values are saved inside each file." |
| 336 | button | "Restore default fields" |
| 342 | section heading | "Updates and privacy" |
| 345 | setting label | "Updates" |
| 345 | setting hint | "Once a day, Strandivo asks updates.strandivo.com for the latest version, telling it your version and system; it keeps no record of who asked. An update installs only when you choose." |
| 346 | checkbox | "Check for updates automatically" |
| 350 | setting label | "Usage statistics" |
| 350 | setting hint | "Which features are used, and on which systems: never your files, sequences or names, and nothing that tells you apart. Turning it off stops it at once." |
| 354 | checkbox | "Share anonymous usage statistics" |
| 355 | button | "What is sent" |
| 367 | browser note | "Your browser keeps these settings, apart from the desktop app's." |
| 383 | button | "Reset all settings" |
| 385 | footer note | "Changes apply to open windows straight away." |

---

## Inspector — `src/views/inspector.ts`

| Line | Where | Text |
|------|-------|------|
| 280 | toast (position error) | "Enter a position from 1 to …." |
| 321 | protein warning | "Length isn't a multiple of 3 (… bp)." |
| 322 | protein note | "Doesn't start with ATG." |
| 497 | variable hint (pattern) | "IUPAC codes, repeated over the region (NNK: K is G or T). Bases the pattern doesn't allow are flagged." |
| 504 | variable hint (alternatives) | "One per line, as name: bases. Each clone is matched to the closest; differences from it are mutations." |
| 507 | variable hint (any) | "Clones may have anything here, of any length. Each clone's bases show in a column of their own, not as mutations." |
| 516 | toast (delete feature) | "Deleted … (the bases are still there). Undo to bring it back." |
| 567 | toast (site moved) | "This primer now binds … places; its site wasn't moved." / "This primer no longer binds the sequence; its site wasn't moved." |
| 670 | toast (saved to library) | "Saved … to the lab library." |
| 675 | toast (delete primer) | "Deleted …. Undo to bring it back." |
| 725 | site note (1 cut) | "Cuts this sequence once" |
| 725 | site note (n cuts) | "Cuts this sequence … times" |
| 755 | orf note | "Found in the sequence, not saved with the file. Add it as a feature to keep it." |
| 846 | hint (nothing selected) | "Click a feature, primer or enzyme to see it here. Drag across the map or the sequence to select bases; type to insert bases at the cursor." |
| 528 | status | "Cursor at … of …." |

---

## Home (construct library) — `src/home.ts`

| Line | Where | Text |
|------|-------|------|
| 95 | no-folders note | "This browser can't keep folders. Files you open are listed until you close the page. Chrome, Edge or the desktop app can list whole folders." |
| 148 | hint | "Drop files anywhere to open them. To check sequencing results, open a construct and drop .ab1 files on it." |
| 306 | empty folders | "None yet." |
| 308 | link | "Add folder…" |
| 321 | empty recent | "Files you open appear here." |
| 343 | empty heading | "Your constructs in one place" |
| 345 | empty body (folders) | "Add the folders where you keep plasmid and construct files (GenBank, SnapGene, FASTA). Home lists every file in them and their subfolders, with what each construct carries and a note you can add." |
| 347 | empty body (no folders) | (same as line 95) |
| 383 | locked folder | "Shown as last read: your browser asks before Strandivo reads it again." / "Your browser asks before Strandivo reads it again." |
| 414 | allow button | "Allow access…" |
| 425 | note placeholder | "Add a note" |
| 427 | note tooltip | "A short note, kept in Strandivo. The Info tab's Notes field is saved in the file." |
| 437 | unreadable file | "Couldn't be read" |

---

## Detect features dialog — `src/views/detectDialog.ts`

| Line | Where | Text |
|------|-------|------|
| 30 | dialog title | "Detect features" |
| 31 | dialog note | "Common parts found in …. Nothing is added until you choose it." |
| 41 | progress | "Looking for known parts…" |
| 73 | empty heading | "No known parts found that aren't already annotated." |
| 77 | empty note | "The catalog holds the parts most plasmids carry. A part that was codon-optimized is only found once protein matching lands." |
| 104 | toast (added) | "Added … features. Undo takes them all back." |
| 111 | missing desktop | "Feature detection needs the desktop app, where the sequence is searched on your computer." |
| 123 | stale sequence | "The sequence changed while searching. Close this and try again." |

---

## Primer dialogs — `src/views/primerDialogs.ts`

### Add from library

| Line | Where | Text |
|------|-------|------|
| 64 | dialog title | "Add from library" |
| 64 | dialog note | "Primers from your lab's library that bind …." |
| 65 | placeholder | "Search the library" |
| 78 | empty library | "Your primer library is empty. Start with the common sequencing primers, or import your lab's list in the library window." |
| 128 | no match | "No primer that binds matches …." / "None of the library primers bind this sequence." |

### Copy for ordering

| Line | Where | Text |
|------|-------|------|
| 183 | toast (no primers) | "There are no primers to copy." |
| 184 | dialog title | "Copy for ordering" |
| 184 | dialog note | "Choose the primers to order. Their names and sequences are copied, ready to paste into an order form or a spreadsheet." |

### Add by sequence

| Line | Where | Text |
|------|-------|------|
| 274 | dialog title | "Add a primer by its sequence" |
| 274 | dialog note | "Strandivo finds where it binds, on either strand. A 5′ tail that doesn't match is fine, and so are changes for mutagenesis." |
| 287 | status (short) | "… bases; at least 15 at the 3′ end must match the sequence." |
| 288 | status (no bind) | "It doesn't bind this sequence (at least 15 bases at its 3′ end must match)." |
| 308 | toast (multiple) | "It binds … places; added at the first (…)." |

### PCR product

| Line | Where | Text |
|------|-------|------|
| 374 | dialog title | "PCR product" |
| 374 | dialog note | "What two primers amplify from …: from this plasmid or the lab library." |
| 419 | hint (pick primers) | "Pick a forward and a reverse primer to see what they make." |
| 421 | no product (circular) | "These primers don't make a product here." |
| 421 | no product (linear) | "These primers point away from each other on this linear sequence, so they make no product." |

### Design primers

| Line | Where | Text |
|------|-------|------|
| 506 | dialog title | "Design primers" |
| 506 | dialog note | "A pair that amplifies exactly the region, with matched Tms and optional restriction sites at its ends." |
| 596 | no result | "No pair fits here (on a linear sequence the region may be too close to an end). Try a wider Tm or length range." |

---

## Cloning dialog — `src/views/cloningDialog.ts`

| Line | Where | Text |
|------|-------|------|
| 47 | method note (restriction) | "Cut the vector and the insert, then ligate the matching ends." |
| 48 | method note (gibson) | "Pieces join on 20 bp overlaps; primers add any that are missing, half on each side." |
| 49 | method note (infusion) | "The insert's primers carry 15 bases of each vector end." |
| 50 | method note (golden gate) | "A Type IIS enzyme cuts every part; their overhangs set the order." |
| 123 | dialog title | "Simulate cloning" |
| 123 | dialog note | "… is the vector. Inserts come from your other open files, or choose one here." |
| 353 | empty source hint | "Open the insert's file in another tab, or choose a file." |
| 473 | ligation problem | "The insert's ends don't match the vector's, so they can't be ligated. Pick enzymes with matching overhangs, or blunt ends on both." |
| 486 | direction note | "The insert's ends fit either way round, so colonies will have both directions: check them by sequencing or a digest." |
| 488 | self-ligation note | "The opened vector's ends match each other, so it can close without an insert. Dephosphorylating it helps." |

---

## Digest dialog — `src/views/digestDialog.ts`

| Line | Where | Text |
|------|-------|------|
| 53 | dialog title | "Digest" |
| 53 | dialog note | "Choose enzymes to see the fragments and how they would run on a gel." |
| 337 | gel note | "Band brightness follows the amount of DNA. Fragments within about 2% of each other's size run as one band." |

---

## Mutagenesis dialog — `src/views/mutagenesisDialog.ts`

| Line | Where | Text |
|------|-------|------|
| 57 | dialog title | "Mutagenesis primers" |
| 57 | dialog note | "A primer pair that makes a change in the plasmid as it copies the whole of it." |
| 34 | layout note (back-to-back) | "As Q5 site-directed mutagenesis: the primers' 5′ ends meet at the change, which the forward primer carries. The product is the whole plasmid; a kinase-ligase-DpnI step closes it." |
| 35 | layout note (overlapping) | "As QuikChange: two complementary primers with the change in the middle copy the whole plasmid; DpnI then removes the template." |
| 229 | warning (no room) | "There's no room for the primers here: the change is too near an end of this linear sequence." |
| 244 | warning (linear) | "Both layouts copy a whole plasmid, and this sequence is linear." |

---

## UniProt dialog — `src/views/uniprotDialog.ts`

| Line | Where | Text |
|------|-------|------|
| 38 | dialog title | "Get regions from UniProt" |
| 39 | dialog note | "Transmembrane helices, topological domains and signal peptides for …. Nothing is added until you choose it." |
| 104 | match note | "… of the CDS's protein matches, over … of the entry's … residues." |
| 107 | identity warning | "That is far from identical, so check that this is the right entry." |
| 117 | empty | "UniProt lists no membrane regions or signal peptides for this entry." |
| 119 | citation | "Numbers are UniProt's. Data from UniProtKB, CC BY 4.0." |
| 127 | input error | "Enter a UniProt accession, such as Q9UKG4, or a link to the entry." |
| 133 | not found | "UniProt has no sequence for …, so it may have been deleted or merged." |
| 139 | no match | "… doesn't look like …: …, so its regions can't be placed." |

---

## Toolbar and document — `src/doc/document.ts`

| Line | Where | Text |
|------|-------|------|
| 311 | tooltip | "Split view: map and sequence side by side" |
| 312 | tooltip | "Show sidebar: features, primers and enzymes" |
| 313 | tooltip | "Show inspector" |
| 329 | tooltip | "Add feature for the selection" |
| 329 | tooltip | "Detect features: find common parts to add" |
| 331 | tooltip | "Add primer for the selection" |
| 332 | tooltip | "Digest…" |
| 332 | tooltip | "Simulate cloning…" |
| 333 | tooltip | "Export GenBank or FASTA" |
| 360 | detection offer (few features) | "This file has few features for its size. Look for known parts?" |
| 360 | detection offer (no features) | "This file has no features. Look for known parts?" |
| 361 | button | "Detect features…" |
| 362 | button | "Not now" |
| 488 | meta text | "… bp · circular/linear · … · edited" |
| 527 | status (cursor, empty) | "Type to insert bases on the Sequence tab" / "Empty sequence" |
| 547 | toast (no selection for feature) | "Select the bases for the new feature first (drag across the map or the sequence)." |
| 567 | toast (no selection for primer) | "Select 10–80 bases to make a primer from (it reads along the top strand; flip it in the inspector)." |
| 612 | toast (format can't save) | "… files can't be written yet — saving a GenBank copy instead." |
| 622 | confirm (fasta loses data) | "FASTA files store only the sequence, so features and primers won't be saved. Save as FASTA anyway?" |
| 648 | toast (saved) | "Saved …" |
| 658 | toast (exported) | "Exported …" |
| 665 | choose title | "Export" |
| 665 | choose note | "Save a copy of this sequence in another format." |
| 706 | reads offer (browser ask) | "Your browser asks before Strandivo reads the reads checked against this file before." |
| 735 | reads offer (choose) | "Your browser opens only files you choose. Strandivo matches them to the check by name." |
| 749 | toast (missing reads) | "… reads … couldn't be found (moved or deleted?): …" |
| 757 | toast (save first) | "Save this sequence first, so the check can point to it." |
| 762 | toast (no read files) | "Only reads opened from files can go in a check." |
| 771 | toast (saved check) | "Saved …. Open it to see these reads again, here or on another computer." |
| 890 | toast (cross-origin revcomp) | "Select a stretch that doesn't cross the origin to reverse-complement it." |
| 899 | toast (linear no origin) | "Only a circular sequence has an origin to move." |
| 900 | toast (no caret for origin) | "Put the cursor where the sequence should start." |
| 1009 | confirm close title | "Save changes to …?" |
| 1010 | confirm close body | "Your changes will be lost if you don't save them." |
| 1093 | error heading | "Couldn't open …" |
| 1095 | error hint | "Supported: SnapGene .dna, GenBank (.gb/.gbk), FASTA, SBOL, GFF, Geneious, TeselaGen JSON and .ab1 traces." |
| 1096 | error follow-up | "If this is a valid file, please report it so the parser can be fixed." |

---

## Info tab — `src/doc/info.ts`

| Line | Where | Text |
|------|-------|------|
| 68 | toast (no reads yet) | "No reads are aligned yet — add them on the Reads tab." |
| 74 | toast (fill from reads) | "Filled in from the sequencing results — check and adjust if needed." |
| 119 | placeholder | "Description (what this plasmid is for)" |
| 238 | section heading | "Found in the features" |
| 239 | chip labels | "Resistance" / "Origins" / "Promoters" |
| 239 | chip empty | "none detected" |
| 259 | lab record note | "Saved inside the file, so it travels with the plasmid. Change the list of fields in Settings." |
| 274 | sequencing empty | "No reads checked in this window yet. Drop .ab1 files on the window to check this plasmid against them." |
| 286 | sequencing ok | "No confident differences from this sequence." |

---

## Primers tab — `src/views/primersView.ts`

| Line | Where | Text |
|------|-------|------|
| 120 | section title | "Binding sites" |
| 120 | note | "Forward primers above the line, reverse below" |
| 298 | footer (pairs) | "A pair is a forward and a reverse primer that face each other. Tm: …." |
| 299 | footer (list) | "Lower-case bases are 5′ tails that don't bind. Tm: …." |
| 346 | pairs empty (< 2) | "Pairs need a forward and a reverse primer in this file." |
| 348 | pairs empty (no pair) | "No forward and reverse primer here face each other closely enough to amplify anything." |
| 464 | list empty | "No primers yet. Add them from your lab's library, by sequence, or design a pair; or select bases and choose "Add primer from selection"." |
| 471 | list note | "… primers · click a heading to sort, right-click a primer for more" |
| 473 | filter empty | "No primer matches "…". The filter looks at names, notes and sequences." |
| 530 | checks pass | "All good" |

---

## Reads tab — `src/views/readsView.ts`

| Line | Where | Text |
|------|-------|------|
| 265 | empty heading | "Check sequencing reads against this sequence" |
| 266 | empty body | "Drop .ab1 trace files (or .seq and FASTQ reads) on this window, or add them here. Reads are quality-trimmed, aligned on both strands, and every difference is listed with its effect on your features." |
| 269 | empty note | "Everything runs on this computer — nothing is uploaded." |
| 337 | no alignment | "No reads aligned, so there is nothing to show here." |

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
| 99 | toast (bad sequence) | "Enter the sequence as bases (at least 6)." |
| 124 | toast (export) | "Exported … primers. Open it in a spreadsheet, or import it on another computer." |
| 131 | confirm (remove) | "Remove …? It goes from the library on this computer. Plasmids that already have it keep their copy." |
| 151 | toast (bad bases) | "A sequence needs at least 6 bases (A, C, G, T or IUPAC codes)." |
| 171 | empty | "Keep your lab's primers here. Each plasmid you open then shows which of them bind it, and adds them in one click." |
| 179 | empty note | "Common primers are M13, T7, T3, SP6, CMV, BGH, pBAD, pGEX and EGFP, as listed by university sequencing cores. Check them against your own provider's list." |
| 231 | subtitle | "Your lab's primers, kept on this computer. / Your lab's primers, kept by this browser. Export… to keep a copy." |
| 231 | subtitle cont. | "Plasmids you open show which of them bind." |

---

## Enzyme library window — `src/enzymeLibraryWindow.ts`

| Line | Where | Text |
|------|-------|------|
| 63 | toast (unknown enzyme) | "Strandivo doesn't know an enzyme called "…". Choose one from the list." |
| 93 | guidance | "Choose the enzyme as its recognition and cut are known, such as Acc65I rather than KpnI. Record the supplier's product name separately, including an HF or other version." |
| 113 | import dialog | "Add the … stock records to your list, or replace your … with them (to restore a backup)?" |
| 139 | confirm (remove) | "Remove …? Remove this stock record from the library on this computer?" |
| 143 | confirm (start new) | "The list that couldn't be read is kept beside the new one, so nothing is deleted." |
| 232 | empty | "Keep the enzymes your lab has, their freezer locations and your notes here. Choose Lab enzymes on the map to show their cut sites." |
| 250 | unknown enzyme in list | "Not in this version's enzyme list" |
| 287 | subtitle (desktop) | "Your lab's enzyme stock, kept on this computer." |
| 287 | subtitle (browser) | "Your lab's enzyme stock, kept by this browser. Export… to keep a copy." |

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
