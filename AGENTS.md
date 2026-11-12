# Strandivo: guide for coding agents

Strandivo is a free (GPL-3.0) desktop app for plasmid maps, sequence editing, primers and
sequence verification. It is a Tauri v2 app: a TypeScript interface (Vite, no UI
framework) over a small Rust shell and a dependency-free Rust core. Users are biologists,
mostly on Mac and Windows; Linux builds too, and it is where CI runs. Priorities: map and
editing, then sequence verification, then primers, then cloning simulation. `README.md`
describes the app for users, and `CONTRIBUTING.md` how people take part and who maintains
it.

**Keep this file true.** A change that makes something here wrong updates it in the same
commit. Write down what the code can't tell you (conventions, decisions, traps), not what
it can (lists of files or features). The same goes for the guides below. CI checks that
every path in backticks in them exists; write paths from the repository's root.

## Guides for each area

The rest of the guide is split by area, so an agent reads only what its task needs. Before
changing code in an area, read its guide; their rules are as binding as this file's.

- Reads, clones, mutations, translation of reads and the Reads tab: `docs/agents/reads.md`.
- Primers, primer pairs, mutagenesis primers and the primer library:
  `docs/agents/primers.md`.
- Protein regions and UniProt: `docs/agents/proteins.md`.
- Anything the app sends or fetches, updates, feedback, crash reports, usage statistics and
  the welcome window: `docs/agents/updates-and-reports.md`.
- Installers, releases, the update key and the website: `docs/agents/releases.md`.
- Long-read alignment, feature detection and the parts catalog: `crates/seqcore/AGENTS.md`.
- The Workers behind `updates.strandivo.com` and `feedback.strandivo.com`:
  `services/AGENTS.md`.

A guide in a code folder has a `CLAUDE.md` beside it, so Claude Code loads it on its own
when it reads files there; the ones in `docs/agents/` are read when the task needs them.

## How the code is organised

- `src/main.ts` decides what a window shows: the main window (`src/mainWindow.ts`),
  Settings (`src/settingsWindow.ts`), the primer library (`src/libraryWindow.ts`) or the
  enzyme library (`src/enzymeLibraryWindow.ts`).
- `src/mainWindow.ts` is the one main window: an app bar with Home (`src/home.ts`, the
  construct library) and a tab per open file, the window title, keys, native menu, dropped
  files and closing. It passes what is meant for a file to that file's tab.
- `src/doc/document.ts` builds an open file's tab (`openDocument`): toolbar with five views
  (Map, Sequence, Primers, Reads, Info), outline on the left, inspector on the right, status
  bar. It also owns saving, the `command()` handler (menus and shortcuts) and the test hook.
- `src/doc/store.ts` holds the document: immutable `SeqData` snapshots, the selection and
  undo history. Views get a `DocContext` (`src/doc/context.ts`) and subscribe to changes.
- `src/views/` has one class per part of the window (map, sequence, primers, reads with its
  canvas trace view, outline, inspector, search). Each builds its own DOM or SVG.
- `src/lib/` is pure logic with unit tests: the sequence model and edits
  (`src/lib/seqdata.ts`), primers and Tm, enzymes, primer design, PCR products, primer
  lists, alignment layout, codon effects, construct summaries for Home, cloning simulation
  (`src/lib/cloning.ts`), mutagenesis primers (`src/lib/mutagenesis.ts`), ORFs
  (`src/lib/orfs.ts`), digests and gels (`src/lib/gel.ts`).
  No DOM here, so `npm test` can run it in plain Node.
- `src/sanger/readSet.ts` loads reads, groups them into clones, has them aligned and
  summarises the results.
- `src/platform.ts` is the only code that talks to the shell, with plain-browser fallbacks.
  Alignment and detection try, in order, a test's hook if the page defines one, the shell,
  then the core in a worker if the page has one.
- The browser version (`docs/web-version-plan.md`) is the same interface built with
  `--mode web` into `dist-web`: `index.html` then loads `src/web.ts`, which hands
  `src/platform.ts` the core compiled to WebAssembly, run in a Web Worker
  (`src/core/worker.ts`). Only `src/web.ts` imports it, so `npm run build`, which Tauri
  runs, never needs Rust's WebAssembly target or holds the worker; keep it that way.
  There is no menu bar there, so the app bar gets a menu button (`src/views/appMenu.ts`)
  with the native menu's items, listed again in `src/lib/appMenu.ts`. It goes on
  Cloudflare Pages only when a release is published (`.github/workflows/web.yml`; a
  release candidate goes to a preview address), so it and the installers are always the
  same version, and its headers, the Content Security Policy among them, are
  `public-web/_headers`, which only that build copies. A page left open across a
  deployment asks for files the new one doesn't have, which the strip under the app bar
  turns into "Reload" (`offerReload` in `src/updates.ts`).
- `src-tauri/src/lib.rs`: windows, native menus, file associations, file commands, listing
  the library's folders. Its alignment and detection commands hand typed requests to
  `crates/seqcore-json/`.
- `crates/seqcore-json/` is what the interface sees of the core: the requests and
  responses of alignment and detection, with their JSON field names, and `align_json` and
  `detect_json` for callers that pass strings. The shell uses it and so does the
  WebAssembly build, so the two can't disagree about a field. It needs serde, which is why
  it is not part of `crates/seqcore/`.
- `crates/seqcore-wasm/` is the core for the browser version: `seqcore-json`'s strings
  passed through linear memory, with no `wasm-bindgen`; an answer is its length, then its
  bytes. A panic traps, so `src/core/instance.ts` starts a fresh instance for the next
  request, having been handed the panic's message by a hook just before.
- `crates/seqcore/`: .ab1 reading, quality trimming, seeded Smith-Waterman-Gotoh
  alignment, alignment of long reads along a chain of seeds, difference calling and each
  clone's consensus (`crates/seqcore/src/consensus.rs`), the catalog of common plasmid
  parts (`crates/seqcore/src/parts.rs`) and the search that finds them in a sequence
  (`crates/seqcore/src/annotate.rs`). No dependencies; tested against `testdata/`.

## Conventions

- **Coordinates** are 0-based and inclusive. On a circular sequence a range with
  `start > end` crosses the origin; every function on ranges must handle that. The
  interface shows positions 1-based.
- **Edits** go through `store.apply(next, label, selection?, key?)` with a new `SeqData`;
  never change `store.data` or arrays it holds in place. Steps with the same `key` within
  1.5 s merge into one undo step (typing). Views compare data by reference, so the same
  goes for read results: replace lists, don't mutate them.
- **Features in parts** (exons, SnapGene segments) keep their parts in `locations`, with
  `start`/`end` spanning them; every edit maps each part. GenBank "source" features live in
  `SeqData.sources`: never shown, but edited along with the sequence and saved.
- **Reading a CDS** starts at its first whole codon, not its first base: a partial one from a
  database says so with GenBank's `/codon_start`, kept in the feature's notes. Anything that
  translates, numbers residues or maps them back to bases walks `codingPositions`
  (`src/lib/genetics.ts`), never `featurePositions`, which is every base the feature covers.
- **Where things go**: the app bar holds what is about the app (Home, a tab per open file,
  the primer and enzyme libraries, Settings and, in a browser, the menu); the bar under it is the file's own (its five views,
  search, editing tools, and each side panel's button on its own side, with split view
  beside the views it shows). Views show the document (Map, Sequence, Primers, Reads, Info), and
  there are five; a task with a start and an end (design primers, a PCR product, adding
  from the library) is a dialog (`openDialog` in `src/ui/modal.ts`, see
  `src/views/primerDialogs.ts`); something not tied to one file gets its own window, like
  Settings and the libraries (in a browser, which can't open windows reliably, the main
  window shows them over its tabs: `showWindowsInPage`), or lives on Home; the inspector shows only what is
  selected. This keeps windows from getting crowded. On the map, what is drawn is chosen
  from the chips and the menus beside them (Cut sites, Regions); the floating bar only
  moves the drawing (rotate, zoom, label size).
- **Cloning** works on fragments (`src/lib/cloning.ts`): a linear `SeqData` holding every
  base on either strand, written as the top strand, plus each end (blunt, 5′ or 3′
  overhang). Two ends ligate when kind and bases match; joining writes the shared bases
  once. The dialog (`src/views/cloningDialog.ts`) takes the open file as the vector and
  other open files (`DocContext.otherSequences`) as inserts; products open as new unsaved
  tabs (`DocContext.openNew`), which count as edited until saved.
- **Selection** changes go through `store.select(…, source)`; `source` names the view that
  made it, so that view can skip scrolling to itself.
  Separate codons can be picked with ⌘/Ctrl in either sequence panel. A selection has
  `ranges` and a null `range` while it covers separate stretches: use `selectedRanges`
  and `selectedBases` in `src/lib/selection.ts`, never a span covering the gaps. Commands
  that need one continuous stretch must require one. Codon picks and their Shift anchor
  live in the store so both panels share them; ordinary selections clear them.
- **Delete with something clicked** (a feature, primer, protein region, cut site or ORF)
  first deletes that thing, or for a cut site or ORF only drops it from the selection, and
  leaves its bases selected; the next press deletes the bases (`src/lib/deletion.ts`). A
  view that gets a Delete key keeps to this, as one press used to take a feature's bases
  along when the user meant the feature.
- **Messages** (`toast` in `src/ui/dom.ts`) are for what the user can't see happen: side
  effects, work finishing, errors, not an edit that shows where they are looking. One about
  an edit goes through `ctx.noteEdit`, which adds Undo while that edit is the last one. An
  edit to bases that removes a feature or primer whole is reported by the document itself
  (`lostWith`), so a call site needs no message for that.
- **Picked enzymes** (`src/lib/enzymePick.ts`, `src/doc/pickEnzyme.ts`): ⌘-click (Ctrl-click
  outside macOS, where Ctrl-click is a right-click) on a cut site in the map, the Sequence
  tab or the outline picks its enzyme for a digest; the selection keeps them in `enzymes`
  (two or more), and any other selection drops them. Enzymes are picked, not sites, as a
  digest uses every site. Every site of a picked enzyme, or of the selected site's enzyme,
  is marked, so a dual cutter shows where else it cuts. A right-click on one of their sites
  keeps the pick and digests with them all.
- **The map's sliders**: the rotation is the file's own, kept by path in local storage
  (`src/mapRotations.ts`), since a plasmid's best angle depends on its contents; an
  unsaved file's is kept once it is saved. Label size is a setting, the same for every
  file. Zoom is kept by nothing: every map opens fitted to the window, as a zoom without
  the place zoomed into would open a file on an arbitrary part of its map.
- **Resizable parts** of a window use `splitter` (`src/ui/splitter.ts`): drag, arrow keys,
  double-click to reset or fit. The caller limits the size and keeps it in local storage
  for the whole app, not per file, like the alignment's names column. The side panels'
  two widths (`src/panelWidths.ts`) are CSS variables on the page, so every open file
  follows a change; the left one is the outline's and the Reads tab list's, each keeping
  its own default until resized.
- **Canvases** never take the full height of what they draw: the alignment's reads draw
  only the rows near the pane, as a canvas above 268 million pixels draws blank in WebKit
  (the Mac app) and a plate of traces would take hundreds of megabytes.
- **Map labels** say what they name by their colour, font and leader: a feature's name on a
  tint of its colour (solid leader), a primer's after an arrow pointing its way (dashed), an
  enzyme's in small grey monospace with no mark (dotted), darker when it cuts once. Marks on
  enzymes were tried and made the map busy; their positions are in the tooltip and outline.
  Protein regions have plain, regular-weight grey names and light solid leaders; their
  colours stay on their bands. Hovering a region's band or name highlights its pieces and
  outlines the owning CDS without changing selection. Hover and selection keep region
  text at its measured weight, so names never widen into their neighbours.
- **Right-click menus**: `src/lib/contextMenu.ts` decides what each menu offers (as data,
  unit-tested) and `src/doc/contextMenu.ts` runs it with the inspector's and toolbar's own
  functions. A view selects what was clicked first (`menuTargetAt`), then calls
  `ctx.contextMenu`; the Primers tab's sequence panel selects bases the same way as the
  Sequence tab. The Reads tab's menus (`readsMenu`) are about reads, not the document, so
  its view runs them. The app shows native menus (`showContextMenu` in `src/platform.ts`);
  the web view's own menu (Reload, Look Up…) is turned off outside text fields.
- Views draw only when visible (`setVisible`) and only what is on screen.
- **Files** are read and written with TeselaGen's bio-parsers (`src/doc/fileio.ts`);
  `src/doc/convert.ts` turns them into `SeqData` and back, keeping fields we don't model
  in `raw`. SnapGene `.dna` is read but saved as GenBank. Lab fields from the Info tab live
  in GenBank COMMENT lines (`src/lib/labinfo.ts`).
- **Paths in a browser are keys** (`src/webFiles.ts`), written like paths so the code keeps
  working on strings: `web:<id>/<name>` for a file the browser gave a handle to (kept in
  IndexedDB, so it lasts between visits), `web:<id>/<folder>/<path>` for one in a folder
  added to Home (the folder's handle is kept; a file picked from inside it gets this key
  too, so it is one file wherever it was opened from), and `upload:<n>/<name>` for one
  without a handle (its bytes in memory, for the visit; `keyLasts` is false). `readFile`,
  `saveText`, `chooseSavePath` and `listSequenceFiles` in `src/platform.ts` resolve them;
  anything else is a URL. Only a handle can be written over (`canSaveInPlace`), so
  elsewhere Save is Save As and a save is a download. Show a key with `shownPath` (its
  place in its folder, or its name), never the key itself. Nothing that lasts (recent
  files, remembered reads, Home's cache and notes) keeps an `upload:` key. A browser may
  ask again before a kept handle is read, and lets a page ask only from a click, so Home
  offers "Allow access…" for such a folder and a file's remembered reads wait behind a
  strip (`filesNeedingAccess`); code that reads kept keys without a click must check
  first. In a check file, keys in one folder are relative paths and other keys are bare
  names, and a check's files that can't be reached are chosen and matched by name.
- **Styles**: design tokens are CSS variables in `src/styles.css`; document styles are
  `sv-*` classes in `src/doc/document.css`, the app bar's and Home's in `src/mainWindow.css`.
  Older `ps-*` classes remain for the Settings and Info screens. Dark tokens exist but no
  setting turns them on yet.
- **Interface text** is plain and short, sentence case, says what happens ("Add reads…",
  "Use read base"), with ranges as 1,700–2,400 and an ellipsis on commands that open a
  dialog. Write like a colleague in the lab, using standard everyday and wet-lab words
  ("identifies you", not "tells you apart"; "Crash details", not "Why it quit"; "5′
  overhang", "co-migrate"). Keep dialog subtitles, Settings hints and empty states to one
  sentence (about 15–20 words); if a control's label already says what it does, leave the
  hint out. Don't add reassurances the UI already shows ("Nothing is added until you choose
  it" when there is a Cancel button, "Undo to bring it back" on routine delete toasts, or
  "Shown below when ticked" next to a checkbox), don't explain how to use nearby controls
  or what to do with a standard exported file (like a TSV), and state privacy or local
  processing as plain fact once where relevant rather than repeating it across screens. New
  screens follow the ones there are: their spacing, `sv-*` components and the design tokens
  in `src/styles.css`.
- **Commits**: Conventional Commits (`feat(scope): summary` and a short body saying what
  and why), one logical change each, under your own name. Never rewrite pushed commits.
- **What's new**: a pull request that changes something users notice adds a bullet under
  `## Unreleased` in `CHANGELOG.md`, in the same plain words as the bullets of past
  releases: what they can do now, not how the code does it. Fixes users would notice count;
  refactors, tests, CI and docs don't. The section is what a release's notes are made
  from, so a change left out of it is a change nobody hears about.
- **Licence headers**: every `.ts`, `.mjs`, `.css`, `.rs` and `.sh` file starts with the
  copyright and `SPDX-License-Identifier: GPL-3.0-or-later` lines (`CONTRIBUTING.md`),
  checked by `.github/scripts/check-headers.sh`. A new file copies them from any other.

## Checking work

- `npm test` (unit tests in `src/lib/`), `npm run typecheck`, `npm run build`.
- `cd crates/seqcore && cargo test --release` for the alignment core, and the same in
  `crates/seqcore-json/` for the JSON it answers with and `crates/seqcore-wasm/` for its
  buffers; `cargo test --lib` in `src-tauri/` for the shell's own (the crash hook, usage
  events, app data).
- `npm run build:web` builds the browser version into `dist-web`, and `npm run dev:web`
  serves it with live reload; both need `rustup target add wasm32-unknown-unknown` once.
  They build the core first (`tools/build-wasm.mjs`), which fails above 512 KB and runs the
  module in Node through `src/core/instance.ts`, the worker's own code. Node only strips
  types there, so that file uses only syntax that can be erased: no parameter properties,
  enums or namespaces.
- `node tools/build-catalog.mjs` rebuilds the parts catalog. It needs the network, so it
  is not part of `npm run check` and is never run by the app or CI; commit the curated
  list and the regenerated catalog together.
- `node tools/build-icon.mjs` draws the app icon and writes every file made from it: the
  PNGs, `src-tauri/icons/icon.ico` and `src-tauri/icons/icon.icns`, and the website's icon
  and favicon. Change the drawing there, never the images (the SVGs beside them are its
  output too). Sizes of 32 px and under get a plainer drawing, as the full one blurs. It
  needs macOS for the .icns.
- `npm run check` runs all of the above, the agent guides' path check, a syntax check of
  the e2e scripts and clippy: what CI
  checks except the e2e, in a minute or two. Run it before every push where Rust is
  installed; CI stays the final word and the only place the e2e runs. A change to nothing
  but docs, Markdown, the website or `CITATION.cff` needs only `npm run check:quick` (the
  guide's paths, the licence headers and the website's security.txt, in seconds), as CI
  then runs only that too.
- In a browser, `npm run dev` (or any static server on the built `dist` folder) shows Home,
  and opens a file in a tab with `?open=<path or URL>`. Reads only align there if the page
  defines `window.__strandivoAlign` (returning `{ reads, clones }` as the core does), or
  in the browser version (`npm run dev:web`), whose worker aligns them for real;
  `node e2e/web.mjs --serve` serves `dist-web` and `testdata/` as its e2e does. Home
  lists folders if the page defines `window.__strandivoListFolder` (see
  `src/platform.ts`), and in Chrome and Edge through the folder's handle; in the app Rust
  does both. A
  UniProt is asked for real unless the page defines `window.__strandivoUniprot`, which e2e
  tests do, in the app too. A
  right-click menu is drawn in the page there, or handed to `window.__strandivoMenu` if
  defined, which is how e2e tests pick items (WebDriver can't click native menus).
- **Checks** (`.github/workflows/checks.yml`) runs on every pull request and push to
  `main`, on Linux only, except one that changes only docs, Markdown, the website or
  `CITATION.cff` (its `paths-ignore`; keep the two lists, and the rule above, the same).
  The guide and header checks run apart, on every change
  (`.github/workflows/quick-checks.yml`), as a docs change is what breaks the guide's
  paths. Checks itself runs tests,
  type check, clippy, a debug build, then `e2e/run.mjs` clicks through the real app with
  WebDriver and pushes screenshots and a report to the `e2e-results` branch (for a pull
  request from a fork, whose token can't push, they are the run's artifact). Add an e2e
  check when you add something users do. It drives the window through `window.__strandivo`:
  the main window's own actions (open, tabs, Home's folders, `saveSettings`) plus those of
  the file in the current tab (store, `command()`, adding reads, saving and `saveCheck`
  without a file dialog). Then `e2e/web.mjs` clicks through the browser version in
  headless Chrome with no hooks, so alignment and detection run in the worker, and checks
  the worker answers after a panic (`trapCore`), then its menu, keys, opening, saving
  and dropping files, Home's folders, and reads and checks remembered across a reload. It
  serves the build with the headers it is deployed with, and fails if the Content
  Security Policy blocked anything along the way. Its file pickers are stood in for with files in the page's private
  file system, whose handles are real, and then taken away to check Safari's and
  Firefox's way (a file input, downloads); its screenshots and report go in a `web`
  folder beside the app's.
- Steps run through `.github/scripts/run.sh`, which repeats a failing step's output as an
  annotation, readable with `gh api repos/<owner>/<repo>/check-runs/<job id>/annotations`.
  The manual **Diagnostics** workflow runs any command on any OS and posts its output the
  same way; delete any branch it pushes afterwards.
- From a cloud session the npm and crates registries may be blocked: Rust in `src-tauri/`
  then only compiles in CI, and CI is the final word.

## Decisions (and why)

- **Own views instead of TeselaGen's Open Vector Editor** (removed Oct 2026): we needed
  control over editing, selection and undo, and it cut the window's code from 4.1 MB to
  0.7 MB.
- **ORFs are found, not stored**: worked out from the sequence on every change (cached in
  `src/doc/analysis.ts`, like cut sites) and never saved; "Add as feature" turns one into a
  CDS that is. In each frame an ORF starts at the first start codon after a stop, so
  shorter ORFs nested in the same frame aren't shown, as SnapGene does. A selected ORF is
  a `Focus` of kind `"orf"` with id `<strand>:<start codon position>`.
- **Digest sizes are top-strand lengths**, so a plasmid's fragments add up to its length;
  `Fragment.data` also holds the overhang bases (`fragmentSize` in `src/lib/gel.ts`).
- **Tabs by default, split view optional**: one big view at a time was preferred.
- **One window, a tab per file** (Oct 2026), replacing a window per file, so the window
  stays tidy as features are added. The shell sends every file to open to the main window;
  until its page asks for its files (`window_info`), they wait in a queue, so none is lost
  while it loads. Side-by-side files in two windows are not possible yet.
- **The construct library** (Home) lists folders the user adds; their files stay where they
  are. The folders, what was read from each file (read again only when its size or date
  changes) and the notes typed on Home are kept by the app (`src/constructLibrary.ts`),
  so a note never changes a file. The Info tab's Notes field, which is in the file, shows
  when no note was typed on Home.
- **Cloning products open as unsaved tabs**, not files, so trying a variant costs nothing.
  Gibson splits a missing overlap between two amplified neighbours
  (NEBuilder's way); In-Fusion puts all 15 bases on the insert's primers (Takara's).
- **Read alignment in Rust** (`crates/seqcore/`), so it is fast and testable on its own.
- **Tm**: SantaLucia 1998 with primer3's default conditions by default, so numbers match
  primer3. Settings can choose Breslauer 1986 (primer3's older method), the Wallace rule or
  a basic GC formula, and the conditions. Each window applies the choice with `useTmSettings`
  (`src/main.ts`), so `meltingTemp` without arguments follows it; tests pass settings.
- **Amber suppression** (TAG read as Q, for phage display in TG1 or XL1-Blue) is a setting
  applied the same way (`useAmberSuppression`), so everything that translates through
  `translateCodon` follows it. ORF stops get it in `OrfOptions`, and caches of
  translations must include it in their key.
- **Enzymes**: Common, Lab and My enzymes choose membership; a separate filter chooses
  unique 6+ cutters, unique, unique and dual, or every site. The common list
  (`src/lib/enzymes.ts`) is curated to avoid duplicate isoschizomers. Lab stock
  (`src/enzymeLibrary.ts`) and the independent personal list (`src/personalEnzymes.ts`)
  may name any enzyme TeselaGen knows: Acc65I is not KpnI (same site, other ends), and
  Esp3I keeps its chosen name. Names reach analysis and reaction dialogs through
  `ViewOptions`, never a global; name arrays remain the same until membership changes,
  so editing a stock note redraws no map. Source and filter changes prune unavailable
  enzyme picks; drawing visibility is separate and the outline still lists sites when
  drawing is off. Digest and restriction cloning choose their own source, initially the
  document's, and keep already chosen reaction enzymes available through filter changes.
  Product names are user text, never read for recognition or reaction conditions.
  Both lists are kept by the shell (`src-tauri/src/app_data.rs`, which writes only the
  files it names), with browser storage in the web version. A saved list keeps names
  this version doesn't know, leaving them off the map. An unreadable file blocks writes
  until a new list is started with the old file kept beside it. Lab imports, unlike saved
  lists, reject unknown names as a whole. The Enzyme Library opens to a requested section
  through a pending shell request listened for before it is read, so a request isn't lost
  while the window starts.
- **Bases in upper case** by default; Settings can show them as in the file.

## Traps

- **Content Security Policy** (`csp` and `devCsp` in `src-tauri/tauri.conf.json`): scripts
  only from the app's own files, so no inline `<script>`, `on…` attributes, `javascript:`
  links or `eval`. Inline styles are allowed, as `style` attributes are used throughout;
  Tauri is told not to add nonces to `style-src` (`dangerousDisableAssetCspModification`),
  as a nonce there turns `'unsafe-inline'` off. An address the app talks to goes into
  `connect-src` in both policies, or the shell blocks it, and into the browser version's
  (`public-web/_headers`), which is its privacy promise, and `docs/privacy.md`, in the
  same pull request; `src/lib/csp.test.ts` holds the two builds' policies to each other,
  where they differ only as the builds do. Text from files reaches the page
  only as text: `h()` in `src/ui/dom.ts` can't set HTML, and `innerHTML` is for constant
  markup only. Code scanning (CodeQL) looks for this on every pull request.
- **Undo can arrive twice**: the page sees ⌘Z/Ctrl+Z and so does the native menu item,
  in either order depending on the platform. `fromMenu` in `src/doc/document.ts` skips a
  menu command the page just handled. Keep that in mind when adding shortcuts.
- **Menu keys on Windows**: WebView2 keeps the keys pressed in the page, so the native
  menu's accelerators never fire there. Outside macOS every window passes a menu item's
  key on to the shell (`MENU_KEYS` in `src/lib/shortcuts.ts`, `menu_shortcut` in
  `src-tauri/src/lib.rs`), which runs it once even where the menu hears it too. A new
  accelerator goes in that list as well; a unit test reads the menu to check.
- **Keys a browser keeps**: ⌘N, ⌘W, ⌘T and ⌘1–⌘9 (Ctrl elsewhere) never reach the page,
  ⇧⌘R reloads and Safari's ⌥⌘W closes the other tabs. So in a browser New Sequence is
  ⌥⌘N and some items have no key (`WEB_SHORTCUTS` in `src/lib/shortcuts.ts`). Tooltips and
  the menu show a key with `shortcutHint` or `shortcutFor`, which give the one that works
  where the user is, never a hard-coded one.
- **A new native menu item** goes in `src/lib/appMenu.ts` too, or the browser has no way
  to it; a unit test compares the two lists' ids and labels.
- **Windows are light on Windows** (`app_window` in `src-tauri/src/lib.rs`), since the
  interface is: a menu bar following the system's dark mode is drawn by hand and turned
  light again when another window opened. Take that out when dark tokens get a setting.
- **macOS title bar**: the main window uses an overlay title bar, so the app bar is the drag
  area (`data-tauri-drag-region="deep"`; buttons and fields are excluded automatically).
  Mark other controls in it with `data-tauri-drag-region="false"`, as the file tabs are. On
  Mac, `sv-mac-titlebar` leaves room for the window buttons.
- **Only the current tab is in the page**: other files' views are taken out (`setActive`),
  so `document.querySelector` in tests finds the current file's elements. A document must
  not measure or draw while inactive, and anything it subscribes to outside itself
  (settings, the primer library) must be undone in `dispose`, or closed tabs leak.
- **The inspector rebuilds on every change**, so a field edited live (a primer's sequence)
  would lose focus to its own edit: mark it `data-keep` and `render()` in
  `src/views/inspector.ts` moves focus, caret and unapplied keystrokes to the new one.
- **Hidden views** have zero size: measure and draw when they become visible.
- **`ch` units follow each element's own font**: a label in a smaller font placed with
  `left: 40ch` lands somewhere else than the bases. Rows of bases place things by the
  measured base width in pixels (`src/views/primerContext.ts`) or correct for the font
  (the ruler in `src/views/sequenceView.ts`).
- **Cut sites** are updated around each edit (`rescanSites` in `src/lib/enzymes.ts`), not
  searched again, so typing stays fast in long sequences. A randomised test compares the
  result with a full search; keep it passing if you touch either.
- **SnapGene files** need fixing up after the generic parser (`src/doc/fileio.ts` with
  `src/lib/snapgene.ts`): it skips primers (whose binding sites, unlike features, are
  0-based), and it keeps a feature's `type="gap"` segments (introns) as parts of it.
- **GenBank qualifier values** are put right after the generic parser and written by us
  (`src/lib/genbankQualifiers.ts`, called from `src/doc/fileio.ts`): it cut a value at its
  first quote, joined wrapped lines with no space, and wrote values wrapped mid-word with
  quotes not doubled. Features are matched to the file's table by their first and last
  base. Lines join with a space, as GenBank's do, except in `/translation` and the app's
  own `/strandivo_…` values, which have no spaces and are cut to the width.
- **Saving** must not lose anything: `src/lib/saving.test.ts` saves and reopens every file
  in `testdata/`, also after edits. Add a file there when you meet one that breaks.
- **HTTPS in the shell**: reqwest is built without a TLS provider (the updater's
  `rustls-no-provider`) and panics building a client until one is installed, and release
  builds abort on a panic. `install_tls_provider` in `src-tauri/src/lib.rs` runs first in
  `run()`; call it too before building a client anywhere else. 0.3.0 crashed this way, as
  only release builds had the statistics key, so no test or e2e run ever built that
  client: code that only a release reaches needs a unit test of its own, and a try in a
  development build given the key or in a release candidate.
- Files in `testdata/` have their own licences, listed in `testdata/README.md`.
