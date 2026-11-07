# End-to-end report

✓ The file opens in a tab with its map
✓ On first launch the welcome window opens over the file
✓ Nothing is checked online while the welcome window is open
✓ It asks about usage statistics, unticked
✓ Start using Strandivo closes it
✓ Its choices land in the settings, and an unticked box adds nothing ({"seen":2,"usage":false,"primers":0,"updates":true})
✓ Once it closes, the update check runs (1 checks)
✓ Home and the file's tab are in the app bar ({"home":true,"tabs":["pUC19-annotated.gb"],"active":0})
✓ Outline lists the file's features (lacZ-alpha, MCS, AmpR)
✓ Map labels fit inside the map (none clipped)
✓ Label size slider changes the map labels (9.66px → 12.075px)
✓ Ruler button hides the map's ruler (26 → 0 ticks)
✓ Features that only touch share a lane on the map (151 and 151)
✓ Clicking a feature shows it in the inspector (AmpR: CDSgenepromoterterminatorrep_originRBSmisc_featureprotein_bindprimer_bindpolyA_signalenhancersig_peptideLTRmRNA5'UTR3'UT)
✓ The feature is highlighted on the map
✓ Sequence view draws its rows
✓ Sequence letters line up with features and the ruler (width ratio 1.000)
✓ Protein translation is shown under coding features
✓ Coding features are named under their amino acids, not in the margin ({"captions":["lacZ-alpha ←","lacZ-alpha ←","lacZ-alpha ←","lacZ-alpha ←","lacZ-alpha ←"],"margin":0})
✓ Colour amino acids colours each residue by its chemistry
✓ Features that only touch share a line in the sequence (110px and 110px)
✓ Clicking the sequence puts the cursor there
✓ Typing inserts bases (2686 → 2693 bp)
✓ Ctrl+Z undoes one typing step (2693 → 2689 bp)
✓ Ctrl+Y redoes it (2689 → 2686 → 2689 bp)
✓ Shift+arrows select bases ({"start":8,"end":10})
✓ The status bar shows the selection's Tm, as the inspector does (70.7 and 70.7)
✓ Right-clicking selected bases offers forward and reverse primers (Copy, Copy reverse complement, —, Add forward primer, Add reverse primer, Mutagenesis primers…, Add feature, —, Reverse-complement selection, —, Delete bases)
✓ Add reverse primer adds the bottom-strand primer over the selection ({"start":100,"end":119,"rc":true,"strand":-1})
✓ Designing primers for AmpR suggests a pair in a dialog
✓ The pair waits for review before it is added
✓ Adding sites designs the pair again
✓ The added sites don't cut inside the product (gagTTACCAATGCTTAATCAGTGAGGCA1,629–1,653 → · 60.8 °CAmpR runs right to left, so AmpR-NdeI-F binds at its start (2,489). NdeI and XhoI don't cut inside the product.Other candidatesCancelAdd both primers)
✓ Add both primers adds the pair and closes the dialog
✓ AmpR-NdeI-F starts at AmpR's start codon with NdeI ([{"name":"AmpR-NdeI-F","start":2464,"end":2488,"strand":-1,"bases":"GCGCCATATGAGTATTCAACATTTCCGTGTCG"},{"name":"AmpR-XhoI-R","start":1628,"end":1652,"strand":1,"bases":"GCGCCTCGAGTTACCAATGCTTAATCAGTGAGGCA"}])
✓ Primers tab lists them
✓ Designed primers have Tm near 60 °C (60.8, 59.9)
✓ Sequence panel shows the selected primer with its ends
✓ Extending the 3′ end of a reverse primer adds the base on its left (2464,2488,32 → 2463,2488,33)
✓ Ctrl+Z puts the primer back
✓ Dragging over the bases around a primer selects them on both strands ({"still":true,"bands":1,"range":{"start":2429,"end":2453},"focus":null,"text":""})
✓ A primer's change is raised in red in the Sequence tab
✓ The inspector says what the primer changes
✓ Primer colours leave out red, which marks changes (Coral, Orange, Yellow, Green, Teal, Blue, Purple, Pink, Grey, Default colour)
✓ Choosing a colour colours the primer
✓ PCR product is AmpR plus the two tails (878 bp)
✓ No side products are reported (12,689Size878 bpTemplate1,629–2,489Tm60.8 °C and 59.9 °C · 0.9 °C apartContainsAmpR)
✓ Escape closes the dialog
✓ Right-clicking selected bases offers mutagenesis primers (Copy, Copy reverse complement, —, Mutagenesis primers…, Add feature, —, Reverse-complement selection, —, Delete bases)
✓ A selected codon opens the dialog on its residue
✓ The dialog designs a back-to-back pair for the change
✓ Add both primers adds the mutagenesis pair
✓ The forward primer carries the change at its 5′ end, back to back with the reverse one ({"strands":[1,-1],"rEnd":2279,"r":"AmpR-F70A-R","arm":true,"f":"AmpR-F70A-F","start":2280,"id":"p-mw5ncqgu-8","differs":true})
✓ The mutagenesis primer's change is raised in the Sequence tab
✓ Common sequencing primers that bind are listed
✓ Library primers are added where they bind ([["M13 fwd (-21)",1],["M13 rev",-1]])
✓ Library primers bring their notes into a Notes column
✓ The filter keeps the primers whose name, note or bases match (M13 fwd (-21), M13 rev)
✓ A filter nothing matches says so
✓ Clearing the filter brings every primer back (M13 fwd (-21), M13 rev, AmpR-XhoI-R, AmpR-NdeI-F)
✓ Picking two rows offers what to do with both
✓ Copy, save and delete are offered for the selection (Copy for ordering…, Save to library, Delete 2 primers)
✓ While several are picked no one primer is selected
✓ A plain click is an ordinary selection again
✓ Clicking the binding map replaces several picked rows
✓ Clicking a heading sorts the list and is remembered (AmpR-NdeI-F, AmpR-XhoI-R, M13 fwd (-21), M13 rev)
✓ Pairs lists what each forward and reverse primer would amplify
✓ Clicking a pair opens it in the PCR product dialog
✓ Copy for ordering lists the primers the file has now
✓ Primer library window lists the library
✓ Saving writes the file (ok)
✓ Saving clears the edited mark
✓ Ctrl+S saves the file
✓ Opening another file adds a tab and shows it (["edited.gb","copy.gb"])
✓ The saved file reopens with the same sequence, features and primers ({"primers":["AmpR-NdeI-F 2464-2488","AmpR-XhoI-R 1628-1652","M13 fwd (-21) 381-397","M13 rev 467-483"],"features":["Saved with Ctrl+S 148-471","MCS 398-456","AmpR 1628-2488"],"len":2689})
✓ Only the shown file's views are in the page
✓ Ctrl+Page Up goes back to the first file
✓ Closing a saved file's tab needs no question
✓ Simulate cloning opens a dialog
✓ Gibson designs insert primers with 20-base overlap tails (aaaacgacggccagtgaattATGGTGAGCAAGGGCGAG, gaccatgattacgccaagctTTACTTGTACAGCTCGTCCATGC)
✓ The product opens in a new, unsaved tab
✓ The product has the insert, the vector's features and the primers ({"circular":true,"primers":["AmpR-NdeI-F","AmpR-XhoI-R","M13 fwd (-21)","M13 rev","A206K.REV","A206K.FOR","mEGFP-F","mEGFP-R"],"features":["Saved with Ctrl+S","MCS","AmpR","mEGFP"],"len":3362})
✓ Closing the product asks to save it
✓ The ORFs button draws ORFs on the map, AmpR among them (-1:2488)
✓ The inspector shows the selected ORF and its protein (Open reading frameFound in the sequence, not saved with the file. Add it as a feature to keep it.Location1,629..2,489StrandReverse · frame −3Length861 bp · 286 )
✓ ORFs show in the sequence too
✓ The ORFs button hides them again
✓ Digest opens a dialog
✓ EcoRI and HindIII cut out pUC19's 51 bp MCS piece, the sizes adding up to the plasmid ([2638,51] of 2689 bp)
✓ The gel shows a band for each fragment next to the ladder
✓ Done closes the Digest dialog
✓ Selecting a site of an enzyme that cuts twice marks its other site on the map (["BglI@1815"])
✓ ⌘/Ctrl-click picks more enzymes, and the inspector offers to digest with them (["BglI","EcoRI","BamHI"])
✓ Right-clicking a picked enzyme keeps the pick and digests with them all (Copy recognition site | Digest with BglI, EcoRI and BamHI… | Show in sequence)
✓ The Digest dialog opens with the picked enzymes ticked (["BamHI","BglI","EcoRI"])
✓ Esc drops the picked enzymes
✓ The enzyme library opens in its own window
✓ The stock record for EcoRI is saved
✓ The stock record for PvuII is saved
✓ Product, freezer location and edited notes are kept in the JSON file ({"entries":[{"location":"Freezer 2, box A","product":"E2E EcoRI","notes":"Updated spare tube","id":"enzyme-mw5ncz1d-1","enzyme":"EcoRI"},{"location":"Freezer 2, box A","product":"E2E PvuII","notes":"Spare tube","id":"enzyme-mw5ncz9t-2","enzyme":"PvuII"}],"version":1})
✓ Lab enzymes updates the open map, including every PvuII site
✓ The outline follows the map's lab enzyme choice
✓ Lab enzymes: unique cutters leaves out PvuII's two sites
✓ An annotated file is not asked about
✓ Opening a file with no features offers to look for parts
✓ Not now puts the offer away
✓ Detect features finds parts in the sequence
✓ pUC19's origin is among them (ori, lac operator, CAP binding site)
✓ AmpR is already annotated in this file, so it isn't offered again (ori, lac operator, CAP binding site)
✓ Every suggestion says where its sequence came from
✓ Nothing is added while the dialog is open
✓ Adding the chosen features closes the dialog and puts them in
✓ The origin went in as a rep_origin, drawn without a direction ([{"name":"ori","type":"rep_origin","strand":0},{"name":"CAP binding site","type":"protein_bind","strand":0},{"name":"lac operator","type":"protein_bind","strand":0}])
✓ They show on the map
✓ One undo takes all of them back out again
✓ A CDS offers regions from UniProt
✓ Looking up an entry offers what can be placed
✓ Adding them adds no features
✓ They are drawn inside the CDS
✓ The entry goes in the file's cross-references
✓ One undo takes them back out
✓ Split view shows the map and the sequence together ({"map":true,"feats":3,"rows":14,"seq":true})
✓ The sidebar button hides and shows the sidebar ({"sidebarHidden":true,"sidebarBack":true})
✓ The sidebar starts with primers, folds a section from its heading and follows the order in Settings ({"sidebarStart":["primers","enzymes","features"],"sidebarFolded":["primers","enzymes","features folded"],"sidebarMoved":["features","primers","enzymes"]})
✓ Three reads listed
✓ Two reads align, one unrelated read doesn't (2 of 3 reads aligned; 1 without a match)
✓ Alignment view is drawn
✓ Alignment opens where the reads start (scrollLeft 4728)
✓ The .ab1 read's trace is drawn
✓ The wheel moves the rows and never sideways ({"moved":0,"room":0,"rows":0})
✓ The alignment's scroll bar stays in view and is in step with the traces ({"width":0,"fromBar":0,"inPane":true,"barFollows":true})
✓ Inspector shows the selected read (Readbla-checkAligned, reverse strand · 1 differenceAligned to1,703–2,403Identity)
✓ Mutation in the reverse read is called as W163R in AmpR (Differences in this readA2003GW163R in AmpRmissenseTGG→CGGShowShow on mapUse read ba)
✓ Alignment jumps to the selected read (scrollLeft 4728 → 20736)
✓ Next difference selects it in the sequence ({"start":2002,"end":2002,"base":"A"})
✓ Differences table lists both changes (PositionChangeEffectSeen inQualityActionsafter 450ins 30 bpin-frame insertion of 10 aa at codon 8 in Saved with Ctrl+Sin frame; in MCSteselagen-example1Q50Show )
✓ Inspector shows how much of the feature the reads cover (701 of 861 bp covered)
✓ Removing a read takes it out of the list and the alignment ({"rows":["→ teselagen-example1"],"cards":2})
✓ Two reads of one clone are listed together
✓ The clone's consensus has W163R once, seen in both reads (Differences in this cloneA2003GW163R in AmpRmissenseTGG→CGG · in 2 readsShowShow on mapUse read baseReads)
✓ Where the clone's reads disagree is listed instead of a change (2,103: PositionReferenceReads sayClone2,103A → ?c7_bla-F: A · c7_bla-R: Cc7_bla)
✓ The Translation chip translates each read in the feature's frame
✓ Splitting the clone lists each read on its own
✓ Right-clicking two picked reads offers to group or remove both (Group into one clone, —, Remove 2 reads)
✓ Grouping makes one clone of them
✓ A clone's menu can split it (Copy consensus, Open clone as file, —, Split into single reads, —, Remove clone)
✓ Dropping a read on another makes a clone of them
✓ Dragging a read out of its clone takes it out
✓ Dragging reorders the list and the alignment, without aligning again (c7_bla-R, c7_bla-F, teselagen-example1, 3730 / c7_bla-R, c7_bla-F, teselagen-example1)
✓ Save check writes the reads, with paths relative to the check file ({"strandivo":"read check","version":1,"reference":"edited.gb","reads":[{"path":"../../home/runner/work/Strandivo/Strandivo/testdata/e2e/c7_bla-R.fasta","clone":"#g1"},{"path":"../../home/runner/work/Strandivo/Strandivo/testdata/e2e/c7_bla-F)
✓ Reopening the file brings its reads back, as they were grouped
✓ Opening the check file shows its reads in the Reads tab
✓ Identical clones share a row of the clone table ([["c7_bla-F","A01_bla","A02_bla"],"c7_bla-F +2","3","Partly covered","AmpR W163R","1,653–2,253"])
✓ The clone table flags a stop and a frameshift ([[["A03_bla"],"A03_bla","1","StopPartly covered","AmpR W163*","1,703–2,353"],[["A05_bla"],"A05_bla","1","FrameshiftPartly covered","AmpR D129fs","1,703–2,353"]])
✓ The clone table has the column to itself until something is selected
✓ Reading TAG as Q turns A06's amber stop into W163Q ([["A06_bla"],"A06_bla","1","Partly covered","AmpR W163Q","1,703–2,353"])
✓ Selecting a clone opens the alignment under the table
✓ Open clone as file makes an unsaved copy with the clone's one change (1 bases differ)
✓ The summary counts different and broken clones (["7 of 9","3 of 9","1.54","4 : 1"])
✓ Recurring mutations count different clones, not identical ones ([["2,003","AmpR W163R","2 of 6","c7_bla-R, c7_bla-F, A01_bla, A02_bla"],["2,003","AmpR W163*","2 of 6","A03_bla, A06_bla"],["2,105","AmpR D129E","1 of 6","c7_bla-R"],["2,105","AmpR D129fs","1 of 6","A05_bla"],["451","Saved with Ctrl+S S7_L8insYLGDTIEYSS","1 of 1","teselagen-example1"]])
✓ Clicking a bar lists its clones ([["2,003","AmpR W163R","2 of 6","c7_bla-R, c7_bla-F, A01_bla, A02_bla"],["2,003","AmpR W163*","2 of 6","A03_bla, A06_bla"]])
✓ A difference opens the alignment, which can be closed
✓ Ctrl+5 opens Plasmid info
✓ Plasmid info detects ampicillin resistance (Ampicillin)
✓ Settings window opens
✓ Choosing the Wallace rule in Settings changes Tm in open windows (72.0 and 72.0)
✓ SnapGene .dna opens in a new tab
✓ Primers stored in the SnapGene file are imported (A206K.REV, A206K.FOR, A206K.FOR, SEC13.REV, SEC13.FOR)
✓ The library's parent opens in a new tab
✓ The inspector marks a feature as a variable region (["cdr1=any","cdr2=any","cdr3=any","FR2=v1:TGGTTTCGTCAGGCCCCGGGCAAAGAGCGGGAGTTCGTGGCC|v2:TGGGTTCGTCAGGCCCCGGGCAAAGAGCTGGAGTGCGTGGCC"])
✓ The clone table has a column per variable region with each clone's CDR ({"cdr2":"AVSWSAGTTY","Status":"Partly covered","FR2":"v1 WFRQAPGKEREFVA","Read":"1,985–2,957","Mutations":"None in what was read3 changes among double peaks left out","cdr3":"GCAGCGGATAGGCCGCCGGCCGGCGGGGAAGGTCGTGGTATGGATTAC","Clone":"2026-10-13_C01_MJG5PRIMER","Seen":"1","cdr1":"GRTLGSLNMA"})
✓ A clone's CDRs are not listed as mutations (["None in what was read","ins T after 2022","None in what was read3 changes among double peaks left out"])
✓ A region with versions shows the closest: the equal mix has FR2 v2 (["v2 WVXQAXXXXXXXXX","v1 WFRQAPGKEREFVA","ins T after 2022"])
✓ Double peaks name the two mixes with their rough share, and not the single clone (["Mixed, about 30%Partly covered","Mixed, about 40%","Partly covered"])
✓ A mix's CDRs show as mixed, not as one plasmid's (["mixed","mixed"])
✓ The traces mark double peaks ({"mixMarks":{"marks":44,"shown":[2161,2213]},"cleanMarks":{"marks":0,"shown":[2051,2102]}})
✓ The summary leaves the mixes out of its numbers and says so ({"tiles":["1 of 1","0 of 1","0.00","0 : 0"],"note":"Left out of these numbers: 2 mixed, of 3 clones.","bars":[],"rows":[]})
✓ A FASTQ read of a whole plasmid is shown as one, with its size (pUC19-wholeWhole plasmid2,697 bp (+11)2 differences · 1 uncertain)
✓ The read is turned to the origin, and its changes are called (ReadpUC19-wholeAligned, forward strand · 2 differences · 1 uncertainAligned to1–2,686Identity99.5% (2,684 of 2,698)Read length2,697 basesSize2,697 bp, 11 bp longer than this sequenceQualitymean Q40Clo)
✓ An indel in a run of one base is flagged, not trusted (apUse read basedel T1413uncertainoutside featuresQ40 · in a run of one base, often the sequence)
✓ A new version is offered in a strip, not a dialog (Strandivo 9.9.9 is available.What's new…Install and restartSkip this versionLater)
✓ What's new shows the update's short notes in the app, as text ({"lines":["Faster maps.","<b>New</b> primer tools."],"bold":false})
✓ More on strandivo.com asks for that version's notes
✓ Install and restart downloads it, then quits the way ⌘Q does
✓ If the app stays open, the strip offers to restart (Strandivo 9.9.9 is ready to install.Restart nowLater)
✓ Later hides the strip
✓ After an update the strip says which version it is now (Strandivo was updated to 0.4.0-rc.1.What's new…Close)
✓ Its What's new opens the dialog
✓ It says so only once
✓ Report a Bug… opens the feedback dialog with Bug chosen
✓ Send waits for a summary
✓ Recent errors are shown before sending, without the file's path (2026-11-07 00:10:56 Error: Couldn't read <path>)
✓ What is sent with it is listed in full
✓ If it can't be sent, the text stays, with Copy and Email instead
✓ Email instead starts a message with the report in it ({"subject":"Bug: Map stays blank","body":"Bug: Map stays blank\nOpened a plasmid from Home.\n\nStrandivo 0.4.0-rc.1 · Linux 24.4.0 · Intel or AMD\nOpen view: Ho)
✓ The report holds what the dialog showed, and no path ({"errors":["2026-11-07 00:10:56 Error: Couldn't read <path>"],"kind":"bug","summary":"Map stays blank","email":"anna@lab.example.org","file":null,"view":"Home","crash":null,"app":{"osVersion":"24.4.0")
✓ It says which issue it became
✓ Open on GitHub asks for that issue by its number
✓ A crash last time is offered in a strip under the app bar
✓ Nothing about it is sent on its own
✓ Report it… opens Report a Bug about the crash
✓ The crash is shown in full before sending, without the file's path (Strandivo 0.4.0, 2026-11-06 09:30:00 UTC
Thread: tokio-runtime-worker
At: reqwest-0.13.0/src/async_impl/client.rs:2311:5
Could not read <path>)
✓ Send sends the crash as it was shown, and no path ({"errors":null,"kind":"bug","summary":"Strandivo quit unexpectedly","email":null,"file":null,"view":"Home","crash":{"at":"2026-11-06T09:30:00.000Z","thread":"tokio-runtime-worker","message":"Could not read <path>","location":"reqwest-0.13.0)
✓ Once sent, the strip goes
✓ A crash is offered once
✓ Nothing is counted while statistics are off, errors included (0 events)
✓ Turned on, the app counts its start and what is used ([{"at":"2026-11-07T00:10:58.210Z","name":"app_started","props":{"installed":"first_day","arch":"x86_64","folders":"0"}},{"at":"2026-11-07T00:10:58.210Z","name":"settings_chosen","props":{"tm":"wallace","amber":"off","bases":"upper"}},{"at":)
✓ The start says how long the copy has been in use, as a range, and Settings' choices come with it ([{"at":"2026-11-07T00:10:58.210Z","name":"app_started","props":{"installed":"first_day","arch":"x86_64","folders":"0"}},{"at":"2026-11-07T00:10:58.210Z","name":"settings_chosen","props":{"tm":"wallace","amber":"off","bases":"upper"}}])
✓ A view is counted once, not at every switch ([{"at":"2026-11-07T00:10:58.499Z","name":"view_used","props":{"view":"primers"}},{"at":"2026-11-07T00:10:58.573Z","name":"view_used","props":{"view":"sequence"}}])
✓ Dismiss hides the crash strip
✓ A crash is counted as an error of kind crash, without its message ([{"at":"2026-11-07T00:10:58.210Z","name":"error_caught","props":{"kind":"command"}},{"at":"2026-11-07T00:10:58.647Z","name":"error_caught","props":{"kind":"crash"}}])
✓ Events carry listed words alone, never a file's name or path ([{"installed":"first_day","arch":"x86_64","folders":"0"},{"tm":"wallace","amber":"off","bases":"upper"},{"kind":"command"},{"view":"primers"},{"view":"sequence"},{"kind":"crash"}])
✓ Turned off, what was queued is dropped and nothing more goes (6 events, 6 before)
✓ Home lists the constructs in a library folder (["bla-check.fasta","c7_bla-F.fasta","c7_bla-R.fasta","pUC19-annotated.gb","plate-bla.fasta"])
✓ Opening a construct from Home adds a tab
