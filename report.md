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
✓ A point on AmpR is found on the map
✓ Double-clicking a CDS on the map opens its Protein details
✓ A point on KpnI's name is found on the map
✓ Double-clicking a cut site on the map opens its Enzyme details
✓ Enzyme details give KpnI's cut, its ends, who sells it and its neoschizomer
✓ A neoschizomer's name opens its own details in their place
✓ Enzyme details find Acc65I's site though the map's list leaves it out
✓ A long name wraps inside the ruler's numbers ({"lines":["testing how it works","and seeing how the","long text works"],"clash":false})
✓ Features that only touch share a lane on the map (151 and 151)
✓ Clicking a feature shows it in the inspector (AmpR: TypeCDS · ReverseLocation1,626–2,486Length861 bp · 286 aaGC49.1%View in sequenceProtein regionsAdd region…Get from UniPr)
✓ A CDS's translation starts folded
✓ Clicking its heading unfolds the translation
✓ The CDS starts with a compact protein summary
✓ The inspector shows the protein's mass and ε280, as ProtParam does (ProteinDetails…Mass31.6 kDaε28027,960 M⁻¹ cm⁻¹28,085 with disulfidesA2800.886 at 1 mg/mL0.890 with disulfides)
✓ The feature is highlighted on the map
✓ Sequence view draws its rows
✓ Sequence letters line up with features and the ruler (width ratio 1.000)
✓ Protein translation is shown under coding features
✓ Coding features are named under their amino acids, not in the margin ({"captions":["lacZ-alpha ←","lacZ-alpha ←","lacZ-alpha ←","lacZ-alpha ←","lacZ-alpha ←"],"margin":0})
✓ Double-clicking a CDS's name in the Sequence tab opens its Protein details
✓ Double-clicking a cut site in the Sequence tab opens its Enzyme details
✓ Sequence translation: amino acids have codon hit areas
✓ Sequence translation: one click selects the codon's three bases without selecting the feature ({"range":{"start":157,"end":159},"focus":null})
✓ Sequence translation: a double-click selects the whole feature and opens nothing ({"range":{"start":145,"end":468},"focus":{"kind":"feature","id":"f-mwpzhoe8-2"},"dialog":false})
✓ Sequence translation: clicking the feature name selects the whole feature ({"range":{"start":145,"end":468},"focus":{"kind":"feature","id":"f-mwpzhoe8-2"}})
✓ Sequence translation: a row has enough residues to check gestures
✓ Sequence translation: dragging forward selects complete codons ({"marked":5,"range":{"start":145,"end":159},"picks":[104,105,106,107,108],"ranges":null})
✓ Sequence translation: dragging backward selects complete codons ({"marked":5,"range":{"start":145,"end":159},"picks":[104,105,106,107,108],"ranges":null})
✓ Sequence translation: Ctrl-click adds a separate codon without its neighbours ({"marked":2,"range":null,"picks":[104,108],"ranges":[{"start":145,"end":147},{"start":157,"end":159}]})
✓ Sequence translation: Ctrl-Shift-click fills from the last clicked codon and keeps other picks ({"marked":4,"range":null,"picks":[104,106,107,108],"ranges":[{"start":145,"end":153},{"start":157,"end":159}]})
✓ Sequence translation: Ctrl-click can remove a picked codon ({"marked":3,"range":null,"picks":[104,106,108],"ranges":[{"start":145,"end":147},{"start":151,"end":153},{"start":157,"end":159}]})
✓ Colour amino acids colours each residue by its chemistry
✓ Coloured sequence translation: amino acids have codon hit areas
✓ Coloured sequence translation: one click selects the codon's three bases without selecting the feature ({"range":{"start":157,"end":159},"focus":null})
✓ Coloured sequence translation: a double-click selects the whole feature and opens nothing ({"range":{"start":145,"end":468},"focus":{"kind":"feature","id":"f-mwpzhoe8-2"},"dialog":false})
✓ Coloured sequence translation: clicking the feature name selects the whole feature ({"range":{"start":145,"end":468},"focus":{"kind":"feature","id":"f-mwpzhoe8-2"}})
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
✓ Typing at the cursor waits in a card ({"on":"","len":2686,"struck":0,"text":"Insert after 5addGAT3 basesEscInsert ↵","open":true})
✓ Enter inserts them (2686 → 2693 bp)
✓ Ctrl+Z undoes one insertion (2693 → 2689 bp)
✓ Ctrl+Y redoes it (2689 → 2686 → 2689 bp)
✓ Typing over selected bases opens a card and changes nothing yet ({"len":2689,"bases":"TTC","text":"Replace 2,059–2,061wasTTCnowA··⚠ 1 of 3 bases · shifts AmpR's frameAmpR · K144fsEscReplace ↵","open":true})
✓ The card counts the bases and names the protein change (Replace 2,059–2,061wasTTCnowAAG✓ 3 bases for 3 · same lengthAmpR · K144LEscReplace ↵)
✓ Enter replaces them in one step ({"len":2689,"bases":"AAG","text":"","open":false})
✓ One undo brings the old bases back
✓ A click elsewhere closes the card and keeps the bases ({"len":2689,"bases":"TTC","text":"","open":false})
✓ It says so, with Replace
✓ Replace in the message replaces them after all (2689 → 2688 bp)
✓ Pasting over selected bases waits in the card (Replace 2,059–2,061wasTTCnowACGTA⚠ 5 bases for 3 · shifts AmpR's frameAmpR · K144fsEscReplace ↵)
✓ Esc closes it and keeps the bases ({"len":2689,"bases":"TTC","text":"","open":false})
✓ At a feature's edge the card asks where new bases go, Neither first ({"on":"Neither","len":2689,"struck":0,"text":"Insert after 2,489addGCT3 basesNew bases go inTab to changeAmpRNeitherNew bases fall outside AmpREscInsert ↵","open":true})
✓ Neither leaves them outside the feature (2488 → 2488)
✓ Tab picks the feature ({"on":"AmpR","len":2689,"struck":0,"text":"Insert after 2,489addGCT3 bases · adds 1 residueNew bases go inTab to changeAmpRNeitherAmpR · adds 1 residueEscInsert ↵","open":true})
✓ It then takes the new bases (2488 → 2491)
✓ Backspace at the cursor marks bases to delete, one more with each press ({"on":"","len":2689,"struck":1,"text":"Delete 198–200delGAA3 bases · removes 1 residuelacZ-alpha · S92delEscDelete ↵","open":true})
✓ Enter deletes them (2689 → 2686 bp)
✓ Cut waits in the card to delete the bases ({"on":"","len":2689,"struck":1,"text":"Delete 200–209delAATACCGCAC⚠ 10 bases · shifts lacZ-alpha's framelacZ-alpha · C89fsor Delete againEscDelete ↵","open":true,"copied":"aataccgcac"})
✓ Esc keeps them
✓ It says they were copied all the same (copied “aataccgcac”)
✓ Pasting a FASTA entry puts in its bases alone, U as T ({"start":"ACGTACGT","grew":8})
✓ Text that isn't a sequence is refused instead of pasted as bases ({"start":"tcgcgGAT","grew":0})
✓ It says why
✓ Shift+arrows select bases ({"start":0,"end":2})
✓ The first Delete on a selected feature deletes the feature, not its bases ({"len":2689,"features":["MCS","AmpR"],"sel":{"caret":472,"range":{"start":148,"end":471},"anchor":null,"focus":null}})
✓ It says the bases are still selected, with an Undo button
✓ The next Delete asks before deleting its bases ({"on":"","len":2689,"struck":5,"text":"Delete 149–472 · 324 bpdelCTATGCGGCATCAGAG…324 basesRemoves MCSor Delete againEscDelete ↵","open":true})
✓ Delete again deletes them (2689 → 2365 bp)
✓ It says the feature inside them went too
✓ Undo in the message brings the bases back (2689 bp, MCS, AmpR)
✓ Undo once more brings the feature back
✓ The status bar shows the selection's Tm, as the inspector does (70.7 and 70.7)
✓ Right-clicking selected bases offers forward and reverse primers (Copy, Copy reverse complement, —, Invert selection, —, Add forward primer, Add reverse primer, Mutagenesis primers…, Add feature, —, Reverse-complement selection, —, Delete bases)
✓ Add reverse primer opens the primer dialog with the selection
✓ Primer dialog preview renders inside its preview box
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
✓ Clicking an end's handle lets the arrow keys move that end (2464,2488,32 → 2463,2488,33)
✓ Dragging over the bases around a primer selects them on both strands ({"still":true,"bands":1,"range":{"start":2429,"end":2453},"focus":null,"text":""})
✓ Primer translation: amino acids have codon hit areas
✓ Primer translation: one click selects the codon's three bases without selecting the feature ({"range":{"start":2486,"end":2488},"focus":null})
✓ Primer translation: a double-click selects the whole feature and opens nothing ({"range":{"start":1628,"end":2488},"focus":{"kind":"feature","id":"f-mwpzhoe8-4"},"dialog":false})
✓ Primer translation: clicking the feature name selects the whole feature ({"range":{"start":1628,"end":2488},"focus":{"kind":"feature","id":"f-mwpzhoe8-4"}})
✓ Primer translation: a row has enough residues to check gestures
✓ Primer translation: dragging forward selects complete codons ({"marked":5,"range":{"start":2474,"end":2488},"picks":[1,2,3,4,5],"ranges":null})
✓ Primer translation: dragging backward selects complete codons ({"marked":5,"range":{"start":2474,"end":2488},"picks":[1,2,3,4,5],"ranges":null})
✓ Primer translation: Ctrl-click adds a separate codon without its neighbours ({"marked":2,"range":null,"picks":[1,5],"ranges":[{"start":2474,"end":2476},{"start":2486,"end":2488}]})
✓ Primer translation: Ctrl-Shift-click fills from the last clicked codon and keeps other picks ({"marked":4,"range":null,"picks":[1,3,4,5],"ranges":[{"start":2474,"end":2482},{"start":2486,"end":2488}]})
✓ Primer translation: Ctrl-click can remove a picked codon ({"marked":3,"range":null,"picks":[1,3,5],"ranges":[{"start":2474,"end":2476},{"start":2480,"end":2482},{"start":2486,"end":2488}]})
✓ Coloured primer translation: amino acids have codon hit areas
✓ Coloured primer translation: one click selects the codon's three bases without selecting the feature ({"range":{"start":2486,"end":2488},"focus":null})
✓ Coloured primer translation: a double-click selects the whole feature and opens nothing ({"range":{"start":1628,"end":2488},"focus":{"kind":"feature","id":"f-mwpzhoe8-4"},"dialog":false})
✓ Coloured primer translation: clicking the feature name selects the whole feature ({"range":{"start":1628,"end":2488},"focus":{"kind":"feature","id":"f-mwpzhoe8-4"}})
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
✓ No side products are reported (Product878 bp49.7% GC · 5′ tails includedProduct mapHideCommon enzymesLab enzymesMy enzymesUnique 6+ cuttersUnique cuttersUnique and dual cuttersEvery site1878AvaIXhoIAhdIBsaIBglIAseIFspIPvuIScaIDraIX)
✓ Escape closes the dialog
✓ With NEB's Q5 as the Tm method, a PCR product says where to anneal (Product878 bp49.7% GC · 5′ tails includedProduct mapHideCommon enzymesLab enzymesMy enzymesUnique 6+ cuttersUnique cuttersUnique and dual cuttersEvery site1878AvaIXhoIAhdIBsaIBglIAseIFspIPvuIScaIDraIXmnIApaLINdeIScaI · cuts after base 564 · 1 site in the product, 1 in the templateBases beyond the si)
✓ A PCR product shows NEB's cycling program for the polymerase (6.0 °C and 64.8 °C · 1.2 °C apartAnneal at66 °C · Q5 High-Fidelity: lower Tm + 1 °C, at most 72 °CContainsAmpRThe 5′ tails pair from the third cycle on, so annealing can rise to 72 °C after 5 cycles.Anneal in two stagesProgramHideModifiedQ5 High-Fidelity DNA Polymerase · NEB M0491Reset programCopy program°CInitial denaturationcycles°CDenature°CAnneal°CExtend°CFinal extension°C∞HoldReaction mixShow)
✓ The final product has a GC strip and a suggested digest
✓ The gel runs the template and the product, uncut and cut (["2689","2689","878","564","314"])
✓ The key names what each lane holds (["1Template, supercoiled2,689 bp","2Template, ScaI2,689 bp","3Product, uncut878 bp","4Product, ScaI564 + 314 bp"])
✓ The supercoiled plasmid runs ahead of the same plasmid cut once (lane 1 at y 83.20139394297829, lane 2 at y 73.75135867545163)
✓ A short product opens the gel on a ladder that reaches its smallest band ({"ladder":"1kb-plus","samples":130.64980463560363,"ladderLowest":160.96577158788554})
✓ Under the product's gel, Save as SVG… saves it with the ladder and each lane in a key (SYNPUC19CV PCR product gel.svg: <?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="264" height="321" fill="#000000" fill-opacity="1" fill-rule="nonzero" stroke="none" stroke-opacity="1" stroke-width="1" stroke-dasharray="none" stroke-linecap="butt" stroke-linejoin="miter" font-family="-apple-syst)
✓ And Save as PNG… a sharp PNG that says its resolution ({"dotsPerInch":767.9943999999999,"width":2112,"lastColumnOpaque":true,"ink":2298890,"cornerAlpha":255,"height":2568,"dpi":true,"lastRowOpaque":true,"png":true})
✓ The product gel's PNG has the gel drawn on it, not only the paper ({"dotsPerInch":767.9943999999999,"width":2112,"lastColumnOpaque":true,"ink":2298890,"cornerAlpha":255,"height":2568,"dpi":true,"lastRowOpaque":true,"png":true})
✓ The product gel's PNG is opaque to its last column and row, as a gel has no transparent background ({"dotsPerInch":767.9943999999999,"width":2112,"lastColumnOpaque":true,"ink":2298890,"cornerAlpha":255,"height":2568,"dpi":true,"lastRowOpaque":true,"png":true})
✓ The product gel's PNG says the resolution that sets it at the SVG's size (767.99 dpi in the file, 768.00 from 2112 px over the SVG's 264, within 0.20)
✓ Another ladder draws the gel beside that one
✓ Q5 on a plasmid has one stage of 25 cycles, with two stages offered for the tails but not ticked ([{"cycles":null,"steps":["Initial denaturation"]},{"cycles":"25 cycles","steps":["Denature","Anneal","Extend"]},{"cycles":null,"steps":["Final extension","Hold"]}])
✓ Ticking Anneal in two stages redraws the dialog
✓ Two stages are four stages: 5 cycles on the pairing parts, then 20 on the whole primers ([{"cycles":null,"steps":["Initial denaturation"]},{"cycles":"5 cycles","steps":["Denature","Anneal","Extend"]},{"cycles":"20 cycles","steps":["Denature","Anneal and extend"]},{"cycles":null,"steps":["Final extension","Hold"]}])
✓ The Anneal at row gives the temperature of each stage (Product878 bp49.7% GC · 5′ tails includedProduct mapHideCommon enzymesLab enzymesMy enzymesUnique 6+ cuttersUnique cuttersUnique and dual cuttersEvery site1878AvaIXhoIAhdIBsaIBglIAseIFspIPvuIScaIDraIXmnIApaLINdeIScaI · cuts after base 564 · 1 site in the product, 1 in the templateBases beyond the sites in the tailsAvaI: 4 bp between its site and the nearest end of the product.XhoI: 4 bp between it)
✓ Unticking it goes back to one stage of 25 cycles ([{"cycles":null,"steps":["Initial denaturation"]},{"cycles":"25 cycles","steps":["Denature","Anneal","Extend"]},{"cycles":null,"steps":["Final extension","Hold"]}])
✓ Sites in the tails with fewer than 6 bases beyond them are listed, in a fold that starts shut ({"text":"Bases beyond the sites in the tailsAvaI: 4 bp between its site and the nearest end of the product.XhoI: 4 bp between its site and the nearest end of the product.NdeI: 4 bp between its site and the nearest end of the product.Check how much each enzyme needs; NEB asks for 6 bases where it lists none.","open":false})
✓ Clicking its heading opens it
✓ It stays open when the dialog is drawn again ({"text":"Bases beyond the sites in the tailsAvaI: 4 bp between its site and the nearest end of the product.XhoI: 4 bp between its site and the nearest end of the product.NdeI: 4 bp between its site and the nearest end of the product.Check how much each enzyme needs; NEB asks for 6 bases where it lists none.","open":true})
✓ And clicking its heading again shuts it, as the checks below expect
✓ Choosing Every site in the product's own filter draws more sites, and the digest follows the list, not the filter (13 → 17 sites, Suggested digestScaIFspIAseIDraIBglIXmnIAclIBsaIApaLIPvuIAhdIBtsINo digest (uncut only)Its fragments are far enough apart to tell on a gel; check the enzymes’ buffer and temperature.Ladder1 kb ladder1 kb Plus ladder100 bp ladder1Template, supercoiled2,689 bp2Template, ScaI2,689 bp3Product, uncut878 bp4Product, ScaI564 + 314 bpTemplate left over from the reaction runs far fainter than the product.Copy imageSave as PNG…Save as SVG…M123410 kb6 kb4 kb3 kb2 kb1.5 kb1 kb500Uncut template, 2,689 bp. Supercoiled DNA runs faster than linear DNA of the same length.2,689 bp878 bp564 bp314 bp)
✓ A lab list with no enzymes draws none, says so and suggests no digest (Product878 bp49.7% GC · 5′ tails includedProduct mapHideCommon enzymesLab enzymesMy enzymesUnique 6+ cuttersUnique cuttersUnique and dual cuttersEvery site1878No cut sites match this list and filter.Simulated gelHideSuggested digestNo digest from this list gives fragments worth running.Ladder1 kb la)
✓ Putting both menus back draws the sites it started with (13 sites)
✓ With no site clicked, the site described follows the digest chosen (FspI: FspI · cuts after base 306 · 1 site in the product, 2 in the template)
✓ Choosing No digest shows uncut DNA lanes only (["1Template, supercoiled2,689 bp","2Product, uncut878 bp"])
✓ Simulated gel folds in the PCR dialog
✓ Simulated gel reopens in the PCR dialog
✓ Product map folds in the PCR dialog
✓ Product map reopens in the PCR dialog
✓ Cycling program folds in the PCR dialog
✓ Cycling program reopens in the PCR dialog
✓ Enter in a program field keeps focus there, with the dialog open and the change made ({"modified":true,"dialog":true,"value":"67","focused":true})
✓ Typing the generated value back and pressing Enter leaves the program unmodified, focus still there
✓ The reaction mix is folded under the program
✓ Clicking Show opens the reaction mix
✓ The mix is NEB's own M0491 table at the 25 µl it starts from (["5X Q5 Reaction Buffer|5|1X","10 mM dNTPs|0.5|200 µM","10 µM forward primer|1.25|0.5 µM","10 µM reverse primer|1.25|0.5 µM","Q5 High-Fidelity DNA Polymerase|0.25|0.02 U/µl","Nuclease-free water|15.8|","Template DNA|1|< 1,000 ng"])
✓ One tube's 0.25 µl of polymerase is called out, with NEB's own dilution
✓ Eight reactions make a master mix a tenth over, and the volume is no longer small ({"warn":0,"head":["Component","Per reaction, µl","Mix (8.8 reactions), µl","Final"],"firstRow":["5X Q5 Reaction Buffer","5","44","1X"],"total":["Master mix","24","211.2",""]})
✓ Copy mix gives the recipe as a notebook would take it (Q5 High-Fidelity DNA Polymerase (NEB M0491), 25 µl × 8.8 reactions
5X Q5 Reaction Buffer: 5 µl, 44 µl in the mix
10 mM dNTPs: 0.5 µl, 4.4 µl in the mix
10 µM forward primer: 1.25 µl, 11 µl in the mix
10 µM reverse primer: 1.25 µl, 11 µl in the mix
Q5 High-Fidelity DNA Polymerase: 0.25 µl, 2.2 µl in the mix
Nuclease-free water: 15.8 µl, 138.6 µl in the mix
Template DNA: 1 µl in each tube
Master mix: 211.2 µl in all, 24 µl per tube)
✓ Template volume of 0 µl is kept in storage and shown in the table ({"row":["Template DNA","0","—","< 1,000 ng"],"stored":0})
✓ Phusion starts at 20 µl, adds 3% DMSO when ticked, and warns on a 100 µM primer stock ({"rows":["5X Phusion HF or GC Buffer|4|1X","10 mM dNTPs|0.4|200 µM","100 µM forward primer|0.1|0.5 µM","100 µM reverse primer|0.1|0.5 µM","DMSO|0.6|3%","Phusion DNA Polymerase|0.2|1.0 units/50 µl PCR","Nuclease-free water|13.6|","Template DNA|1|< 250 ng"],"notes":" Too little to pipette accurately: 10 mM dNTPs 0.4 µl, 100 µM forward primer 0.1 µl, 100 µM reverse primer 0.1 µl, Phusion DNA Polymerase 0.2 µl. Phusion DNA Polymerase may be diluted in 1X Phusion HF or GC Buffer just prior to use to reduce pipetting errors. NEB's table uses a 10 µM primer.Everything but the template can be mixed first, so the tubes differ only in their template."})
✓ Folding the reaction mix hides it again
✓ Copy program uses edited temperatures, times and counts, including the last typed field (Modified PCR program; based on Q5 High-Fidelity DNA Polymerase (NEB M0491), 878 bp
Plasmid · 878 bp · annealing at 66 °C · 1 stage
Initial denaturation: 98 °C, 30 s
30 cycles:
  Denature: 98 °C, 10 s
  Anneal: 64 °C, 1 min 30 s
  Extend: 72 °C, 15 s
Final extension: 72 °C, 2 min
Hold: 4 °C)
✓ One print preview at a time: the PCR dialog's button focuses the open one ({"mirrors":1,"focus":"plan-title","dialogs":2})
✓ A preview only opened and cancelled marks the page for printing while open, then leaves no mirror, class, kept choice or title ({"openedOnce":{"title":"• pUC19-annotated.gb — Strandivo","mirrors":1,"body":true,"sections":null,"html":true,"paper":null,"dialogs":2},"cancelledOnly":{"title":"• pUC19-annotated.gb — Strandivo","mirrors":0,"body":false,"sections":null,"html":false,"paper":null,"dialogs":1}})
✓ Print PCR plan… opens a preview dialog without closing the PCR product dialog
✓ Printable PCR plan reflects edited program, chosen ladder, collapsed mix, unset date, and multiline notes ({"hasMap":true,"mirrorNotes":"Line one: fresh polymerase\nLine two: check gel at 120V","dateBlank":true,"sub":"Template: SYNPUC19CV (2,689 bp, circular · Plasmid)Plan exported 2026-11-21 · Strandivo","footers":0,"hasGel":true,"kicker":"PCR Plan · Bench SheetPlanning snapshot only — not a record that PCR was performed.","text":"PCR Plan · Bench SheetPlanning snapshot only — not a record that PCR wa)
✓ The plan's header says it is a planning snapshot and when it was exported, and the sheet has no footer to spill onto a page ({"kicker":"PCR Plan · Bench SheetPlanning snapshot only — not a record that PCR was performed.","sub":"Template: SYNPUC19CV (2,689 bp, circular · Plasmid)Plan exported 2026-11-21 · Strandivo","footers":0})
✓ Print preview lets users toggle Simulated gel off independently and offers Save as PDF… on desktop ({"previewMap":true,"previewGel":false,"hasSavePdf":true,"mirrorGel":false})
✓ Copy Markdown copies a Markdown bench sheet with edited program and collapsed mix (# Clone verification \#7

- **Template:** SYNPUC19CV (2,689 bp, circular · Plasmid)
- **Predicted product:** 878 bp · 49.7% GC (5′ tails incl.)
- **Template span:** 1,629–2,489 of 2,689 bp
- **Polymerase:** Q5 High-Fidel)
✓ Print… (frontend hook) prints the mirror under the plan's title, alone, then puts the title back ({"printed":[{"title":"Clone verification #7 — PCR Plan","html":true,"disabled":true,"body":true,"mirrorTitle":"Clone verification #7"}],"afterPrint":{"title":"• pUC19-annotated.gb — Strandivo","enabled":true,"body":true,"sections":"{\"primers\":true,\"productMap\":true,\"gel\":true,\"program\":true,\"mix\":true,\"notes\":true}","mirrors":1,"html":true,"paper":"a4","dialogs":2}})
✓ Save as PDF… (frontend hooks) suggests a name from the title, and a cancelled save dialog saves and keeps nothing ({"calls":0,"asked":{"name":"Clone verification #7.pdf","filters":[{"name":"PDF","extensions":["pdf"]}]},"sections":null})
✓ A save dialog that fails says so and writes nothing (["Couldn't choose where to save: Picker broke."])
✓ Save as PDF… (frontend hooks) hands over the path and paper, holds the printed page still and alone, then puts the title back ({"calls":[{"title":"Clone verification #7 — PCR Plan","disabled":true,"path":"/tmp/e2e-plan.pdf","paper":"letter","mirrorGel":true}],"during":{"previewGel":false,"mirrorGel":true,"latePrint":false},"after":{"title":"• pUC19-annotated.gb — Strandivo","enabled":true,"sections":{"productMap":true,"program":true,"mix":true,"notes":true,"primers":true,"gel":true},"paper":"letter","mirrorGel":false}})
✓ A PDF that can't be written says why and leaves the preview ready to try again ({"pdfFailed":{"title":"• pUC19-annotated.gb — Strandivo","enabled":true,"mirrors":1},"pdfFailedToasts":["Couldn't save the PDF: Disk full. Try Print… or Save HTML… instead."]})
✓ Cancelling the print preview cleans up and leaves the PCR dialog, document and settings unchanged ({"title":"• pUC19-annotated.gb — Strandivo","dirty":true,"settings":"{\"appearance\":\"system\",\"minQuality\":20,\"trimCutoff\":0.05,\"labelSize\":10,\"sequenceCase\":\"uppercase\",\"show\":{\"features\":true,\"primers\":true,\"cutsites\":true,\"ruler\":true,\"cdsFeatureTranslations\":true,\"orfs\":false},\"orfs\":{\"minCodons\":75,\"alternativeStarts\":false},\"labFields\":[\"Sequence verified\",\"Verified on\",\"Verified with\",\"Stored at\",\"Antibiotic resistance\",\"Host / strain\",\"Backbone\",\"Insert\",\"Codon optimized for\",\"Source\",\"Notes\"],\"tm\":{\"method\":\"neb\",\"monovalent\":50,\"divalent\":1.5,\"dntp\":0.6,\"primer\":50,\"polymerase\":\"q5\",\"nebPrimer\":500},\"amberAsQ\":false,\"offerDetection\":true,\"sidebar\":{\"order\":[\"primers\",\"enzymes\",\"features\"],\"folded\":[]},\"checkForUpdates\":true,\"shareUsage\":false,\"welcomeSeen\":2}","primers":2,"printing":false,"editedTemp":"64","seqLen":2689,"mirror":false})
✓ Changing polymerase preserves the custom program and offers regeneration
✓ The strip over the kept program says what it was made for, annealing and stages included
✓ Picking another polymerase in the dialog offers it for all Tms (PCR productCheck the product amplified from SYNPUC19CV by two primers.Forward primer (→)Choose a primer…AmpR-XhoI-R (1,629–1,653 →)Reverse primer (←)Choose a primer…AmpR-NdeI-F (← 2,465–2,489)PolymeraseQ5 High-FidelityQ5U Hot StartPhusion High-Fidelity (HF or GC buffer)OneTaq, Standard bufferOneTaq, GC bufferTaq, Standard Taq bufferTaq, ThermoPol bufferTaq 2X or 5X Master MixHemo KlenTaqMultiplex PCR 5X Master MixLongAmp TaqVent or Deep VentTemplatePlasmidGenomic DNA or cDNAColonyTms here are fo)
✓ Its program is OneTaq's, from 94 °C (81)Tm57.2 °C and 56.1 °C · 1.2 °C apart · NEB, OneTaq, Standard bufferAnneal at51 °C · OneTaq, Standard buffer: lower Tm − 5 °C, at most 68 °CContainsAmpRThe 5′ tails pair from the third cycle on, so annealing can rise to 59 °C after 5 cycles.Anneal in two stagesProgramHideModifiedOneTaq Hot Start DNA Polymerase · NEB M0481Reset programCopy program°CInitial denaturationcycles°CDenature°CAnneal°CExtend°CFinal extension°C∞HoldReaction mixShowShow on mapPrint PCR plan…Copy sequenceOpen as new file…)
✓ The program names the product its protocol is for, beside the program (81)Tm57.2 °C and 56.1 °C · 1.2 °C apart · NEB, OneTaq, Standard bufferAnneal at51 °C · OneTaq, Standard buffer: lower Tm − 5 °C, at most 68 °CContainsAmpRThe 5′ tails pair from the third cycle on, so annealing can rise to 59 °C after 5 cycles.Anneal in two stagesProgramHideModifiedOneTaq Hot Start DNA Polymerase · NEB M0481Reset programCopy program°CInitial denaturationcycles°CDenature°CAnneal°CExtend°CFinal extension°C∞HoldReaction mixShowShow on mapPrint PCR plan…Copy sequenceOpen as new file…)
✓ An unfinished program field blocks copying and keeps its text, focus and caret on redraw
✓ Escape cancels unfinished text without closing the PCR dialog
✓ Reset puts the program back and moves focus to Copy program (annealing at 51 °C)
✓ Use for all Tms saves the dialog's polymerase as the Tm method, with its own primer concentration ({"nebPrimer":200,"primer":50,"method":"neb","polymerase":"onetaq","dntp":0.6,"divalent":1.5,"monovalent":50})
✓ Then the strip is gone and the Polymerase menu has the focus (SELECT Polymerase, strip false)
✓ Taq offers a colony as a template (plasmid,complex,colony)
✓ A colony on Taq starts with the longer first denaturation (colony, first step 5 min)
✓ Picking Q5, which has no colony, falls back to a plasmid (plasmid,complex; plasmid; Q5 High-Fidelity DNA Polymerase · NEB M0491)
✓ With genomic DNA or cDNA as the template, the gel runs the product's lanes without the plasmid's (["1Product, uncut878 bp","2Product, ScaI564 + 314 bp"])
✓ Back on a plasmid the gel has the template's lanes again (["1Template, supercoiled2,689 bp","2Template, ScaI2,689 bp","3Product, uncut878 bp","4Product, ScaI564 + 314 bp"])
✓ A polymerase with no protocol says there is no program for it (.6 °C · 1.3 °C apart · NEB, Q5U Hot StartAnneal at66 °C · Q5U Hot Start: the lower TmContainsAmpRThere is no program for Q5U Hot Start yet.Reaction mixThere is no reaction setup for Q5U Hot Start yet.)
✓ Printable PCR plan omits empty tables when protocol and mix are unavailable ({"tables":1,"text":"PCR Plan · Bench SheetPlanning snapshot only — not a record that PCR was performed.SYNPUC19CV PCR (AmpR-XhoI-R / AmpR-NdeI-F)Template: SYNPUC19CV (2,689 bp, circular · Plasmid)Plan exported 2026-11-21 · StrandivoExperiment datePredicted product878 bp · 49.7% GC (5′ tails incl.)Po)
✓ The dialog is back on OneTaq with its program and a plasmid (plasmid)
✓ A Settings change redraws the PCR dialog and keeps focus where it was (menu true, program true, footer true)
✓ A product of ordinary GC has no GC warning (Product878 bp49.7% GC · 5′ tails includedProduct mapHideCommon enzymesLab enzymesMy enzymesUnique 6+ cuttersUnique cuttersUnique and dual cuttersEvery site1878AvaIXhoIAhdIBsaIBglIAseIFspIPvuIScaIDraIX)
✓ A GC-rich product says so, with the GC to one decimal and Q5's enhancer (Product300 bp100.0% GCProduct mapHideCommon enzymesLab enzymesMy enzymesUnique 6+ cuttersUnique cuttersUnique and dual cuttersEvery site1300FseINotIAscIFseI · cuts after base 133 · 1 site in the product, 1 in the templateSimulated gelHideSuggested digestFseINotIAscIApaIPspOMIBglINo digest (uncut only)Its fragments are far enough apart to tell on a gel; check the enzymes’ buffer and temperature.Lad)
✓ Undo takes the GC-rich bases and their primers out again
✓ Right-clicking selected bases offers mutagenesis primers (Copy, Copy reverse complement, —, Invert selection, —, Mutagenesis primers…, Add feature, Add as region…, —, Reverse-complement selection, —, Delete bases)
✓ A selected codon opens the dialog on its residue
✓ The dialog designs a back-to-back pair for the change
✓ Add both primers adds the mutagenesis pair
✓ The forward primer carries the change at its 5′ end, back to back with the reverse one ({"strands":[1,-1],"rEnd":2279,"r":"AmpR-F70A-R","arm":true,"f":"AmpR-F70A-F","start":2280,"id":"p-mwpzioe6-8","differs":true})
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
✓ A site Dam methylation blocks is drawn with an m and a dashed tick, beside the one that cuts ({"chipBlocked":1,"chipXba40":true,"other":true,"dashed":1,"blocked":1})
✓ Simulate cloning lists predicted cuts and warns when methylation blocks a chosen enzyme (XbaI · 2 sites · 1 predicted cut)
✓ The inspector says how many sites cut and why this one doesn't (XbaI2 sites · 1 predicted cutSiteTCTAGALocation41–46Cuts after41 (top) · 45 (bottom)Ends5′ overhang CTAGMethylationWon't cut: Dam methylation (GATC overlaps the site). Assumed dam⁺ strain.All sites41m121View in sequence)
✓ The digest cuts only the unblocked site, giving one linear band, and says why (["200"]  XbaI (2 sites · 1 predicted cut): Won't cut: Dam methylation (GATC overlaps the site). Assumed dam⁺ strain.Grown inNot set (Dam⁺ Dcm⁺ assumed)DH5αNEB 5-alphaTOP10DH10BNEB 10-betaXL1-BlueJM109TG1Stbl3)
✓ Choosing a dam⁻ strain there writes it to the file and both sites cut (["120","80"], Host / strain "JM110")
✓ With the strain set, the map and outline drop the mark
✓ Ctrl+Page Down closes a file's dialog as it shows the next tab
✓ The next tab opens its own dialog
✓ Escape closes the dialog of the tab shown
✓ A dialog closed with its tab stays closed when the tab is shown again
✓ Showing Home closes a file's dialog
✓ Opening a file closes a dialog left over the tab it came from
✓ Closing a file's tab, as the menu's Close does, takes its dialog with it
✓ The file left works as before
✓ A second dialog opens over the first
✓ The first Escape closes only the topmost dialog
✓ The next Escape closes the one under it
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
✓ The Digest dialog's Save as SVG… saves the gel with its ladder, lanes and a key, nothing picked (SYNPUC19CV digest gel.svg: <?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="334" height="413" fill="#000000" fill-opacity="1" fill-rule="nonzero" stroke="none" stroke-opacity="1" stroke-width="1" stroke-dasharray="none" stroke-linecap="butt" stroke-linejoin="miter" font-family="-apple-syst)
✓ Its Save as PNG… saves a sharp PNG that says its resolution ({"dotsPerInch":696.9506,"width":2425,"lastColumnOpaque":true,"ink":1676999,"cornerAlpha":255,"height":2998,"dpi":true,"lastRowOpaque":true,"png":true})
✓ The Digest gel's PNG has the gel drawn on it, not only the paper ({"dotsPerInch":696.9506,"width":2425,"lastColumnOpaque":true,"ink":1676999,"cornerAlpha":255,"height":2998,"dpi":true,"lastRowOpaque":true,"png":true})
✓ The Digest gel's PNG is opaque to its last column and row, as a gel has no transparent background ({"dotsPerInch":696.9506,"width":2425,"lastColumnOpaque":true,"ink":1676999,"cornerAlpha":255,"height":2998,"dpi":true,"lastRowOpaque":true,"png":true})
✓ The Digest gel's PNG says the resolution that sets it at the SVG's size (696.95 dpi in the file, 697.01 from 2425 px over the SVG's 334, within 0.16)
✓ Copy image puts one PNG on the clipboard within the click that asked ({"clipboardItem":"function","types":[["image/png"]],"inClick":true,"found":true,"items":1})
✓ What it copied starts as a PNG does, and a toast says the gel was copied ({"size":149527,"signature":[137,80,78,71,13,10,26,10],"toasts":["Saved test:SYNPUC19CV digest gel.svg","Saved test:SYNPUC19CV digest gel.png","Copied the gel"]})
✓ With the stand-in deleted, the page's own clipboard is back ({"type":"object","own":false,"real":true})
✓ Done closes the Digest dialog
✓ Selecting a site of an enzyme that cuts twice marks its other site on the map (["BglI@1815"])
✓ ⌘/Ctrl-click picks more enzymes, and the inspector offers to digest with them (["BglI","EcoRI","BamHI"])
✓ Right-clicking a picked enzyme keeps the pick and digests with them all (Copy recognition site | Enzyme details… | Digest with BglI, EcoRI and BamHI… | Show in sequence | Add to My enzymes)
✓ A cut site's right-click menu offers its Enzyme details (Copy recognition site | Enzyme details… | Digest with BglI, EcoRI and BamHI… | Show in sequence | Add to My enzymes)
✓ The Digest dialog opens with the picked enzymes ticked (["BamHI","BglI","EcoRI"])
✓ Esc drops the picked enzymes
✓ The enzyme library opens in its own window
✓ The stock record for EcoRI is saved
✓ The stock record for PvuII is saved
✓ Product, freezer location and edited notes are kept in the JSON file ({"entries":[{"location":"Freezer 2, box A","product":"E2E EcoRI","notes":"Updated spare tube","id":"enzyme-mwpzj32z-1","enzyme":"EcoRI"},{"location":"Freezer 2, box A","product":"E2E PvuII","notes":"Spare tube","id":"enzyme-mwpzj3bm-2","enzyme":"PvuII"}],"version":1})
✓ Stock rows show each enzyme's cut and the ends it leaves
✓ The stock table sorts by a clicked column, both ways
✓ My enzymes saves EcoRI and lists it under My selected enzymes at once
✓ My enzymes saves Acc65I and lists it under My selected enzymes at once
✓ My enzymes saves PvuII and lists it under My selected enzymes at once
✓ My selected enzymes shows the chosen names and lab membership
✓ The personal checklist keeps keyboard navigation between rows
✓ Only the current row of each box is in the Tab order, so Tab leaves the list
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
✓ Circular selected region leaders keep their stronger accent stroke
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
✓ Linear selected region leaders keep their stronger accent stroke
✓ Linear parent selection takes precedence over the hover outline
✓ Linear right-clicking a region keeps its own actions
✓ Linear dragging suppresses region hover
✓ Linear hover resumes after dragging
✓ Linear pointer cancellation clears hover
✓ Linear redraw clears hover
✓ Linear hiding the map clears hover
✓ Linear hiding regions clears hover and preserves CDSs
✓ Linear leaving the map clears hover
✓ Crowded linear features and protein regions get anchored labels ({"regions":true,"features":true,"arrows":true,"cuts":true})
✓ Linear primer arrows pack by binding overlap and draw both pieces across the origin
✓ Linear enzyme leaders start at their own cut ticks
✓ Crowded linear labels fit at label size 8 (null)
✓ Crowded linear labels fit at label size 16 (null)
✓ Clicking a displaced linear primer label selects its mark
✓ Clicking a displaced linear feature label selects its mark
✓ Clicking a displaced linear cutsite label selects its mark
✓ A linear cut-site count opens a keyboard-accessible list of its own ticks
✓ Choosing a grouped site selects its enzyme and highlights the count
✓ Picking from the cut-site list keeps both picked enzymes
✓ Zooming in restores a name for a separated tick and keeps identical cuts grouped
✓ A CDS offers regions from UniProt
✓ Looking up an entry offers what can be placed
✓ Adding them adds no features
✓ They are drawn inside the CDS
✓ The inspector draws both regions
✓ Independent regions need no top-level/all choice
✓ The entry goes in the file's cross-references
✓ An imported region labels both coordinate systems
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
✓ The inspector names the selected region and links back to its parent
✓ The region list opens when the diagram label clips
✓ Viewing the region in Sequence keeps its own bases selected
✓ Viewing the region back on Map keeps its bases selected
✓ The parent link selects the enclosing region
✓ The list can fold a region's children
✓ Picking a child in the diagram reveals it in the list
✓ Protein details draw a block for the CDR and a bracket for its domain, all named apart
✓ At top level the figure draws the domain as a block
✓ Clicking a block in the figure selects its region
✓ Clicking the selected block again returns to its CDS
✓ The figure can be copied or saved as PNG or SVG
✓ Protein details give both coefficients for a protein with a pair of Cys
✓ Protein details fold the list of regions under the figure
✓ Closing a region editor opened from Protein details returns to them
✓ Leaving a file with a region editor open leaves no dialog, Protein details included
✓ No dialog comes back with the file's tab
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
✓ A selected region has a handle at each end in Sequence (2)
✓ Its handle says what it moves (Drag to move where CDR1 edited ends, a codon at a time)
✓ Dragging the end two codons out makes the region two residues longer (9-21)
✓ The region stays selected, with its handles
✓ One undo takes the whole drag back (9-19)
✓ An arrow key moves the end a residue (10-19)
✓ The keyboard stays on the handle
✓ A handle where two regions meet says Alt moves its own end alone (Drag to move where CDR1 edited ends and FR2 starts, a codon at a time; Alt-drag moves only where CDR1 edited ends)
✓ Where two regions meet, the arrow keys move both (9-20, 21-25)
✓ With Alt, only the selected region's end moves, parting the two (9-19, 21-25)
✓ Undo takes the meeting region away again
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
✓ Export keeps all formats in the picker and its buttons together
✓ Cancel closes Export
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
✓ A feature inside it offers to become one of its regions (Copy DNA, Copy protein, Protein details…, —, Design primers to amplify…, Mutagenesis primers…, Add protein region…, Turn features into regions…, Turn into region of Nanobody…, —, Show in sequence, Rename…, Colour, —, Delete feature)
✓ Only that feature starts ticked (["cdr1"])
✓ The long feature list scrolls all the way to its last row
✓ Select all ticks every eligible feature and leaves separate pieces alone
✓ Deselect all clears the checkboxes and disables Apply
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
✓ After an update the strip says which version it is now (Strandivo was updated to 0.5.0.What's new…Close)
✓ Its What's new opens the dialog
✓ It says so only once
✓ Send feedback… in the app bar opens the feedback dialog with Idea chosen
✓ Report a bug… in the app bar opens the feedback dialog with Bug chosen
✓ Send waits for a summary
✓ No name is listed until one is typed
✓ A name to credit is listed with what is sent (INCLUDED WITH THE REPORT
Strandivo 0.5.0 · Linux 24.4.0 · Intel or AMD
Open view: Home
Sent by: JIB

Recent errors (1)
App errors from the past week, with file paths removed.
)
✓ Recent errors are shown before sending, without the file's path (2026-11-21 05:47:29 Error: Couldn't read <path>)
✓ What is sent with it is listed in full
✓ If it can't be sent, the text stays, with Copy and Email instead
✓ Email instead starts a message with the report in it ({"subject":"Bug: Map stays blank","body":"Bug: Map stays blank\nOpened a plasmid from Home.\n\nStrandivo 0.5.0 · Linux 24.4.0 · Intel or AMD\nOpen view: Home\nS)
✓ The report holds what the dialog showed, and no path ({"errors":["2026-11-21 05:47:29 Error: Couldn't read <path>"],"kind":"bug","summary":"Map stays blank","email":"anna@lab.example.org","file":null,"name":"JIB","view":"Home","crash":null,"app":{"osVers)
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
✓ Turned on, the app counts its start and what is used ([{"at":"2026-11-21T05:47:32.049Z","name":"app_started","props":{"installed":"first_day","arch":"x86_64","folders":"0"}},{"at":"2026-11-21T05:47:32.050Z","name":"settings_chosen","props":{"tm":"wallace","amber":"off","bases":"upper"}},{"at":)
✓ The start says how long the copy has been in use, as a range, and Settings' choices come with it ([{"at":"2026-11-21T05:47:32.049Z","name":"app_started","props":{"installed":"first_day","arch":"x86_64","folders":"0"}},{"at":"2026-11-21T05:47:32.050Z","name":"settings_chosen","props":{"tm":"wallace","amber":"off","bases":"upper"}}])
✓ A view is counted once, not at every switch ([{"at":"2026-11-21T05:47:32.336Z","name":"view_used","props":{"view":"primers"}},{"at":"2026-11-21T05:47:32.439Z","name":"view_used","props":{"view":"sequence"}}])
✓ Dismiss hides the crash strip
✓ A crash is counted as an error of kind crash, without its message ([{"at":"2026-11-21T05:47:32.050Z","name":"error_caught","props":{"kind":"command"}},{"at":"2026-11-21T05:47:32.531Z","name":"error_caught","props":{"kind":"crash"}}])
✓ Events carry listed words alone, never a file's name or path ([{"installed":"first_day","arch":"x86_64","folders":"0"},{"tm":"wallace","amber":"off","bases":"upper"},{"kind":"command"},{"view":"primers"},{"view":"sequence"},{"kind":"crash"}])
✓ Turned off, what was queued is dropped and nothing more goes (6 events, 6 before)
✓ Home lists the constructs in a library folder (["bla-check.fasta","c7_bla-F.fasta","c7_bla-R.fasta","pUC19-annotated.gb","plate-bla.fasta"])
✓ Home sorts its constructs by length, either way round ({"lengthsUp":[601,601,651,701,2686],"lengthsDown":[2686,701,651,601,601]})
✓ Opening a construct from Home adds a tab
✓ Choosing Dark turns the window dark at once (dark rgb(15, 17, 20))
✓ In dark, the read's traces are drawn
✓ In dark, the Digest dialog's Save as SVG… still saves the whole gel (library-parent digest gel.svg: <?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="266" height="413" fill="#000000" fill-opacity="1" fill-rule="nonzero" stroke="none" stroke-opacity="1" stroke-width="1" stroke-dasharray="none" stroke-linecap="butt" stroke-linejoin="miter" font-family="-apple-syst)
✓ Saved in dark or in light, the gel is the same SVG, as an image is always drawn in the light theme (theme read: dark, then light, then dark; 3238 and 3238 characters)
✓ Sites too many to name are counted where they cut, and the chip names them ({"ticks":9,"height":195,"detail":"9 more sites here: SfiI, NcoI, MscI, AgeI, BamHI, EcoO109I, AvaI, XmaI, SmaI.","chip":"+9"})
✓ A Settings change leaves focus on the counted sites
✓ Choosing Light turns it back
