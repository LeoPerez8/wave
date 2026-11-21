# Rights inventory for GPL-3.0-only

Ticket #1134 (spec #1122). First observed 2026-11-18 against commit
`2d95fbb9c814b3b5147ad71b24bb8f58520b78d8`; resolved the same day against
`6b31a7cc027d3d16bf12803418b7d101493a91d0`.

**Verdict: ready.** `node scripts/ci/rights-inventory.ts check` exits 0: "Rights inventory: ready
for GPL-3.0-only." Two of the resolutions are owner exceptions, labelled as such below and in
`components.json`; they aren't findings that the risk is gone.

Wave is licensed GPL-3.0-only from 2026-11-18: [LICENSE](../../LICENSE) holds the unmodified GPLv3
text (sha256 `3972dc97…86`), [NOTICE.md](../../NOTICE.md) the owner's copyright line, a §7
additional permission for Google Play services, and the paths left out of the grant, and every
first-party `package.json` says `"license": "GPL-3.0-only"`.

## Where it lives

#1135 (release-source delivery) and the licence declaration read these files:

| File                                          | What it holds                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/licensing/rights-inventory.md`          | This document: conclusions, obligations, resolutions, sources.                                                                                                                                                                                                                                                                                                                                         |
| `docs/licensing/components.json`              | Hand-kept entries: contributors, ported code, Gradle libraries, assets, fixtures, distribution. Each has a `status`, the `evidence` observed, and where relevant `paths`, `licence`, `notice` and `resolution` (observed, owner statement, owner exception, or excluded from the grant). `reviews` resolves npm packages whose declared licence alone doesn't settle compatibility, per exact version. |
| `docs/licensing/npm-packages.json`            | Every npm package `apps/mobile` and `apps/sync` ship, at its exact version, from `pnpm-lock.yaml` (its sha256 is recorded): declared licence and the notice files it holds.                                                                                                                                                                                                                            |
| `docs/licensing/android-release-closure.json` | The Android release's resolved `releaseRuntimeClasspath` at `6b31a7cc`: 274 libraries with the licence each POM states, and the 22 Gradle projects.                                                                                                                                                                                                                                                    |
| `scripts/ci/rights-inventory.ts`              | The tool that records the snapshot and checks it.                                                                                                                                                                                                                                                                                                                                                      |

Commands, from the repository root:

```sh
node scripts/ci/rights-inventory.ts check     # the blockers; exits 1 while there are any
node scripts/ci/rights-inventory.ts notices   # the notices a release carries, as JSON
node scripts/ci/rights-inventory.ts snapshot --node-modules node_modules   # after a lockfile change
```

`check` also flags drift: a package in the lockfile that the snapshot lacks, or a library declared
in `apps/mobile/modules/*/android/build.gradle` or `packages/kotlin-shared/build.gradle.kts` that
`components.json` doesn't cover. After any dependency change, re-run `snapshot` (it reads
installed packages and asks the npm registry for those not installed on the host) and add the new
Gradle library with its evidence. `check` doesn't resolve the Gradle closure: after a change to a
`build.gradle` or to an npm package that brings a Gradle module, observe the closure again (below).

The package list is a superset of what ships. It is the production dependency closure, which still
holds build tools such as Babel, lightningcss and TypeScript's platform binaries. A Metro source
map of the Android export at `6b31a7cc` shows which packages reach the release bundle (see the
Blue Oak packages below).

## Distribution model

What Wave conveys, and so what the GPL's conditions attach to:

- **Android APKs**, published as GitHub prereleases (`ti`) and promoted releases (`main`), and
  offered to phones by the update service (`GET /v1/apk`). A repack keeps a native base built
  from an earlier commit and swaps in the new JS bundle.
- **OTA bundles**, the Hermes JS bundle and its assets, served by `apps/updates` from R2 and
  verified on the phone against the certificate in its APK.
- **Not conveyed**: the sync and update Workers run on Cloudflare. Users reach them over the
  network and receive no copy, and GPL-3.0 (unlike the AGPL) attaches no source obligation to
  that. Their dependencies are inventoried anyway (`apps/sync` is in the snapshot). The desktop
  app isn't published as a release either, so `apps/desktop` isn't a shipped importer.

Every `v*` tag, from the first (`v0.5.0`) to `v0.68.0-ti`, contains `a3f085e9`, which brought in
innertubex and the Metrolist/NewPipe ports. So every Android release already distributed holds
third-party GPL-3.0 code, and was conveyed without a licence for the combined work, a notices file
or source access tied to the release. **Owner exception, 2026-11-18:** the owner accepts the risk
for those releases, as the status quo of every release so far, and backfills their source access
through #1135 (`docs/release-source.md`).

## First-party code and contributors

Authors on `2d95fbb9` (git log, names as committed):

| Author                           | Commits | Status                                                  |
| -------------------------------- | ------: | ------------------------------------------------------- |
| LeoPerez8 (the repository owner) |   2,527 | Licensed GPL-3.0-only by the owner.                     |
| Ygor Perez de Oliveira           |     672 | The owner, by the owner's statement of 2026-11-18.      |
| ygor-infotera                    |      21 | The owner, same statement.                              |
| github-actions[bot]              |     165 | Version bumps and autofixes from the owner's workflows. |
| Claude                           |       1 | AI-authored commit.                                     |

On 2026-11-18 the owner stated that they wrote the code under all three identities ("foi eu que
codei pelas 3 contas"). That statement is the resolution for `contributor:Ygor Perez de Oliveira`;
no separate rights holder was found. 1,976 commits carry a `Co-Authored-By` trailer for an AI
assistant. Nobody else claims rights in that output; copyright may not subsist in purely generated
parts, which narrows what the grant covers without blocking it.

`packages/kotlin-shared` (`dev.leoperez.wave:kotlin-shared:0.0.0`, which `wave-native` declares
and `apps/mobile/plugins/kotlinShared.ts` substitutes with the project) is Wave's own code, except
the ported files below that now live there.

No vendored directories, patched dependencies or copied third-party files were found outside the
ports below. The search covered `vendor`/`third_party` paths, `patches/`, pnpm
`patchedDependencies`, and comments naming a source (`ported`, a licence in parentheses, upstream
project names).

## Ported and derived code

None of this can be relicensed by the owner. Each keeps its licence and notices inside the
GPL-3.0-only work, and since 2026-11-18 each file carries a header naming its source, licence,
copyright holder and Wave's changes with their date (GPLv3 §5a).

| Component                 | Files                                                                                                                                | Upstream, exact revision                                                                                                                                                                | Licence observed                                                                                                              | Resolution                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `port:metrolist-potoken`  | wave-native `yt/potoken/YtPoTokens.kt`, `YtPoTokenWebView.kt`, `assets/wave_po_token.html`; kotlin-shared `yt/potoken/YtBotGuard.kt` | Metrolist `utils/potoken/*` and `po_token.html` at v13.7.0 (`7c5ba3ad`), the last release before the port; `po_token.html` matches byte for byte. Origin: NewPipe v0.29.3 (`8e15d04e`). | Metrolist: GPLv3 text, no "or any later version" in LICENSE, README or file headers. NewPipe: README grants GPL-3.0-or-later. | Compatible. v13.7.0 recorded in each header; notices added.                                                                          |
| `port:yt-response-walks`  | kotlin-shared `yt/Yt*Parser.kt`, `YtAccountMenu.kt`, `YtClient.kt`                                                                   | Doc comments say the walk "follows" Metrolist page classes, innertubex's `AccountMenuResponse`, and ytmusicapi. No upstream revision compared.                                          | GPL-3.0 (Metrolist, innertubex); MIT (ytmusicapi).                                                                            | Compatible. Credited as derived code in each header, which says the upstream revision isn't recorded.                                |
| `port:shazamio-signature` | kotlin-shared `recognize/SignatureGenerator.kt`, `HanningWindow.kt`                                                                  | shazamio-core tag 2.0.0 (`5690a2e9`). The Hann table is copied as literals. Its fingerprinting files share names with SongRec 0.8.2 (`79d3d771`, Cargo.toml `GPL-3.0+`).                | MIT, "Copyright (c) 2024 dotX12" (LICENSE, Cargo.toml).                                                                       | Compatible. Both files carry the MIT notice and credit SongRec (GPL-3.0-or-later), since no comparison has cleared it.               |
| `port:chfft-rfft`         | kotlin-shared `recognize/RealFft2048.kt`                                                                                             | chfft 0.3.4 `RFft1D`, crate sha256 `103be009…07dc0`.                                                                                                                                    | MPL-2.0, file headers without Exhibit B.                                                                                      | Compatible via MPL-2.0 §3.3. The file carries the MPL-2.0 Exhibit A notice and stays MPL-2.0, outside the owner's grant (NOTICE.md). |

`packages/kotlin-shared/src/testFixtures/fixtures-src/shazam` is Wave's own tool. It
fetches shazamio-core at build time and commits none of it.

## Dependencies

### npm (`docs/licensing/npm-packages.json`)

`apps/mobile` ships 646 package versions and `apps/sync` 22. Declared licences, `apps/mobile`:
MIT 522, Apache-2.0 29, ISC 25, MPL-2.0 35, BSD-3-Clause 9, BSD-2-Clause 9, BlueOak-1.0.0 6,
Unlicense 2, `(MIT OR CC0-1.0)` 2, and one each of `MIT AND OFL-1.1`, Python-2.0, CC-BY-4.0,
0BSD, CC0-1.0, `(MIT OR Apache-2.0)` and `(BSD-3-Clause OR GPL-2.0)`. `apps/sync`: MIT 19,
Apache-2.0, BSD-3-Clause and ISC one each. The snapshot of 2026-11-18 at `6b31a7cc` added four
packages `apps/mobile` reaches through `@wave/client` (better-sqlite3 13.2.0, node-addon-api
8.9.2, @types/better-sqlite3 9.6.0, @types/react-dom 19.3.0), all MIT in their installed
`package.json`.

`licenceVerdict` accepts an SPDX expression only when the FSF licence list calls every licence
it needs GPLv3-compatible (an `OR` needs one compatible choice). Everything else waits for a
review of that exact version:

- **lightningcss and its 32 platform packages** (1.30.1, 1.32.0, 1.33.0), MPL-2.0: each npm
  tarball was checked, and no file outside the licence text carries the Exhibit B notice.
  Compatible under §3.3. A build-time CSS compiler.
- **@expo-google-fonts/inter 0.4.2**, `MIT AND OFL-1.1`: the Inter fonts ship as separate
  files under OFL-1.1, which permits bundling with any software. Compatible, not relicensed.
- **glob 13.0.6, lru-cache 11.5.3, minimatch 10.2.6, minipass 7.1.3, path-scurry 2.0.2,
  sax 1.6.1**, BlueOak-1.0.0: **observed absent from the release.** `expo export --platform
android --no-bytecode --source-maps` at `6b31a7cc` built `index-6eb99dbb….js`; its source map's
  9,911 sources come from 68 npm packages, and none of these six is among them (nor
  better-sqlite3 or node-addon-api). The lockfile reaches them only through Node-side tools:
  `@expo/cli`, `@expo/config(-plugins)`, `@expo/fingerprint`, `@expo/metro-config`, eslint,
  `expo-updates`' command-line helper and `expo-splash-screen`'s config plugin (sax through
  xml2js). No Gradle project comes from them. Releases convey no copy, so the FSF list's silence
  on Blue Oak doesn't matter here.

82 snapshot entries (74 for `apps/mobile`, 8 for `apps/sync`) were read from registry metadata
because the observing host hadn't installed them (other platforms' binaries). Their notice files
weren't observed and show as `null`.

### Gradle (declared)

`apps/mobile/modules/*/android/build.gradle` and `packages/kotlin-shared/build.gradle.kts`:

| Library                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Licence (primary source)                                                                                                                                                                                                                                                                        | Status                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `com.github.MetrolistGroup.innertubex:innertubex:0.11.9` (and `innertubex-android`)                                                                                                                                                                                                                                                                                                                                                                                                                                              | JitPack built tag `v0.11.9` from commit `719948b9`. LICENSE is the unmodified GPLv3 text, README "GNU General Public License v3.0", no "or any later version" outside the licence text itself; POM: "GNU General Public License, version 3". No bundled JavaScript or native files in the tree. | Compatible. Its source at `719948b9` belongs to the release's Corresponding Source. |
| `com.github.MetrolistGroup.quackjs:quackjs:0.1.4` (and `quackjs-android`), innertubex's JavaScript interpreter                                                                                                                                                                                                                                                                                                                                                                                                                   | JitPack built tag `v0.1.4` from commit `d867d98f`. POM "GNU General Public License, version 3 only", README "Licensed under GPL-3.0-only". Its third-party notices cover test fixtures and the Gradle wrapper only.                                                                             | Compatible. Its source at `d867d98f` belongs to the release's Corresponding Source. |
| `dev.leoperez.wave:kotlin-shared:0.0.0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Wave's own module, `packages/kotlin-shared`.                                                                                                                                                                                                                                                    | Compatible; first-party.                                                            |
| `net.jthink:jaudiotagger:3.0.1`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Sources jar headers: LGPL 2.1 "or (at your option) any later version"; POM "LGPL".                                                                                                                                                                                                              | Compatible.                                                                         |
| `androidx.palette:palette:1.0.0`, `androidx.core:core:1.16.0`, `androidx.media3:media3-exoplayer:1.11.1`, `androidx.media3:media3-session:1.11.1`, `androidx.car.app:app:1.7.0`, `androidx.credentials:credentials:1.6.0`, `androidx.credentials:credentials-play-services-auth:1.6.0`, `io.ktor:ktor-client-okhttp:3.6.0`, `io.ktor:ktor-client-content-negotiation:3.6.0`, `io.ktor:ktor-serialization-kotlinx-json:3.6.0`, `com.squareup.okhttp3:okhttp-bom:5.5.0`, `org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0` | Apache-2.0 (POMs).                                                                                                                                                                                                                                                                              | Compatible.                                                                         |
| `com.google.android.libraries.identity.googleid:googleid:1.2.1`, and the 9 `com.google.android.gms:play-services-*` libraries the closure resolves                                                                                                                                                                                                                                                                                                                                                                               | "Android Software Development Kit License" (POMs). Proprietary.                                                                                                                                                                                                                                 | **Owner exception, 2026-11-18**, with the §7 permission in NOTICE.md. See below.    |

### Gradle (resolved release closure)

Observed 2026-11-18 at `6b31a7cc`: after `expo prebuild --platform android`,
`./gradlew :app:dependencies --configuration releaseRuntimeClasspath` resolves 274 libraries and 22
Gradle projects. `docs/licensing/android-release-closure.json` lists each library with the licence
its POM (or its parent POM) states:

| Licence                                  | Libraries | Notes                                                                                                                                                              |
| ---------------------------------------- | --------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Apache-2.0                               |       194 | AndroidX, Media3, Ktor, OkHttp, Kotlin, Fresco, commons-codec and commons-io (licence in the Apache parent POM), and others.                                       |
| MIT                                      |        57 | react-android, hermes-android, slf4j-api (licence in slf4j-bom), and others.                                                                                       |
| BSD-2-Clause AND Apache-2.0              |         6 | Glide 5.0.5.                                                                                                                                                       |
| BSD-2-Clause                             |         1 | avif 1.1.1.                                                                                                                                                        |
| BSD-3-Clause                             |         1 | bolts-tasks 1.4.0, through Fresco. Its repository also carries Facebook's "Additional Grant of Patent Rights" v2, a patent grant that adds no copyright condition. |
| LGPL-2.1-or-later                        |         1 | jaudiotagger.                                                                                                                                                      |
| GPL-3.0, GPL-3.0-only                    |         4 | innertubex and quackjs, with their `-android` artifacts.                                                                                                           |
| Android Software Development Kit License |        10 | googleid and 9 Play services libraries: owner exception.                                                                                                           |

The FSF licence list calls Apache-2.0, MIT (Expat), the 2- and 3-clause BSD licences and
LGPL-2.1-or-later GPLv3-compatible. The projects are the Expo and React Native modules built from
npm packages in the snapshot, plus Wave's `wave-native`, `wave-glass` and `kotlin-shared`. Native
code inside npm packages (`react-native-skia-android` 154.0.0's Skia build, Hermes) declares only
its package's licence, MIT for both.

### Google Play services: owner exception

Google sign-in's Play services libraries ship inside the APK, beside third-party GPL-3.0 code.
They aren't part of the phone's operating system, so whether GPLv3's System Library exception
covers them is unresolved. **Owner exception, 2026-11-18:** the owner keeps them and grants, in
NOTICE.md, a GPLv3 §7 additional permission to convey the owner's code combined with them. That
permission covers only code the owner holds. innertubex, quackjs and the Metrolist/NewPipe ports
have no such permission from their holders; the owner accepts that risk, as every release so far
has shipped this combination. A GPL build without Play services remains the way to remove it.

## Assets, documentation and fixtures

| Component                      | What                                                                                                                                                | Status                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `asset:app-icons`              | `apps/mobile/assets/*.png`, rendered by Wave's `apps/mobile/scripts/render-icons.ts`; launcher and splash drawables come from Wave's config plugins | Compatible; rights follow the contributors'.                              |
| `asset:inter-font`             | Inter, via @expo-google-fonts/inter                                                                                                                 | OFL-1.1, kept; ship the OFL text.                                         |
| `asset:tabler-icons`           | UI icons, @tabler/icons(-react-native) 3.49.0                                                                                                       | MIT; ship the notice.                                                     |
| `asset:design-reference-icons` | `docs/design/*/reference-*.svg`                                                                                                                     | **Excluded from the grant** (NOTICE.md); one looks like Tabler's (MIT).   |
| `asset:design-studies`         | Wave's own icon studies in `docs/design`                                                                                                            | Compatible.                                                               |
| `asset:evidence-screenshots`   | `docs/agents/evidence/534`: 120 UI screenshots and their text dumps                                                                                 | **Excluded from the grant**: may show third-party artwork and song names. |
| `data:service-samples`         | `docs/spotify-samples`, `docs/google-translate-samples`                                                                                             | **Excluded from the grant**: third-party service content.                 |
| `fixtures:youtube-responses`   | `packages/kotlin-shared/src/testFixtures/resources/fixtures/yt/*.json`, 32 captured YouTube Music responses                                         | **Excluded from the grant**: third-party catalogue data.                  |
| `fixtures:audio`               | 24 small audio files and `cover.png` in kotlin-shared's test fixtures                                                                               | **Excluded from the grant**: how they were made isn't recorded.           |
| `fixtures:shazam-pcm`          | Synthesised by `make_fixtures.py`                                                                                                                   | Compatible.                                                               |
| `data:generated-and-measured`  | Performance results, AGP baseline profile, manifest fixture, the public update certificate                                                          | Compatible.                                                               |
| `docs:first-party`             | `docs/`, `README.md`, `CONTEXT.md`, `CLAUDE.md`                                                                                                     | Compatible; rights follow the contributors'.                              |

The excluded material stays in the repository, by the owner's decision of 2026-11-18, and none
of it ships in a release. Apple Music and BlackPlayer EX appear in the docs only as references.
`CONTEXT.md` already rules out using Apple's names, icons or artwork, and none were found among
the shipped assets.

## Grant and notices

The grant, made 2026-11-18 in LICENSE and NOTICE.md: GPL-3.0-only for the code the owner holds,
across Android, Core, desktop, Workers and tools, with the §7 Play services permission. Third-party
parts keep their own licences and notices:

- innertubex, quackjs and the Metrolist/NewPipe ports stay GPL-3.0 (NewPipe's or-later choice is
  preserved in its notice).
- `RealFft2048.kt` stays MPL-2.0.
- The shazamio-core port keeps its MIT notice, with SongRec's credit.
- jaudiotagger stays LGPL-2.1-or-later.
- Fonts stay OFL-1.1.
- Permissive dependencies keep their licence texts and NOTICE files.

`node scripts/ci/rights-inventory.ts notices` lists what a release carries: each shipped npm
package with its notice files, then each component's notice. The resolved Gradle closure's
licences are in `android-release-closure.json`, not in that output.

## Source and installation obligations

Corresponding Source (GPLv3 §1, §6) for each conveyed APK and OTA bundle is the source at its
release commit. For a repack, that also means the commit its native base was built from. Add the
build scripts and generated version configuration, and the source of the GPL/LGPL libraries in it
(innertubex at `719948b9`, quackjs at `d867d98f`, jaudiotagger 3.0.1). §6(d) allows offering it
from a different server, such as a release tag, if clear directions sit next to the object code.
That covers the GitHub release page and whatever the app and update service show for an OTA
bundle. #1135 builds this, for releases already out as well as new ones.

Production credentials aren't Corresponding Source. The sync Worker's secrets, the database and
Cloudflare tokens, and the APK and update signing keys aren't source code, and a recipient builds
with their own configuration.

Installation Information (GPLv3 §6, User Products): phones are User Products, but the duty applies
only when the conveying "occurs as part of a transaction in which the right of possession and use
of the User Product is transferred". Wave isn't sold or preinstalled with phones, so we found no
duty to hand over signing keys. That's a reading of the licence text, not a categorical
exemption. Signing still matters in practice:

- A self-built APK installs with the builder's own key, but replacing a release build needs an
  uninstall, which deletes Wave's data on that phone.
- The updater accepts only updates signed for the certificate in its own APK, so a modified build
  must carry the builder's own certificate (`apps/mobile/certs/certificate.pem` is the public half
  to replace).

If Wave ever ships on devices, revisit this.

## Resolutions

The 20 items `check` listed at `6b31a7cc` before this change, and what each became:

| Item                                                                                                                                 | Resolution                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `contributor:Ygor Perez de Oliveira` (and ygor-infotera)                                                                             | **Owner statement**, 2026-11-18: the same person as the owner.                                                             |
| `com.google.android.libraries.identity.googleid:googleid:1.2.1`, with Play services                                                  | **Owner exception**, 2026-11-18: kept, §7 permission for the owner's code, risk for third-party GPL code accepted.         |
| `distribution:released-android`                                                                                                      | **Owner exception**, 2026-11-18: risk accepted as the status quo of every release; source access backfilled through #1135. |
| `gradle:release-closure`                                                                                                             | **Observed**: the closure above.                                                                                           |
| `dev.leoperez.wave:kotlin-shared:0.0.0`                                                                                              | **Observed**: first-party module, new entry. innertubex moved to 0.11.9 and quackjs 0.1.4 was added with it.               |
| `port:metrolist-potoken`, `port:yt-response-walks`, `port:shazamio-signature`, `port:chfft-rfft`                                     | **Observed**, notices added to each file.                                                                                  |
| `glob`, `lru-cache`, `minimatch`, `minipass`, `path-scurry`, `sax`                                                                   | **Observed** absent from the release bundle.                                                                               |
| `asset:design-reference-icons`, `asset:evidence-screenshots`, `data:service-samples`, `fixtures:youtube-responses`, `fixtures:audio` | **Excluded from the grant**, named in NOTICE.md, kept in the repository.                                                   |

The four desktop-reached npm packages that the earlier snapshot lacked were resolved by
re-running `snapshot` (all MIT).

## Primary sources

Fetched 2026-11-18:

- GPLv3 text, §1, §5, §6, §7, §8, §14: <https://www.gnu.org/licenses/gpl-3.0.html>; LICENSE is
  <https://www.gnu.org/licenses/gpl-3.0.txt>
- FSF licence list (page dated 2026-04-22): <https://www.gnu.org/licenses/license-list.html>
  (MPL-2.0, OFL-1.1, CC-BY-4.0, Python, LGPL, BSD entries)
- innertubex `719948b994d71d700a6d0615c6d8e2985ca371f6` (tag `v0.11.9`):
  <https://github.com/MetrolistGroup/innertubex/tree/719948b994d71d700a6d0615c6d8e2985ca371f6>
  and the JitPack POM for 0.11.9
- quackjs `d867d98f9f2562009399cdfecd67e626a086f878` (tag `v0.1.4`):
  <https://github.com/MetrolistGroup/quackjs/tree/d867d98f9f2562009399cdfecd67e626a086f878>
  and the JitPack POM for 0.1.4
- Metrolist v13.7.0 `7c5ba3ad22cb562d337897f82163a2b7fce665f3`:
  <https://github.com/MetrolistGroup/Metrolist/tree/7c5ba3ad22cb562d337897f82163a2b7fce665f3>
- NewPipe v0.29.3 `8e15d04efea1285839c9e1f9fcd0792d8476770b`:
  <https://github.com/TeamNewPipe/NewPipe/tree/8e15d04efea1285839c9e1f9fcd0792d8476770b>
- shazamio-core 2.0.0 `5690a2e99ba2aa6456a742c5b1defd8e7841826b`:
  <https://github.com/shazamio/shazamio-core/tree/5690a2e99ba2aa6456a742c5b1defd8e7841826b>
- SongRec 0.8.2 `79d3d7716bbd2488068b2210f1558d4cd55c22b6`:
  <https://github.com/marin-m/SongRec/tree/79d3d7716bbd2488068b2210f1558d4cd55c22b6>
- chfft 0.3.4: <https://crates.io/crates/chfft/0.3.4>
- Bolts-Android 1.4.0 LICENSE and PATENTS:
  <https://github.com/BoltsFramework/Bolts-Android/tree/1.4.0>
- Maven POMs (and parent POMs) on Maven Central, Google's Maven (`dl.google.com/dl/android/maven2`)
  and JitPack for each library in the closure, and the jaudiotagger 3.0.1 sources jar
- npm registry tarballs for each lightningcss version reviewed
