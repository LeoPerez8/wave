# Wave update service

`apps/updates` delivers Wave's over-the-air JS updates: a Cloudflare Worker that answers the
[`expo-updates` protocol](https://docs.expo.dev/technical-specs/expo-updates-1/) from an R2
bucket. It's separate from the sync service, so a bad sync deploy can't take down the path that
delivers its fix, and it needs no account or sign-in. See "Build and CI" in `docs/spec.md`.

| File                 | What it holds                                                    |
| -------------------- | ---------------------------------------------------------------- |
| `src/worker.ts`      | The Worker entry: the service over the bucket in `wrangler.toml` |
| `src/service.ts`     | The routes                                                       |
| `src/layout.ts`      | What R2 holds, which the service and the publish script share    |
| `src/publish.ts`     | Turns `expo export`'s output into a published update             |
| `src/promote.ts`     | Republishes an earlier version as a channel's newest update      |
| `src/release.ts`     | Where both end: writes the update, moves phones, trims R2        |
| `scripts/publish.ts` | CI's entry to publishing                                         |
| `scripts/promote.ts` | The rollback workflow's entry to promoting                       |
| `scripts/bucket.ts`  | R2 through wrangler, which both scripts use                      |

## Routes

### `GET /v1/manifest`

The check `expo-updates` makes at launch, with its headers `expo-protocol-version: 1`,
`expo-platform: android`, `expo-channel-name` (`ti` or `main`), `expo-runtime-version` and
`expo-current-update-id`.

`200`, `multipart/mixed` with the update's manifest, when the channel has an update for that
runtime version and the phone isn't on it. `204` when there's nothing new. `400` for any other
platform, protocol or channel.

### `GET /v1/assets/<sha256 hex>`

A bundle or asset, named by its content and cached for good. `404` when there's none.

## What R2 holds

```
assets/<sha256 hex>                       a bundle or asset
updates/<channel>/<runtime>/<id>.json     a published update
updates/<channel>/<runtime>/latest.json   { "updateId": ... }: what that channel's phones get
updates/<channel>/history.json            what the channel keeps, newest first
```

A failed upload leaves phones on the previous update: `latest.json` moves after everything the
update needs. wrangler can't list a bucket, so `history.json` is the listing that rollback and
retention read.

Each channel keeps its last 10 updates, promotions included, and a release removes the older
ones. A file stays while an update of either channel names it. An APK whose runtime version has
no update left finds nothing new and stays on the JS it has.

## Rolling back

GitHub › Actions › **Roll back an update** › Run workflow, with the channel and the version to go
back to (`0.46.1-ti`, as in the release's tag). `expo-updates` only moves to a newer `createdAt`,
so this republishes that version's bundle under a new id and time. Phones on the channel with the
same runtime version move to it at their next check, and the next release replaces it.

The run fails and says why when the channel doesn't keep that version, phones are already on it,
or it was built for another runtime version than the channel's newest update. A bundle can't
cross a native change: release a fix instead. `Constants.expoConfig.version` on the phone reads
the promoted version.

## What the owner sets up

Nothing here is provisioned yet. Until it is, every release logs `Skipping the over-the-air
update` and is published as usual, and phones find no update. The Worker's URL is already in
`apps/mobile/app.config.ts`, so deploy it under the account whose subdomain is
`leonardolp2424.workers.dev`, or change the URL there (which takes a new APK).

1. Create the bucket: `pnpm --filter @wave/updates exec wrangler r2 bucket create wave-updates`.
   Keep it private: phones reach it only through the Worker.
2. Deploy the Worker: `pnpm --filter @wave/updates run deploy`. Check it answers:
   `curl -i https://wave-updates.leonardolp2424.workers.dev/v1/manifest` gives `400`.
3. Create a Cloudflare API token with **Workers R2 Storage: Edit** on the account.
4. Add the repository secrets (GitHub › Settings › Secrets and variables › Actions):
   - `CLOUDFLARE_API_TOKEN`: that token.
   - `CLOUDFLARE_ACCOUNT_ID`: the account's id, from the Cloudflare dashboard.
5. Install the first APK with `expo-updates` by hand. Later JS-only releases reach it with no
   install.

A change to this package isn't released with the app. Deploy it the same way as step 2.
