# Release provenance

CI is three workflows: `.github/workflows/ci.yml` runs the jobs both apps share and calls
`mobile.yml` for the phone and `desktop.yml` for the desktop (#1336). Each app has its own gate
and its own release job. The phone's release job holds the APK release key and the update signing
key, so it opens only after the phone's **Release gate** (`Mobile / Release gate` in the run) has
checked the phone's prerequisites on the commit it is about to sign. The desktop's release job
opens only after the desktop's own gate (`Desktop / Release gate`). Neither gate reads the other
app's jobs, so a failed desktop never refuses the APK and a failed APK never refuses the
installers. This file is the contract the gates write and later work reads (#1129; promotion and
rollback in #1130, source delivery in #1135).

## The release source

The `source` job in `.github/workflows/ci.yml` picks one commit per run, after CI's own commits:

| Run                    | Release source                                    |
| ---------------------- | ------------------------------------------------- |
| PR, autofix committed  | the autofix commit (`autofix-apply.outputs.sha`)  |
| push to `main`, bumped | the version bump (`version.outputs.sha`)          |
| anything else          | the PR head, or the event's commit (`github.sha`) |

On `main` the bump can sit on a newer tip than the pushed commit, so the pushed SHA is never the
release source when the Version job made a bump. Secret scan, Checks and Patch notes check out
`needs.source.outputs.sha`. `ci.yml` hands the same commit to `mobile.yml` and `desktop.yml` as
the `source_sha` input, which Native unit tests, Android APK and the Desktop jobs check out. Each
gated job reports the commit it actually checked out as its `source` output (`git rev-parse HEAD`). Secret scan also reports the
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

The phone's `release-gate` (in `mobile.yml`) runs on release runs unless the run was cancelled.
Its evidence comes in two parts: the shared jobs' results and outputs, which `ci.yml` passes to
`mobile.yml` as the `evidence` input (its own `toJSON(needs)` of `source`, `changes`,
`secret-scan`, `checks` and `notes`), and the phone's jobs, which are the gate's own
`toJSON(needs)` (`native-tests`, `android`). It merges the two and calls
`node scripts/ci/release-gate.ts admit` on the result. It has `contents: read`, no
Environment and no secret, so a healthy `ti` release stays automatic and a `main` one still waits
for the owner at the release job's Environment. It refuses (exits 1, so the release job is
skipped) when:

- any of `source`, `changes`, `secret-scan`, `checks`, `native-tests`, `notes`, `android` is
  missing or its result isn't `success` (failed, cancelled, skipped);
- `source` isn't a 40-hex SHA, or any job's `source` output differs from it;
- the scan range doesn't end at the source (`<sha>..<source>` or `<source>`);
- `changes.nativeTests` isn't `true`. Release runs count every area as changed
  (`scripts/ci/changes.sh`), so the only legitimate skip is a PR's, and PRs never reach the gate.
  Report and comment jobs aren't prerequisites and count for nothing, and neither do the
  desktop's jobs, which aren't in either part of the evidence;
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
  // stable releases only: the ti release this one promotes
  "promotedFrom": {
    "releaseTag": "v0.61.0-ti",
    "source": "<the same source>",
    "run": { "repository": "LeoPerez8/wave", "id": 120, "attempt": 1 },
    "signedSha256": "<sha256 of the ti APK>",
  },
}
```

A folder's digest (`release-gate.ts digest <dir>`) is the SHA-256 of one
`"<relative path>\0<file sha256>\n"` line per file (a NUL between path and digest), sorted by
path.

A repack keeps the native side of an earlier full build and swaps in this source's JS and Metro
resources. Its `base` names that full build: the commit and run that built it, its native key
(equal to `runtimeVersion`) and its unsigned APK's digest. The full build writes the record as
`kept-build.json` beside the kept `app-release.apk` (`scripts/ci/kept-build.ts keep`). A kept APK
with no record, a record for another key, or a record that doesn't match the APK gets no base, and
the run builds in full (`kept-build.ts check`). `bundleSha256` and `unsignedSha256` cover what the
repack published.

## The release job

The phone's release job (`release` in `mobile.yml`) checks out `release-gate.outputs.sha` and, before any step that names a secret, downloads the
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

The phone and the desktop publish to the same GitHub Release, each on its own. Whichever gets
there first creates it; the other adds its files. When both try to create it at once, the one
that loses adds its files to the release the other made (`publish-release.sh`). The phone also
writes the release notes; the desktop leaves them as they are when the release exists.

A re-run of a tag whose GitHub Release already exists replaces the APK and record, and rewrites
its notes, only when the phone's record there names the same source. One built from another
commit stays as it is and the step fails. So does a release from before records that holds an
APK: nothing shows that APK came from this run's source, so the step says so and replaces
nothing. A listing or download GitHub can't answer fails the step too. The other app's files and
record don't count: the desktop's installers on a release don't stop the APK, and the other way
round.

## Desktop installers

The desktop's gate (`release-gate` in `desktop.yml`) admits the Windows x64 NSIS installer and
the Linux x64 AppImage on versioned releases. `ci.yml` calls `desktop.yml` on `main` and tags
only when the desktop changed since its own previous release (`scripts/ci/changes.ts`). The
Desktop jobs run on Windows and Ubuntu 22.04, check out the same release source as Android and
report their actual checkout, tag, update public key fingerprint and file digests. The gate needs
both Desktop jobs to succeed. From the `evidence` input it also checks what the phone's gate
checks of the shared jobs: `source` picked a commit and it is the one `desktop.yml` was handed,
Secret scan, Checks and Patch notes succeeded on it, and the scan range ends at it. Then it
rehashes the Linux installer and the Windows build output (`desktop-release.ts admit`) and
uploads its record as the workflow artifact **`desktop-release-provenance`**: the same schema,
`source` and `releaseTag` as the phone's, with the desktop's evidence under `desktop` and no
`artifact`. A failed Desktop job refuses only the desktop; the phone's gate never sees it.
Before SignPath is enabled, that Windows output is the unsigned ti installer and its blockmap.
With SignPath enabled, the gate admits the unpacked Windows app archive. The Windows signing job
verifies it against the gate record, signs `Wave.exe` before building NSIS, then signs the installer
and builds its blockmap. The desktop's release job (`release` in `desktop.yml`, in the release
Environment) verifies both installers and the blockmap against the record, including the Windows
signing job's final build evidence (`desktop-release.ts finalize-windows`). It then publishes
them with the record as **`wave-<version>.desktop.provenance.json`** on the version's GitHub
Release, and after that their update. It doesn't wait for the phone: a failed APK leaves the
installers published. See [Windows code signing](windows-code-signing.md) for owner setup.
A stable release includes the desktop when the repository variable `RELEASE_DESKTOP_MAIN` is
`on`. The usual stable approval still applies, to the desktop's release job as to the phone's.
Releases published before #1336 keep the desktop's evidence under `desktop` in the phone's sealed
record instead.

Android's existing update key is RSA. Desktop uses an Ed25519 PEM public key in the
`WAVE_DESKTOP_UPDATE_PUBLIC_KEY` repository variable and the matching PEM private key in
`WAVE_DESKTOP_UPDATE_SIGNING_KEY` in the release Environments. Only the public key reaches the
packaging jobs. The private key must match the fingerprint in the admitted record.

The owner deploys `apps/updates` by hand. After GitHub publishes a release, CI uploads the desktop
files and notes to R2, then updates one signed channel pointer covering both installers. The app
checks the signature, channel, platform and installer digest before installation. It applies the
update on quit. On Linux, the installed AppImage must be writable by the user.

In **Roll back an update**, choose `app=desktop`, the channel and the earlier version. Before
any secret, the job runs `verified-desktop-release.sh` on the tagged GitHub Release (below), which
checks the desktop's record and both installers and needs no APK, so a version the desktop
released alone can go back. The publisher also checks the original signed desktop manifests in R2
and signs a fresh channel pointer that allows the downgrade. It writes only under
`desktop/<channel>/`, so the phone's update and metadata stay as they are; `app=mobile` likewise
writes none of the desktop's files. Desktop has no transition for releases without provenance.

## Trusting a published release

`scripts/ci/verified-release.sh <tag> <dir>` is how promotion and rollback trust a release. It
downloads `wave-<version>.provenance.json` and `wave-<version>.apk` from the tag's GitHub Release,
asks the API for the tag's commit, and runs `release-gate.ts verify-release`: the record must be
this tag's, name the tag's commit as `source`, be sealed, and have `signedSha256` equal to the
APK's digest. It writes `file=<record>` to `$GITHUB_OUTPUT`. A release with no record fails.

`scripts/ci/verified-desktop-release.sh <tag> <dir>` does the same for the desktop. It downloads
the desktop's record (`wave-<version>.desktop.provenance.json`, or the phone's record for a
release from before #1336) and both installers, and runs `release-gate.ts verify-desktop-release`:
the record must be this tag's, hold the desktop's admission for its own tag and source, and name
the tag's commit as `source`. A stable desktop built from another ti release than the phone's
names that release in `promotedFrom` instead, and then `source` must be that release's commit.
`desktop-release.ts verify-published` then checks the installers against the admission.

## Promotion

Promote to main takes an `app` (`both`, `mobile` or `desktop`). `promote-version.ts` keeps
its version rules and picks each app's ti release: its newest at or below `v<version>-ti` that
holds its files (`promotedApps`). `promote.sh` checks the ancestry of each against `main`, the
phone's with `verified-release.sh` and the desktop's with `verified-desktop-release.sh`, before
it pushes the stable tag on the phone's commit (the desktop's when only the desktop goes out).
It then starts one CI run per ti release, with `app` and `promoted_from` (`ci.yml`'s
`workflow_dispatch` inputs). The Release source job takes `promoted_from`'s commit as the run's
source, so each run checks, scans and builds only its apps, from the commit their ti release was
built from: Secret scan, Checks (the checkout must be `promoted_from`'s commit, at or below the
tag's number), native tests, notes and a full build. Before admitting, each gate downloads the
promoted ti release's record. The phone's `admit` refuses a stable tag unless that record is
sealed, is `promoted_from`'s (by default `v<version>-ti`), is at or below the stable number and
names the same source. The desktop's `promote-desktop` refuses unless the desktop's ti record
admitted installers from the same source. Each admitted record carries the link as
`promotedFrom`. Each release job still opens the `main` Environment, so the owner approves every
stable release as before.

A stable release is its own full build, so its APK and bundle digests differ from the ti
release's. What links the two is the shared source and the ti record's seal.

## Tag runs

Every `v*` tag run, pushed or started with `workflow_dispatch`, has `IS_RELEASE`, runs the gate of
each app it calls and reaches that app's release job only through it. The release jobs, and Sign
the Windows release, take the `ti` Environment only on a push to `main`; any tag, a hand-made
`-ti` tag included, takes `main` and waits for the owner.
Check release tag still refuses a tag that isn't the app's version or isn't on `main`. A tag run
can't replace a release built from another source (above).

## Rollback

**Roll back an update** (`rollback.yml`) republishes the update R2 keeps for a version, with a
new id and time and a new signature. It needs no new build and no new commit: the release's record
and R2's copy are enough. For `app=mobile`, before any step that names a secret, it runs
`verified-release.sh` on `v<version>` (the desktop's path is under Desktop installers). Then `apps/updates/scripts/promote.ts` gets the checked record
(`WAVE_PROVENANCE_FILE`) and refuses, before signing, unless R2's update is what that record
admitted:

- the record is `v<version>`'s, for this channel and the update's runtime version, and sealed;
- the update's list of exported files (`exported.files`, written by `publishUpdate` since #1130)
  digests to the record's `updateSha256`;
- the bundle and every asset phones download are among those files, each under its own hash;
- the app config phones read is the exported `expo-config.json` plus the runtime version.

The existing checks stay: the channel must keep the version, phones must not already be on it,
and the runtime version must be the channel's current one. The job keeps its channel's
Environment, so a `main` rollback waits for the owner and a `ti` one doesn't.

## Releases published before records

Nothing here makes up a record for an older release.

- **Promotion.** A ti release without a record can't be promoted. Promote a newer one: the merge
  that brings this in releases a ti version with a record, so there is always a candidate.
- **Rollback.** Right after this lands, every update R2 keeps (the last 10 per channel) predates
  records, and rollback is the recovery path for a bad update. So `rollback.yml` has an input,
  `allow_unrecorded` (off by default). With it, a release with no record on its GitHub Release goes
  back on the runtime version check alone, and the run says so in a warning. It applies only when
  the release has no record and R2's update has no file list. A release that has either is checked
  in full, so the input can't skip a check that is possible. The input is for the owner. Once R2
  keeps no update from before records (10 releases per channel), it has nothing left to allow, and
  removing it is a later change for the owner to review.

## What stays the same

The shared signing keys (APK release key, rotation proof, `UPDATES_SIGNING_KEY`) and where they
live, the automatic `ti` release on pushes to `main`, owner approval for `main`, and the bot's
version-bump and tag pushes are unchanged. Trusted maintainers can still edit the workflows and
these scripts. The gate and these checks keep bad evidence out of a release. They are no defence
against someone with write access.

## Remote settings

The repo's tests check the workflow files. What GitHub enforces lives in its settings, and only
what was read from the API is verified here. Read on 2026-11-18 (UTC) with `gh api`, read-only:

- Environment `main`: required reviewer `LeoPerez8`, self-review allowed; deployment policies
  allow the `main` branch and `v*` tags.
- Environment `ti`: no reviewer; deployment policy allows the `main` branch only.
- Ruleset "Release tags" (active, `refs/tags/v*`): blocks updating and deleting tags; the
  repository admin role bypasses it. Creating a `v*` tag isn't restricted.

Not verified: which secrets each Environment holds, the Actions settings for workflow token
permissions and fork runs, and any setting not listed above.

## For dependent work

- To find what a release was built from, use `verified-release.sh`, or read
  `wave-<version>.provenance.json` on its GitHub Release and check `source` against the tag's
  commit and `signedSha256` against the APK asset.
- A stable release's record links its ti release in `promotedFrom`, for the phone and the
  desktop each. The desktop's may be another release than the phone's.
