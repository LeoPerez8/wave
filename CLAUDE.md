# Working on Wave

Read `docs/spec.md` first — it holds the product decisions and the glossary. Work is tracked
on GitHub; `docs/agents/issue-tracker.md` defines feature parents and native blocking links.
Pick tickets whose blockers are closed.

## Conventions

- Everything in English: UI copy, code, docs, issues, PRs, commits.
- One PR per ticket, branch `feat/<issue>-<slug>` (`fix/<issue>-<slug>` for a bug fix), PR body
  says `Closes #<issue>`. The PR title is the release's patch-note line: one line a user
  understands, saying what changed for them.
- Day-to-day test builds target `ti`. Its version in `apps/mobile/package.json` ends in
  `-ti` (for example `0.5.1-ti`). Merging a version bump publishes it: the push to `ti`
  tags `v0.5.1-ti` and publishes the prerelease, so don't tag by hand. Compatible ti pushes
  and tags repack a kept APK. A new Android version, native input or Metro resource first
  needs a full build. Stable versions have no suffix and release from `main` on their own:
  every push to `main` that changes the app gets a bot commit "Release Wave <version>" (the
  next patch version) that CI tags and publishes, so don't bump or tag `main`'s version by
  hand. Only a major bump is a hand edit of `package.json`. Pull `main` after merging. Main
  always builds fully. See `docs/spec.md`, Build and CI.
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
