# Browser version report

✓ The web build opens a file in a tab with its map
✓ Nothing stands in for the core: no shell and no test hooks
✓ The page comes with the Content Security Policy it is deployed with (default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'sel)
✓ A first visit's welcome window asks nothing about updates (Usage statistics, Your constructs, Primer library)
✓ It says statistics are on in a browser, and offers to turn them off
✓ Turn off says nothing is sent
✓ Closing the window keeps them off
✓ The full enzyme catalogue renders only its visible rows
✓ My enzymes opens on the common enzymes, under their heading, before the rest of the catalogue
✓ The browser saves EcoRI in My enzymes and lists it under My selected enzymes
✓ The browser saves Acc65I in My enzymes and lists it under My selected enzymes
✓ The browser saves PvuII in My enzymes and lists it under My selected enzymes
✓ A search filters both boxes
✓ Unticking in My selected enzymes takes the row out at once
✓ …and unticks it in All enzymes
✓ Ticking it again in All enzymes brings it back
✓ All enzymes folds from its title, and the choice is kept
✓ The personal map shows every chosen site and keeps Acc65I's name
✓ The outline shares both enzyme choices
✓ Unique cutters hides PvuII without changing the personal source
✓ Sequence uses the same personal enzyme names and filter
✓ Digest starts from My enzymes and offers a multi-cutter hidden on the map
✓ Changing Digest's source retains an explicitly chosen non-common enzyme
✓ Restriction cloning starts with the personal source
✓ Restriction cloning keeps the selected enzyme through a source change
✓ Golden Gate retains its Type IIS choices
✓ Removing a personal enzyme updates the map immediately
✓ Adding from a site preserves the active source
✓ The personal list, source and filter survive reopening
✓ The reopened checklist keeps all personal selections
✓ Personal enzyme changes do not mark the sequence as edited
✓ Circular map region labels are quiet, readable and name their owning protein
✓ Circular region stripes lie within their CDS
✓ Circular region label highlights its bands and only its own CDS
✓ Circular a split region highlights every piece
✓ Circular overlapping proteins with identical region names stay distinct
✓ Circular nested region hover identifies the owning CDS
✓ Circular hover changes neither document state nor label width
✓ Circular clicking a region label selects region zero at the measured weight
✓ Circular selected region leaders keep their stronger accent stroke
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
✓ Linear leaving the map clears hover
✓ Crowded linear features and protein regions get anchored labels ({"arrows":true,"cuts":true,"features":true,"regions":true})
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
✓ Detect features finds parts in the sequence
✓ pUC19's origin is among them, and AmpR, already in the file, isn't (ori, lac operator, CAP binding site)
✓ A plate of reads aligns (true)
✓ Identical clones share a row, with their change ([["A01_bla","A02_bla"],"A01_bla +1","2","Partly covered","AmpR W163R","1,700–2,350"])
✓ The clone table flags a stop and a frameshift ([[["A03_bla"],"A03_bla","1","StopPartly covered","AmpR W163*","1,700–2,350"],[["A05_bla"],"A05_bla","1","FrameshiftPartly covered","AmpR D129fs","1,700–2,350"]])
✓ A panic in the core fails its request with the panic's message (the core stopped unexpectedly (capacity overflow at alloc/src/raw_vec/mod.rs:29))
✓ After it, the core aligns the plate again (A06's amber stop as W163Q) ([["A06_bla"],"A06_bla","1","Partly covered","AmpR W163Q","1,700–2,350"])
✓ No alignment failed along the way
✓ Home says the files never leave the computer, and links to how ({"href":"https://strandivo.com/privacy#the-browser-version","text":"Runs in your browser. Your files never leave this computer. How?"})
✓ Settings offers no update checks in a browser, and statistics stay as turned off ({"shared":false,"updates":false})
✓ The app bar's menu has the menu bar's groups (File,Edit,View,Tools,Window,Help)
✓ It shows the keys that work in a browser, and greys out what needs a file ([{"key":"Ctrl+Alt+N","label":"New Sequence","on":true},{"key":"Ctrl+O","label":"Open…","on":true},{"key":"Ctrl+S","label":"Save","on":false},{"key":"Ctrl+Shift+S","label":"Save As…","on":false},{"key":"","label":"Export GenBank…","on":false},{"key":"","label":"Export FASTA…","on":false},{"key":"","label":"Close Tab","on":false},{"key":"","label":"Settings…","on":true}])
✓ Ctrl+Alt+N makes a new sequence, as the browser keeps Ctrl+N
✓ Open… opens the file the browser's picker gave (true)
✓ Leaving the page isn't asked about with nothing unsaved
✓ The menu has Invert Selection after Select All, with no key in a browser ([{"key":"Ctrl+Z","label":"Undo"},{"key":"Ctrl+Y","label":"Redo"},{"key":"Ctrl+A","label":"Select All"},{"key":"","label":"Invert Selection"},{"key":"Ctrl+F","label":"Find…"},{"key":"","label":"Reverse Complement"},{"key":"","label":"Set Origin at Cursor"}])
✓ Invert Selection selects the rest of the plasmid, across the origin ({"end":144,"start":469})
✓ With unsaved changes, the browser asks before leaving
✓ Save writes over the file it opened (LOCUS       pUC19_from_the_browser      )
✓ Save As writes the file chosen in the browser's save dialog, and the tab follows it (LOCUS       pUC19_from_the_browser      )
✓ The gel saves as an SVG through the browser's save dialog, styles and key included (<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="414" fill="#000000" fill-opacity="1" fill-rule="nonzero" stroke="none" stroke-opacity="1" stroke-widt)
✓ And as a sharp PNG that says its resolution ({"cornerAlpha":255,"dotsPerInch":685.4444,"dpi":true,"height":2956,"ink":1640404,"lastColumnOpaque":true,"lastRowOpaque":true,"png":true,"width":2999})
✓ The Digest gel's PNG has the gel drawn on it, not only the paper ({"cornerAlpha":255,"dotsPerInch":685.4444,"dpi":true,"height":2956,"ink":1640404,"lastColumnOpaque":true,"lastRowOpaque":true,"png":true,"width":2999})
✓ The Digest gel's PNG is opaque to its last column and row, as a gel has no transparent background ({"cornerAlpha":255,"dotsPerInch":685.4444,"dpi":true,"height":2956,"ink":1640404,"lastColumnOpaque":true,"lastRowOpaque":true,"png":true,"width":2999})
✓ The Digest gel's PNG says the resolution that sets it at the SVG's size (685.44 dpi in the file, 685.49 from 2999 px over the SVG's 420, within 0.13)
✓ Recent files keep files with a handle, shown by name
✓ Add folder… lists the sequence files in a folder and its subfolders (true: pUC19.gb, pIB2-SEC13-mEGFP.dna)
✓ Home shows the folder by its name, never its key
✓ Reads picked in the browser's picker are added
✓ They are remembered, and come back when the file opens again
✓ Save check… in the folder writes paths relative to it, and a read from elsewhere by name ({"strandivo":"read check","version":1,"reference":"../pUC19.gb","reads":[{"path":"sage-sample.ab1","clone":null},{"path":"plate-bla.fasta","clone":null}],"minQuality":20,"trimCutoff":0.05})
✓ After a reload, Home lists the folder again
✓ The file's reads come back too
✓ A check in the folder opens with its reads there, and asks for one from elsewhere (true)
✓ The read chosen is matched by name and added with the others
✓ Open… falls back to a file input
✓ The file input opens a SnapGene file
✓ The SnapGene file's primers come with it
✓ Save, which can't write over it, downloads a GenBank copy ({"name":"pIB2-SEC13-mEGFP.gb","text":"LOCUS       "})
✓ The first download says why
✓ The second doesn't say it again
✓ Without folders, Home lists the files opened during the visit, and says why
✓ A file dragged over the window shows where it will go (true)
✓ A file dropped on Home opens in a tab
✓ A trace dropped on a file is added to its reads
✓ Held only for the visit, the reads aren't remembered, and the Reads tab says so
✓ Save check… downloads a check naming the files beside it ({
  "strandivo": "read check",
  "version": 1,
  "reference": "dropped.gb",
  "reads": [
    {
      "path": "sage-sample.ab1",
      "clone": null
    }
  ],
  "minQuality": 20,
  "trimCutoff": 0.05
)
✓ A check opened there finds its sequence among the open files, and asks for its reads
✓ The read chosen is matched by name
✓ A check whose sequence isn't open asks for its files
✓ They open matched by name, with the check's read
✓ Print PCR plan… opens a preview over the PCR dialog
✓ Browser preview labels Print / Save as PDF… and lets Product map be omitted while keeping Simulated gel ({"gelOnlyOk":true,"hasDesktopPdf":false,"printLabel":"Print / Save as PDF…"})
✓ Save HTML… downloads a self-contained bench sheet honoring section toggles, edited program, collapsed mix, escaped multiline notes, and no full template sequence (<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Web bench sheet &lt;v1&gt; — PCR Plan</title>
<style>
@page {
  margin: 9.5mm;
}
* {
  box-sizing: border-box;
}
:root {
)
✓ The page printed and the saved HTML say the same, word for word (2399 vs 2399 characters; live …PCR Plan · Bench Sheet Planning snapshot only — not a recor… saved …PCR Plan · Bench Sheet Planning snapshot only — not a recor…)
✓ The plan prints on as many A4 and US Letter pages from the preview as from the saved file ({"livePages":{"a4":1,"letter":1},"savedPages":{"a4":1,"letter":1}})
✓ The schematic opens with the selected region highlighted
✓ Clicking the highlighted region again selects the whole CDS
✓ The whole CDS also offers the schematic in the inspector
✓ Another region can still be selected from the schematic
✓ The schematic exports PNG and SVG with a white background ({"labels":["FR3","FR1","FR2","CDR3","FR4","CDR2","CDR1","Variable domain","1","20","40","60","80","100","118"],"pixel":[255,255,255,255],"white":"#ffffff"})
✓ The schematic exports PNG and SVG with a transparent background ({"labels":["FR3","FR1","FR2","CDR3","FR4","CDR2","CDR1","Variable domain","1","20","40","60","80","100","118"],"pixel":[0,0,0,0],"white":null})
✓ Nothing the page did broke its Content Security Policy
