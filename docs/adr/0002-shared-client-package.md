# ADR 0002: A shared `@wave/client` package between Core and the apps

Date: 2026-11-17. Status: accepted. Spec: `docs/spec-desktop.md`.

Both apps share Effect services, the database layer and view-model logic through
`packages/client`, which may depend only on `@wave/core`, `effect` and `drizzle-orm`. Platform
work enters as Effect Layers each app provides. Core stays dependency-free and keeps the
decision-heavy logic.

Considered: the desktop importing from `apps/mobile/src` (one Expo import away from breaking the
desktop) and moving everything into Core (breaks its zero-dependency rule).

Consequences: code moves area by area in PRs that keep the phone green; a new guard should fail
when `packages/client` imports a platform package.
