# feedback.strandivo.com

The Cloudflare Worker behind Help → Send Feedback… in the app. It takes one report as
JSON, checks it with the app's own rules (`src/lib/feedback.ts`), files it as an issue in
this repository, labelled `from-app` and `bug`, `enhancement` or `question`, and answers
with the issue's number. A name the reporter typed to be credited goes in the issue as
"Sent by:" and inline code, so it can't mention anyone or link anywhere. Issues are public,
so the reporter's email address and any file they attach never go in one: they are emailed to the maintainer alone, with the issue's
link, the address as Reply-To. See `src/index.mjs`, and part 4 of
`docs/updates-feedback-usage-plan.md`.

It keeps nothing and has no logs. Cloudflare's rate limiter holds each network to 5
reports a minute.

## Setting it up, once

1. **A label.** Add a `from-app` label to the repository (Issues → Labels → New label).
   `bug`, `enhancement` and `question` are GitHub's own and are there already.
2. **A token that can only write issues.** On GitHub: Settings → Developer settings →
   Fine-grained tokens → Generate new token. Resource owner: you. Repository access:
   only `Mateusz-Jaskolowski/Strandivo`. Permissions: **Issues: Read and write**, nothing
   else (Metadata: Read-only is added by itself). Pick an expiry and put a reminder in
   your calendar: when it expires, reports fail until a new one is set.
3. **Email to you.** In Cloudflare, `strandivo.com` → Email → Email Routing: it must be on,
   with your own address as a **verified destination address** (the one `hello@` already
   forwards to will do). The Worker sends from `noreply@strandivo.com` to that address
   alone.
4. **Deploy and give it its two secrets**, from the repository's root:

   ```sh
   npx wrangler@4 deploy --config services/feedback/wrangler.toml
   npx wrangler@4 secret put GITHUB_TOKEN --config services/feedback/wrangler.toml
   npx wrangler@4 secret put MAINTAINER_EMAIL --config services/feedback/wrangler.toml
   ```

   Each `secret put` asks for the value: the token, then your verified address. Neither
   is in this repository or in the app.

Deploy again after changing `src/index.mjs` or `src/lib/feedback.ts`, which it bundles:
the app and the Worker then agree on what a report may hold. A copy of the app checks a
report before sending, so a stricter rule here only turns away reports from older copies.
A new field must be deployed before a release that sends it, as the Worker turns down a
report with a field it doesn't know.

## Checking it

```sh
curl -i -X POST https://feedback.strandivo.com/report -H 'content-type: application/json' -d '{}'
```

answers `400` with "Choose bug, idea or question.", without filing anything. To file a
real test report, use the app's Help → Send Feedback…, then close the issue.

## Tests

`npm test` runs `feedback.test.mjs`, with GitHub and email replaced by stubs.
