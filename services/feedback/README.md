# feedback.strandivo.com

The Cloudflare Worker behind Help → Send Feedback… in the app. It takes one report as
JSON, checks it with the app's own rules (`src/lib/feedback.ts`), files it as an issue in
this repository, labelled `from-app` and `bug`, `enhancement` or `question`, and answers
with the issue's number. A name the reporter typed to be credited goes in the issue as
"Sent by:" and inline code, so it can't mention anyone or link anywhere. Issues are public,
so the reporter's email address and any file they attach never go in one: they are emailed to the maintainer alone, with the issue's
link, the address as Reply-To. See `src/index.mjs`, and part 4 of
`docs/updates-feedback-usage-plan.md`.

It has no logs and keeps two numbers a day (`schema.sql`): how many reports came, and how
many of them GitHub turned down, with nothing about a report or who sent it. That bounds a
flood, as an app can't keep a secret and anyone can send a report:

- Past 30 reports in a day, UTC (`DAILY_REPORTS` in `src/index.mjs`), it turns reports
  away until midnight and emails you once, with a link to the day's issues.
- When GitHub turns a report down, the reporter is told it wasn't taken, and you get an
  email with GitHub's reason and nothing from the report: the day's first only.
- Cloudflare's rate limiter holds each network to 5 reports a minute, an IPv6 network
  being the first 64 bits of the address.
- An attached file is named `.gb` in the email, whatever the report called it, so it never
  opens as a web page or a script.

Issues are filed by a GitHub App, so they show its bot as their author rather than the
maintainer: for each report the Worker signs a token request with the App's private key
and gets a token that can only write this repository's issues.

## Setting it up, once

1. **A label.** Add a `from-app` label to the repository (Issues → Labels → New label).
   `bug`, `enhancement` and `question` are GitHub's own and are there already.
2. **Email to you.** In Cloudflare, `strandivo.com` → Email → Email Routing: it must be on,
   with your own address as a **verified destination address** (the one `hello@` already
   forwards to will do). The Worker sends from `noreply@strandivo.com` to that address
   alone.
3. **Its counts.** A D1 database, made in western Europe; its id is in `wrangler.toml`.
   It was made once, from the repository's root, with:

   ```sh
   npx wrangler@4 d1 create strandivo-feedback-counts --location weur
   npx wrangler@4 d1 execute strandivo-feedback-counts --remote --file services/feedback/schema.sql
   ```

4. **Deploy, and give it your address**, from the repository's root:

   ```sh
   npx wrangler@4 deploy --config services/feedback/wrangler.toml
   npx wrangler@4 secret put MAINTAINER_EMAIL --config services/feedback/wrangler.toml
   ```

   `secret put` asks for the value: your verified address. No secret is in this
   repository or in the app.
5. **A GitHub App that can only write issues**, and its three secrets (below).

Deploy again after changing `src/index.mjs` or `src/lib/feedback.ts`, which it bundles:
the app and the Worker then agree on what a report may hold. A copy of the app checks a
report before sending, so a stricter rule here only turns away reports from older copies.
A new field must be deployed before a release that sends it, as the Worker turns down a
report with a field it doesn't know.

### The GitHub App

1. **Create it.** On GitHub: Settings → Developer settings → GitHub Apps → New GitHub App.
   - GitHub App name: `Strandivo feedback` (issues will show `strandivo-feedback[bot]`;
     if the name is taken, any other will do).
   - Homepage URL: `https://strandivo.com`.
   - Webhook: untick **Active**. The Worker only calls GitHub; GitHub never calls it.
   - Repository permissions: **Issues: Read and write**, nothing else (Metadata:
     Read-only is added by itself). No organization or account permissions, no events.
   - Where can this GitHub App be installed: **Only on this account**.

   Then Create GitHub App.
2. **Note its Client ID**, at the top of the App's General page (it starts `Iv`).
3. **Make a private key**: further down the same page, Private keys → Generate a private
   key. GitHub downloads a `.pem` file and keeps no copy. You needn't keep one either:
   to replace a key, lost or not, generate another, set it as in step 5, then delete the
   old one here.
4. **Install it on the repository**: Install App (in the App's menu on the left) → your
   account → Install → **Only select repositories** → `Strandivo` → Install. The address
   you land on ends in the installation's ID, a number:
   `https://github.com/settings/installations/12345678`.
5. **Give the Worker the three secrets**, from the repository's root:

   ```sh
   npx wrangler@4 secret put GITHUB_APP_CLIENT_ID --config services/feedback/wrangler.toml
   npx wrangler@4 secret put GITHUB_APP_INSTALLATION_ID --config services/feedback/wrangler.toml
   npx wrangler@4 secret put GITHUB_APP_PRIVATE_KEY --config services/feedback/wrangler.toml < ~/Downloads/strandivo-feedback.*.private-key.pem
   ```

   The first two ask for the value; the key is read from the file as GitHub gave it, as
   a prompt would take only its first line. Then delete the downloaded file. Until all
   three are set, reports fail, and you get an email a day saying why.
6. **Check it**: send a report from the app (below) and see that the issue's author is
   the App's bot, then close the issue.

## Checking it

```sh
curl -i -X POST https://feedback.strandivo.com/report -H 'content-type: application/json' -d '{}'
```

answers `400` with "Choose bug, idea or question.", without filing anything, and asks
GitHub for no token, and isn't counted. To file a real test report, use the app's Help →
Send Feedback…, then close the issue.

Read the counts with:

```sh
npx wrangler@4 d1 execute strandivo-feedback-counts --remote --command "SELECT * FROM days ORDER BY day DESC LIMIT 14"
```

## If it is flooded

The day's reports stop at the limit on their own. To stop them all, suspend the App's
installation: GitHub → Settings → Applications → Installed GitHub Apps → Configure →
Suspend. Reports then fail, and reporters are offered another way to send them;
Unsuspend there brings it back. Close the day's issues by their `from-app` label.

## Tests

`npm test` runs `feedback.test.mjs`, with GitHub and email replaced by stubs, and D1 by
Node's own SQLite running `schema.sql`. The App's tests sign with a key made for the test
and check the signature with Node's own crypto.
