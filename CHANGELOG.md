# What's new in Strandivo

Each release has a section, newest first, headed by its version. Its first paragraph is
the short version: the app shows it in "What's new" before and after updating, so keep it
to two or three plain sentences, without formatting, addresses or file names (the app
won't show notes that name anything like example.com or pUC19.gb). Everything after the
first blank line is the full notes, for the GitHub release and strandivo.com/changes.
`npm run version` fails a release without a section here.

Between releases, a pull request that changes something users notice adds a bullet under
Unreleased, written for them like the bullets below. The app, the website and the release
script read only sections headed by a version, so they skip it. To release, write the
short notes above its bullets and run `npm run release <version>`, which renames it to
the version and starts a new, empty Unreleased. A release candidate (`0.4.0-rc.1`) goes out
with Unreleased's notes and leaves them where they are.

## Unreleased

- **Design primers a little away from the selection**: the Design primers dialog has a
  "Move ends" distance. Allow the ends a few bases and each primer can slide outward onto
  a stretch that suits it, instead of being stuck on an AT-rich or GC-rich one at the edge
  of what you selected. The product only grows, so it still covers the whole region, and
  the pair nearest your selection wins when moving gains nothing. An end that gets a
  restriction site stays where it is.

- **Hide badly matched primer pairs**: the Primers tab's Pairs list hides pairs whose two
  Tms are more than 5 °C apart, and says how many it hid. Set your own limit beside the
  list, or choose Show all to see them, marked.

- **No more "ResizeObserver loop" errors**: the browser's harmless notice when a panel
  resizes as it is drawn no longer shows as an "Unexpected error" or goes into the recent
  errors a bug report can include.

- **GC content along the sequence**: a thin strip under the bases shows where GC leaves
  40–60%, teal where it is AT-rich and orange where it is GC-rich, so you can see where a
  primer will sit well before you draw it. It is on in the Primers tab's sequence panel
  and turned on with the GC button in the Sequence tab, where the bar at the top also
  shows GC across the whole sequence.

- **A tidier toolbar**: the sidebar's button is on the left and the inspector's on the
  right, beside the panels they show, and split view sits next to the views. Buttons that
  do nothing in the current view are greyed out.

- **Choosing enzymes**: Common, Lab and Mine are one row of buttons in the sidebar, with
  the list's Edit link in the Enzymes heading. On the map they are in a menu beside the
  Cut sites button, which shows what is chosen, and the region detail is beside Regions,
  so the bar at the bottom holds only rotate, zoom (with Fit) and label size.

- **Selecting on the map**: dragging round a circular map selects the bases the pointer
  passed over, whichever way it goes. Dragging anticlockwise used to select nearly the
  whole plasmid and shrink it as you went.

- **Primers tab**: clicking another primer in the sequence panel moves the panel to that
  primer, with its Tm, checks and handles, as clicking it in the list does.

- **Notes on features**: the inspector has a Note field for the selected feature, saved
  in the file as its GenBank note, and lists the feature's other details from the file,
  such as gene and database links. Notes with quotes, or long enough to wrap, now open and
  save whole: a quote used to cut the rest of a line off, and words at a line break were
  run together. Long notes saved by earlier versions, which split them mid-word, open
  whole too.

- **Saving right after typing**: a primer's bases edited in the inspector are saved with
  every last keystroke, even when you save straight away. The last letters used to be
  left out of the file.

- **Pasting a sequence**: text copied from a database or another program can be pasted
  whole — a FASTA header, a GenBank record, numbered lines — and only its bases go in.
  Letters that aren't bases used to be pasted as DNA; now Strandivo says the clipboard
  isn't a sequence instead. U is read as T.

- **Partial coding sequences**: a CDS that starts mid-codon (GenBank's codon_start, as in
  many database records) is now translated in its own frame, in the Sequence view, Copy
  protein, and the amino-acid changes reported for reads. Saving keeps qualifiers that hold
  numbers, such as codon_start, and web addresses in notes, which were being dropped.

- **Mutagenic primers**: a primer whose change sits close to its 3′ end is no longer
  reported as not binding the sequence.

- **Library clones**: clones with different CDRs are no longer counted as identical in
  the Clones table when the vector has Ns in its CDRs, or when two CDR3s have the same
  length.

- **Amino-acid changes from reads**: two or three changes in one codon are now read
  together, so a codon swapped whole is reported as one change, such as A2W.

- **Markers on Home and in Info**: NeoR/KanR counts as both kanamycin and neomycin, TcR as
  tetracycline resistance, and TetR, the repressor in Tet-On plasmids, no longer does.

- The PCR dialog gives the same Tm as the Primers tab, and saving while an edit is in
  flight no longer loses it.

- **Designing primers**: candidates that bind more than one place or whose 3′ end pairs
  with itself are avoided, and the pair says so when nothing better fits the region.

- **Find**: finds an enzyme from the chosen list even when the cut-site filter hides it,
  and accepts U in a sequence.

- A coding sequence keeps its colour on the map when another is added before it, and
  positions are written as 1,700–2,400 throughout.

- **My enzymes**: keep a personal restriction enzyme list alongside your lab stock, and
  choose the list separately from how often its enzymes cut. Use your list on maps, in
  Sequence, and when choosing enzymes for a digest or restriction cloning.

If Strandivo quits unexpectedly, it now offers to report the crash the next time it opens,
and shows everything it would send before anything goes. Usage statistics, if you share
them, count a little more, still only as fixed words and ranges.

- **Select codons from translation**: click an amino acid in the Sequence view or around
  a primer to select its DNA bases, or drag to select whole codons. Hold ⌘ on Mac or Ctrl
  elsewhere to pick separate amino acids, and Shift to select through the intervening
  residues. Double-click an amino acid or click the feature name to select the whole
  feature. Copying or deleting separate codons leaves the bases between them alone.

- **Protein regions**: add and edit domains, helices, linkers, CDRs and frameworks within
  one CDS, with colours and nested regions. A protein diagram and expandable outline
  show them, and the map can show all regions, just the top level or none. UniProt now
  offers domains, repeats and other regions too. Regions can vary between clones, and
  Export can include them as ordinary annotations in a GenBank copy for other software.
  Select bases within a CDS and choose Add as region… in the inspector or right-click
  menu; the residue positions are filled in. The Sequence view's Regions button shows
  coloured bars with their names underneath, separately from the CDS's translation.
  The Map view has a Regions button too, which remembers the chosen level of detail;
  there, region names are quieter than features', and hovering a region highlights the
  CDS it belongs to. Regions also appear around the selected primer in the Primers tab, sharing the
  Sequence view's Regions setting.
  New regions get different, coordinated colours automatically, starting near their
  CDS's colour; colours you choose yourself are kept.

- **Protein region controls**: a compact editor offers more kinds and custom categories,
  and keeps names as typed. Clearer action buttons fill the inspector's width, feature
  names stay aligned in the outline, and the map's top-level/all choice appears only for
  nested regions.

- **Crash reports**: if Strandivo quits unexpectedly, it notes why on your computer, and
  the next time it opens a strip under the app bar offers to report it. Report it… opens
  Report a Bug with what it noted, shown in full and with file paths removed; nothing is
  sent until you click Send. Recent errors are now kept for a week, so a report after a
  crash can still include them if you tick them.
- **Usage statistics**, if you share them, count a little more, still only as fixed words
  and ranges: saving, adding features and primers, adding reads, how long a file's
  sequence is and how long alignment takes, and three choices in Settings. Each view is
  counted once each time the app opens, not at every switch. The Privacy page lists every
  event and what it carries.
- **Delete with a feature or primer selected** now deletes only the feature or primer, as
  the inspector's Delete button does, and leaves its bases selected: press Delete again to
  delete them too. Before, one press deleted the bases, and the feature went with them. A
  cut site or an ORF comes from the sequence, so the first press only makes it a plain
  selection of bases.
- **Messages about edits have an Undo button.** Deleting a feature or primer says so with
  Undo beside it, and deleting or replacing bases now says when a feature or primer that
  lay wholly inside them was deleted too, which was easy to miss. A new message about an
  edit replaces the last one instead of piling up, at most three messages show at once,
  and one with a button, or an error, stays while the pointer is over it and can be closed.
- **Gibson and In-Fusion say when two pieces already share their overlap**: where one piece
  ends with the bases the next one starts with, they are joined on those bases and the
  product keeps one copy. That is usually what you want, but not when each piece was meant
  to carry its own copy of a linker or a tag, so the result now says so and gives both
  lengths. Keeping both copies can't be done by moving the overlap around — two copies in
  a row give the join two places to land — so it says to put both copies inside one piece
  and to put the join past them, somewhere the sequence occurs only once.
- **Overlap melting temperatures in Gibson** are now worked out the way the 48 °C guideline
  they are checked against was, by the Wallace rule, and the result says so. They no longer
  change with the method chosen in Settings, which is for the temperatures shown elsewhere.
  A Gibson overlap that melts below the guideline is still only a warning: the product is
  built either way. In-Fusion has no melting temperature to meet, so nothing is warned about
  there, but the temperature it shows for an overlap is now worked out the same way, so both
  methods mean the same thing by it.
- **Gibson and In-Fusion say when an overlap reads the same somewhere else.** An overlap
  that turns up again in the product gives the join another sequence that could pair with
  it, which is one way an assembly comes back with its pieces rearranged or a repeat
  collapsed. The result now names the join and lists where the other copies are, saying
  which are on the other strand. Copies across the origin of a circular product count, and
  capital or small letters make no difference.
- **A piece too short to carry the whole overlap** no longer loses the difference. The
  overlap used to be taken as the full length whether or not the pieces had that many bases
  to share, which quietly cut the missing bases out of the product. The plan now joins on
  the bases the pieces really share, keeps every base of both, and says the overlap came out
  shorter than the method asks for. Where there are no bases to join on at all, it says so
  and builds nothing.
- **An overlap that can't be judged is now reported**, in both Gibson and In-Fusion: where
  the shared bases include anything other than A, C, G or T there is no telling whether
  they will anneal, and the plan says so instead of passing quietly.
- **Keyboard shortcuts on Windows**: Ctrl+S saves again, and so do the other menu keys
  that did nothing there: Ctrl+Shift+S, Ctrl+N, Ctrl+O, Ctrl+W, Ctrl+, and the rest.
- **Menu bar on Windows** stays light, like the rest of the window, instead of switching
  from dark to light when another window such as Settings opened.
- **Cut sites at the end of a row** in the Sequence tab stay inside it: an enzyme that cuts
  right at a row's edge is shown at the start of the next row, beside the rest of its site,
  and a cut on the bottom strand that falls in the next row is drawn there.
- **Codon shading** in the Sequence tab alternates evenly again: the first codon of a
  feature or row was sometimes partly shaded.
- **The Sequence tab stays where you are** when you turn on Translation, Both strands, ORFs,
  Cut sites or Primers, or resize the window. It used to jump to another part of the
  sequence, further the further down you were.
- **Each map keeps its rotation**: a file's map opens turned the way you last turned it.
  The enzymes to show now come last under the map, after rotation, zoom and label size.
- **Map labels on a Mac** sit in the middle of their coloured backgrounds, which no longer
  run on past the end of the name; position numbers around the map are centred too.

## 0.3.1

Fixes a crash in 0.3.0: with usage statistics turned on, Strandivo could quit on its own
about half a minute after starting. If you turned statistics on, please update.

- Sending usage statistics no longer makes Strandivo quit. It happened on every system
  whenever statistics were sent before that day's check for updates, which is most
  launches.

## 0.3.0

Keep a list of your lab's enzymes and where they are, and show only those on the map. Map
labels now tell features, primers and enzymes apart, and you can pick enzymes on the map to
digest with. Send feedback or report a bug from the Help menu, and share anonymous usage
statistics if you choose to.

- **Enzyme library**: open Enzyme Library from the app bar or the Window menu to keep the
  enzymes your lab has, with each product's name, freezer location and notes. Choose Lab
  enzymes on the map or in the outline to show every site of the enzymes you stock and no
  others. Export and Import back the list up or share it, and Import also reads a
  spreadsheet saved as tab-separated or CSV text.
- **Map labels** say what they name: a feature's name sits on a tint of its colour, a
  primer's follows an arrow pointing its way, and an enzyme's is small grey type, darker
  when it cuts once. Enzymes that cut once keep their labels when space runs short, and
  every site's position is in its tooltip.
- **An enzyme's other sites**: selecting a cut site marks the enzyme's other sites on the
  map, in the Sequence tab and in the outline, and the inspector links to each one.
- **Pick enzymes to digest**: ⌘-click (Ctrl-click on Windows and Linux) cut sites to pick
  their enzymes. Digest with… in the inspector, or on a right-click on any of their sites,
  opens the Digest dialog with them ticked. Esc or an ordinary click drops them.
- **Send Feedback… and Report a Bug…** in the Help menu: everything sent is shown first,
  and recent errors (without file paths) and the open file go only if you tick them. Your
  email address, if you give one, and an attached file go to the maintainer alone, never
  into the public report. If a report can't be sent, you can copy it or email it instead.
- The **Help menu** also has Strandivo Website and Strandivo on GitHub, and on Windows and
  Linux Welcome, Check for Updates and About.
- **Usage statistics** stay off unless you turn them on. The welcome window asks once (if
  you have seen it before, it shows only this question), and Settings → Updates and privacy
  has the same switch, with what is sent. They are fixed words and rounded counts, never
  file names, sequences or anything you typed.
- Update checks are now counted by day, version and system, to know how many copies are in
  use; nothing else about a check is kept.
- [strandivo.com](https://strandivo.com) has Download, What's new and Privacy pages; the
  Privacy page lists everything the app sends.

## 0.2.1

A small update with no new features. It is the first to arrive through Strandivo's own
updates, to check that updating works on every system.

- Nothing in the app changes; only the version number is new.

## 0.2.0

Strandivo now updates itself: it checks once a day and installs a new version when you
choose. A welcome window on first launch helps you add your construct folders and start a
primer library.

- Check for Updates… in the Strandivo menu (Help menu on Windows and Linux), and "Check
  for updates automatically" in Settings → Updates and privacy.
- An update downloads in the background and installs when you restart; unsaved files are
  asked about first.
- On Linux, both the AppImage and the .deb update themselves.
- The welcome window can be opened again from Welcome to Strandivo… in the same menu.
