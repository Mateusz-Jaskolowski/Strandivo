# updates.strandivo.com

The Cloudflare Worker every installed copy of Strandivo asks for updates. It hands over
`latest.json` from the newest **published** GitHub release (drafts are invisible to it), or
answers 204, "no update", when there is none or GitHub can't be reached. See
`src/index.mjs`, and `docs/updates-feedback-usage-plan.md` (part 1) for why it exists.

## Deploying

From the repository's root, once:

```sh
npx wrangler@4 login
npx wrangler@4 deploy --config services/updates/wrangler.toml
```

`login` opens Cloudflare in the browser; pick the account that holds `strandivo.com`.
`deploy` creates the Worker and the `updates.strandivo.com` custom domain, with its
certificate. Deploy again after changing `src/index.mjs`.

Check it:

```sh
curl -i "https://updates.strandivo.com/latest.json?target=darwin&arch=aarch64&version=0.1.0"
```

Before the first release this answers `204 No Content`; afterwards, the release's manifest.

## Counting update checks

Each check adds one to a row for its day, version, OS and processor in a D1 database
(`schema.sql`), so checks a day roughly count copies in use, whether they share usage
statistics or not. Nothing else is kept: no address, no identifier, no logs. Set it up
once, from the repository's root:

```sh
npx wrangler@4 d1 create strandivo-update-checks
npx wrangler@4 d1 execute strandivo-update-checks --remote --file services/updates/schema.sql
```

Put the id the first command prints in the `[[d1_databases]]` block of `wrangler.toml`,
uncomment it and deploy. Read the counts with:

```sh
npx wrangler@4 d1 execute strandivo-update-checks --remote --command "SELECT day, SUM(n) AS checks FROM checks GROUP BY day ORDER BY day DESC LIMIT 14"
```

A copy checks at most once a day on its own, so a day's checks are about the copies in use
that day; Check for Updates… adds one each time, and a copy with checks turned off is
missed.

## Tests

`npm test` runs `updates.test.mjs`, with GitHub replaced by a stub.
