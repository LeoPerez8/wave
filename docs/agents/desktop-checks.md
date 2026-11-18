# Checking desktop tickets without the owner

Drive the built app with Playwright's Electron support (`apps/desktop/e2e`): launch it, click,
read the page and take screenshots, on Windows and on Linux under WSLg. Label every result with
the system and the commit. Audio is checked by the engine's tests, not by ear.

## Commands

From the repo root:

```sh
pnpm --filter @wave/desktop typecheck
pnpm --filter @wave/desktop test       # node:test units in src/
pnpm --filter @wave/desktop lint
pnpm --filter @wave/desktop test:e2e   # builds out/, then runs the Playwright smoke test
pnpm --filter @wave/desktop dev        # the app with hot reload
```

`test:e2e` builds first, so it always drives the current code. Screenshots and failure traces go
to `apps/desktop/test-results/`, which git ignores; read the PNGs to check what the window
shows. Add a check as a test in `apps/desktop/e2e/` rather than a throwaway script, so CI runs
it too.

## Data

`WAVE_DATA_DIR` points the app at a folder of its own instead of the user's data folder; the
Library is `wave.db` in it. Seed one before launching with `libraryLayer` from
`src/main/database.ts` and `addTrack` from `@wave/client/testing`, as `e2e/smoke.spec.ts` does.
Pass `--lang=en-US` (or `pt-BR`) to fix the app's language.

## The dev window

To look at `pnpm dev` from an agent, start it in the background with a debugging port and a
scratch data folder, then read the page over the Chrome DevTools Protocol
(`http://127.0.0.1:9333/json` lists the targets):

```sh
WAVE_DATA_DIR="$(mktemp -d)" pnpm --filter @wave/desktop exec electron-vite dev --remoteDebuggingPort 9333
```

Stop the Electron processes it started when done: a second launch only focuses the first
window (the single-instance lock), so a leftover one hides your new code.

## Linux under WSLg

Windows' `node_modules` can't run in WSL. Clone into WSL's own disk and install there (worktree
branches are in the main checkout's refs, so commit first):

```sh
git clone --branch <branch> /mnt/c/projects/wave ~/wave-check && cd ~/wave-check
pnpm install --frozen-lockfile --filter "@wave/desktop..."
pnpm --filter @wave/desktop test:e2e
```

WSLg provides the display (`DISPLAY=:0`). Electron's binary downloads on the first run. CI runs
the same set on `ubuntu-22.04` under `xvfb-run` and on `windows-latest` (the Desktop jobs in
`.github/workflows/ci.yml`).
