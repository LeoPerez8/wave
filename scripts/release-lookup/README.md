# Release-date lookup sample

`sample-recorded.json` is a live recording of Deezer's and MusicBrainz's answers for 40 songs,
20 of them Brazilian. Core's `releaseLookup.test.ts` replays it without network access.

To record it again, from the repository root:

```sh
node scripts/release-lookup/sample.ts
```

It makes its requests one after another, at least a second apart, and overwrites
`sample-recorded.json` with only the fields matching and dates use. Then run
`pnpm --filter @wave/core test` and update the replay test's counts if the services' answers
changed.
