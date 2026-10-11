# Working on Wave

Read `docs/spec.md` first — it holds the product decisions and the glossary. Work is tracked
as sub-issues of the "Wave v1" issue (#2) with native blocked-by links; pick tickets whose
blockers are closed.

## Conventions

- Everything in English: UI copy, code, docs, issues, PRs, commits.
- One PR per ticket, branch `feat/<issue>-<slug>`, PR body says `Closes #<issue>`.
- Decision-heavy logic (queue, counted plays, search, sorting, scan reconciliation, LRC,
  sleep timer) goes in `packages/core`, which must keep **zero runtime dependencies** and
  use only erasable TypeScript syntax with `.ts` import extensions. Test it through its
  public API with `node:test`.
- The app uses Effect for services, uniwind classes for styling (colour tokens in
  `apps/mobile/global.css`), and `useThemeColor` for native props that can't take a class.

## Environment constraints

Agent sessions on this repo may not be able to reach the npm registry, Maven or the Android
SDK. When that's the case:

- `pnpm --filter @wave/core test` (or `node --test` in `packages/core`) still works — Core
  has no dependencies.
- Don't hand-edit `pnpm-lock.yaml`. Change `package.json` and push: on PRs, CI resolves the
  lockfile and runs `oxfmt`, then commits the result back to the branch. Pull before
  continuing.
- CI reports each job as a sticky PR comment (`<!-- wave-ci:… -->`) with the tail of the
  failing step's log — read it with
  `gh api repos/LeoPerez8/wave/issues/<pr>/comments`. The Actions API itself may be blocked.
