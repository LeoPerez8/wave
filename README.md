# Wave

A local music player for Android with BlackPlayer-grade features and Apple Music's
structure, gestures and glass. Personal project, sideloaded — see the
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
```

## Agent skills

Two skill packs are installed as Claude Code plugins (managed, not vendored — they update
when upstream ships). `.claude/settings.json` registers both marketplaces and enables the
plugins, so Claude Code offers to install them when you trust this folder.

| Plugin              | Source                                                          | Use it for                                                                                                |
| ------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `mattpocock-skills` | [mattpocock/skills](https://github.com/mattpocock/skills) (MIT) | Engineering flow: `/grill-me`, `/to-spec`, `/to-tickets`, `/tdd`, `/code-review`, `/diagnosing-bugs` …    |
| `impeccable`        | [pbakaus/impeccable](https://github.com/pbakaus/impeccable)     | Design quality: `/impeccable critique`, `/impeccable audit`, `/impeccable polish` and anti-pattern checks |

Manual install, if needed:

```bash
claude plugin marketplace add mattpocock/skills
claude plugin install mattpocock-skills@mattpocock
claude plugin marketplace add pbakaus/impeccable
claude plugin install impeccable@impeccable
```

Issues live on GitHub; ready tickets carry the `ready-for-agent` label; docs live in `docs/`.
