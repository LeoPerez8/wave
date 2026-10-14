# Issue tracker: GitHub Issues

Publish approved specs and implementation tickets to
[LeoPerez8/wave on GitHub](https://github.com/LeoPerez8/wave/issues).
GitHub is the authoritative tracker. Files in `.scratch/` are working drafts
and local research notes; creating them does not publish a ticket.

## Conventions

- Use the source spec issue as the parent when one is provided. Otherwise,
  use an open tracking issue for the feature, or create one from its approved
  spec and publish the implementation tickets as its sub-issues.
- Version tracking issues describe their release scope. Group new features
  under their own tracking issues unless the user selects a release parent.
- Publish blockers first and use GitHub's native blocked-by relationships.
- Apply `ready-for-agent` to approved implementation tickets; see
  `triage-labels.md` for the role strings.
- Issue bodies must be self-contained. Use GitHub issue references for parents
  and prerequisites; local draft links are not available to GitHub readers.
- Record discussion in GitHub issue comments and keep draft copies linked to
  their published issues.

## When a skill says "publish to the issue tracker"

Search existing issues for the same ticket before creating a new issue.
Create one GitHub issue per approved ticket with `gh issue create`, passing
the exact Markdown through `--body-file`. Use `--parent` for the parent issue
and `--blocked-by` for prerequisite issue numbers. Verify the published body,
labels, parent and blocking relationships before reporting completion.

## When a skill says "fetch the relevant ticket"

Use `gh issue view <number> --repo LeoPerez8/wave --json body,comments`.
Read a local file when the user explicitly supplies a draft path.

## Local wayfinding maps

`/wayfinder` can keep a local map with one child file per research question.
Publish the resulting approved implementation tickets on GitHub.

- **Map**: `.scratch/<effort>/map.md` (the Notes / Decisions-so-far / Fog body).
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.
