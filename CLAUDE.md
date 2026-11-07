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
- `main` is the only working branch. Start work from its latest commit, on a branch
  `feat/<issue>-<slug>` (`fix/<issue>-<slug>` for a bug fix), and land it on `main` through a PR. A PR can carry several tickets; its body
  has a `Closes #<issue>` line for each. The PR title is the release's patch-note line: one
  line a user understands, saying what changed for them. Its body gives the same line in
  Brazilian Portuguese as `pt-BR: …`; without it CI comments a warning, never blocks, and the
  Portuguese notes use the English title. Merge the PR without waiting for its
  checks (wait only for CI's lockfile autofix when a `package.json` changed); the push run on
  `main` is the build that counts.
- Every push to `main` that changes the app gets a bot commit "Release Wave <version>" that CI
  tags and publishes as a prerelease on the `ti` channel. Its version in
  `apps/mobile/package.json` ends in `-ti` (for example `0.5.6-ti`), and nobody bumps or tags a
  version by hand. The bump is minor when a PR the patch notes list since the previous tag has a
  `feat/` branch and no `v*` tag holds it yet, else patch. Only a major bump is a hand edit of
  `package.json`. Pull `main` after merging. These pushes repack a kept APK when only JS changed,
  and the repack writes the new version into it; a new native input or Metro resource first needs
  a full build.
- The `main` channel gets a version only when the owner says so: run the **Promote to main**
  workflow (`gh workflow run promote.yml`, with `-f version=0.5.6-ti` for one that isn't the
  newest). It publishes that release's commit as `0.5.6`, in a full build, once the owner
  approves its run in the `main` Environment. See `docs/spec.md`, Build and CI.
- PR runs check, test and compile native code but build no APK, so they get no secret and no
  signing key. Test on a phone after the merge, with the `ti` release the push to `main` makes.
  To try a change before merging, build it locally (`pnpm android`, or `scripts/emulator-apk.sh`
  for the emulator); a local debug build is signed with the debug key and needs an uninstall to
  replace a release build, which deletes Wave's data on that phone.
- Releases also reach phones over the air (`docs/spec.md`, Build and CI). Channels are `ti` and
  `main`, fixed in the APK by the run that built it (a push to `main` follows `ti`, a promotion follows `main`); local builds have updates off. A JS
  change arrives as a bundle, and a change to the runtime version (the kept APK's key) as an APK
  Wave installs itself. Phones run only updates, and install only APKs, that CI signed with
  `UPDATES_SIGNING_KEY`, checked against the certificate in their own APK. Never publish around
  that. Released APKs are signed only by the release job, with the release key and its rotation
  proof from Expo's public debug key, all three in the release Environments (`docs/spec.md`, APK
  signing); the Android job and its artifacts hold no keystore. Undo a bad update that doesn't
  crash with the **Roll back an update** workflow (channel and version); it can't cross a runtime
  version.
- Both Workers are deployed by hand from the owner's machine, never by CI, and a change to them
  doesn't release: `pnpm --filter @wave/updates run deploy` for `apps/updates`, and
  `pnpm --filter @wave/sync run deploy` for `apps/sync`, which goes out before any app release
  that needs it. A provider key a feature needs is a secret of the sync Worker, and the phone
  reaches the provider through it: an `EXPO_PUBLIC_*` variable is readable in every APK and
  bundle, so it holds no credential. The threat model is in `docs/spec.md` › Security.
- The repo is public. A PR that fixes a weakness uses a `fix/` branch, the title
  `Security patch` and the body line `pt-BR: Patch de segurança`; its commits, body and code
  comments say what changed and leave out how it could be abused.
- Decision-heavy logic (queue, counted plays, search, sorting, scan reconciliation, LRC,
  sleep timer) goes in `packages/core`, which must keep **zero runtime dependencies** and
  use only erasable TypeScript syntax with `.ts` import extensions. Test it through its
  public API with `node:test`.
- The app uses Effect for services, uniwind classes for styling (colour tokens in
  `apps/mobile/global.css`), and `useThemeColor` for native props that can't take a class.

## Agent runs

- `scripts/check-guards.sh` runs the fast repo-wide checks; tests near a change miss what they catch.
  Enable its pre-commit hook once per clone with `git config core.hooksPath .githooks`.
- `scripts/merge-ticket.sh` merges a ticket into an integration branch; an agent only resolves its
  conflicts. Keep the integration branch out of every checkout so worktrees can use it.
- `docs/agents/emulator-checks.md` is how to check a ticket without a phone.
- `scripts/clean-worktrees.sh` removes merged, idle worktrees when the disk runs low.

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
