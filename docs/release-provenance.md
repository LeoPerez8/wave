# Release provenance

The release job holds the APK release key and the update signing key, so it opens only after
the **release gate** has checked that every prerequisite passed on the commit the job is about
to sign. This file is the contract the gate writes and that later work reads (#1129; promotion and
rollback in #1130, source delivery in #1135).

## The release source

The `source` job in `.github/workflows/ci.yml` picks one commit per run, after CI's own commits:

| Run                    | Release source                                    |
| ---------------------- | ------------------------------------------------- |
| PR, autofix committed  | the autofix commit (`autofix-apply.outputs.sha`)  |
| push to `main`, bumped | the version bump (`version.outputs.sha`)          |
| anything else          | the PR head, or the event's commit (`github.sha`) |

On `main` the bump can sit on a newer tip than the pushed commit, so the pushed SHA is never the
release source when the Version job made a bump. Secret scan, Checks, Native unit tests, Patch
notes and Android APK all check out `needs.source.outputs.sha`, and each reports the commit it
actually checked out as its `source` output (`git rev-parse HEAD`). Secret scan also reports the
`range` it scanned. The scan runs on PRs as well, but only release runs (pushes to `main`, `v*`
tags) reach the gate.

What Secret scan covers (`scripts/ci/secret-scan.sh` with `SOURCE_SHA`):

- a PR: `<base>..<source>`, the autofix commit included;
- a push or tag: from the channel's previous release tag to the source
  (`scripts/ci/previous-tag.sh`; a stable tag looks back to the previous stable one, past the ti
  ones), so the bump and any push that never got its own run are scanned;
- no earlier release: the source's whole history.

It refuses to scan when the checkout isn't the source, and writes `source`/`range` only after a
clean scan.

## The gate

`release-gate` runs on release runs unless the run was cancelled, and calls
`node scripts/ci/release-gate.ts admit` on `toJSON(needs)`. It has `contents: read`, no
Environment and no secret, so a healthy `ti` release stays automatic and a `main` one still waits
for the owner at the release job's Environment. It refuses (exits 1, so the release job is
skipped) when:

- any of `source`, `changes`, `secret-scan`, `checks`, `native-tests`, `notes`, `android` is
  missing or its result isn't `success` (failed, cancelled, skipped);
- `source` isn't a 40-hex SHA, or any job's `source` output differs from it;
- the scan range doesn't end at the source (`<sha>..<source>` or `<source>`);
- `changes.nativeTests` isn't `true`. Release runs count every area as changed
  (`scripts/ci/changes.sh`), so the only legitimate skip is a PR's, and PRs never reach the gate.
  Report and comment jobs aren't prerequisites and count for nothing;
- a versioned release's Patch notes step didn't succeed;
- the APK record is incomplete or malformed, a stable tag was repacked, or a repack has no valid
  kept base for the same native key.

## The record

`admit` prints one JSON line, uploaded as the workflow artifact **`release-provenance`**
(`provenance.json`, kept 14 days):

```jsonc
{
  "schema": "wave-release-provenance/1",
  "source": "<40-hex release source>",
  "releaseTag": "v0.61.0-ti", // "" for a ti-latest-only push
  "run": {
    "repository": "LeoPerez8/wave",
    "id": 123,
    "attempt": 1,
    "event": "push",
    "ref": "refs/heads/main",
  },
  "artifact": {
    "build": "full", // or "repack"
    "name": "unsigned-wave-abc1234.apk", // workflow artifact with the unsigned APK
    "apk": "wave-abc1234.apk",
    "unsignedSha256": "<sha256 of the unsigned APK>",
    "bundleSha256": "<sha256 of the Hermes bundle built from the source>",
    "runtimeVersion": "apk-v2-<64 hex>",
    "updateChannel": "ti",
    "updateSha256": "<digest of the exported update folder, or empty>",
    "base": { "source": "<sha>", "run": 120, "key": "apk-v2-…", "unsignedSha256": "<sha256>" }, // repack only
  },
}
```

A folder's digest (`release-gate.ts digest <dir>`) is the SHA-256 of `"<relative path> <file
sha256>\n"` lines sorted by path.

A repack keeps the native side of an earlier full build and swaps in this source's JS and Metro
resources. Its `base` names that full build: the commit and run that built it, its native key
(equal to `runtimeVersion`) and its unsigned APK's digest. The full build writes the record as
`kept-build.json` beside the kept `app-release.apk` (`scripts/ci/kept-build.ts keep`). A kept APK
with no record, a record for another key, or a record that doesn't match the APK gets no base, and
the run builds in full (`kept-build.ts check`). `bundleSha256` and `unsignedSha256` cover what the
repack published.

## The release job

It checks out `release-gate.outputs.sha` and, before any step that names a secret, downloads the
record and checks the unsigned APK against it (`release-gate.ts verify`). After signing it
**seals** the record (`release-gate.ts seal`), which adds `artifact.signedSha256`, and keeps the
sealed record:

- as the workflow artifact **`release-provenance-sealed`** (`sealed.json`, 14 days), on every run
  including ti-latest-only pushes;
- on a versioned GitHub Release as the asset **`wave-<version>.provenance.json`**
  (`publish-release.sh`, `PROVENANCE_FILE`), next to `wave-<version>.apk`. This is the durable
  copy.

The over-the-air update is published only when `release-gate.ts verify-update` matches the
downloaded update folder to `updateSha256`. A mismatch or an empty digest skips the update and
leaves the GitHub Release as published, like the other post-release steps.

## For dependent work

- To find what a release was built from, read `wave-<version>.provenance.json` on its GitHub
  Release. Check `source` against the tag's commit and `signedSha256` against the APK asset.
- Releases published before this gate have no record. Nothing here fabricates one, and
  `rollback.yml` and `promote.yml` are unchanged by #1129. Deciding how they treat a release with
  no record belongs to #1130.
- A promotion's tag run goes through the same gate as its own run and builds in full. Linking that
  run's record to the ti release's record is #1130's.
- Trusted maintainers can still edit the workflow and these scripts. The gate keeps bad evidence
  out of a release. It is no defence against someone with write access.
