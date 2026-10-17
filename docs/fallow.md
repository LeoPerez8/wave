# Dead code and duplication

Fallow 3.33.1 is pinned at the workspace root. Install with `pnpm install --frozen-lockfile`.

```sh
pnpm fallow                         # Full dead-code and duplication report
pnpm fallow:dead-code               # Dead code only
pnpm fallow:dupes                   # Duplication only
pnpm fallow:check --base origin/main # Findings introduced since the base
```

Full scans include the existing backlog and can exit 1 for its findings. For
report-only JSON diagnostics, use `pnpm --silent fallow --format json`; this still
fails on setup and parse errors. These commands do not modify source or create a
committed baseline. Add `--format markdown` for a readable report file, or use
`pnpm --silent` when redirecting JSON.

`fallow:check` uses Fallow's native `audit --gate new-only`. It compares changed files
with a temporary snapshot at the selected base, reports inherited findings as context,
and fails on new error findings. Pass the target branch or commit explicitly; without
`--base`, Fallow uses its upstream/default-branch detection. A missing or invalid base,
an invalid configuration, and source parse errors fail the check.

Duplication detection requires at least 50 tokens and five lines in two locations.
The small positive `duplicates.threshold` makes new clone groups fail the audit;
Fallow treats zero as disabling this gate. Inherited clones do not block a change.
Complexity and architecture checks are outside this integration's scope.

## Framework boundaries

Built-in plugins recognize Expo, Expo Router, React Native, package exports,
package-script entry points, and Node tests. Core's public API comes from its
`exports` map, while its internal modules remain checked. Maintenance commands run
directly from the shell and their tests are declared as additional entry points.
The Smart Shuffle design review's JavaScript and CSS are also entry points,
loaded directly by its standalone HTML page rather than the mobile app.
The Android WebView asset is loaded from Kotlin and is marked as dynamically loaded.

The configuration excludes generated native projects, builds, dependencies, caches,
scratch directories, and local worktrees. It documents four dependency exceptions:
the bundled Inter font assets, Expo's autolinked constants/system-UI modules, and
Expo Router's native screens dependency. Independent modules sharing export names
such as Effect's `layer` produce advisory duplicate-export findings.

## Pull requests

The Fallow workflow checks out the PR head with full Git history and passes the
event's actual base SHA to `fallow:check`. Pushes to main compare with the previous
commit from the event. Setup or comparison errors fail the job.

The job summary contains the regression report. The `fallow-full-report` artifact
contains the full backlog, including duplication. Same-repository PRs also receive
the usual sticky CI status comment. Fork PRs receive the check, summary, and artifact
without requiring a write token for comments.

Sources: [audit and new-only attribution](https://fallow.tools/docs/cli/audit/),
[duplication thresholds](https://fallow.tools/docs/analysis/duplication/),
[entry points and exclusions](https://fallow.tools/docs/configuration/overview/),
and [built-in plugins](https://fallow.tools/docs/frameworks/built-in/).
