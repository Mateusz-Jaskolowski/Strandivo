# Updates, feedback and usage statistics: plan

Status: every decision below is made (November 2026). Parts 1–3 are built: the release
workflow, the updates Worker (deployed), updating from inside the app and the welcome
window, which go out together as 0.2.0. The other parts are planned.
Each part below is one branch and one PR. What is said here about services and the law was read
on 4 November 2026; check it again before each part is built. The legal notes are a
reading of published guidance, not legal advice.

## What we want

Three ways for the app to stay in touch once someone has installed it, one place where
the user chooses, and a home on the web:

1. **Updates**: the app notices a new version and installs it when the user says so.
2. **A welcome window** on first launch: what the app sends, the choices about updates
   and statistics on one page, and the two things worth setting up on day one (the
   construct folders and the primer library).
3. **Feedback**: Help → Send Feedback… opens a dialog for a bug, an idea or a question,
   and sends it without the user needing a GitHub account.
4. **Usage statistics**: anonymous counts of what is used, so we know what to work on.
   Off until the user turns it on (opt-in, for everyone), asked in the welcome window, and
   a setting.
5. **A website**, `strandivo.com`: what the app does, where to download it, and the
   privacy page that says what it sends.

What holds for all of it:

- **The user's files never leave the computer.** No sequence, file name, path, feature or
  primer name is sent by any of these, ever. Feedback may attach a file only when the user
  ticks a box that is off by default.
- **The app says what it sends before it sends it**, and updates, feedback and
  statistics can each be turned off in Settings.
- **The README's "Private" line and AGENTS.md's UniProt paragraph ("the one thing the app
  fetches") change in the same PR as each part**, since each part makes them untrue.
- **Nothing here may slow down or block the app.** It all works in the background and
  fails quietly when offline.

## Decisions

**Strandivo has its own domain, `strandivo.com`** (bought through Cloudflare, November
2026). That matters more than it looks: **the address an installed copy checks for updates
is built into it**, so it must be one we control, not GitHub's, or moving the releases
later would strand every copy. `updates.strandivo.com` and `feedback.strandivo.com` are
Cloudflare Workers; `strandivo.com` itself is the website (part 6). The domain also gives:

- **The app's identifier**, `com.strandivo.desktop` (`identifier` in
  `src-tauri/tauri.conf.json`). It decides where the app keeps its settings, library and
  remembered reads, and macOS and Windows treat a new one as a different app, so it is set
  once, before the first public release, and never changed. Not `com.strandivo.app`: on a
  Mac an identifier ending in `.app` clashes with the bundle's own extension.
- **Addresses that forward to the maintainer** (Cloudflare Email Routing), so no personal
  address is published: `hello@` (`CONTRIBUTING.md`, `CITATION.cff`), `security@`
  (`SECURITY.md`) and `feedback@` (the feedback dialog's "Email instead").

1. **Where releases are public**: decided, **a new public repository** whose history
   starts with today's files, so nothing from before goes public. The current repository
   is renamed `Strandivo-archive` and stays private, with its history and pull requests.
   Releases and `latest.json` live on the new repository's GitHub Releases, behind
   `updates.strandivo.com`, and public repositories' Actions minutes are free, Mac
   included. Pull requests from forks get a read-only token, so `checks.yml` skips pushing
   `e2e-results` for them, and first-time contributors' runs wait for approval (an Actions
   setting of the repository).
2. **Where feedback goes**: decided, a Cloudflare Worker at `feedback.strandivo.com`
   (part 4) that files a GitHub issue and keeps the reporter's email out of it.
3. **Which statistics service**: decided, [Aptabase](https://aptabase.com) in its EU
   region: open source, made for desktop apps, no persistent identifier, with a Tauri
   plugin; it can be self-hosted later. Its Tauri v2 plugin must be checked first (the 1.0
   crate is for v2, but its docs.rs build failed); if it doesn't build, events go to a
   small endpoint on our own Worker instead.
4. **Opt-in for statistics, for everyone**: decided. Nothing is sent until the user
   chooses to share in the welcome window or Settings. That meets the EU's ePrivacy rules
   as well as the UK's (where the Data (Use and Access) Act 2025 would have allowed
   opt-out for statistics alone), so one rule holds wherever the app is used.

## What the code already gives us

- **Settings** (`src/settings.ts`): one object in local storage, sent to every window when
  it changes; `loadSettings` fills in defaults, so new fields need no migration. The
  Settings window (`src/settingsWindow.ts`) has sections (Maps, Primers, Sequencing
  results, Plasmid info); a new "Updates and privacy" section goes last.
- **One place talks to the shell** (`src/platform.ts`), with a plain-browser fallback and
  test hooks on `window` (`__strandivoUniprot`, `__strandivoAlign`, …). Each part adds its
  own hook the same way, so the e2e test never reaches the internet.
- **The page can fetch** (`csp` is `null`; `fetchUniprotEntry` uses the page's own
  `fetch`), so feedback and statistics need no Rust. The updater does, as it replaces the
  app.
- **Dialogs** (`openDialog` in `src/ui/modal.ts`) and **the quiet strip** detection shows
  under the toolbar (`sv-offer` in `src/doc/document.ts`) are the two shapes these need.
- **Quitting** already asks about unsaved tabs (`request_quit` in `src-tauri/src/lib.rs`,
  `cancelQuit`), which an install must go through rather than around.
- **Menus** (`build_menu` in `src-tauri/src/lib.rs`): there is a Help menu with only About
  on Windows and Linux, and none on a Mac. There is no way to open a web link yet.
- **Releases** (`.github/workflows/build.yml`): a version tag builds every platform and
  drafts a GitHub release; Mac builds are signed ad hoc (`signingIdentity: "-"`) and
  Windows installs per user (NSIS `currentUser`), which the updater can replace without
  admin rights.
- **The version** is written in three places: `package.json`, `src-tauri/Cargo.toml` and
  `src-tauri/tauri.conf.json`, all 0.1.0.
- **Nothing records errors** today: no `window.onerror`, and release builds abort on a
  Rust panic.

## Parts

### 1. Releases the app can update from
`build/updater-release`: `.github/workflows/build.yml`, `src-tauri/tauri.conf.json`,
`package.json`, `src-tauri/Cargo.toml`, `services/updates/`

- **An update signing key**, made once with `npm run tauri signer generate`. The public
  half goes in `plugins.updater.pubkey`; the private half and its password go in the
  secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. **Keep a
  copy of the private key somewhere safe**: if it is lost, no installed copy can ever
  update again, and every user has to reinstall by hand. It is separate from Apple's and
  Microsoft's code signing.
- `bundle.createUpdaterArtifacts: true`, so each build also makes the update files and
  their signatures: `.app.tar.gz` on a Mac, the NSIS `-setup.exe` on Windows, the
  AppImage and the `.deb` on Linux (the `.deb` installs with the system's password prompt;
  part 2).
- **`latest.json`** lists each platform's file, signature and version, and the release
  notes. Either switch the build step to `tauri-apps/tauri-action`, which writes it, or
  have the release job build it from the `.sig` files, whichever is less code.
- **Endpoint**: `https://updates.strandivo.com/latest.json`, a Worker that hands over the
  release's `latest.json` (on GitHub, `releases/latest/download/latest.json`) and counts
  the check (part 5). The address is ours, so the files can move without stranding a
  single install. GitHub's `latest` only follows the release marked Latest, so drafts and
  pre-releases are invisible to it. That is what we want: **publishing the draft is the
  moment users get the update**, a natural last check. The Worker goes in
  `services/updates/` beside the feedback one.
- **One version**: the release job fails if the tag doesn't match all three versions, so a
  release can't tell the updater it is something it isn't. A small `npm run version <x>`
  writes all three.
- Mac minutes are unchanged: installers are still built only for a tag or on request.

### 2. Updating from inside the app
`feat/in-app-updates`: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`,
`src-tauri/src/updates.rs`, `src/platform.ts`, `src/updates.ts`, `src/lib/updates.ts`,
`src/mainWindow.ts`, `src/settings.ts`, `src/settingsWindow.ts`, `e2e/run.mjs`

Built differently from the plan below in four ways:

- **The shell holds the update, not the page.** Its own commands check, download and
  restart; the updater plugin's commands aren't in the capability, and there is no
  `tauri-plugin-process`, as the shell restarts itself. The page can't install anything.
- **What's new is a small dialog with the short notes**, and "More on strandivo.com"
  opens `strandivo.com/changes#v<version>` (through `tauri-plugin-opener`, from Rust only,
  which checks the version). The notes are written in `CHANGELOG.md` before the version is
  bumped: its first paragraph goes in latest.json and the whole section is the GitHub
  release. After an update, the first start says "Strandivo was updated to …" in the same
  strip, with What's new built in from the same file; a first install says nothing.
- **Only Restart installs.** A cancelled quit keeps the download for the next Restart, but
  an ordinary quit doesn't install it: on Windows that would bring up an installer the
  user didn't ask for.
- **The .deb updates too**, not only the AppImage: the release's latest.json has a
  `linux-x86_64-deb` entry, which a copy installed from the .deb finds first, and the
  plugin installs it with `pkexec dpkg -i`, so the system asks for the user's password.
  No .rpm is built, so an .rpm copy is told to download the new version.

The first check waits for the welcome window to close (`startUpdates` takes a promise,
part 3).

- `tauri-plugin-updater` and `tauri-plugin-process` (to relaunch), with their permissions
  in the capability. `checkForUpdate()` and `installUpdate()` in `src/platform.ts`; in a
  browser there are none, and `window.__strandivoUpdate` lets a test supply one.
- **When it checks**: a few seconds after the main window opens, never while the welcome
  window (part 3) is still open, at most once a day (the time is remembered), and
  whenever the user picks Check for Updates… (Help menu; in the app menu on a Mac). A
  check never shows anything unless there is an update, except when the user asked, who
  gets "Strandivo is up to date" or why it couldn't check.
- **What it shows**: a quiet strip in the main window, like detection's offer, never a
  dialog that interrupts: "Strandivo 0.3.0 is available. What's new · Install and
  restart · Later". "Skip this version" is remembered. What's new shows the release notes
  from `latest.json` in a dialog.
- **Installing** downloads in the background with progress in the strip, then quits the
  way ⌘Q does, so unsaved tabs are asked about first; cancelling leaves the download ready
  for the next quit. It never restarts on its own.
- **Setting**: "Check for updates automatically", on by default, and asked in the welcome
  window. Each check asks `updates.strandivo.com`, which sees the address it comes from,
  as any server does, and keeps only a count; the download that follows comes from
  GitHub. The
  privacy page says so.
- **On a Mac**, the update works with the current ad-hoc signed builds, but each build is a
  different app to macOS, which may ask again for permissions such as access to folders.
  Signing and notarizing (on the roadmap) fix that; it is not a reason to wait.
- **Before telling users**: install 0.2.0 by hand on a Mac and on Windows, publish 0.2.1,
  and check that both update, relaunch and keep their settings, library and remembered
  reads (local storage is kept by origin, which an update doesn't change; this is what the
  check is for). An e2e check fakes an update through the hook and checks the strip.

### 3. The welcome window
`feat/welcome`: `src/welcome.ts`, `src/lib/welcome.ts`, `src/mainWindow.ts`,
`src/updates.ts`, `src/settings.ts`, `src-tauri/src/lib.rs`, `src/home.ts`, `e2e/run.mjs`

Built differently from the plan below:

- **A dialog over the main window, not a window of its own.** Its choices act on the main
  window (Home's folders, the update check it holds back), and a separate window on first
  launch could end up behind the main one.
- **The version is `welcomeSeen` in the settings, and the parts are versioned**
  (`WELCOME_PARTS` in `src/lib/welcome.ts`), so a raised version shows only the new parts.
- **The common primers are offered only while the library is empty**, so a lab's own list
  never gets extra entries; reopening the window doesn't add them again.
- In e2e the run starts as a fresh install, so it closes the window first rather than
  starting with the version set: that is the check the plan describes.
- Welcome… is in the Help menu, and in the app menu on a Mac (which has no Help menu yet).

Not tied to one file, so it is a window of its own, like Settings (in a browser it is shown
over the main window, as `showWindowsInPage` does for the others).

- **When**: on first launch, over the main window, which opens as usual behind it so a
  file double-clicked to start the app still opens. **Nothing goes online until it is
  closed**: no update check, no statistics.
- **One page, not steps**, so every choice is in view at once and closing the window keeps
  them as shown. Statistics stay off unless the user picks "Share", so closing without
  choosing shares nothing. Short, in this order:
  1. *Welcome*: one sentence on what Strandivo is, and "Everything runs on your computer.
     Your files and sequences never leave it."
  2. *Updates*: "Check for updates automatically" (on), "Asks Strandivo's server once a
     day for the latest version."
  3. *Usage statistics* (part 5 adds it): two equal choices, "Share anonymous usage
     counts" and "Don't share", neither chosen to begin with, with "What is sent" opening
     the privacy page, `strandivo.com/privacy` (part 6).
  4. *Your constructs*: "Add a folder…" (Home's own `pickFolder`), listing what was added;
     optional, and Home says the same if skipped.
  5. *Primer library*: "Start with common sequencing primers" (on; M13, T7, SP6 and the
     rest of `COMMON_SEQUENCING_PRIMERS`) and "Import a list…".
  Then "You can change all of this in Settings." and one button, "Start using Strandivo".
- **Not asked here**, because the defaults suit nearly everyone and each question makes
  the window longer: the Tm method, amber suppression, read quality thresholds, lab fields,
  the case of bases, the detection offer. Appearance joins the window when the dark mode
  setting exists.
- **A version, not a flag**: `welcome: { version }` in the settings. When a release adds a
  choice that must be asked (statistics, later crash reports), it raises `WELCOME_VERSION`
  and the window opens once more for existing users **with only the new questions**. This
  is how someone who installed before part 5 is asked about statistics rather than having
  them start silently with an update.
- Help → Welcome… opens it again, all of it.
- In e2e the settings start with the current version, so the window stays shut; one check
  clears it, closes the window and checks the choices landed in the settings and that no
  update check ran before it was closed.

### 4. Help menu and the feedback dialog
`feat/feedback`: `src-tauri/src/lib.rs`, `src/feedback.ts`, `src/views/feedbackDialog.ts`,
`src/platform.ts`, `src/mainWindow.ts`, `services/feedback/`, `e2e/run.mjs`

- **A Help menu on every platform**: Send Feedback…, Report a Bug… (the same dialog, with
  Bug chosen), Check for Updates… (when part 2 is in), Welcome… (part 3), Strandivo on
  GitHub, Strandivo website, and About outside a Mac. `tauri-plugin-opener` opens links
  in the user's browser. Chosen in Settings or the primer library, it opens in the main
  window.
- **The dialog** (`openDialog`): kind (Bug, Idea, Question), a summary line, details, and
  an email field marked "only if you'd like an answer". Below them, what is sent with it,
  shown in full: app version, OS and its version, and the view that was open. Two boxes,
  off by default: **Recent errors** (the log below, file paths removed) and **Attach
  the open file**, with a warning that sequences may be confidential. Send is disabled
  until there is a summary.
- **Recent errors**: `src/feedback.ts` keeps the last 20 uncaught errors and rejected
  promises (`window.onerror`, `unhandledrejection`) and failed shell commands, in memory
  only. It is also what makes a bug report useful.
- **The service** (`services/feedback/`, a Cloudflare Worker or similar, on its free tier):
  takes one JSON POST, checks its size and shape, limits how often one address can send,
  and files a GitHub issue labelled `from-app` and with the kind, using a fine-grained
  token that can only write issues in this repository. **The email never goes in the
  issue**, which is public: the service emails it to the maintainers alone (Cloudflare's
  email sending, to the address `hello@` forwards to), with the issue's link. It answers
  with the issue number, which the dialog shows ("Thanks, sent as #123"). The token lives
  only in the service, never in the app.
- **Offline or refused**: the text stays in the dialog, with "Copy" and "Email instead"
  (a pre-filled `mailto:feedback@strandivo.com`), so nothing typed is lost.
- **Spam**: an app can't keep a secret, so anyone could call the service. A rate limit, a
  size limit and the label are enough at this scale; revisit if it is abused.
- `window.__strandivoFeedback` receives the report in tests; the e2e opens the dialog,
  fills it, sends it and checks the report holds no path.

### 5. Usage statistics
`feat/usage`: `src/lib/usage.ts` (and its test), `src/usage.ts`, `src/platform.ts`,
`src/mainWindow.ts`, `src/settings.ts`, `src/settingsWindow.ts`, `src-tauri/Cargo.toml`,
`src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `docs/privacy.md`,
`e2e/run.mjs`

- **Every event is listed in one file**, `src/lib/usage.ts`: its name and the properties it
  may carry, each an enumerated value or a number put in a bucket (1, 2–5, 6–20, over
  20). A unit test checks that no event can carry free text, so a file name can't slip in
  later. `track(event, props)` in `src/usage.ts` is the only way to send one.
- **What is counted**, to start with: the app started (version, OS, processor); a file
  opened (format only); a view shown; a dialog completed (digest, cloning by method,
  primer design, mutagenesis, detection with how many parts were added); the Primers
  tab's Pairs view shown and its list exported; reads aligned (how many, Sanger or long);
  a check saved; an update installed; an error (its kind, not
  its message). Nothing else until it is added to the list, with the reason.
- **No identifier.** Aptabase counts sessions, not people, so "how many users" is only
  approximate. That is accepted: it is the price of not tracking anyone.
- **Asked in the welcome window** (part 3), which this part extends and whose version it
  raises, so existing users are asked too. Nothing is sent until the window is closed.
  `docs/privacy.md` lists every event and says what update checks send; the website
  publishes it as `strandivo.com/privacy`, and a unit test checks that it names every
  event in `src/lib/usage.ts`.
- **How many share, without asking those who don't.** Turning statistics off sends
  nothing, not even that it was turned off: that would be collecting from someone who
  just said no. Instead, every copy with update checks on asks `updates.strandivo.com` at
  most once a day, and the Worker adds one to a count per day, version and platform, keeping
  nothing else (no address, no identifier). So update checks a day roughly count active
  installs, sharing or not; "app started" events a day count those that share; one over
  the other is the share rate, which says how far the statistics speak for everyone. It
  is an estimate: copies with update checks off are missed, and one person on two
  computers counts twice. GitHub's own download counts for installers give installs over
  time.
- **Setting**: "Share anonymous usage statistics", with "What is sent" linking to the same
  list. Turning it off stops sending at once, including anything queued.
- **Never from tests or development**: the service key comes from an environment variable
  at release build time only, so `npm run app:dev`, Checks and e2e builds have none and
  send nothing. `window.__strandivoTrack` receives events in e2e, which checks that turning
  the setting off stops them.
- **Crashes**: a Rust panic aborts with nothing recorded. Later, a panic hook can write a
  line that the next launch sends as a `crashed` event; not in this part.

### 6. The website
`feat/website`: `site/`, `docs/privacy.md`, `README.md`

`strandivo.com` on Cloudflare Pages (free), built from `site/` in this repository, so it
is versioned and reviewed like the code. Plain HTML and the app's own design tokens, no
framework. Three pages to start with:

- **Home**: what Strandivo does, in the README's words, with one screenshot from the e2e.
- **Download**: the latest release's installers for Mac (Apple Silicon and Intel), Windows
  and Linux, read from GitHub's releases API in the page, with the first-launch notes from
  the README (the unsigned-app steps until installers are signed).
- **Privacy**: generated from `docs/privacy.md` when the site is built, so there is one
  list of what the app sends. The welcome window and Settings link here.
- **What's new** at `/changes`, a section per version with an `id` of `v<version>`, from
  `CHANGELOG.md`. Every copy from 0.2.0 on opens that address, so it must keep working;
  until the page exists, `site/_redirects` sends it to the GitHub releases.

It comes after the first public release, when there is something to download. Until then
a single placeholder page (built November 2026) says the app is in development and links
to GitHub, since the repository, `CITATION.cff` and `SECURITY.md` already send people to
the domain; the three pages replace it. The About
box, `package.json`, `src-tauri/Cargo.toml` and the README name it as the homepage from
the start.

## Order

Before any part: the repository starts afresh and public (decision 1), with the new
identifier. Then part 1, 2 and 3, released together as 0.2.0: until updates work, every
fix after the first release has to reach each user by hand, so the updater comes first,
and the welcome window comes with the first thing that goes online by itself. Copies
before 0.2.0 can't update, so everyone installs 0.2.0 by hand once. Then the website
(part 6), since 0.2.0 is something to download. Part 4 depends on none of the others;
part 5 needs part 3, since that is where it is asked. Whichever of 3 and 4 comes first
adds the Help menu.

## Checking work

- `npm run check` before every push, as always.
- Each part's e2e check uses its hook, so CI never reaches the update server, the feedback
  service or the statistics service.
- The updater can only be proved on real installers: the 0.2.0 → 0.2.1 check in part 2 on
  a Mac and on Windows, before any user is told about it.
- The feedback service is tested on its own (`services/feedback/`, with its own small
  test), and once by hand against a test repository before it points at this one.
- `AGENTS.md` gains what the code can't say: where the update key lives and that losing it
  strands every install; that a new statistic goes into `src/lib/usage.ts` and
  `docs/privacy.md` together; that a new choice users must make raises
  `WELCOME_VERSION`; that the reporter's email never goes in an issue; and the rewritten
  paragraph on what the app fetches.
