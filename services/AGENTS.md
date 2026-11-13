# Workers: guide for coding agents

The Cloudflare Workers that every installed copy talks to. How the app side of updates and
feedback works is in `docs/agents/updates-and-reports.md`.

**Keep this guide true** (and `AGENTS.md`'s rules apply here too): a change that makes
something here wrong updates it in the same commit. Paths are from the repository's root,
and CI checks that they exist.

- **`updates.strandivo.com`** is built into every copy (`plugins.updater` in
  `src-tauri/tauri.conf.json`), so it must never change; the Worker behind it
  (`services/updates/`) hands over the published release's latest.json, or 204 for no
  update when there is none. The app's version, OS and processor come in the query, and
  each check adds one to a row for its day, version, OS and processor in a D1 database
  (`services/updates/schema.sql`), as known words or "other": that count of copies in use
  is what tells how far the opt-in statistics speak for everyone. The Worker keeps nothing
  else and logs nothing. Deploy it with
  `npx wrangler@4 deploy --config services/updates/wrangler.toml`.
- **`feedback.strandivo.com`** is built into every copy from the release that adds it (`FEEDBACK_URL` in
  `src/platform.ts`), so it must keep answering. Its Worker (`services/feedback/`) files
  issues as a GitHub App's bot, so they don't show the maintainer as their author: for
  each report it signs a JSON Web Token with the App's private key (RS256, WebCrypto,
  which takes only PKCS#8, so GitHub's PKCS#1 key is wrapped in code) and swaps it for an
  installation token narrowed to this repository's issues. Until all three of the App's
  secrets are set it uses the maintainer's fine-grained token instead (`GITHUB_TOKEN`),
  which is to be taken out once the App works. Those and the maintainer's address are
  Worker secrets, never in the repository; its README says how to set them up. Deploy it
  with `npx wrangler@4 deploy --config services/feedback/wrangler.toml`.
