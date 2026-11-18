# Release source

How to get the source of a Wave release and build it yourself (#1135, spec #1122). Read the copy
of this file at the commit a release names, not the one on `main`: the build steps change with
the code.

Wave is licensed GPL-3.0-only from 2026-11-18 ([LICENSE](../LICENSE), [NOTICE.md](../NOTICE.md),
`docs/licensing/rights-inventory.md`). This file and the tool it describes are how each release
offers its Corresponding Source.

## What identifies a release's source

Each release is one commit. The release gate records it (`docs/release-provenance.md`), and
`scripts/ci/release-source.ts` turns that record into a **source manifest**,
`wave-<version>.source.json`, plus directions in Markdown, `wave-<version>.source.md`:

| Field              | What it holds                                                                                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`           | The commit, with an archive and a browse link that name it by SHA. Never a branch.                                                                                                                                                                                |
| `build`            | `full`, `repack`, or `unknown` for a release from before the gate.                                                                                                                                                                                                |
| `nativeBase`       | For a repack, the commit its kept native build came from. The APK carries code from both commits, so both are its source.                                                                                                                                         |
| `promotedFrom`     | For a stable release, the ti release it promotes (`docs/release-provenance.md`, Promotion): its tag and signed APK digest. The tool refuses a record that promotes another source.                                                                                |
| `generated`        | What CI generates on top of the tree: the version name and code (a promotion drops `-ti`), the update channel and the runtime version it stamps into the manifest (`scripts/ci/update-config.ts`).                                                                |
| `artifacts`        | The published APK's name and digests, from the sealed record.                                                                                                                                                                                                     |
| `buildInputs`      | The files besides the app's code that drive the build, all inside the source tree: the lockfile, workspace config, config plugins, native modules, CI build scripts, the inventory and this file.                                                                 |
| `instructions`     | This file at a fixed commit.                                                                                                                                                                                                                                      |
| `thirdPartySource` | Exact source of the GPL-family libraries the APK links from outside the tree: innertubex (`af31fd2b` for 0.8.6, `719948b9` for 0.11.9), quackjs at `d867d98f` and the jaudiotagger 3.0.1 sources jar (`correspondingSource` in `docs/licensing/components.json`). |
| `notices`          | `node scripts/ci/rights-inventory.ts notices` for that commit: every shipped npm package with its notice files, then each component's notice.                                                                                                                     |
| `pending`          | What isn't settled for that release, starting with the rights inventory's open items.                                                                                                                                                                             |

The manifest holds links, version numbers and digests. The tool builds it field by field from
the record, so nothing else in a record can end up in it. It never holds a key, a token or a
production setting.

```sh
node scripts/ci/release-source.ts manifest sealed.json > wave-<version>.source.json
node scripts/ci/release-source.ts directions wave-<version>.source.json > wave-<version>.source.md
node scripts/ci/release-source.ts verify wave-<version>.source.json   # read-only, exits 1 on a problem
```

Run `manifest` from a checkout of the release's source commit. `verify` needs only a clone with
the tags. It checks that the tag is on the source commit, that the source's app version names
the tag, that each build input and the instructions exist at their commit, that a repack's base
is in the source's history, and that every link names a commit.

### Releases from before the gate

Tags `v0.5.0` to `v0.68.0-ti` have no provenance record, and none of them holds the rights
inventory or a licence. Run this from a checkout that has both the tag and this file (a commit on `main`
pushed to GitHub, so the link works):

```sh
node scripts/ci/release-source.ts legacy v0.68.0-ti --instructions-at <commit holding this file>
```

It reads the tag's version and build inputs through git, and the notices from the checkout's
inventory. When the tag's `pnpm-lock.yaml` differs from the checkout's, `pending` says the notices
come from a later inventory and the tag needs its own snapshot. `thirdPartySource` also comes from
the checkout, so it lists every GPL library source the inventory records, including ones that tag
didn't ship (those tags shipped innertubex 0.8.6, not 0.11.9 or quackjs).

The manifest says `"provenance": "none"` and `"build": "unknown"`. Some of those APKs were
repacks, and no record says which commit their native part came from. It is an earlier commit on
`main`, which is public, but the manifest can't name it, and `pending` says so.

### Why links name commits

GitHub serves `https://github.com/LeoPerez8/wave/archive/<sha>.tar.gz` for any commit it has.
Release commits stay reachable because `v*` tags can only be moved or deleted by an admin (the
"Release tags" ruleset, `docs/contributing.md`), and a repack's base is an ancestor of the
release commit. A branch link would show whatever `main` holds today.

The third-party links point at other people's servers. GPLv3 §6(d) leaves Wave responsible for
that source staying available while it offers the APK. Mirroring innertubex, quackjs and jaudiotagger as
release assets is not done; see [Open items](#open-items).

## Building a release yourself

You need none of Wave's credentials. The Android build in CI runs with no secret (the release
environments test checks that only the release job reads one). Everything below uses a fresh
clone and your own keys.

Tools: Node 22.18 or later, pnpm 10.28.0 (`packageManager` in `package.json`; `corepack enable`
picks it), JDK 17, and the Android SDK with the NDK that prebuild asks for.

```sh
git clone https://github.com/LeoPerez8/wave.git && cd wave
git checkout <source commit from the manifest>
pnpm install --frozen-lockfile
```

For a stable release (no `-ti` in the tag), first set the version the way CI does, because the
commit still says `x.y.z-ti`:

```sh
sed -i -E 's/^(\s*"version":\s*)"[^"]*"/\1"x.y.z"/' apps/mobile/package.json
```

Then build:

```sh
cd apps/mobile
EXPO_NO_GIT_STATUS=1 pnpm exec expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Gradle signs `app/build/outputs/apk/release/app-release.apk` with prebuild's public debug key.
Re-sign it with your own key before you keep it:

```sh
apksigner sign --ks your-key.p12 --out wave-mine.apk app/build/outputs/apk/release/app-release.apk
```

`scripts/emulator-apk.sh` does the same for an x86_64 emulator. For a repack release, building
the source commit in full gives you the same JS and an equivalent native part. If you want the
native part exactly as shipped, build `nativeBase` and swap in the source's bundle with
`scripts/ci/repack.sh`, as CI does.

The result won't match Wave's APK byte for byte, and its signature won't be Wave's. Neither is
expected. Compare the version and the bundle's behaviour, not hashes.

### What runs without Wave's services

Playing music and everything in the Library (scanning, playlists, queue, stats, lyrics from
files) work on the phone with no account and no server. These features reach a hosted service,
and a build of your own needs your own resources for them:

| Feature                                  | What it calls                                        | What you provide                                                                                                                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wave account, sync, Soulseek password    | the sync Worker (`apps/sync`)                        | Your own Worker and libSQL database, a Google OAuth client for your package name and signing key, a Soulseek key (`openssl rand`). Set `extra.syncUrl` and `extra.googleWebClientId` in `apps/mobile/app.config.ts`. |
| Lyrics search, concerts                  | the sync Worker, which calls Genius and Ticketmaster | Your own Genius token and Ticketmaster key, as secrets of your Worker. Empty, those lookups fail and the rest of the app keeps working.                                                                              |
| Over-the-air updates                     | the update Worker (`apps/updates`)                   | Off in any local build: the manifest says `unstamped` and updates are disabled until CI stamps a channel. To run your own, deploy `apps/updates` with your own bucket and signing key.                               |
| Instagram Stories share of a lyrics card | Instagram's share intent                             | A Meta app id in `extra.facebookAppId`, or none (the destination disappears).                                                                                                                                        |

Wave's Google OAuth client accepts sign-ins only from APKs signed with Wave's key, so a
self-signed build can't use Wave's own sync service. That's Google's check, not a licence
condition. `apps/sync/README.md` explains running the sync Worker locally against a local
database, with no token.

### Updates and signing on the phone

- Android installs an APK over an existing one only when both carry the same signing key. A build
  with your key replaces Wave's only after an uninstall, which deletes Wave's data on that phone.
- A phone runs only over-the-air updates signed for the certificate in its own APK
  (`apps/mobile/certs/certificate.pem`, the public half). To publish updates to your own build,
  put your certificate there, or delete the file, and prebuild makes an APK that doesn't check
  update signatures (`apps/mobile/plugins/updateSigning.ts`).

## Installation information

GPLv3 §6 asks for Installation Information only when the object code is conveyed in or for a
User Product as part of a transaction transferring possession of the device. Wave is a sideloaded
APK, not sold with or preinstalled on phones, so we found no duty to hand over Wave's signing
keys. That's our reading of the text, recorded in the rights inventory, not a ruling. The steps
above still let you install a modified build on your own phone, at the cost of the uninstall
noted above. Revisit this if Wave ever ships on devices.

## Publishing it with a release

`scripts/ci/publish-release.sh` attaches `SOURCE_MANIFEST_FILE` and `SOURCE_DIRECTIONS_FILE`
when they're set, as `wave-<version>.source.json` and `.source.md`, and adds the directions to
the release notes. The release job builds them only when the repository variable
`RELEASE_SOURCE_DELIVERY` is `on`. The owner turns it on with the licence declaration of
2026-11-18; it changes what every later release page shows.

Releases already published get their manifests by hand (`legacy` above, or `manifest` from the
tag's checkout for a release with a record), attached by the owner. The tool edits no published
release.

## Open items

These keep source delivery from being complete. Each manifest lists the ones that apply.

- The resolved Gradle release closure is recorded (`docs/licensing/android-release-closure.json`,
  observed at `6b31a7cc`), but `notices` doesn't list its libraries, and nothing re-observes it
  when a `build.gradle` changes.
- Releases before 2026-11-18 carry no licence file, and their tree's inventory (where one exists)
  says the inventory was blocked. `v0.70.0-ti` ships innertubex 0.11.9 and quackjs, which the
  inventory at its own commit doesn't name.
- Notices are listed by file name in the manifest. No release ships their texts as a file or an
  in-app screen yet.
- innertubex and jaudiotagger sources are linked, not mirrored with the release.
- An over-the-air update reaches phones with no release page. The app doesn't show where its
  source is, so the directions sit only on the GitHub release of the same version.
- Releases before the gate don't name a repack's native base.
- A full independent APK build from a clean machine has not been run for this ticket; see
  `docs/verification/1135.md` for what was.
