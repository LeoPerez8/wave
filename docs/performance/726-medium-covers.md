# #726 Medium covers and shared artwork selection

Ticket: #726 (parent #712). Branch `feat/726-medium-covers`, based on
`feat/712-faster-lighter` at `874fb3753b8a26efee5d22a4bd608374f9cbe23a`.

## What was measured

Desktop checks cover artwork selection and URI preservation, medium sizing,
provider fallback order, and migration completion, interruption and retry.
No phone measurements have been taken.

The owner's S24+ run should use `scripts/perf` scenarios `push-library` (Library ›
Albums), `push-playlist` (playlist artwork), `tab-switch` (Home's shelves),
`now-playing`, and `soak-routes` (retained memory). Use the same Library with
large embedded covers, visible playlist, display settings, compiler filter and
kind of APK in both runs. Compare both idle and import workloads. Keep a separate
first-launch check for the migration, then measure after it completes and after
restarting Wave so image-memory caches cannot retain a pre-migration fallback.

```sh
node scripts/perf/perf.ts run --serial <S24+> --apk <perf.apk> \
  --commit <source-sha> --compile baseline --playlist "<visible playlist>" \
  --scenario push-library,push-playlist,tab-switch,now-playing \
  --variant idle,import --import-link <fixture-link> --label 726-before
node scripts/perf/perf.ts run --serial <S24+> --compile baseline \
  --scenario soak-routes --label 726-before-soak
```

Repeat with `726-after` labels on the combined implementation. Retain raw JSONL
under `docs/performance/results/`, run `summary` on each, and run `compare` on
matching before/after files.

Budgets for this change:

- A medium cover's long side is at most 640 px, preserving aspect ratio without
  upscaling. The scanner decodes once for both cached sizes.
- The migration encodes at most one cached original per free turn, off the JS
  thread, with zero audio/tag reads. A completed pass does no more encoding.
- Session artwork decoding is capped at 640 px by Media3's
  [DataSourceBitmapLoader](<https://developer.android.com/reference/androidx/media3/datasource/DataSourceBitmapLoader.Builder#setMaximumOutputDimension(int)>).
- At 120 Hz the frame interval is 8.33 ms. Compare missed-frame counts, frame p90,
  route response and retained graphics/PSS memory against the owner's repeated
  baseline. There must be no repeatable regression in response or frame misses;
  tile image memory should decrease after migration. #546 contains no measured
  S24+ baseline, so it cannot supply a numeric before/after improvement here.

## Before (`874fb375`)

Pending the owner's S24+ run. APK, device fingerprint, Android version, actual
refresh rate, compiler filter, Library size, scenario summaries and raw JSONL
are not available. No emulator or desktop timings substitute for these numbers.

## After

Pending the owner's run on the integrated implementation. Record the same run
header and `perf.ts compare` output, including warnings and negative results.

## Behavior kept

Helper tests cover rows, tiles and originals; photo priority; larger-size
fallbacks; missing artwork; existing file, content and remote addresses; and
recovering originals from sized URIs for sharing. The provider's JVM tests
exercise real files before and after a medium arrives, including malformed URI
rejection. Migration JVM tests cover one-cover turns, existing mediums,
completion, interrupted runs and failed encodes retried next launch. Existing
History, queue-cover, playlist-image and artist-photo tests cover nearby behavior.

On the S24+, compare album grids, Home, playlist mosaics, artist photos, row
covers, Now Playing, notification/Auto artwork and exported song/lyric/Recap
images. Test a Library installed before this change without rescanning: pending
mediums must keep their original cover, and originals and palettes must stay
intact after migration. Confirm orientation, crop, placeholders and YT Music's
remote-artwork switch match the current build.

## Not measured, and negative results

The phone cannot be run in this session. Frame times, graphics memory, migration
throughput, disk growth, full Android integration and visual acceptance remain
pending. The pure Kotlin sizing, file-provider and migration suites run on the
JVM; they do not execute Android's BitmapFactory/JPEG encoder or Media3. The
Android SDK is not configured in this worktree, so those Android changes have
not been compiled here. Phone measurements never block the merge.

Sized content URIs use memory caching, so an original served before migration
is not retained in the image disk cache under the medium's URI. That fallback
can remain in memory for the current process; the after run must restart Wave.
Artist photos and custom playlist images keep their existing cached files;
this migration processes embedded artwork only.
