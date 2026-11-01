# Working on Wave

Read `docs/spec.md` first — it holds the product decisions and the glossary. Work is tracked
on GitHub; `docs/agents/issue-tracker.md` defines feature parents and native blocking links.
Pick tickets whose blockers are closed.

## Conventions

- Code, docs, issues, PRs and commits are in English. UI text comes from Core's catalogue
  (`packages/core/src/catalogue/`) in English and Brazilian Portuguese, using the glossary in
  `docs/spec.md` › Language; a PR that adds UI text adds both. The untranslated-text check in the
  app and Core tests fails on literal UI text; `docs/untranslated-text-check.md` says how to
  exempt a log line or id.
- Start work from the latest `main`, on a branch `feat/<issue>-<slug>` (`fix/<issue>-<slug>`
  for a bug fix), and land it on `ti` through a PR. A PR can carry several tickets; its body
  has a `Closes #<issue>` line for each. The PR title is the release's patch-note line: one
  line a user understands, saying what changed for them. Its body gives the same line in
  Brazilian Portuguese as `pt-BR: …`; without it CI comments a warning, never blocks, and the
  Portuguese notes use the English title. Merge the PR without waiting for its
  checks (wait only for CI's lockfile autofix when a `package.json` changed); the push run on
  `ti` is the build that counts. GitHub only closes issues from merges into `main`, so close
  each ticket by hand with a comment naming the PR.
- Day-to-day test builds target `ti`. Its version in `apps/mobile/package.json` ends in
  `-ti` (for example `0.5.6-ti`). Nobody bumps or tags a version by hand: every push to `main`
  or `ti` that changes the app gets a bot commit "Release Wave <version>" that CI tags and
  publishes. The bump is minor when a PR the patch notes list since the previous tag has a
  `feat/` branch and no `v*` tag holds it yet (a feature released on ti doesn't bump main's
  minor again), else patch. Both branches count from the highest `v*` tag, so they share one
  sequence (0.5.4-ti, 0.5.5, 0.5.6-ti), and ti's releases are prereleases. Only a major bump
  is a hand edit of `package.json`. Pull the branch after merging. Main always builds fully.
  ti pushes and tags repack a kept APK when only JS changed, and the repack writes the new
  version into it; a new native input or Metro resource first needs a full build. See
  `docs/spec.md`, Build and CI.
- Decision-heavy logic (queue, counted plays, search, sorting, scan reconciliation, LRC,
  sleep timer) goes in `packages/core`, which must keep **zero runtime dependencies** and
  use only erasable TypeScript syntax with `.ts` import extensions. Test it through its
  public API with `node:test`.
- The app uses Effect for services, uniwind classes for styling (colour tokens in
  `apps/mobile/global.css`), and `useThemeColor` for native props that can't take a class.

## Skills

The `mattpocock-skills` and `impeccable` plugins are enabled in `.claude/settings.json`.
Use the Matt Pocock flow for planning and engineering (grill → spec → tickets → TDD) and
Impeccable to critique and polish UI work against the spec's Apple Music direction. If a
session can't load plugins, read the skill files straight from their GitHub repos.

## Environment constraints

Agent sessions on this repo may not be able to reach the npm registry, Maven or the Android
SDK. When that's the case:

- `pnpm --filter @wave/core test` (or `node --test` in `packages/core`) still works — Core
  has no dependencies.
- Don't hand-edit `pnpm-lock.yaml`. Change `package.json` and push: on PRs, CI resolves the
  lockfile and runs `pnpm fmt` (Prettier), then commits the result back to the branch. Pull before
  continuing.
- CI reports each job as a sticky PR comment (`<!-- wave-ci:… -->`) with the tail of the
  failing step's log — read it with
  `gh api repos/LeoPerez8/wave/issues/<pr>/comments`. The Actions API itself may be blocked.
