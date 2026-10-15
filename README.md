# Wave

A local music player for Android with BlackPlayer-grade features and an interface of its
own, inspired by Apple Music. Personal project, sideloaded — see the
[v1 spec](docs/spec.md) and the [Wave v1 tracking issue](https://github.com/LeoPerez8/wave/issues/2).

## Layout

| Path            | What                                                               |
| --------------- | ------------------------------------------------------------------ |
| `apps/mobile`   | The Expo / React Native app (Expo Router, uniwind, Inter)          |
| `packages/core` | Domain logic in pure TypeScript with **zero runtime dependencies** |
| `scripts/ci`    | Helpers used by GitHub Actions                                     |
| `docs`          | Spec and design decisions                                          |

## Getting the app on a phone

Every PR and every push to `main` builds a release APK (arm64, signed with the debug key):

- **PR builds** — the PR gets a comment with a _Download APK_ link.
- **Latest `main`** — <https://github.com/LeoPerez8/wave/releases/download/latest/wave-latest.apk>

Open the link on the phone and install (allow installs from the browser once). Builds
share a signing key, so each one updates the previous install in place.

## Local development

Requirements: Node ≥ 22.18, pnpm 10, JDK 17 and the Android SDK.

```bash
pnpm install
pnpm android        # prebuild + build + install on a connected device
pnpm dev            # Metro, for an already-installed dev build
```

Checks (the same ones CI runs):

```bash
pnpm typecheck
pnpm lint
pnpm fmt:check      # `pnpm fmt` to fix
pnpm test           # Core tests run with plain `node --test`
pnpm react-doctor   # Full mobile diagnostics, including existing findings
pnpm react-doctor:check --base origin/main # Fail on new React errors only
```

See the [lint policy](docs/lint.md) for TypeScript and React Hooks rules, native
exceptions, and excluded generated files.

React Doctor scans the Expo / React Native app. Fetch the target branch before
running `react-doctor:check`, and use that branch as `--base` when the pull request
targets a branch other than `main`. The local check also includes untracked source.
The full scan reports the existing backlog without failing on findings. Both
commands fail when a scan cannot complete. The full JSON report is saved locally
in `.cache/react-doctor/full.json`.

The React Doctor workflow prints full diagnostics on every run and compares pull
requests with their actual base commit using full git history. New errors fail the
check; warnings stay advisory. Same-repository pull requests receive a summary
comment and inline feedback. Fork pull requests get the same scan and gate in the
Actions logs. React Doctor's score API and dependency supply-chain network checks
are disabled so these code checks work offline. Oxlint remains the authority for
the project's lint rules and native import exceptions.

## Agent skills

This repo is set up for [Matt Pocock's skills](https://github.com/mattpocock/skills) (MIT),
installed as a Claude Code plugin rather than vendored:

```bash
claude plugin marketplace add mattpocock/skills
claude plugin install mattpocock-skills@mattpocock
```

Issues live on GitHub; ready tickets carry the `ready-for-agent` label; docs live in `docs/`.
