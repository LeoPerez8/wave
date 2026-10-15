# Lint policy

Run `pnpm lint` from the repository root. GitHub Actions runs the same command.
Oxlint checks the app, Core, tests, Expo config plugins and utility scripts. Errors
fail the command; suspicious findings remain warnings for review.

## TypeScript

Correctness rules are errors. The selected TypeScript rules also reject explicit
`any`, empty object types, boxed primitive types and the unsafe `Function` type.
Use `unknown` at external boundaries and narrow it before reading values. Do not
use `@ts-ignore` or `@ts-nocheck`; a necessary `@ts-expect-error` needs a description.
Type checking remains a separate required check (`pnpm typecheck`): these lint
rules do not run TypeScript's type-aware analysis.
Effect's `TaggedError` uses an empty generic payload for tag-only errors; those
two declarations have local `no-empty-object-type` exceptions.

## React Hooks

`react/rules-of-hooks` and `react/exhaustive-deps` are errors. Call Hooks at the
top level of components or custom Hooks, and include the reactive values used by
effects and memoized callbacks in their dependency arrays. Expo Router focus
effects use `useCallback` so the dependency rule checks their closures too.

Fix missing dependencies rather than disabling the rule for a component or
directory. A suppression must name the rule on one line and explain why the
specific dependency or native behavior is intentional. Stats callbacks include
version tokens that trigger a new read after play-history or Library changes;
the callbacks intentionally do not read those tokens.

Oxlint also identifies Effect's `Service.use` methods as React's `use` Hook.
Those service calls have local `rules-of-hooks` exceptions. They resolve Effect
services and do not participate in React's render or Hook lifecycle.

Hermes does not support `Array.prototype.toSorted` in this app. Existing local
exceptions allow `sort` on fresh arrays and explain why no shared array is mutated.
Native worklet code still follows the Hooks rules; there is no directory-wide
Reanimated exemption.

## Android Back handling

Screens register Back handlers through `addScreenBackHandler`. Direct imports of
React Native's `BackHandler` are forbidden outside the overlay module so an open
card receives Back before a screen handler. The overlay module owns that exception.

## Excluded files

Oxlint ignores dependencies, generated native projects and build output, Expo
declarations and caches, coverage, scratch files, and local worktree directories
(`.worktrees`, `worktrees`, and `.claude/worktrees`). Keep worktrees in one of those
directories or beside the checkout. Authored TypeScript under the native module,
Expo config plugins and scripts remains in scope.
