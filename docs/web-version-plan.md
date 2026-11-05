# Strandivo in a browser: plan

Status: planned (November 2026). Part 1 is built (#4); the rest waits for 0.2.0 and the
website. Each part below is one branch and one PR. It comes after the first public release (0.2.0) and the website (part 6 of
`docs/updates-feedback-usage-plan.md`). What is said here about browsers was read on
5 November 2026; check it again before each part is built.

## What we want

Strandivo at `app.strandivo.com`, for someone who can't install software on a lab or
university computer, wants to try it before installing, or uses a Chromebook.

- **The same app, not a second one.** The web version is the desktop interface built for a
  browser, with the same core doing alignment and detection. No feature is written twice;
  where a browser can't do something the desktop does, it says so plainly.
- **Everything runs in the browser.** No sequence, read or file name is sent anywhere. The
  page is static files; there is no server of ours behind it that could receive anything.
- **It says so where people look**, and the browser enforces it (part 5).
- **Desktop first.** Nothing here may make the desktop app slower, larger or harder to
  build. Contributors who never touch the web version need nothing new to work on the
  desktop.

Not in this plan: working offline or being installed from the browser (a service worker;
worth doing once the web version has users), sharing a file by link, collaboration, and
anything that needs an account.

## Decisions

1. **The JSON bridges move into a new crate, `crates/seqcore-json/`**, shared by the shell
   and the WebAssembly build, rather than being copied. The two copies would have to agree
   field for field (`AlignResponse` is 25 fields per read, with clones, conflicts and
   pieces), and one drifting would show only as a wrong screen in one of the two builds.
   `crates/seqcore/` stays dependency-free, as `AGENTS.md` promises: the bridges need
   `serde` and `serde_json`, so they can't go into it, and putting them behind a feature
   flag would make "no dependencies" true only sometimes.
2. **The WebAssembly entry is a crate of its own, `crates/seqcore-wasm/`**, a `cdylib`
   with four exported functions (allocate, free, align, detect) that pass JSON strings
   through linear memory: about 40 lines of Rust and 30 of TypeScript. **No
   `wasm-bindgen`**: our interface is two functions taking a string and returning one, and
   `wasm-bindgen` would add a command-line tool whose version must match the crate's
   exactly, plus generated glue to review. Plain `cargo build --target
   wasm32-unknown-unknown` is all it takes. The shell never depends on this crate, so
   desktop builds don't build it.
3. **Size and speed were measured**, not guessed, with a throwaway build of today's bridges
   and core (5 November 2026, Apple Silicon, Node 22): **259 KB** (105 KB gzipped) at
   `opt-level = "s"`, 314 KB (126 KB gzipped) at `opt-level = 3`, both with LTO, one
   codegen unit, `panic = "abort"` and stripped. The parts catalog is about 30 KB of that.
   Speed was the same as the native core, which is single-threaded too: 96 reads against
   pUC19 aligned in about 1 s either way, and detection on pUC19 took 190 ms (most of it
   the first call building the catalog's index). So `opt-level = "s"`, and a CI check that
   fails above 512 KB, so a dependency that bloats it is noticed. `wasm-opt` could take
   10–20% off; not worth another tool yet.
4. **The core runs in a Web Worker**, one per page, loaded the first time it is needed. A
   plate of reads takes a second or more, and on the page's own thread the window would
   freeze for that long. Requests are answered in order. A panic aborts the WebAssembly
   instance (it traps), so the worker starts a fresh one for the next request and the one
   that failed is rejected with its message, as a failed command is on the desktop.
5. **The web version is deployed from published releases only, not every merge to
   `main`.** Then the web version and the installers are always the same version: a bug
   report or a statistic names a version that exists as a tag, release notes describe what
   web users see, and a feature built over several PRs (as every plan in `docs/` is) never
   reaches users half done. A fix waits for a patch release, which is one tag. Any branch
   can still be deployed by hand to a preview address to try it (part 5).
6. **Deployed by our CI, not Cloudflare's own builds**: Cloudflare Pages' build image
   would need Rust and the WebAssembly target set up there too, and CI already builds and
   tests both. The workflow uploads the built folder with `wrangler pages deploy`.
7. **Paths in a browser are keys, not paths.** Code from Home to the read checks keys
   everything on a file's path. In a browser a file opened through the File System Access
   API keeps its handle in IndexedDB, under a key written like a path (`web:<id>/<name>`,
   and `web:<id>/sub/folder/file.gb` inside an added folder). `readFile`, `writeFile` and
   `listSequenceFiles` in `src/platform.ts` resolve them, so the rest of the code keeps
   working on strings. A file that came without a handle (a file input, or a drop in
   Safari and Firefox) gets `upload:<n>/<name>`, held in memory for the visit only.

## What the code already gives us

- **The interface already runs in a browser**: `npm run dev` shows Home, `?open=<url>`
  opens a file, Settings and the primer library are drawn over the main window
  (`showWindowsInPage`), right-click menus are drawn in the page, and ⌘S/Ctrl+S saves.
  Settings and the primer library already follow each other between tabs through the
  `storage` event.
- **`src/platform.ts` is the one place to change.** `alignReads` uses
  `window.__strandivoAlign` when the page defines it and otherwise calls the shell, which
  fails in a browser; `detectFeatures` uses `window.__strandivoDetect` and otherwise
  returns nothing, and `canDetectFeatures` hides detection without it.
- **The bridges are small and self-contained**: `src-tauri/src/sanger.rs` (DTOs and
  `align`) and `src-tauri/src/annotate.rs` (DTOs and `detect`), about 12 KB together, with
  no Tauri in them. `catalog_version` is a third, one-line command.
- **Reads are parsed in TypeScript** (`src/lib/chromatogram.ts`), so the core only ever
  receives JSON, never a file, and nothing in it touches the file system.
- **What does not work in a browser yet**: a sequence file can only be opened by
  `?open=<url>` (the Open… button says so, and dropping files is desktop-only); saving
  always downloads a new copy; Home can't add folders ("Folders can only be read in the
  desktop app."); there is no menu bar, so menu-only commands (New Sequence, Open…, Close
  Tab, Export…, Detect Features…, Digest…, Simulate Cloning…) have no way in; and reads
  picked there have no path, so they are neither remembered nor saved in a check.

## Parts

### 1. The bridges in a crate of their own
`refactor/seqcore-json`: `crates/seqcore-json/`, `src-tauri/Cargo.toml`,
`src-tauri/src/lib.rs`, `src-tauri/src/sanger.rs`, `src-tauri/src/annotate.rs`,
`package.json`, `.github/workflows/checks.yml`, `AGENTS.md`

Desktop only; nothing changes for users.

- `crates/seqcore-json/` takes the two bridges as they are, plus `align_json(&str) ->
  String` and `detect_json(&str) -> String`, which parse a request, run it and write the
  response, or `{"error": "…"}` for a request that doesn't parse. The shell's commands keep
  their typed arguments (Tauri deserialises them) and call the same `align` and `detect`,
  so both builds share every struct.
- Its tests run a request built from `testdata/` through `align_json` and `detect_json`
  and check the response's shape, field names included, since camelCase renaming is what a
  copy would get wrong. `npm run check` and Checks run them.
- `src-tauri/src/sanger.rs` and `src-tauri/src/annotate.rs` go; `AGENTS.md`'s "How the code
  is organised" names the new crate and says it holds what the interface sees of the core.

### 2. The core as WebAssembly, in a worker
`feat/web-core`: `crates/seqcore-wasm/`, `src/core/worker.ts`, `src/core/client.ts`,
`src/platform.ts`, `vite.config.ts`, `package.json`, `.github/workflows/checks.yml`,
`e2e/web.mjs`, `AGENTS.md`, `CONTRIBUTING.md`

- **The crate**: `sv_alloc`, `sv_free`, `sv_align` and `sv_detect`, plus `sv_catalog_version`;
  the result is left in a buffer the caller reads and copies. Its release profile is the
  one measured above.
- **Building**: `npm run build:wasm` runs cargo for `wasm32-unknown-unknown` and copies the
  file to `src/core/seqcore.wasm` (ignored by git). `npm run build:web` and
  `npm run dev:web` build it first and run Vite with `--mode web`; only in that mode does
  the bundle include the worker, which imports the `.wasm` with `?url` so its name carries
  a hash. `npm run build`, which Tauri runs, is unchanged, so desktop builds need no
  WebAssembly target.
- **`src/platform.ts`**, in this order for both `alignReads` and `detectFeatures`: a test
  hook if the page defines one (so every existing e2e check works as it is), the shell on
  the desktop, the worker in a web build, and otherwise today's answer (an error for
  alignment, nothing for detection). `canDetectFeatures` and `catalogVersion` follow the
  same order, so Home's cache of detected parts keys on the real catalog in a browser too.
- **The worker** (`src/core/worker.ts`) instantiates the module on its first request with
  `WebAssembly.instantiateStreaming`, answers requests one at a time and starts a fresh
  instance after a trap. `src/core/client.ts` sends requests as strings, so typed arrays
  in reads are already turned into lists, as `AGENTS.md` says for the shell. A plate of
  .ab1 reads with traces is tens of megabytes of JSON, well inside WebAssembly's memory;
  sending traces as binary is for later, if it is ever slow.
- **The browser check** (`e2e/web.mjs`): builds the web version, serves `dist` and
  `testdata/` with a few lines of Node's `http`, and drives Chrome through ChromeDriver, both preinstalled on GitHub's
  Ubuntu runners, over plain WebDriver with Node's `fetch` as `e2e/run.mjs` does. With no
  hooks defined it opens `testdata/e2e/pUC19-annotated.gb`, adds the reads of
  `testdata/e2e/plate-bla.fasta` (`addReadPaths`, which fetches them there), waits for them to align and checks the clones and
  differences match what the desktop e2e expects; then runs detection on a FASTA copy of
  pUC19 and checks that AmpR and the ori are suggested. A second check
  makes the worker trap and checks the next request still works. Screenshots and the
  report go to `e2e-results` beside the desktop's, under `web/`.
- Checks installs the target (`rustup target add wasm32-unknown-unknown`), builds the web
  version and fails if the `.wasm` passes 512 KB. `npm run check` builds it too;
  `CONTRIBUTING.md` says to add the target once.

### 3. Opening and saving files, and the menu
`feat/web-files`: `src/platform.ts`, `src/webFiles.ts`, `src/mainWindow.ts`, `src/home.ts`,
`src/doc/document.ts`, `src/views/appMenu.ts`, `e2e/web.mjs`

After this part the web version does everything the desktop does with one file at a time.

- **Opening**: Home's Open… button and ⌘O/Ctrl+O use `showOpenFilePicker` where the
  browser has it (Chrome and Edge) and a file input elsewhere (Safari and Firefox), with
  the same extensions as the desktop's dialog. `onFileDrop` gets a browser version: the
  page's own `dragover` and `drop` events, the same overlay, and in Chrome and Edge each
  file's handle (`getAsFileSystemHandle`). Check files and reads dropped on a document go
  where they go on the desktop. `?open=<url>` stays.
- **Saving**: a file with a handle is written in place (`createWritable`), after the
  browser's own permission prompt the first time. Without one, Save does what Save As
  does: `showSaveFilePicker` in Chrome and Edge, a download elsewhere. A download can't
  tell whether it was kept, so the tab counts as saved once it starts, and the first
  download in a visit says once "Saved to your Downloads folder. Your browser can't save
  over the file you opened." Export and saving a check follow the same rule. `toast`
  messages don't name the browser; they say what happened.
- **A menu in the app bar**: in a browser only, a menu button at its right end with the
  native menu's items in the same groups (File, Edit, View, Sequence, Tools, Help), drawn
  by the page's right-click menu code. `src/views/appMenu.ts` builds it from one list shared
  with nothing else for now; `src-tauri/src/lib.rs` keeps its own, as the shell can't read
  TypeScript, and the e2e compares the two lists' ids so they can't drift.
- **Shortcuts the browser keeps**: ⌘N, ⌘W, ⌘T, ⌘Q and, in most browsers, ⌘1–⌘9 (Ctrl
  elsewhere) never reach the page. In a browser the menu shows ⌥⌘N (Alt+Ctrl+N) for New
  Sequence and ⌥⌘W for Close Tab, and the views stay on the toolbar's buttons. Tooltips
  show the shortcut that works where they are.
- **Closing**: the browser asks before leaving only when a tab has unsaved changes, as
  the desktop asks before quitting. Today `beforeunload` asks every time.
- **Storage**: settings, the primer library, Home's notes and remembered reads stay in
  local storage, at `app.strandivo.com`'s own, separate from any installed copy. The page
  asks for persistent storage (`navigator.storage.persist()`), as browsers otherwise may
  clear a site's data under pressure and Safari after weeks without a visit. The primer
  library and Settings say, in a browser only, "Your browser keeps these. Export… to keep
  a copy." Export/Import is already how a library moves between computers, and now between
  the web and the desktop.

### 4. Home's folders and remembered reads
`feat/web-folders`: `src/webFiles.ts`, `src/platform.ts`, `src/home.ts`,
`src/readChecks.ts`, `src/mainWindow.ts`, `src/doc/document.ts`, `e2e/web.mjs`

Can come before or after the first deployment; it only adds to Chrome and Edge.

- **Folders in Chrome and Edge**: Add folder… uses `showDirectoryPicker`; the handle is
  kept in IndexedDB and the folder listed on Home under its own name. `listSequenceFiles`
  walks it and gives each file its size and `lastModified`, so Home's cache reads only
  what changed, as on the desktop. On a later visit the browser may ask again before
  Home can read the folder (Chrome remembers "Allow on every visit" if chosen); until
  then the folder shows "Allow access…", one click, as permission can only be asked from
  a click.
- **Elsewhere** (Safari and Firefox, which have no folder access a page can keep), Home
  lists the files opened in this visit, with the same summaries, and says above them:
  "This browser can't keep folders. Files you open are listed until you close the page.
  Chrome, Edge or the desktop app can list whole folders." The empty Home says the same
  instead of "Folders can only be read in the desktop app."
- **Remembered reads** follow the same split. In Chrome and Edge, reads picked with
  `showOpenFilePicker` or from an added folder have handle keys, so `src/readChecks.ts`
  remembers them by the sequence file's key and adds them again when it opens, after the
  same permission click if the browser asks. A check file opened from an added folder
  resolves its relative paths inside it, as on the desktop. Elsewhere reads have no key
  that lasts: they are not remembered, and the Reads tab says once, under the list, "This
  browser can't remember reads. Save check… to keep them with the file." Opening that
  check file there asks for the reads it lists ("Add the 12 reads this check lists…"),
  matching the files picked by name, and keeps the user's clones and order. Storing the
  reads' bytes in the browser was considered and left out: the file itself has no key that
  lasts either, so there would be nothing to attach them to.

### 5. Deploying, and saying what the web version does with files
`feat/web-deploy`: `.github/workflows/web.yml`, `public-web/_headers`, `src/home.ts`,
`src/mainWindow.ts`, `README.md`, `docs/privacy.md`, `site/`, `AGENTS.md`

Needs parts 2 and 3: a web version that can't open a file isn't worth publishing.

- **Hosting**: a Cloudflare Pages project, `strandivo-app`, with `app.strandivo.com` as its
  domain, free, beside the website's project. Cloudflare's own analytics script stays off.
- **The workflow** (`.github/workflows/web.yml`): on a published release (not the tag
  push, which only drafts one), checks out the tag, runs the unit tests and
  `npm run build:web`, then `wrangler pages deploy dist --branch main`. Run by hand on any
  branch, it deploys to that branch's preview address (`<branch>.strandivo-app.pages.dev`)
  instead, which never touches `app.strandivo.com`. It needs a Cloudflare token that can
  only deploy Pages, kept as a repository secret. The workflow sets `permissions:
  contents: read`, as `build.yml` does, so a job holding that secret can't also write to
  the repository.
- **Headers** (`public-web/_headers`, copied into `dist` only by the web build): a Content
  Security Policy that starts from the desktop's (`src-tauri/tauri.conf.json`), without
  the shell's `ipc:` addresses:
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self'; font-src 'self';
  connect-src 'self' https://rest.uniprot.org; object-src 'none'; frame-src 'none';
  frame-ancestors 'none'; base-uri 'none'; form-action 'none'`.
  `connect-src` allows only the page's own origin and UniProt, so the browser itself
  refuses to send anything elsewhere, whatever a future change or a dependency tries; it
  also limits `?open=<url>` to files on `app.strandivo.com`, so a link can't make the page
  open a file from somewhere else. `script-src` has no `'unsafe-inline'`: a file's text
  that ever reached the page as HTML still couldn't run, which matters more here than on
  the desktop, as a script on the page could write through every file handle the user has
  allowed. `'wasm-unsafe-eval'` is what lets the worker compile the core and allows no
  JavaScript `eval`. `frame-ancestors` only works as a header, which is why the desktop
  has none. Also `Referrer-Policy: no-referrer`; `index.html` never cached, everything with
  a hash in its name cached for a year. From then on the browser check (`e2e/web.mjs`)
  serves `dist` with the headers in `_headers`, so a violation fails CI before it reaches
  users.
- **A page left open across a deployment** still runs the old version, whose hashed files
  are gone from the new deployment. The worker and the `.wasm` are fetched when the page
  loads, not when first used, so alignment keeps working in an old page; a lazy import that
  fails anyway shows "Strandivo has been updated. Reload the page to continue." instead of
  an error.
- **Saying that nothing is uploaded**, where people will see it:
  - **Home**, in a browser, under its title, always: "Runs in your browser. Your files
    stay on this computer: nothing is uploaded." with "How?" linking to the privacy page.
  - **The welcome window** (part 3 of the updates plan) starts with the same sentence in
    a browser.
  - **The privacy page** (`docs/privacy.md`, published at `strandivo.com/privacy`) gains
    "The web version": the page is static files from Cloudflare; files are read by the
    browser and never leave it; what Cloudflare sees is what any website's host sees (that
    the page was loaded, by which address), never a file; the one exception is UniProt,
    fetched by the browser directly and only when asked; and how to check it: the
    browser's network panel shows no request carrying a file, and the Content Security
    Policy above is in the page's headers for anyone to read.
  - **The website** says it on the Download page, where the web version is offered as
    "Use it in your browser" beside the installers, and the README gains the address and
    the same sentence beside its "Private" line.
- **The updates plan, for the web**:
  - *Updates*: none to install; a reload is the latest release. The welcome window has no
    Updates section in a browser, Settings no update choice, and the Help menu no Check for
    Updates….
  - *Welcome window*: shown on a first visit, kept in the same `welcome: { version }`
    setting; Your constructs offers Add folder… only where part 4 works.
  - *Feedback*: the same dialog; the Worker at `feedback.strandivo.com` must allow
    `app.strandivo.com` as an origin (CORS), and the report says "web" and the browser
    family (Chrome, Edge, Safari, Firefox) and version, never the whole user-agent string.
    `connect-src` gains `https://feedback.strandivo.com`.
  - *Usage statistics*: the same events and the same opt-in, with "web" as the platform and
    the browser family. Aptabase's Tauri plugin doesn't run there, so `src/usage.ts` sends
    through its web SDK, or our own endpoint if part 5 of that plan chose one, and
    `connect-src` gains that address only. Web visits aren't counted through update
    checks, as there are none; the count of page loads Cloudflare keeps for any site is the
    share rate's denominator for the web, and nothing is added to the page to get it.
- **Before announcing it**: the whole of the desktop e2e's file journey done by hand once
  in Chrome, Safari and Firefox on a Mac and in Edge on Windows, with a plate of real
  .ab1 reads from `testdata/library/`.

## Order

After 0.2.0 and the website, because the website is where the web
version is offered and its privacy page is what the web version links to. Then parts 1,
2 and 3 in order, each needing the one before; part 5 once 2 and 3 are in, deployed with
the next release; part 4 before or after 5. Part 1 is worth doing early on its own, as it
tidies the shell whether or not the rest follows.

## Checking work

- `npm run check` before every push; from part 2 it builds the web version too.
- The bridge crate's tests (part 1) prove both builds speak the same JSON; `e2e/web.mjs`
  (part 2) proves alignment and detection work through WebAssembly in a real browser, with
  no hooks, and `e2e/run.mjs` keeps proving the desktop. CI runs both.
- The `.wasm` size is checked in CI against 512 KB; the measured 259 KB is the baseline.
- What CI can't check is checked by hand before the first deployment (part 5): Safari and
  Firefox, where the fallbacks run, and permission prompts, which WebDriver can't answer.
- `AGENTS.md` gains what the code can't say: that `crates/seqcore/` stays dependency-free
  and JSON lives in `crates/seqcore-json/`, shared by both builds; the order
  `src/platform.ts` tries things in (hook, shell, worker); that `npm run build` must never
  need the WebAssembly target; that browser paths are handle keys (`web:`, `upload:`) and
  `upload:` ones last only for the visit; which shortcuts a browser keeps; that the web
  version deploys only from published releases; and that **the Content Security Policy is
  the privacy promise**, so a new address the app talks to goes into `_headers` and
  `docs/privacy.md` in the same PR, or the browser will block it.
