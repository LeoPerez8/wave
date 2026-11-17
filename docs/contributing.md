# Contributing to Wave

Wave has two kinds of contributor, and GitHub tells them apart by the account that pushes, not
by anything in a commit.

## Trusted maintainers

The trusted maintainers are the GitHub accounts with write access to `LeoPerez8/wave`:
`LeoPerez8` (the owner, admin), `YgorPerez` and `ygor-infotera`. That list is the trust set the
owner approved for #1122.

- Trust comes from the authenticated GitHub account and the permission GitHub grants it. A
  commit's author name or email, an email domain and a Wave account grant nothing. A Wave
  account is a sign-in to the sync service and has no relation to the repository.
- Giving another account write access widens the trust set. The owner decides it on purpose,
  and this file and the next evidence record (`docs/verification/1131.md`) change with it.
- Maintainers work as `CLAUDE.md` describes: they push to `main` or merge their own PRs without
  waiting for checks, and they can change workflows. The release bot's version commit and tag
  on `main` keep working as they do today.
- `main` has no branch protection or ruleset, on purpose. The version commit is pushed with the
  workflow's `GITHUB_TOKEN`, and nobody has shown a ruleset bypass that token can use. Adding a
  rule would need a new privileged credential, which #1122 rules out.

So the process below binds outside contributions. It doesn't stop a maintainer, and nothing in
this repository claims to protect against a maintainer's account or machine being compromised
(`docs/spec.md` › Security, Threat model).

## Outside contributions

Anyone else contributes through a pull request from a fork. They have no write or merge access,
and nothing in a PR reaches a signing key or a publishing secret.

A maintainer merges an outside PR only when:

1. The PR's applicable checks passed on its current head commit. A check the change rule skips
   (`scripts/ci/changes.ts`) counts as not applicable, not as passed.
2. A maintainer read the current head commit and accepted it. Approving an earlier commit
   doesn't carry over: each new commit from the contributor needs another review before the
   merge.

GitHub asks a maintainer to approve the first workflow run of someone who hasn't contributed
before. Read the PR's changes, its workflow and script changes above all, before approving that
run.

## What keeps a fork's code away from secrets

These hold today; `docs/verification/1131.md` records when each was last checked.

- Workflows start only on `pull_request`, `push` and `workflow_dispatch`. On `pull_request`
  from a fork, GitHub runs the PR's code with a read-only token and passes it no secrets. The
  repository's default workflow token is read-only too, and Actions can't approve a PR.
- Each workflow grants no token permissions at the top (`permissions: {}`), and each job asks
  for its own. Jobs that write (the PR comment reports, the autofix commit, the version bump,
  the release, the promotion) run only for same-repository PRs, pushes to `main` or `v*` tags,
  or runs a maintainer starts, and the ones a PR starts run none of its code.
- The six release secrets exist only in the `ti` and `main` Environments. The repository has no
  repository-level or Dependabot secret. `ti` opens only to `main`. `main` opens to `main` and
  `v*` tags, and waits for the owner's approval.
- Only an admin can move or delete a `v*` tag (the "Release tags" ruleset).

`scripts/ci/untrusted-code.ts` (trigger and permission rules),
`scripts/ci/release-environments.test.ts` (which jobs read release secrets),
`scripts/ci/action-pins.ts` (SHA-pinned actions) and `scripts/ci/inlined-env.test.ts`
(no credential in an app bundle) check the workflow text in CI. They check only the text: the
remote settings above are read from GitHub, and only `docs/verification/1131.md` records them.
