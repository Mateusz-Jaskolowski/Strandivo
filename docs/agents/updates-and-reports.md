# Updates, feedback, crash reports and statistics: guide for coding agents

Read this before changing anything the app sends or fetches, how it updates itself,
feedback and bug reports, crash reports, usage statistics or the welcome window. The
Workers behind `updates.strandivo.com` and `feedback.strandivo.com` are in
`services/AGENTS.md`; `docs/privacy.md` is the one list of what the app sends.

**Keep this guide true** (and `AGENTS.md`'s rules apply here too): a change that makes
something here wrong updates it in the same commit. Paths are from the repository's root,
and CI checks that they exist.

## Conventions

- **Updates** (`src/updates.ts`, `src-tauri/src/updates.rs`): the page asks the shell to
  check, download and restart, but can't install: Restart quits the way ⌘Q does, so the
  main window asks about unsaved tabs, and the update is installed only once the last
  window has closed. A cancelled quit keeps the download, and an ordinary quit doesn't
  install it. So the updater and opener plugins' own commands stay out of the capability,
  and a version's notes on strandivo.com (`/changes#v<version>`, which every copy opens,
  so it must keep working: each version's section has that id) are opened from a
  version the shell checks, never an address from the page. What's new shows the short
  notes as text: before updating they come from latest.json (`shortNotes` in
  `src/lib/changelog.ts` cuts them short and drops them if they name an address, as
  latest.json isn't signed and tampered notes could point to a look-alike site), after updating
  from the copy's own `CHANGELOG.md`, on the first start of the new version. Development builds don't update themselves, and
  a browser has nothing to install (a reload is the latest release), so there the welcome
  window, Settings and the menu offer no updates. On Linux the AppImage replaces
  itself and a .deb copy installs the release's .deb (`linux-x86_64-deb` in latest.json,
  which the plugin looks for before `linux-x86_64`) with `pkexec`, so the system asks for a
  password; no .rpm is built, so an .rpm copy is told to download instead. A check says nothing unless it finds something or the user asked; an offer is a
  strip under the app bar, never a dialog. e2e fakes the shell with
  `window.__strandivoUpdate`, so it never reaches the server.
- **Feedback** (Report a bug… and Send feedback… in the app bar, and the same two in the
  Help menu, `src/views/feedbackDialog.ts`): while Strandivo is young they are named
  buttons, not icons, so people see they can report things; a window under 1,000 px wide
  shows only their icons, keeping room for tabs. The page posts the report to `feedback.strandivo.com` (`services/feedback/`), which
  files it as a GitHub issue with a token that can only write issues. Issues are public,
  so **the reporter's email address and an attached file never go in one**: the Worker
  emails them to the maintainer alone (Email Routing, to a verified address kept as a
  secret), and what the reporter wrote is fenced as plain text, so it can't mention
  anyone or link anywhere. A name to credit goes in the issue as inline code (`codeSpan`),
  which does the same for one line; it is turned away if it holds an email or web address,
  which typed in the wrong box would be published, but no list of words is kept (real
  surnames would be turned away, and the summary is public too). The last name sent is
  remembered in local storage (`src/feedback.ts`). What a report may hold is
  `src/lib/feedback.ts`, which the Worker bundles too, so the two can't disagree; change
  it and deploy the Worker in the same PR. The Worker turns down a field it doesn't know,
  so a new optional field is left out of a report when empty, not sent as null: the app
  then still works with the Worker before it, and the Worker must be deployed before a
  release that fills it in. Everything sent is shown in the dialog first; recent errors (`src/feedback.ts`:
  uncaught errors, rejected promises and failed shell commands of the past week) and the
  open file are off until ticked, and errors lose their file paths (`scrubPaths`, which
  takes a path under a home or volume folder to the end of its line, as folder names have
  spaces). The shell opens only addresses it builds: an issue from its number, an email
  to feedback@strandivo.com with the page's text as subject and body. e2e fakes the
  service with `window.__strandivoFeedback`. In a browser, `systemInfo` gives the browser
  and its major version as `os`, "on" and the system as `osVersion`, and "web" as `arch`
  (`src/lib/browser.ts`), so the service, unchanged, shows "Chrome 142 on macOS · web". On a Mac, Welcome and Check for Updates stay
  in the app menu, where 0.2.0's notes put them; the Help menu has the rest.
- **Crash reports** (`src-tauri/src/crash.rs`, `src/crash.ts`): release builds abort on a
  panic and have no symbols, so the panic hook, set first in `run()`, writes the message,
  `file:line:column`, thread, version, system and time to crash.json in the app's data
  folder, from one buffer on the stack, then lets the abort happen. It keeps the location
  short (a dependency from its crate's folder) but leaves the message as it is: the page
  removes paths (`crashForReport` in `src/lib/feedback.ts`), and shows the crash exactly as
  it is sent. The main window takes the file once (`take_crash_report` deletes it) and
  offers it in a strip, never a dialog; Report it… opens Report a Bug with the crash ticked,
  and nothing goes without Send. A report's `crash` is optional, as copies before 0.4.0
  send none. With statistics on, a crash counts as `error` of kind `crash` on that next
  launch. Recent errors (`src/feedback.ts`) are kept in local storage for a week, shared by
  all windows, so a report after a crash still has them; still off until ticked. e2e hands
  a crash file over with `window.__strandivoCrash`.
- **Usage statistics** are off in the app until the user turns them on (the welcome
  window or Settings), as the EU's rules want. In the browser version they are on until
  turned off, a decision made for it alone: the welcome window says so with Turn off,
  Settings has the switch, and they are off whenever the browser sends Global Privacy
  Control (`browserAsksNotToTrack` in `src/platform.ts`). What makes that defensible is
  that the page stores nothing for them (no `installed`, no first start kept) and keeps
  its session only in memory; keep it so, as anything stored on a visitor's computer for
  statistics, or anything that tells visitors apart, would need their yes first. Every event and what it may carry is
  listed in `src/lib/usage.ts`, each property a list of words or a number put in one of a
  few buckets (`BUCKETS`), so nothing typed or named can go; a unit test holds
  `docs/privacy.md` to naming every event and property, so add one to both, with why it is
  worth counting. An event is named for what happened to what, as the user would say it
  (`file_opened`, `primers_designed`, never `dialog_completed` with the tool as a
  property), as Aptabase's dashboard lists names alone; a test holds names to the verbs
  in use. Renaming one splits its count from older copies', so do it early or not at all.
  `track` in `src/usage.ts` is the only way to send (`trackOnce` for once a launch, as for
  views); it queues in the page, so turning statistics off empties the queue at once and
  sends nothing, not even that. Only the main window's page sends, so a library or
  Settings window can't count anything yet. The shell (`src-tauri/src/usage.rs`) checks
  the words again, adds a session number (random, never stored) and the system, and posts
  to Aptabase's EU region with the key built in from `APTABASE_APP_KEY`, a variable of the
  `release` environment: CI and e2e builds have none and send nothing. A development build
  sends only if its developer builds it with the key, to try the whole path before a
  release; its events and a release candidate's are marked `isDebug`, which Aptabase's
  dashboard keeps apart (its bug icon). Aptabase's Tauri plugin isn't used: it keeps a queue
  of its own that turning statistics off couldn't empty, sends the system's language, and
  lets the page send any text. The browser version posts each event itself
  (`sendUsage` in `src/platform.ts`) to Aptabase's single-event address, as Aptabase's web
  SDK does, without the language, so Aptabase reads the browser and system from the
  request; the key is built in from `APTABASE_APP_KEY`, a variable of the `web`
  environment that only `.github/workflows/web.yml` passes, and every deployment but a
  release's marks its events `isDebug` (`__USAGE_DEBUG__` in `vite.config.ts`). Its address
  is in the page's Content Security Policy, the only one statistics can go to. e2e
  receives events with `window.__strandivoTrack`.
- **The welcome window** (`src/welcome.ts`) opens on first launch as a dialog over the
  main window, not a window of its own, since what it asks acts on the main window (Home's
  folders, holding back the update check, which waits for it). A choice users must make,
  such as usage statistics, is added to `WELCOME_PARTS` in `src/lib/welcome.ts` with the
  next version: that raises `WELCOME_VERSION`, and people who saw the older window are
  asked only the new part. Closing it any way keeps the choices as shown; "Reset all
  settings" leaves it seen, and never turns statistics on. A browser's window has no
  Updates part (`welcomeParts`). The e2e run starts as a fresh install, so it closes the window
  first.
