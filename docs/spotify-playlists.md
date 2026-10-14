# Reading a Spotify playlist without an account or key (#156)

Tried on 2026-10-14 from a Brazilian IP, with curl and small Node scripts, against:

| Playlist | Id | Kind | Songs |
| --- | --- | --- | --- |
| Top 500 Most Streamed Songs on Spotify | `1RTENWq73MEx1Pop40ZZ5S` | user | 495 |
| The Longest Playlist Ever | `6yPiKpy7evrwvZodByKvM9` | user | 10,000 (82 local files, 307 not playable in BR) |
| Today's Top Hits | `37i9dQZF1DXcBWIGoYBM5M` | Spotify editorial | 50 |
| This Is Taylor Swift | `37i9dQZF1DX5KpP2LN299J` | Spotify editorial | 85 |
| (none) | `0000000000000000000000`, `4bU1kM5X1Sd6p8XGwLsH9m` | doesn't exist | |
| (malformed) | `abc` | bad id | |

## Answer

A keyless way returns the whole playlist, but only through an undocumented Spotify API:

1. `GET https://open.spotify.com/embed/playlist/<id>`, the public embed page. Its
   `__NEXT_DATA__` JSON holds the name, cover, the first 100 songs and an anonymous access
   token.
2. `POST https://api-partner.spotify.com/pathfinder/v2/query` (`fetchPlaylist`) with that
   token, paged until `totalCount`. It returned all 495 and all 10,000 songs, editorial
   playlists included, with title, every artist, album, duration, track and disc number.

Neither gives the ISRC. Spotify's metadata endpoint does, one request per song, with the same
token (see [ISRC](#isrc)).

The embed page alone, the part Spotify publishes for anyone to load, stops at 100 songs.

**Recommendation.** Steps 1 and 2. If step 2 fails (hash rotated, token refused, throttled),
fall back to the embed page's first 100 songs and say on the import card that only the first
100 were imported. Don't fetch ISRCs unless #163 decides to match songs by ISRC: title,
artists, album and duration are already there, and ISRCs cost one request per song.

The cost is that Wave depends on an internal API Spotify can change without notice, and
Spotify's [User Guidelines](https://www.spotify.com/us/legal/user-guidelines/) forbid
"crawling" or "scraping" and using automated means "to view, access or collect information".
YT Music already stands on the same footing (`youtubei/v1`), so this fits Wave's existing
trade-off, but the owner should accept it knowingly.

## Candidates

### Embed page: `open.spotify.com/embed/playlist/<id>`

- **Fields.** `props.pageProps.state.data.entity` has `name`, `subtitle` (owner name),
  `coverArt.sources[].url` and `trackList[]`. Each track has `uri` (`spotify:track:<id>`),
  `title`, `subtitle` (artists joined with `", "`), `duration` (ms), `isPlayable`,
  `isExplicit`. **No album, no ISRC.** Splitting `subtitle` on `", "` breaks artists whose
  name holds a comma, so prefer the pathfinder's artist list.
- **Cap.** 100 songs (the 495 and 10,000-song playlists both gave 100), no paging.
- **Token.** `props.pageProps.state.settings.session.accessToken`, `isAnonymous: true`,
  `accessTokenExpirationTimestampMs` 25 to 50 minutes ahead. It isn't tied to the playlist:
  one token read every playlist tried.
- **Rate limits.** 30 page loads back to back, all 200 with a token.
- **Failure.** An unknown id still answers HTTP 200, but `pageProps` is
  `{ "status": 404, "title": "Page not found", … }` with no `state` and no token. A malformed
  id gives `status: 500`. So the embed page doubles as the existence check.

### Partner GraphQL: `api-partner.spotify.com/pathfinder/v2/query`

The web player's own API. Body:

```json
{
  "variables": { "uri": "spotify:playlist:<id>", "offset": 0, "limit": 500, "enableWatchFeedEntrypoint": false },
  "operationName": "fetchPlaylist",
  "extensions": { "persistedQuery": { "version": 1, "sha256Hash": "8964e8eafb21aa992a7d951d256d83285c04be2105d209262901de70cb97584a" } }
}
```

Headers: `Authorization: Bearer <embed token>`, `Content-Type: application/json`.

- **Fields.** `data.playlistV2` has `name`, `description`, `images.items[0].sources[].url`,
  `ownerV2.data.name`, `content.totalCount`, `content.items[]`. Each item's `itemV2` is a
  `TrackResponseWrapper` whose `data` (`__typename: "Track"`) has `name`, `uri`,
  `artists.items[].profile.name`, `albumOfTrack.name` / `.uri` / `.coverArt` / `.date`,
  `trackDuration.totalMilliseconds`, `trackNumber`, `discNumber`, `playability.reason`
  (`PLAYABLE`, `COUNTRY_RESTRICTED`, …), `contentRating.label`. **No ISRC.**
- **Other item kinds.** `LocalTrackResponseWrapper` / `LocalTrack` (a file from the owner's
  computer) has `name`, `artistName`, `albumName` (often empty) and
  `localTrackDuration.totalMilliseconds`, and a `spotify:local:…` uri. Podcast episodes can
  sit in playlists too; none of the test playlists had one, so the parser should skip any
  wrapper it doesn't know. Songs not playable in the user's country keep their full metadata.
- **Paging.** `offset` / `limit`. `content.pagingInfo` only echoes the request, so the next
  offset is `offset + items.length`, until `totalCount`. `limit` 1,000 worked (10,000 songs in
  10 calls, 22 s); 5,000 timed out with a 504. Use 500.
- **Rate limits.** 120 calls back to back with one token, all 200, no `Retry-After`. Unknown
  ceiling.
- **Failure.** All HTTP 200 except auth and hash errors.
  - Unknown id: `playlistV2: { "__typename": "NotFound", "message": "Object with uri … not found" }`.
  - Malformed id: `{ "__typename": "GenericError", "message": "… status code: 400 BAD_REQUEST" }`.
  - Bad or expired token: HTTP 401 `Missing/invalid/expired access token`.
  - Unknown hash: HTTP 412 `"Invalid query hash"`.
- **The hash.** It's the persisted-query id of `fetchPlaylist` in the web player's bundle and
  changes whenever Spotify changes that query. To find the new one: fetch
  `https://open.spotify.com/` with a desktop browser User-Agent, take the
  `open.spotifycdn.com/cdn/build/web-player/web-player.<hash>.js` script (4.4 MB) and match
  `"fetchPlaylist","query","([0-9a-f]{64})"`. Wave can ship the hash as a constant and treat a
  412 as "fall back to 100 songs"; re-discovering it at runtime costs a 4.4 MB download.

### Open web page: `open.spotify.com/playlist/<id>`

- With a desktop browser User-Agent it's the bare web player shell (no data).
- With curl's User-Agent it serves the mobile web player with a base64 JSON blob in
  `<script id="initialState">`. Under `entities.items["spotify:playlist:<id>"]` it carries the
  same GraphQL shape as `fetchPlaylist`, but only **30 songs**, with `totalCount` and
  `pagingInfo.nextOffset`. It also has `og:title`, `og:image` and 30 `music:song` meta tags.
- Paging past 30 needs the web player's token from `/api/token`, which now requires a TOTP
  computed from a secret in the player's JS (`enableTOTPVersionValidation` in its config). The
  embed token makes this unnecessary.
- An unknown id answers HTTP 404.

Worse than the embed on every count. Not recommended.

### oEmbed: `open.spotify.com/oembed?url=<playlist url>`

Title and a 300 px cover (`thumbnail_url`) only. No songs.

### Web API: `api.spotify.com/v1`

- **With the embed's token.** Every call (playlist, tracks, search, track) answers 429
  `QUOTA_EXCEEDED` with `Retry-After` of about 49,600 s. The embed's client id
  (`ab9ad0d96a624805a7d51e8868df1f97`) shares one Web API quota with everyone and it's spent.
- **With a key the owner registers.** Since 27 November 2024, new apps get no Spotify editorial
  or algorithmic playlists ([Spotify, 2024-11-27](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)).
  Since February 2026 a Development Mode app needs its owner on Premium, is capped at 5 users,
  and Spotify is moving away from the Client Credentials flow for metadata
  ([Spotify, 2026-02-06](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security),
  [rspotify#550](https://github.com/ramsayleung/rspotify/issues/550)). Spotify's migration guide
  is reported to return playlist items only for playlists the user owns or collaborates on; its
  page timed out (504) here, so that's unconfirmed. Either way a key means a sign-in, Premium,
  and no editorial playlists. It gives the ISRC (`external_ids.isrc`).

### ISRC

`GET https://spclient.wg.spotify.com/metadata/4/track/<gid>?market=from_token` with the embed
token and `Accept: application/json` returns `external_id: [{ "type": "isrc", "id": "…" }]`.
`<gid>` is the track's base-62 id as 32 hex digits. One request per song, so 495 requests for
the test playlist. Deezer's open API also gives ISRCs, but only after a title and artist search,
which can match the wrong song. Neither is worth it for import.

## Links Spotify shares

All playlist ids are 22 base-62 characters (`[0-9A-Za-z]{22}`).

| Form | Where it comes from | To the id |
| --- | --- | --- |
| `https://open.spotify.com/playlist/<id>?si=…` | Share › Copy link, the share sheet | path |
| `https://open.spotify.com/intl-<lang>/playlist/<id>?si=…` | localized web links | path (the server 302s to the plain form) |
| `https://open.spotify.com/user/<user>/playlist/<id>` | old links | path (301 to the plain form) |
| `https://open.spotify.com/embed/playlist/<id>` | embed codes | path |
| `spotify:playlist:<id>`, `spotify:user:<user>:playlist:<id>` | desktop Copy Spotify URI | last segment |
| `https://spotify.link/<code>`, `https://spotify.app.link/<code>` | the mobile app's share (Branch.io short links) | resolve over the network, below |

Strip the query string. A URL without `/playlist/` (a track, album, artist or user) isn't a
playlist: say so instead of importing.

Resolving a short link depends on the User-Agent:

- With `curl/…` or no User-Agent, `https://spotify.link/<code>` answers 307 with
  `Location: https://open.spotify.com/<type>/<id>?si=…&_branch_match_id=…`.
- With a browser, `okhttp/…`, `Dalvik/…` or `Wave/…` User-Agent it 307s to
  `https://spotify.app.link/<code>?_p=…`. That one answers `okhttp/…` (the only agent tried
  there) with a 200 HTML page that contains the `https://open.spotify.com/<type>/<id>` URL, and
  curl with the same 307 to `open.spotify.com`.
- An unknown code answers 200 with no `Location` (or an `intent://` redirect for browsers).

So: request the short link without following redirects; take `Location` if it points at
`open.spotify.com`; otherwise follow to `spotify.app.link` and take the first
`https://open.spotify.com/<type>/<id>` in the body. The two real codes found
(`spotify.link/wud9sAYDbDb`, a track; `spotify.link/uszhQI5hT3b`, a user profile) weren't
playlists; resolution doesn't depend on the type.

Sharing to Wave from the Spotify app should arrive as `ACTION_SEND` `text/plain` with the link
in `EXTRA_TEXT`. That wasn't checked on the phone in this research, so the parser should find the first
`open.spotify.com/…`, `spotify.link/…`, `spotify.app.link/…` or `spotify:` match anywhere in
the shared text.

## Private and deleted playlists

Not tested: there's no keyless way to find a real private or deleted playlist's id, and making
one needs an account. Spotify's [Playlist privacy and access](https://support.spotify.com/us/article/playlist-privacy/)
page (updated 2025-09-08) separates two cases:

- A playlist left off the owner's profile is still public: "If you share them, recipients can
  play, follow, and share them to others." The id is enough, like any public playlist.
- A private playlist is shared from the mobile app with a link friends "can use for 7 days".
  That link probably carries an access token beside the id; reading it by id alone will most
  likely answer like an unknown id. Whether Wave can pass the link's extra parameters to the
  embed or `fetchPlaylist` is open; it can be checked once the owner shares a private playlist.

Wave treats the embed's `status: 404` and the `NotFound` answer the same way: "This playlist
doesn't exist or isn't public."

## What Wave sends to Spotify

- `open.spotify.com`: the playlist id (in the embed page's path).
- `api-partner.spotify.com`: the playlist URI, the page offset and size, and the anonymous token
  Spotify issued in the embed page.
- `spotify.link` / `spotify.app.link`: the short-link code, only when a short link is shared.
- `i.scdn.co`, `image-cdn-ak.spotifycdn.com`: the cover URL, to show the cover.
- With every request: the device's IP address and a User-Agent.

Nothing about the Library, play history, stats or the YT Music account.

## Options for the owner

A keyless way does return the whole playlist, so no choice is forced before #163. If the owner
won't depend on Spotify's internal API, the options are:

1. **The embed page only.** First 100 songs, title, artists and duration, no album. Public and
   stable.
2. **A key the owner registers.** Needs Premium on the owner's account, a Spotify sign-in in
   Wave, and still no Spotify editorial playlists; possibly only the user's own playlists.
3. **Drop Spotify import.**

## Samples for the parser test (#163)

Under `docs/spotify-samples/`, trimmed from the live responses above (noise fields such as
colours, avatars, markets and `itemV3` removed; the embed token replaced):

- `embed-playlist.html`: the 495-song user playlist's embed page, first 3 of its 100 songs.
- `embed-not-found.html`: the embed page for an unknown id (`status: 404`, no token).
- `fetch-playlist-user-page.json`: `fetchPlaylist` offset 0, limit 3 of 495; multi-artist songs.
- `fetch-playlist-editorial-page.json`: Today's Top Hits, offset 48, limit 2 of 50 (the last
  page).
- `fetch-playlist-local-and-restricted.json`: the 10,000-song playlist, offset 21, limit 10:
  one `LocalTrack` (2nd item) and one `COUNTRY_RESTRICTED` song (last item).
- `fetch-playlist-not-found.json`, `fetch-playlist-bad-uri.json`: the `NotFound` and
  `GenericError` answers.
- `track-metadata.json`: the spclient track metadata with its ISRC.
