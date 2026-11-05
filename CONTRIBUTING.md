# Contributing to Strandivo

Thanks for helping. Strandivo is maintained by Mateusz Jaskolowski
([Mateusz-Jaskolowski](https://github.com/Mateusz-Jaskolowski) on GitHub). Where the docs
say "the maintainer", that is who they mean.

For anything that isn't an issue or a pull request, write to hello@strandivo.com. Report
security problems privately, as `SECURITY.md` says, never in a public issue.

## Before you start

- **Bugs and small fixes**: open a pull request, or an issue if you're not sure it's a bug.
- **New features or larger changes**: open an issue first, so we can agree on where the
  feature goes before you build it. The app keeps windows uncluttered on purpose, and
  `AGENTS.md` ("Where things go") explains how.
- The priorities are the map and editing, then Sanger checking, then primers, then cloning
  simulation.

## Working on the code

`README.md` covers building from source. `AGENTS.md` is written for coding agents, but it is
also the best guide for people: how the code is organised, its conventions, the decisions
behind them and the traps. If your change makes something there wrong, update it in the
same pull request.

Before you push, run:

```sh
npm run check
```

This runs the unit tests, the type check, the build, the Rust tests and clippy, which is
what CI runs except the end-to-end test. When you add something users do, add a check for
it to `e2e/run.mjs`.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org): `feat(scope): summary`,
  with a short body saying what changed and why. Make one logical change per commit.
- Commit under your own name. Signed commits are welcome but not required.
- Don't rewrite commits that are already pushed to a shared branch.
- If a coding agent helped, that's fine. You are still the author and responsible for the
  change.

## Test data

Files in `testdata/` must be ones we may share under their licence. Add each file's source
and licence to `testdata/README.md`.

## Licence

Strandivo is GPL-3.0-or-later. By contributing, you agree that your contribution is
licensed the same way.
