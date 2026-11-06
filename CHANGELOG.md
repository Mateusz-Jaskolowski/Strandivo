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
