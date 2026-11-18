# ADR 0003: Services in Electron's main process, a sandboxed renderer

Date: 2026-11-17. Status: accepted. Spec: `docs/spec-desktop.md`.

The main process builds the app's Effect Layers (database, scan, sync, YT Music); the renderer
runs with context isolation, sandbox and no Node, and reaches services only through a typed
preload bridge. Audio runs in its own `utilityProcess` (ADR 0001).

Considered: a separate backend `utilityProcess` for all services (more IPC hops for a light
main) and Node in the renderer (against Electron's security guidance in an app that loads
network content).

Consequences: every UI read crosses IPC, so list reads return pages, not whole tables; the
bridge's types are the contract between UI and services.
