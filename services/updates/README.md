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

## Tests

`npm test` runs `updates.test.mjs`, with GitHub replaced by a stub.
