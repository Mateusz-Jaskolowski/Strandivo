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

Mark domains, linkers and CDRs in a coding sequence as protein regions, and see them on the
map. The Reads tab copes with hundreds of reads and keeps the reference in view, and primer
design can move ends onto better stretches. Ctrl+S works again on Windows, and if Strandivo
ever quits unexpectedly it offers to report the crash.

- **Protein regions**: mark domains, helices, linkers, CDRs and frameworks within a CDS,
  nested if need be, from more kinds or categories of your own. Select bases within a CDS
  and choose Add as region… in the inspector or the right-click menu, and the residue
  positions are filled in; Get from UniProt… now offers domains, repeats and other regions
  too. New regions get colours of their own near their CDS's, and colours you choose are
  kept. Regions show in a protein diagram, in the outline, as coloured bars with their
  names in the Sequence view and around the selected primer, and on the map, where the
  Regions button chooses all of them, the top level or none, and hovering one highlights
  its CDS. A region can be marked to vary between clones of a library, with its known
  versions written as DNA bases or as amino acids, and Export can include regions as
  ordinary annotations in a GenBank copy for other software.
- **Library versions**: a clone can be matched to the closest of a region's versions, or
  only to one it is exactly, which suits a large designed library; anything else is
  flagged. Versions equally close to a clone are all named instead of the first one
  listed. Finding a clone among many thousands of versions is much faster, the region's
  settings warn when a long list would still be slow, and the Reads tab shows how far it
  has got instead of stopping while it matches. A long list shows in the inspector by its
  count, with Edit versions… for the whole list.
- **Select codons from translation**: click an amino acid in the Sequence view or around
  a primer to select its DNA bases, or drag to select whole codons. Hold ⌘ on Mac or Ctrl
  elsewhere to pick separate amino acids, and Shift to select through the intervening
  residues. Double-click an amino acid or click the feature name to select the whole
  feature. Copying or deleting separate codons leaves the bases between them alone.
- **Partial coding sequences**: a CDS that starts mid-codon (GenBank's codon_start, as in
  many database records) is now translated in its own frame, in the Sequence view, Copy
  protein, and the amino-acid changes reported for reads. Saving keeps qualifiers that
  hold numbers, such as codon_start, and web addresses in notes, which were being dropped.
- **GC content along the sequence**: a thin strip under the bases shows where GC leaves
  40–60%, teal where it is AT-rich and orange where it is GC-rich, so you can see where a
  primer will sit well before you draw it. It is on in the Primers tab's sequence panel
  and turned on with the GC button in the Sequence tab, where the bar at the top also
  shows GC across the whole sequence.
- **Notes on features**: the inspector has a Note field for the selected feature, saved
  in the file as its GenBank note, and lists the feature's other details from the file,
  such as gene and database links. Notes with quotes, or long enough to wrap, now open and
  save whole: a quote used to cut the rest of a line off, and words at a line break were
  run together. Long notes saved by earlier versions, which split them mid-word, open
  whole too.
- **Pasting a sequence**: text copied from a database or another program can be pasted
  whole — a FASTA header, a GenBank record, numbered lines — and only its bases go in.
  Letters that aren't bases used to be pasted as DNA; now Strandivo says the clipboard
  isn't a sequence instead. U is read as T.
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
- **My enzymes**: keep a personal list of restriction enzymes beside your lab's stock, and
  choose how often an enzyme must cut to be shown separately from which list it comes
  from. Common, Lab and Mine are one row of buttons in the sidebar, and on the map they are
  in a menu beside the Cut sites button, which shows what is chosen. Any list can be used
  on the map, in the Sequence tab, and to choose enzymes for a digest or restriction
  cloning, and Find finds an enzyme from the chosen list even when the filter hides it.
- **A tidier toolbar**: the sidebar's button is on the left and the inspector's on the
  right, beside the panels they show, and split view sits next to the views. Buttons that
  do nothing in the current view are greyed out. Under the map, the bar holds only rotate,
  zoom (with Fit) and label size.
- **Resizable sidebar and inspector**: drag the inner edge of either panel to make it
  wider or narrower, in every view that has them, Reads included. The widths are kept for
  every file; double-click an edge for the usual width.
- **The map**: each file's map opens turned the way you last turned it. Dragging round a
  circular map selects the bases the pointer passed over, whichever way it goes; dragging
  anticlockwise used to select nearly the whole plasmid. A coding sequence keeps its
  colour when another is added before it, and on a Mac labels sit in the middle of their
  coloured backgrounds, with position numbers centred too.
- **The Sequence tab stays where you are** when you turn on Translation, Both strands, ORFs,
  Cut sites or Primers, or resize the window; it used to jump, further the further down you
  were. An enzyme that cuts right at a row's edge is shown beside the rest of its site, and
  codon shading alternates evenly again.
- **Sort more tables**: click a heading to sort Home's constructs by name, length or date
  changed (within each folder), the Clones table by clone, how often it was seen, status
  or mutations, and the primer library by name, length, Tm or GC. A second click turns
  the order round; in the Clones table a third goes back to the order of your reads.
- **Hundreds of reads**: the Reads tab's alignment draws only the reads near the view, so
  large sets of reads with traces use far less memory, and on a Mac no longer leave the
  traces blank. The ruler, features, translation and reference stay at the top while you
  scroll down through the reads, unless the pane is too short for both.
- **Read names in the alignment**: reads from one plate leave out the start their names
  share, such as the date, so the well and primer show. With traces on, a long name wraps
  instead of being cut off. Drag the edge of the names column to resize it, or
  double-click it to fit the names.
- **Amino-acid changes from reads**: two or three changes in one codon are now read
  together, so a codon swapped whole is reported as one change, such as A2W.
- **Library clones**: clones with different CDRs are no longer counted as identical in
  the Clones table when the vector has Ns in its CDRs, or when two CDR3s have the same
  length.
- **Design primers a little away from the selection**: the Design primers dialog has a
  "Move ends" distance. Allow the ends a few bases and each primer can slide outward onto
  a stretch that suits it, instead of being stuck on an AT-rich or GC-rich one at the edge
  of what you selected. The product only grows, so it still covers the whole region, and
  the pair nearest your selection wins when moving gains nothing. An end that gets a
  restriction site stays where it is. Candidates that bind more than one place or whose
  3′ end pairs with itself are avoided, and the pair says so when nothing better fits.
- **Hide badly matched primer pairs**: the Primers tab's Pairs list hides pairs whose two
  Tms are more than 5 °C apart, and says how many it hid. Set your own limit beside the
  list, or choose Show all to see them, marked.
- **Primers tab**: clicking another primer in the sequence panel moves the panel to that
  primer, with its Tm, checks and handles, as clicking it in the list does. The PCR dialog
  gives the same Tm as the Primers tab.
- **Mutagenic primers**: a primer whose change sits close to its 3′ end is no longer
  reported as not binding the sequence.
- **Saving right after typing**: a primer's bases edited in the inspector are saved with
  every last keystroke, even when you save straight away, and saving while any edit is in
  flight no longer loses it. The last letters used to be left out of the file.
- **Gibson and In-Fusion check their overlaps more closely.** The result says when two
  pieces already share their overlap, so the product keeps one copy of it, which matters
  when each was meant to carry its own linker or tag; to keep both, put both copies inside
  one piece and the join past them. It names a join whose overlap reads the same somewhere
  else in the product, on either strand, which is one way an assembly comes back
  rearranged, and one whose shared bases include anything other than A, C, G or T.
- **A piece too short to carry the whole overlap** no longer loses bases: the plan joins
  on the bases the pieces really share, keeps every base of both, and says the overlap
  came out shorter than the method asks for.
- **Overlap melting temperatures** in Gibson and In-Fusion are worked out by the Wallace
  rule, as the 48 °C guideline they are checked against was, and no longer change with the
  method chosen in Settings, which is for the temperatures shown elsewhere.
- **Markers on Home and in Info**: NeoR/KanR counts as both kanamycin and neomycin, TcR as
  tetracycline resistance, and TetR, the repressor in Tet-On plasmids, no longer does.
- **On Windows**, Ctrl+S saves again, and so do the other menu keys that did nothing
  there: Ctrl+Shift+S, Ctrl+N, Ctrl+O, Ctrl+W, Ctrl+, and the rest. The menu bar stays
  light, like the rest of the window, instead of turning dark when another window such as
  Settings opened.
- **Crash reports**: if Strandivo quits unexpectedly, it notes why on your computer, and
  the next time it opens a strip under the app bar offers to report it. Report it… opens
  Report a Bug with what it noted, shown in full and with file paths removed; nothing is
  sent until you click Send. Recent errors are now kept for a week, so a report after a
  crash can still include them if you tick them.
- **No more "ResizeObserver loop" errors**: this harmless notice, given when a panel
  resizes as it is drawn, no longer shows as an "Unexpected error" or goes into the recent
  errors a bug report can include.
- **Usage statistics**, if you share them, count a little more, still only as fixed words
  and ranges: saving, adding features and primers, adding reads, how long a file's
  sequence is and how long alignment takes, and three choices in Settings. Each view is
  counted once each time the app opens, not at every switch. The Privacy page lists every
  event and what it carries.
- Find accepts U in a sequence, and positions are written as 1,700–2,400 throughout.

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
