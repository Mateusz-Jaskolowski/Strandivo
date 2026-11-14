# Browser version report

✓ The web build opens a file in a tab with its map
✓ Nothing stands in for the core: no shell and no test hooks
✓ The page comes with the Content Security Policy it is deployed with (default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self'; connect-src 'sel)
✓ A first visit's welcome window asks nothing about updates (Usage statistics, Your constructs, Primer library)
✓ It says statistics are on in a browser, and offers to turn them off
✓ Turn off says nothing is sent
✓ Closing the window keeps them off
✓ The full enzyme catalogue renders only its visible rows
✓ The browser saves EcoRI in My enzymes
✓ The browser saves Acc65I in My enzymes
✓ The browser saves PvuII in My enzymes
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
✓ Selected region leaders keep their stronger accent stroke
✓ Circular leaving the map clears hover
✓ Linear map region labels are quiet, readable and name their owning protein
✓ Linear region stripes lie within their CDS
✓ Linear region label highlights its bands and only its own CDS
✓ Linear a split region highlights every piece
✓ Linear overlapping proteins with identical region names stay distinct
✓ Linear nested region hover identifies the owning CDS
✓ Linear hover changes neither document state nor label width
✓ Linear clicking a region label selects region zero at the measured weight
✓ Linear leaving the map clears hover
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
✓ Nothing the page did broke its Content Security Policy
