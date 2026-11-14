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
✓ Names along features sit in the middle of them (central, central)
✓ Label size slider changes the map labels (9.66px → 12.075px)
✓ Ruler button hides the map's ruler (26 → 0 ticks)
✓ A click far from the map's circle clears the selection and leaves the cursor ({"caretBefore":2486,"caret":2486,"range":null,"anchor":null,"focus":null})
✓ A click near the circle puts the cursor there (caret 23, expected about 22)
✓ Double-clicking the map's name opens a field with the name selected
✓ Enter renames the sequence, not its file ({"title":"pUC19 K45A","field":false,"tab":"pUC19-annotated.gb","shown":"pUC19 K45A","name":"pUC19 K45A","undo":"Rename"})
✓ Esc leaves the name as it was
✓ Right-clicking the name offers to rename the sequence, and no origin (Rename sequence…, —, Select all, Reverse-complement sequence)
✓ Rename sequence… opens the same field
✓ Undo brings the old name back
✓ A long name wraps inside the ruler's numbers ({"lines":["testing how it works","and seeing how the","long text works"],"clash":false})
✓ Features that only touch share a lane on the map (151 and 151)
✓ Clicking a feature shows it in the inspector (AmpR: CDSgenepromoterterminatorrep_originRBSmisc_featureprotein_bindprimer_bindpolyA_signalenhancersig_peptideLTRmRNA5'UTR3'UT)
✓ A CDS's translation starts folded
✓ Clicking its heading unfolds the translation
✓ The inspector shows the protein's mass and ε280, as ProtParam does (ProteinDetails…Mass31.6 kDaε28027,960 M⁻¹ cm⁻¹28,085 with disulfidesA2800.886 at 1 mg/mL0.890 with disulfides)
✓ The feature is highlighted on the map
✓ Sequence view draws its rows
✓ Sequence letters line up with features and the ruler (width ratio 1.000)
✓ Protein translation is shown under coding features
✓ Coding features are named under their amino acids, not in the margin ({"captions":["lacZ-alpha ←","lacZ-alpha ←","lacZ-alpha ←","lacZ-alpha ←","lacZ-alpha ←"],"margin":0})
✓ Sequence translation: amino acids have codon hit areas
✓ Sequence translation: one click selects the codon's three bases without selecting the feature ({"range":{"start":157,"end":159},"focus":null})
✓ Sequence translation: a double-click selects the whole feature ({"range":{"start":145,"end":468},"focus":{"kind":"feature","id":"f-mwgsglk8-2"}})
✓ Sequence translation: clicking the feature name selects the whole feature ({"range":{"start":145,"end":468},"focus":{"kind":"feature","id":"f-mwgsglk8-2"}})
✓ Sequence translation: a row has enough residues to check gestures
✓ Sequence translation: dragging forward selects complete codons ({"marked":5,"range":{"start":145,"end":159},"picks":[104,105,106,107,108],"ranges":null})
✓ Sequence translation: dragging backward selects complete codons ({"marked":5,"range":{"start":145,"end":159},"picks":[104,105,106,107,108],"ranges":null})
✓ Sequence translation: Ctrl-click adds a separate codon without its neighbours ({"marked":2,"range":null,"picks":[104,108],"ranges":[{"start":145,"end":147},{"start":157,"end":159}]})
✓ Sequence translation: Ctrl-Shift-click fills from the last clicked codon and keeps other picks ({"marked":4,"range":null,"picks":[104,106,107,108],"ranges":[{"start":145,"end":153},{"start":157,"end":159}]})
✓ Sequence translation: Ctrl-click can remove a picked codon ({"marked":3,"range":null,"picks":[104,106,108],"ranges":[{"start":145,"end":147},{"start":151,"end":153},{"start":157,"end":159}]})
✓ Colour amino acids colours each residue by its chemistry
✓ Coloured sequence translation: amino acids have codon hit areas
✓ Coloured sequence translation: one click selects the codon's three bases without selecting the feature ({"range":{"start":157,"end":159},"focus":null})
✓ Coloured sequence translation: a double-click selects the whole feature ({"range":{"start":145,"end":468},"focus":{"kind":"feature","id":"f-mwgsglk8-2"}})
✓ Coloured sequence translation: clicking the feature name selects the whole feature ({"range":{"start":145,"end":468},"focus":{"kind":"feature","id":"f-mwgsglk8-2"}})
✓ Coloured sequence translation: a row has enough residues to check gestures
✓ Coloured sequence translation: dragging forward selects complete codons ({"marked":5,"range":{"start":145,"end":159},"picks":[104,105,106,107,108],"ranges":null})
✓ Coloured sequence translation: dragging backward selects complete codons ({"marked":5,"range":{"start":145,"end":159},"picks":[104,105,106,107,108],"ranges":null})
✓ Coloured sequence translation: Ctrl-click adds a separate codon without its neighbours ({"marked":2,"range":null,"picks":[104,108],"ranges":[{"start":145,"end":147},{"start":157,"end":159}]})
✓ Coloured sequence translation: Ctrl-Shift-click fills from the last clicked codon and keeps other picks ({"marked":4,"range":null,"picks":[104,106,107,108],"ranges":[{"start":145,"end":153},{"start":157,"end":159}]})
✓ Coloured sequence translation: Ctrl-click can remove a picked codon ({"marked":3,"range":null,"picks":[104,106,108],"ranges":[{"start":145,"end":147},{"start":151,"end":153},{"start":157,"end":159}]})
✓ e2e-codon-forward: the codon is drawn
✓ e2e-codon-forward: selects all three bases across the row or origin ({"caret":81,"codons":{"anchor":{"index":1,"feature":"e2e-codon-forward"},"picks":[{"index":1,"feature":"e2e-codon-forward"}]},"range":{"start":78,"end":80},"anchor":78,"focus":null})
✓ e2e-codon-reverse: the codon is drawn
✓ e2e-codon-reverse: selects all three bases across the row or origin ({"caret":162,"codons":{"anchor":{"index":1,"feature":"e2e-codon-reverse"},"picks":[{"index":1,"feature":"e2e-codon-reverse"}]},"range":{"start":159,"end":161},"anchor":159,"focus":null})
✓ e2e-codon-origin-forward: the codon is drawn
✓ e2e-codon-origin-forward: selects all three bases across the row or origin ({"caret":1,"codons":{"anchor":{"index":1,"feature":"e2e-codon-origin-forward"},"picks":[{"index":1,"feature":"e2e-codon-origin-forward"}]},"range":{"start":2684,"end":0},"anchor":2684,"focus":null})
✓ e2e-codon-origin-reverse: the codon is drawn
✓ e2e-codon-origin-reverse: selects all three bases across the row or origin ({"caret":2,"codons":{"anchor":{"index":1,"feature":"e2e-codon-origin-reverse"},"picks":[{"index":1,"feature":"e2e-codon-origin-reverse"}]},"range":{"start":2685,"end":1},"anchor":2685,"focus":null})
✓ Features that only touch share a line in the sequence (110px and 110px)
✓ Clicking the sequence puts the cursor there
✓ Typing inserts bases (2686 → 2693 bp)
✓ Ctrl+Z undoes one typing step (2693 → 2689 bp)
✓ Ctrl+Y redoes it (2689 → 2686 → 2689 bp)
✓ Pasting a FASTA entry puts in its bases alone, U as T ({"start":"ACGTACGT","grew":8})
✓ Text that isn't a sequence is refused instead of pasted as bases ({"start":"tcgcgGAT","grew":0})
✓ It says why
✓ Shift+arrows select bases ({"start":0,"end":2})
✓ The first Delete on a selected feature deletes the feature, not its bases ({"len":2689,"features":["MCS","AmpR"],"sel":{"caret":472,"range":{"start":148,"end":471},"anchor":null,"focus":null}})
✓ It says the bases are still selected, with an Undo button
✓ The next Delete deletes its bases (2689 → 2365 bp)
✓ It says the feature inside them went too
✓ Undo in the message brings the bases back (2689 bp, MCS, AmpR)
✓ Undo once more brings the feature back
✓ The status bar shows the selection's Tm, as the inspector does (70.7 and 70.7)
✓ Right-clicking selected bases offers forward and reverse primers (Copy, Copy reverse complement, —, Invert selection, —, Add forward primer, Add reverse primer, Mutagenesis primers…, Add feature, —, Reverse-complement selection, —, Delete bases)
✓ Add reverse primer adds the bottom-strand primer over the selection ({"start":100,"end":119,"rc":true,"strand":-1})
✓ Invert selection selects the rest of a circular plasmid as one stretch across the origin ({"range":{"start":472,"end":147},"ranges":null,"focus":null})
✓ The status bar gives the inverted selection's length (2365 bp)
✓ Edit > Invert Selection inverts it ({"start":148,"end":471})
✓ Right-clicking selected bases offers Invert selection (Copy, Copy reverse complement, —, Invert selection, —, Design primers to amplify…, Mutagenesis primers…, Add feature, Add as region…, —, Reverse-complement selection, —, Delete bases)
✓ Invert selection in the right-click menu inverts it
✓ Inverting leaves the window its size (855 → 855 px)
✓ Designing primers for AmpR suggests a pair in a dialog
✓ The pair waits for review before it is added
✓ Moving the ends designs a longer product over the same region (861 bp with the ends pinned, 864 bp with 20 allowed)
✓ Back at 0 the primers sit on the region's edges again
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
✓ Primer translation: amino acids have codon hit areas
✓ Primer translation: one click selects the codon's three bases without selecting the feature ({"range":{"start":2486,"end":2488},"focus":null})
✓ Primer translation: a double-click selects the whole feature ({"range":{"start":1628,"end":2488},"focus":{"kind":"feature","id":"f-mwgsglk8-4"}})
✓ Primer translation: clicking the feature name selects the whole feature ({"range":{"start":1628,"end":2488},"focus":{"kind":"feature","id":"f-mwgsglk8-4"}})
✓ Primer translation: a row has enough residues to check gestures
✓ Primer translation: dragging forward selects complete codons ({"marked":5,"range":{"start":2474,"end":2488},"picks":[1,2,3,4,5],"ranges":null})
✓ Primer translation: dragging backward selects complete codons ({"marked":5,"range":{"start":2474,"end":2488},"picks":[1,2,3,4,5],"ranges":null})
✓ Primer translation: Ctrl-click adds a separate codon without its neighbours ({"marked":2,"range":null,"picks":[1,5],"ranges":[{"start":2474,"end":2476},{"start":2486,"end":2488}]})
✓ Primer translation: Ctrl-Shift-click fills from the last clicked codon and keeps other picks ({"marked":4,"range":null,"picks":[1,3,4,5],"ranges":[{"start":2474,"end":2482},{"start":2486,"end":2488}]})
✓ Primer translation: Ctrl-click can remove a picked codon ({"marked":3,"range":null,"picks":[1,3,5],"ranges":[{"start":2474,"end":2476},{"start":2480,"end":2482},{"start":2486,"end":2488}]})
✓ Coloured primer translation: amino acids have codon hit areas
✓ Coloured primer translation: one click selects the codon's three bases without selecting the feature ({"range":{"start":2486,"end":2488},"focus":null})
✓ Coloured primer translation: a double-click selects the whole feature ({"range":{"start":1628,"end":2488},"focus":{"kind":"feature","id":"f-mwgsglk8-4"}})
✓ Coloured primer translation: clicking the feature name selects the whole feature ({"range":{"start":1628,"end":2488},"focus":{"kind":"feature","id":"f-mwgsglk8-4"}})
✓ Coloured primer translation: a row has enough residues to check gestures
✓ Coloured primer translation: dragging forward selects complete codons ({"marked":5,"range":{"start":2474,"end":2488},"picks":[1,2,3,4,5],"ranges":null})
✓ Coloured primer translation: dragging backward selects complete codons ({"marked":5,"range":{"start":2474,"end":2488},"picks":[1,2,3,4,5],"ranges":null})
✓ Coloured primer translation: Ctrl-click adds a separate codon without its neighbours ({"marked":2,"range":null,"picks":[1,5],"ranges":[{"start":2474,"end":2476},{"start":2486,"end":2488}]})
✓ Coloured primer translation: Ctrl-Shift-click fills from the last clicked codon and keeps other picks ({"marked":4,"range":null,"picks":[1,3,4,5],"ranges":[{"start":2474,"end":2482},{"start":2486,"end":2488}]})
✓ Coloured primer translation: Ctrl-click can remove a picked codon ({"marked":3,"range":null,"picks":[1,3,5],"ranges":[{"start":2474,"end":2476},{"start":2480,"end":2482},{"start":2486,"end":2488}]})
✓ Selecting codons and their feature keeps the same primer in view
✓ A primer's change is raised in red in the Sequence tab
✓ The inspector says what the primer changes
✓ Primer colours leave out red, which marks changes (Coral, Orange, Yellow, Green, Teal, Blue, Purple, Pink, Grey, Default colour)
✓ Choosing a colour colours the primer
✓ PCR product is AmpR plus the two tails (878 bp)
✓ No side products are reported (12,689Size878 bpTemplate1,629–2,489Tm60.8 °C and 59.9 °C · 0.9 °C apartContainsAmpR)
✓ Escape closes the dialog
✓ With NEB's Q5 as the Tm method, a PCR product says where to anneal (12,689Size878 bpTemplate1,629–2,489Tm66.0 °C and 64.8 °C · 1.2 °C apartAnneal at66 °C · Q5 High-Fidelity: lower Tm + 1 °C, at most 72 °CContainsAmpR)
✓ Right-clicking selected bases offers mutagenesis primers (Copy, Copy reverse complement, —, Invert selection, —, Mutagenesis primers…, Add feature, Add as region…, —, Reverse-complement selection, —, Delete bases)
✓ A selected codon opens the dialog on its residue
✓ The dialog designs a back-to-back pair for the change
✓ Add both primers adds the mutagenesis pair
✓ The forward primer carries the change at its 5′ end, back to back with the reverse one ({"strands":[1,-1],"rEnd":2279,"r":"AmpR-F70A-R","arm":true,"f":"AmpR-F70A-F","start":2280,"id":"p-mwgsh95y-8","differs":true})
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
✓ Pairs with Tms further apart than the limit are hidden and counted (0 of 4)
✓ Show all lists them again, marked
✓ Primer library window lists the library
✓ Saving writes the file (ok)
✓ Saving clears the edited mark
✓ A feature's note applies as it is typed ({"note":["Says \"stop\" here, and goes on long enough to wrap onto another line of the file"]})
✓ Ctrl+S saves the file
✓ The note is saved as GenBank writes it
✓ Saving straight after typing a note saves all of it (ok)
✓ Opening another file adds a tab and shows it (["edited.gb","copy.gb"])
✓ The saved file reopens with the same sequence, features and primers ({"primers":["AmpR-NdeI-F 2464-2488","AmpR-XhoI-R 1628-1652","M13 fwd (-21) 381-397","M13 rev 467-483"],"features":["Saved with Ctrl+S 148-471","MCS 398-456","AmpR 1628-2488"],"len":2689})
✓ The reopened file shows the note in the inspector
✓ Only the shown file's views are in the page
✓ Ctrl+Page Up goes back to the first file
✓ Closing a saved file's tab needs no question
✓ Simulate cloning opens a dialog
✓ Gibson designs insert primers with 20-base overlap tails (aaaacgacggccagtgaattATGGTGAGCAAGGGCGAG, gaccatgattacgccaagctTTACTTGTACAGCTCGTCCATGC)
✓ The product opens in a new, unsaved tab
✓ The product has the insert, the vector's features and the primers ({"circular":true,"primers":["AmpR-NdeI-F","AmpR-XhoI-R","M13 fwd (-21)","M13 rev","A206K.REV","A206K.FOR","mEGFP-F","mEGFP-R"],"features":["Saved with Ctrl+S","MCS","AmpR","mEGFP"],"len":3362})
✓ Closing the product asks to save it
✓ The ORFs button draws ORFs on the map, AmpR among them (-1:2488)
✓ The inspector shows the selected ORF and its protein (Open reading frameDetected from the sequence and not saved in the file. Add it as a feature to save it.Location1,629–2,489StrandReverse · frame −3Length861 bp ·)
✓ Right-clicking an ORF offers its protein's details (Copy DNA, Copy protein, Protein details…, —, Add as feature, Show in sequence)
✓ Protein details number the ORF's sequence in lines of 60, with no figure
✓ The map shows no GC until its button is on
✓ The map's GC% button says what its colours mean
✓ The GC% button draws GC as a ring inside the features
✓ Each stretch of the ring says its GC and bases
✓ The linear map draws GC as a band
✓ The map's GC% button hides it again
✓ ORFs show in the sequence too
✓ The ORFs button hides them again
✓ Sequence shows no GC until its button is on
✓ The Sequence GC% button says what its colours mean
✓ The GC button draws GC under the bases and along the overview strip
✓ Each stretch of the GC strip says its GC and bases
✓ The GC button hides it again
✓ Digest opens a dialog
✓ EcoRI and HindIII cut out pUC19's 51 bp MCS piece, the sizes adding up to the plasmid ([2638,51] of 2689 bp)
✓ The gel shows a band for each fragment next to the ladder
✓ Done closes the Digest dialog
✓ Selecting a site of an enzyme that cuts twice marks its other site on the map (["BglI@1815"])
✓ ⌘/Ctrl-click picks more enzymes, and the inspector offers to digest with them (["BglI","EcoRI","BamHI"])
✓ Right-clicking a picked enzyme keeps the pick and digests with them all (Copy recognition site | Digest with BglI, EcoRI and BamHI… | Show in sequence | Add to My enzymes)
✓ The Digest dialog opens with the picked enzymes ticked (["BamHI","BglI","EcoRI"])
✓ Esc drops the picked enzymes
✓ The enzyme library opens in its own window
✓ The stock record for EcoRI is saved
✓ The stock record for PvuII is saved
✓ Product, freezer location and edited notes are kept in the JSON file ({"entries":[{"location":"Freezer 2, box A","product":"E2E EcoRI","notes":"Updated spare tube","id":"enzyme-mwgshjva-1","enzyme":"EcoRI"},{"location":"Freezer 2, box A","product":"E2E PvuII","notes":"Spare tube","id":"enzyme-mwgshk2z-2","enzyme":"PvuII"}],"version":1})
✓ My enzymes saves EcoRI
✓ My enzymes saves Acc65I
✓ My enzymes saves PvuII
✓ The personal checklist shows selected names and lab membership
✓ The personal checklist keeps keyboard navigation between rows
✓ Only the current checklist row is in the Tab order, so Tab leaves the list
✓ An existing library opens to its requested section
✓ Removing lab stock preserves the personal choice
✓ My enzymes updates open maps without substituting KpnI
✓ A saved enzyme's context menu offers removal
✓ Removing a personal enzyme updates the map live
✓ Lab enzymes updates the open map, including every PvuII site
✓ The outline follows the map's lab enzyme choice
✓ Lab enzymes: unique cutters leaves out PvuII's two sites
✓ An annotated file is not asked about
✓ Opening a file with no features offers to look for parts
✓ Not now puts the offer away
✓ Inverting a middle stretch of a linear sequence selects its two ends ({"n":1509,"range":null,"ranges":[{"start":0,"end":99},{"start":200,"end":1508}],"circular":false})
✓ The status bar counts both stretches' bases (1409 bp)
✓ Detect features finds parts in the sequence
✓ pUC19's origin is among them (ori, lac operator, CAP binding site)
✓ AmpR is already annotated in this file, so it isn't offered again (ori, lac operator, CAP binding site)
✓ Every suggestion says where its sequence came from
✓ Nothing is added while the dialog is open
✓ Adding the chosen features closes the dialog and puts them in
✓ The origin went in as a rep_origin, drawn without a direction ([{"name":"ori","type":"rep_origin","strand":0},{"name":"CAP binding site","type":"protein_bind","strand":0},{"name":"lac operator","type":"protein_bind","strand":0}])
✓ They show on the map
✓ One undo takes all of them back out again
✓ Circular map region labels are quiet, readable and name their owning protein
✓ Circular region stripes lie within their CDS
✓ Circular region label highlights its bands and only its own CDS
✓ Circular a split region highlights every piece
✓ Circular overlapping proteins with identical region names stay distinct
✓ Circular nested region hover identifies the owning CDS
✓ Circular hover changes neither document state nor label width
✓ Circular clicking a region label selects region zero at the measured weight
✓ Selected region leaders keep their stronger accent stroke
✓ Circular parent selection takes precedence over the hover outline
✓ Circular right-clicking a region keeps its own actions
✓ Circular dragging suppresses region hover
✓ Circular hover resumes after dragging
✓ Circular pointer cancellation clears hover
✓ Circular redraw clears hover
✓ Circular hiding the map clears hover
✓ Circular hiding regions clears hover and preserves CDSs
✓ Circular leaving the map clears hover
✓ Linear map region labels are quiet, readable and name their owning protein
✓ Linear region stripes lie within their CDS
✓ Linear region label highlights its bands and only its own CDS
✓ Linear a split region highlights every piece
✓ Linear overlapping proteins with identical region names stay distinct
✓ Linear nested region hover identifies the owning CDS
✓ Linear hover changes neither document state nor label width
✓ Linear clicking a region label selects region zero at the measured weight
✓ Linear parent selection takes precedence over the hover outline
✓ Linear right-clicking a region keeps its own actions
✓ Linear dragging suppresses region hover
✓ Linear hover resumes after dragging
✓ Linear pointer cancellation clears hover
✓ Linear redraw clears hover
✓ Linear hiding the map clears hover
✓ Linear hiding regions clears hover and preserves CDSs
✓ Linear leaving the map clears hover
✓ A CDS offers regions from UniProt
✓ Looking up an entry offers what can be placed
✓ Adding them adds no features
✓ They are drawn inside the CDS
✓ The inspector draws them with their list folded
✓ Independent regions need no top-level/all choice
✓ The entry goes in the file's cross-references
✓ One undo takes them back out
✓ Region names leave spelling and capitalisation to the user
✓ Region kinds use a dropdown with antibody and structural categories
✓ An ordinary region dialog leaves no blank area below its last control
✓ A manually added domain has a protein diagram
✓ One region needs no map detail selector
✓ Region actions have clear labels and fill both rows
✓ New regions in one CDS start with different coordinated colours (#d57479, #b47eb3)
✓ Nested regions stay within one document feature
✓ The outline shows both regions
✓ Nested region detail is in the map's Regions menu
✓ Features with regions align with other features
✓ Collapsing regions keeps the feature list aligned
✓ All map detail draws a domain and its CDR
✓ The map's Regions button hides regions while keeping CDS features
✓ Hiding map regions hides its detail choice but keeps the level
✓ Showing map regions restores the previous detail level
✓ Top-level map detail keeps only the domain
✓ Editing a region keeps its colour
✓ A region's bounds and name can be edited
✓ Protein details draw a block for the CDR and a bracket for its domain, all named apart
✓ At top level the figure draws the domain as a block
✓ Clicking a block in the figure selects its region
✓ The figure can be copied or saved as PNG or SVG
✓ Protein details give both coefficients for a protein with a pair of Cys
✓ Protein details fold the list of regions under the figure
✓ Closing a region editor opened from Protein details returns to them
✓ Protein regions have labelled tracks in Sequence
✓ Regions can be hidden without hiding the CDS
✓ The Sequence region toggle is separate from the map's
✓ Hiding regions preserves the row or stops at the sequence's end ({"before":{"row":29,"scrollTop":2850,"targetTop":null,"label":"2,321–2,689","maxScrollTop":2850},"after":{"row":28,"scrollTop":2719,"targetTop":2748,"label":"2,241–2,689","maxScrollTop":2719}})
✓ The Regions toggle keeps the same sequence row away from the end ({"before":{"row":22,"scrollTop":2098,"targetTop":null,"label":"1,761–2,320","maxScrollTop":2850},"after":{"row":22,"scrollTop":2098,"targetTop":null,"label":"1,761–2,320","maxScrollTop":2719}})
✓ Region names remain visible without translation
✓ Right-clicking inside a CDS keeps the smaller selection and offers Add as region ({"entries":["Copy","Copy reverse complement",null,"Invert selection",null,"Add forward primer","Add reverse primer","Mutagenesis primers…","Add feature","Add as region…",null,"Reverse-complement selection",null,"Delete bases"],"focus":null})
✓ Selected bases fill the region's residue bounds in the CDS frame
✓ The selection inspector adds a region without entering positions
✓ A custom region kind is kept when reopened
✓ Primer context shows the overlapping CDR and a neighbouring region
✓ The primer's context shows GC under its bases without turning it on
✓ Primer regions can be hidden without hiding the primer or its handles
✓ Primer and Sequence region toggles share one setting
✓ Restoring regions keeps the primer's sequence window
✓ A primer-context region selects its own bases and keeps the primer in view
✓ Removing a region keeps its CDS
✓ Removing the last nested region hides the map detail choice
✓ Region authoring can be undone completely
✓ Split view shows the map and the sequence together ({"map":true,"feats":3,"rows":22,"seq":true})
✓ The sidebar button hides and shows the sidebar ({"sidebarHidden":true,"sidebarBack":true})
✓ The sidebar and inspector resize from their edges, and a double-click resets them ({"before":[288,300],"saved":{"inspector":316,"sidebar":304},"after":[288,300],"wider":[304,316]})
✓ The sidebar starts with primers, folds a section from its heading and follows the order in Settings ({"sidebarStart":["primers","enzymes","features"],"sidebarFolded":["primers","enzymes","features folded"],"sidebarMoved":["features","primers","enzymes"]})
✓ Three reads listed
✓ Two reads align, one unrelated read doesn't (2 of 3 reads aligned; 1 without a match)
✓ Alignment view is drawn
✓ Alignment opens where the reads start (scrollLeft 4728)
✓ The .ab1 read's trace is drawn
✓ The wheel moves the rows and never sideways ({"moved":0,"room":101,"rows":40})
✓ The reference stays at the top while the reads scroll, with no errors ({"errors":[],"share":0.19649805447470817,"room":101,"pinned":true,"offset":0})
✓ The alignment's scroll bar stays in view and is in step with the traces ({"width":0,"fromBar":0,"inPane":true,"barFollows":true})
✓ The panel buttons hide and show the reads' list and inspector, apart from the map's ({"panelsShown":{"pressed":[true,true],"width":620,"insp":true,"list":true},"panelsHidden":{"pressed":[false,false],"width":1184,"insp":false,"list":false},"outlineKept":true,"stillHidden":true,"panelsBack":{"pressed":[true,true],"width":620,"insp":true,"list":true}})
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
✓ The clone table sorts by status and by how often a clone was seen, and goes back to the list's order ({"status":["StopPartly covered","FrameshiftPartly covered","StopPartly covered","No read aligned","Partly covered","Partly covered","Partly covered","Partly covered"],"seen":["3","1","1","1","1","1","1","1"]})
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
✓ The NEB method offers NEB's polymerases, each with its primer concentration, and only then ([[false,"400"],[true,"400"]])
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
✓ Matching exact versions only flags a clone that is none of them (2026-10-13_C01_MJG5PRIMER1Breaks designPartly coveredGRTLGSLNMAWFRQAPGKEREFVANot one of the versionsAVSWSAGTTYGCAGCGGATAGGCCGCCGGCCGGCGGGGAAGGTCGTGGTATGGATTACNone in what was read3 changes among double peaks left out1,985–2,957)
✓ The inspector shows a long list of versions by its count
✓ Edit versions… opens the whole list and saves it (short:GGTGGT|long:GGTGGTGGT)
✓ The library's parent opens again to turn its features into regions
✓ A CDS with features inside offers to turn them into regions
✓ It lists the frameworks and CDRs, ticked, with their residues and kinds (FR1 1–25 Framework true; cdr1 26–35 CDR true; FR2 36–49 Framework true; cdr2 50–59 CDR true; FR3 60–96 Framework true; cdr3 97–107 CDR true; FR4 108–118 Framework true)
✓ Every ticked row shows the colour its region will have
✓ Nothing changes while the dialog is open
✓ Turning them deletes the features
✓ and makes them regions of the CDS, at the same residues (["FR1 Framework 1-25","cdr1 CDR 26-35","FR2 Framework 36-49","cdr2 CDR 50-59","FR3 Framework 60-96","cdr3 CDR 97-107","FR4 Framework 108-118"])
✓ The inspector draws them in the CDS's protein
✓ It says what happened, with an Undo button
✓ One undo brings the features back and takes the regions away
✓ The CDS's right-click menu offers to turn features into regions (Copy DNA, Copy protein, Protein details…, —, Design primers to amplify…, Mutagenesis primers…, Add protein region…, Turn features into regions…, —, Show in sequence, Rename…, Colour, —, Delete feature)
✓ A feature inside it offers to become one of its regions (Copy DNA, Copy protein, Protein details…, —, Design primers to amplify…, Mutagenesis primers…, Add protein region…, Turn into region of Nanobody…, —, Show in sequence, Rename…, Colour, —, Delete feature)
✓ Only that feature starts ticked (["cdr1"])
✓ It becomes a region of the CDS, which is selected with the region picked ({"kind":"feature","id":"e2e-nanobody","region":0})
✓ Undo takes the file back to how it opened
✓ A FASTQ read of a whole plasmid is shown as one, with its size (pUC19-wholeWhole plasmid2,697 bp (+11)2 differences · 1 uncertain)
✓ The read is turned to the origin, and its changes are called (ReadpUC19-wholeAligned, forward strand · 2 differences · 1 uncertainAligned to1–2,686Identity99.5% (2,684 of 2,698)Read length2,697 basesSize2,697 bp, 11 bp longer than this sequenceQualitymean Q40Clo)
✓ An indel in a run of one base is flagged, not trusted (apUse read basedel T1413uncertainoutside featuresQ40 · in a run of one base, often the sequence)
✓ A new version is offered in a strip, not a dialog (Strandivo 9.9.9 is available.What's new…Install and restartSkip this versionLater)
✓ What's new shows the update's short notes in the app, as text ({"lines":["Faster maps.","<b>New</b> primer tools."],"bold":false})
✓ More on strandivo.com asks for that version's notes
✓ Install and restart downloads it, then quits the way ⌘Q does
✓ If the app stays open, the strip offers to restart (Strandivo 9.9.9 is ready to install.Restart nowLater)
✓ Later hides the strip
✓ After an update the strip says which version it is now (Strandivo was updated to 0.4.0.What's new…Close)
✓ Its What's new opens the dialog
✓ It says so only once
✓ Send feedback… in the app bar opens the feedback dialog with Idea chosen
✓ Report a bug… in the app bar opens the feedback dialog with Bug chosen
✓ Send waits for a summary
✓ No name is listed until one is typed
✓ A name to credit is listed with what is sent (INCLUDED WITH THE REPORT
Strandivo 0.4.0 · Linux 24.4.0 · Intel or AMD
Open view: Home
Sent by: JIB

Recent errors (1)
App errors from the past week, with file paths removed.
)
✓ Recent errors are shown before sending, without the file's path (2026-11-14 19:20:21 Error: Couldn't read <path>)
✓ What is sent with it is listed in full
✓ If it can't be sent, the text stays, with Copy and Email instead
✓ Email instead starts a message with the report in it ({"subject":"Bug: Map stays blank","body":"Bug: Map stays blank\nOpened a plasmid from Home.\n\nStrandivo 0.4.0 · Linux 24.4.0 · Intel or AMD\nOpen view: Home\nS)
✓ The report holds what the dialog showed, and no path ({"errors":["2026-11-14 19:20:21 Error: Couldn't read <path>"],"kind":"bug","summary":"Map stays blank","email":"anna@lab.example.org","file":null,"name":"JIB","view":"Home","crash":null,"app":{"osVers)
✓ It says which issue it became
✓ Open on GitHub asks for that issue by its number
✓ The name sent last time is filled in
✓ Post on GitHub instead opens the idea form filled in, without the email or name (https://github.com/Mateusz-Jaskolowski/Strandivo/issues/new?template=feature_request.yml&title=Invert%20the%20selection&task=With%20a%20key%20%26%20a%20menu%20item.)
✓ It closes the dialog, sending nothing
✓ A crash last time is offered in a strip under the app bar
✓ Nothing about it is sent on its own
✓ Report it… opens Report a Bug about the crash
✓ The crash is shown in full before sending, without the file's path (Strandivo 0.4.0, 2026-11-06 09:30:00 UTC
Thread: tokio-runtime-worker
At: reqwest-0.13.0/src/async_impl/client.rs:2311:5
Could not read <path>)
✓ Send sends the crash as it was shown, and no path ({"errors":null,"kind":"bug","summary":"Strandivo quit unexpectedly","email":null,"file":null,"name":"JIB","view":"Home","crash":{"at":"2026-11-06T09:30:00.000Z","thread":"tokio-runtime-worker","message":"Could not read <path>","location":"r)
✓ Once sent, the strip goes
✓ A crash is offered once
✓ Nothing is counted while statistics are off, errors included (0 events)
✓ Turned on, the app counts its start and what is used ([{"at":"2026-11-14T19:20:23.865Z","name":"app_started","props":{"installed":"first_day","arch":"x86_64","folders":"0"}},{"at":"2026-11-14T19:20:23.866Z","name":"settings_chosen","props":{"tm":"wallace","amber":"off","bases":"upper"}},{"at":)
✓ The start says how long the copy has been in use, as a range, and Settings' choices come with it ([{"at":"2026-11-14T19:20:23.865Z","name":"app_started","props":{"installed":"first_day","arch":"x86_64","folders":"0"}},{"at":"2026-11-14T19:20:23.866Z","name":"settings_chosen","props":{"tm":"wallace","amber":"off","bases":"upper"}}])
✓ A view is counted once, not at every switch ([{"at":"2026-11-14T19:20:24.151Z","name":"view_used","props":{"view":"primers"}},{"at":"2026-11-14T19:20:24.240Z","name":"view_used","props":{"view":"sequence"}}])
✓ Dismiss hides the crash strip
✓ A crash is counted as an error of kind crash, without its message ([{"at":"2026-11-14T19:20:23.866Z","name":"error_caught","props":{"kind":"command"}},{"at":"2026-11-14T19:20:24.360Z","name":"error_caught","props":{"kind":"crash"}}])
✓ Events carry listed words alone, never a file's name or path ([{"installed":"first_day","arch":"x86_64","folders":"0"},{"tm":"wallace","amber":"off","bases":"upper"},{"kind":"command"},{"view":"primers"},{"view":"sequence"},{"kind":"crash"}])
✓ Turned off, what was queued is dropped and nothing more goes (6 events, 6 before)
✓ Home lists the constructs in a library folder (["bla-check.fasta","c7_bla-F.fasta","c7_bla-R.fasta","pUC19-annotated.gb","plate-bla.fasta"])
✓ Home sorts its constructs by length, either way round ({"lengthsUp":[601,601,651,701,2686],"lengthsDown":[2686,701,651,601,601]})
✓ Opening a construct from Home adds a tab
✓ Choosing Dark turns the window dark at once (dark rgb(15, 17, 20))
✓ In dark, the read's traces are drawn
✓ Choosing Light turns it back
