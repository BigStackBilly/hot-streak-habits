# Installing the Bitfront workflow

`bitfront-checks.yml` is not active. GitHub only reads workflows from
`.github/workflows/` at the root of the repository, and this app was built
under a "don't touch anything outside `apps/bitfront/`" rule — so it is
parked here instead of being installed behind your back.

To turn it on, from the repository root:

```bash
cp apps/bitfront/ci/bitfront-checks.yml .github/workflows/bitfront-checks.yml
```

Then commit that file. It is scoped with `paths:` so it only runs when
something under `apps/bitfront/` changes, and it needs no secrets, no
`npm install` and no signing — every script it runs is dependency-free.

Two things worth knowing before you do:

- **Check the name doesn't collide.** If a workflow called `bitfront`
  already exists at the root, rename this one; two workflows with the same
  `name:` are confusing to read in the Actions tab.
- **It takes a few minutes.** The balance step plays ten full games. If that
  is too slow for every push, drop `--runs 5` to `--runs 3`, or move that
  one step to `workflow_dispatch` only.

## What it does not do

Nothing to do with building or shipping the native apps. iOS and Android
builds in this repo run from shared workflows and fastlane config at the
root, and hooking Bitfront into those means editing files outside this
folder — a decision, not a copy-paste. See `release/STORE.md`.
