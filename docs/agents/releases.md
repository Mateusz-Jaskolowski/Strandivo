# Installers, releases and the website: guide for coding agents

Read this before building installers, making a release, touching the update key or the
release workflows, or changing the website (`site/`, `tools/site/`,
`tools/build-site.mjs`).

**Keep this guide true** (and `AGENTS.md`'s rules apply here too): a change that makes
something here wrong updates it in the same commit. Paths are from the repository's root,
and CI checks that they exist.

- Installers (`.github/workflows/build.yml`) are built for a version tag, which also drafts a
  release, or when a maintainer runs the workflow; not on every push, as a full set takes
  most of an hour. Both use `.github/actions/build-app/action.yml`. A tag's builds are
  signed and make the update files; a manual run's are not
  (`src-tauri/tauri.unsigned.conf.json`, which `npm run app:build` uses too, since a build
  with update files stops when there is no key).
- **Releases and the update key**: the key that signs updates is a secret of the `release`
  environment only (`v*` tags may use it, a maintainer approves each run, and the "Protect
  release tags" ruleset lets only admins create, move or delete `v*` tags). Never give it
  to `.github/workflows/checks.yml`, a `pull_request_target` workflow or a manual run, and
  keep the release jobs' third-party actions pinned to commits, as they run beside it.
  `.github/CODEOWNERS` names who reviews what runs beside it or reaches users without a
  release (the site, the updates Worker); a new file of that kind goes in it too.
  Losing the key strands every install: it is backed up outside GitHub. To release, write
  the short notes the app shows (two or three plain sentences) as the first paragraph of
  Unreleased in `CHANGELOG.md`, above its bullets, then run `npm run release <x.y.z>` on
  an up-to-date main (`tools/release.mjs`): it renames Unreleased to the version with a new
  empty one above, sets the version (`tools/set-version.mjs`, also `npm run version`),
  rebuilds the site, commits on `chore/release-<x.y.z>` and opens the pull request. Once
  that is merged, `npm run release:tag` checks main as the release build will and pushes
  the `v<x.y.z>` tag on it; then a maintainer approves the run and publishes the draft.
  A minor release is first tried as a **release candidate** (`npm run release 0.4.0-rc.1`):
  the same steps, but Unreleased stays as it is and gives the candidate its notes
  (`releaseNotesFor` in `src/lib/changelog.ts`), and its build drafts a pre-release. GitHub
  never makes a pre-release "latest", which is what the updates Worker and the Download page
  follow, so only people who download it get it; the website shows sections only, so it
  never lists one. 0.3.0 is why: its crash happened only in a signed build, the one thing
  nothing ran before users had it. Use the candidate for a day with statistics on.
  Tagging stays a person's step: an Actions token that could push `v*` tags would get
  round the ruleset that keeps them to admins. `check-version` in
  `.github/scripts/release.mjs` fails a tag that doesn't match the three
  files or has no notes, `latest-json` writes the manifest from the `.sig` files the builds
  made, and the section becomes the release's text. `name-files` gives each file its
  published name first (`RELEASE_FILES`): the system in words people use
  (`Strandivo_Mac_Intel.dmg`, not the build's x64) and no version, so a release lists each
  installer once and the website's Download page links to
  `releases/latest/download/…`, the newest published release, with no change per release. The script reads the changelog with
  `src/lib/changelog.ts`, so it runs with `--experimental-strip-types`. A release's
  section written by hand needs `npm run site` too, or the quick checks fail.
- **The website**, `strandivo.com`, is the plain files in `site/` on Cloudflare Pages (a
  project named `strandivo`), with no build step, so its Content Security Policy
  (`site/_headers`) allows only its own images, stylesheet and one script,
  `site/download.js`, which puts the visitor's own system's download first. That script
  only shows what the page already holds, hidden: without it every download shows, and it
  sends and stores nothing (the Privacy page says so; keep both true). A browser can't
  tell an Apple silicon Mac from an Intel one, so Macs get Apple silicon first, with Intel
  just under it. Its colours copy the
  app's tokens, as the site can't load `src/styles.css`. Its pages are written by
  `tools/build-site.mjs` (`npm run site`) and committed: What's new from `CHANGELOG.md`,
  Privacy from `docs/privacy.md`, and Home, Download and the 404 page from
  `tools/site/`, each with the same header and footer. Edit those, never the HTML in
  `site/`; the quick checks fail when the two differ. `docs/privacy.md` is the one list of
  what the app sends, so whatever makes the app send something new changes it in the same
  PR. Its Markdown is a small subset (headings, paragraphs, `-` lists, links, `code`,
  bold), and the generator fails on anything else rather than show it wrong; links may
  only be https, mail or the site's own. Cloudflare builds it from this repository, but
  only for a push that changes something in `site/` (the project's build watch paths, a
  dashboard setting): on `main` it goes live, and other branches get a preview address.
  Other pushes, the e2e-results branch's included, show as skipped. The project is
  connected to GitHub, so never deploy it with wrangler, which would be overwritten by
  the next push. Cloudflare's
  email obfuscation rewrites addresses on the proxied domain (not on `pages.dev`) into
  a script the policy blocks, so a page's body sits inside `<!--email_off-->` comments;
  a new page needs them too, or its addresses read "[email protected]".
  `site/.well-known/security.txt` repeats `SECURITY.md` for scanners, and its `Expires`
  must be moved on by hand each year: `.github/scripts/check-security-txt.mjs` fails the
  quick checks from 30 days before it.
