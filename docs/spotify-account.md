# Using a signed-in Spotify account without the official API (#484)

Researched on 2026-10-18 from a Brazilian IP with Node 26 `fetch`, against the live web player
(`open.spotify.com`, bundle `web-player.0079e2e5.js`) and its APIs. This builds on
[spotify-playlists.md](spotify-playlists.md) (#156), which reads public playlists with the embed
page's anonymous token.

**What was verified and how.** No Spotify account was available to this research, so:

- **Verified by real requests:** the token endpoint and its TOTP step (anonymous, and how a bad
  cookie fails), `searchTracks`, `searchDesktop`, `fetchPlaylist`, and every signed-in
  GraphQL operation below. Anonymous calls to those come back `200` with `"User is not authorized"`
  from the right resolver (`/me`, `/addItemsToPlaylist`). A wrong hash gets `412` instead, so the
  hash and the variables are both accepted. Rate behaviour, error codes.
- **Read from the web player's own code, not yet run signed in:** the cookie the sign-in leaves
  (`sp_dc`), the signed-in response shapes, and the `spclient` REST calls for creating a
  playlist, adding it to the account and making it public or private.

[Checking it signed in](#checking-it-signed-in) has a script the owner can run with their own
cookie to close that gap before #485 merges. Every claim below says which kind it is.

## Answer

It can be done. Sign-in, the library, playlist writes and search all go through the web player's
own endpoints, with one cookie as the only credential.

1. **Sign-in:** Spotify's login page in a web view (`accounts.spotify.com/login?continue=…open.spotify.com`).
   Once it lands on `open.spotify.com`, read the `sp_dc` cookie for `.spotify.com`. That cookie is
   the session. Clear the web view before and after, as `YtSignInActivity` does.
2. **Token:** `GET open.spotify.com/api/token` with `Cookie: sp_dc=…` and a TOTP computed from a
   secret in the web player's JS. It answers a Bearer token that lasts about an hour. Fetch a new
   one when it expires or a call answers `401`. A `401` from `/api/token` itself means Spotify
   no longer accepts the cookie, so the session goes to "expired".
3. **Reading:** GraphQL `pathfinder/v2/query` operations `profileAttributes` (name, photo,
   username), `libraryV3` (created and followed playlists, plus Liked Songs as a pseudo-playlist),
   `fetchLibraryTracks` (Liked Songs) and `fetchPlaylist` (a playlist's songs, already used by the
   link import).
4. **Writing:** `POST spclient.wg.spotify.com/playlist/v2/playlist` creates a playlist, then
   `…/user/<username>/rootlist/changes` adds it to the account and sets `public`. Its songs
   change through the GraphQL mutations `addToPlaylist`, `removeFromPlaylist` and
   `moveItemsInPlaylist`. Who can open it is `…/playlist-permission/v1/playlist/<id>/permission/base`.
5. **Search:** GraphQL `searchTracks`. It works with the anonymous token too, so export matching
   doesn't strictly need the session.

**Not usable:** the official Web API (`api.spotify.com/v1`). The web player's token gets
`429 API rate limit exceeded` there (`Retry-After: 35`), anonymous. The embed's client id gets
`QUOTA_EXCEEDED` (#156).

**Recommendation for #485–#487**

- **#485 Sign in:** mirror `YtSignInActivity` / `YtSessionStore` / `YtSignInPage`. Store only
  `sp_dc` (plus the account's name, photo and username) in no-backup storage. Tokens live in
  memory in the native module, fetched on demand, never persisted, never handed to JS. Expire on
  a `401` from `/api/token`. Email and password, or an emailed code, should work in the web view.
  "Continue with Google" probably won't (see [Risks](#risks)).
- **#486 Import:** `libraryV3` (filter `Playlists`, feature `LIKED_SONGS`, flattened), then
  `fetchPlaylist` per playlist (the parser Core already has in `spotifyPlaylist.ts`) and
  `fetchLibraryTracks` for Liked Songs. Use the signed-in token, so the account's private and
  collaborative playlists read too.
- **#487 Share:** `searchTracks` per song, then create, add to the rootlist with `public: true`,
  set the base permission to `VIEWER`, and add songs with `addToPlaylist` in batches. Keep
  the playlist URI on Wave's playlist. Sharing again: `fetchPlaylist` it. A `NotFound`, or a
  playlist missing from `libraryV3`, means it was deleted, so create it again. Otherwise
  `removeFromPlaylist` every uid and `addToPlaylist` the new list (simpler than diffing with
  moves).
- **Breakage plan:** ship the TOTP secret, its version and the operation hashes as constants in
  the native module. When `/api/token` answers `400 Unauthorized request`, or a response carries
  `totpVerExpired`, or pathfinder answers `412 Invalid query hash`, re-read them once from the
  live web-player bundle (below) and retry. If that fails too, show "Spotify changed something.
  Try again after updating Wave" instead of signing out.

## Sign-in

### The cookie

_From the web player's code and the login page, not yet seen signed in._

- `https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F` answers `307`
  to the localized page (`/pt-BR/login?continue=…`). That page offers email or username with a
  password, a passwordless emailed code, and Google, Facebook and Apple buttons.
- After sign-in Spotify sets **`sp_dc`** (`HttpOnly`, domain `.spotify.com`) and sends the page
  to `continue`. The web player never sees it from JS. It goes to `open.spotify.com/api/token`,
  which hands out tokens for the signed-in account (`isAnonymous: false`). Anonymous requests
  already get `sp_t`, a device id. Send the whole cookie header the web view holds for
  `open.spotify.com` if `sp_dc` alone turns out not to be enough.
- Android's `CookieManager.getCookie("https://open.spotify.com")` returns `HttpOnly` cookies
  too. So, as `YtSignInActivity.readSession` does: on `onPageFinished` for host
  `open.spotify.com`, poll the cookie until it has `sp_dc`, then call `/api/token` with it.
  `isAnonymous: false` confirms the sign-in. Then fetch `profileAttributes` for the name and photo.
- **How long `sp_dc` lasts:** not measured. Expiry shows as `401` from `/api/token`, verified
  with a made-up `sp_dc`:

```
GET https://open.spotify.com/api/token?reason=init&productType=web-player&totp=…&totpServer=…&totpVer=61
Cookie: sp_dc=AQBogusValue123
→ 401 {"error":{"code":401,"message":"Unauthorized","trace":"…"}}
```

Signing out on Spotify's side (Account › Sign out everywhere, or a password change) should
revoke `sp_dc` the same way.

### The access token

_Verified (anonymous)._

```
GET https://open.spotify.com/api/server-time
→ 200 {"serverTime":1792361453}

GET https://open.spotify.com/api/token?reason=init&productType=web-player&totp=<6 digits>&totpServer=<6 digits>&totpVer=61
User-Agent: <a desktop browser UA>
Cookie: sp_dc=<cookie>            (omit for an anonymous token)
→ 200 {
  "clientId": "d8a5ed958d274c2e8ee717e6a4b0971d",
  "accessToken": "BQ…",
  "accessTokenExpirationTimestampMs": 1792364794718,
  "isAnonymous": true,
  "_notes": "Usage of this endpoint is not permitted under the Spotify Developer Terms and Developer Policy, and applicable law"
}
```

- **Lifetime:** `accessTokenExpirationTimestampMs` was about 55 minutes ahead. Repeating the
  request inside that window returns the same token. `reason=transport` (what the player sends on
  refresh) behaves the same. Refresh a minute before expiry, or on any `401
  Missing/invalid/expired access token` from pathfinder.
- **Without the TOTP:** `400 {"error":{"code":400,"message":"Unauthorized request",…}}`. A wrong
  code gets the same.
- **TOTP:** RFC 6238, SHA-1, 6 digits, 30 s. `totp` is computed from the device clock and
  `totpServer` from `/api/server-time` (the player sends `"unavailable"` when that call fails).
  The secret is in the web player's main bundle:

  ```js
  let ej=[{secret:',7/*F("rLJ2oxaKL^f+E1xvP@N',version:61},{secret:'OmE{ZA.J^":0FG\\Uz?[@WW',version:60},{secret:"{iOFn;4}<1PFYKPV?5{%u14]M>/V0hDH",version:59}]
    .map(e=>({secret: /* each char code XOR (index % 33 + 9), the numbers joined as a decimal string, its UTF-8 bytes */, version:e.version}))[0]
  ```

  So the HMAC key is `Buffer.from(raw.split('').map((c, i) => c.charCodeAt(0) ^ (i % 33 + 9)).join(''), 'utf8')`.
  The first entry (version 61 today) is the one in use. Code that worked:

  ```js
  const key = Buffer.from(raw.split('').map((c, i) => c.charCodeAt(0) ^ ((i % 33) + 9)).join(''), 'utf8')
  function totp(ms) {
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(BigInt(Math.floor(ms / 30000)))
    const h = crypto.createHmac('sha1', key).update(b).digest()
    const o = h[19] & 15
    return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
  }
  ```

- **When the version goes stale:** sending `totpVer=5` with the v61 code still returned a token,
  plus `"totpVerExpired":"error","totpValidUntil":"2025-10-18T09:00:00.000Z"`. The web player
  shows a reload banner when it sees `totpVerExpired`. Treat that field as the early warning to
  re-read the secret. A rotated secret will give `400 Unauthorized request`.
- **Re-reading the secret and hashes at runtime:** `GET https://open.spotify.com/` with a desktop
  UA (166 KB). Take `open.spotifycdn.com/cdn/build/web-player/web-player.<hash>.js` (4.4 MB) and
  match `\[\{secret:(['"])(.*?)\1,version:(\d+)\}` for the secret and
  `"<operationName>","(query|mutation)","([0-9a-f]{64})"` for hashes. Search operations aren't in
  that file: they're in the lazy chunk `xpui-routes-search.<hash>.js`. Its hash is in the main
  bundle's chunk map (`u.u=e=>…({…4406:"xpui-routes-search"…})[e]…+"."+({…4406:"26863a01"…})[e]+".js"`).
- **`client-token`:** the web player also sends a `client-token` header from
  `clienttoken.spotify.com/v1/clienttoken`. No call here needed it.

## Reading the library

All are `POST https://api-partner.spotify.com/pathfinder/v2/query` with
`Authorization: Bearer <token>`, `Content-Type: application/json` and a body
`{"variables":{…},"operationName":"<op>","extensions":{"persistedQuery":{"version":1,"sha256Hash":"<hash>"}}}`.
They answer `200` even on errors: check `errors[]` and the `__typename` of each result.

| Operation              | Hash (2026-10-18)                                                  | Variables                                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `profileAttributes`    | `08ffb4730af3746e04a8301396f20875dbbce10c75243803091a9274eacc8ac0` | `{}`                                                                                                                                                                                                                           |
| `libraryV3`            | `390c78e5b951029bad359785e69b07b536a509c581cbcd0aded5e5067f187455` | `{"filters":["Playlists"],"order":null,"textFilter":null,"features":["LIKED_SONGS"],"limit":50,"offset":0,"flatten":true,"expandedFolders":[],"folderUri":null,"includeFoldersWhenFlattening":true}` |
| `fetchLibraryTracks`   | `087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240` | `{"offset":0,"limit":50}`                                                                                                                                                                                                      |
| `fetchPlaylist`        | `21ea11a6ac75a5f3e01fd365d29c18e0a4a8b7dc09f89bbb5d73910190c6acaf` | `{"uri":"spotify:playlist:<id>","offset":0,"limit":500,"enableWatchFeedEntrypoint":false}`                                                                                                                                  |

Anonymous, `profileAttributes`, `libraryV3` and `fetchLibraryTracks` answer (verified):

```json
{
  "data": { "me": null },
  "errors": [
    {
      "message": "Exception while fetching data (/me) : User is not authorized",
      "path": ["me"],
      "extensions": { "classification": "DataFetchingException", "service": "pathfinder" }
    }
  ]
}
```

The shapes below come from the player's parsers (signed in, not yet seen):

- **`profileAttributes`** → `data.me.profile` with `uri`, `username` (needed for the rootlist
  path), `name` and `avatar.sources[].url`.
- **`libraryV3`** → `data.me.libraryV3` with `items[]`, `totalCount`, `pagingInfo.offset/limit`
  and the available filters and sort orders. A `__typename` of `LibraryInvalidFilterIdError`,
  `LibraryInvalidSortOrderIdError` or `NotFound` is an error. Each entry has `pinned`, `addedAt`,
  `playedAt`, `depth` and `item`:
  - `PlaylistResponseWrapper`: `item._uri`, and `item.data` (`__typename: "Playlist"`) with
    `uri`, `name`, `images.items[0].sources`, `ownerV2.data` (compare `username` with the
    profile's to tell created from followed), `revisionId` and `currentUserCapabilities`. A
    `data.__typename` other than `Playlist`, or a null `revisionId`, is an unavailable playlist:
    skip it. The `Your Episodes` collection also arrives as a playlist wrapper: skip it.
  - `LibraryPseudoPlaylistResponseWrapper`: Liked Songs, with `data` (`PseudoPlaylist`)
    holding `uri`, `name`, `count` and `image.sources`. It's there only when `features` has
    `LIKED_SONGS`.
  - `LibraryFolderResponseWrapper`: a folder. With `flatten: true` its playlists are listed
    anyway. Skip the folder row.
  - Others (albums, artists, podcasts…) don't appear with `filters: ["Playlists"]`. Skip any
    unknown wrapper.
  - Paging: `offset += items.length` until `totalCount`. The player asks 50 at a time.
- **`fetchLibraryTracks`** → `data.me.library.tracks` with `items[]`, `totalCount` and
  `pagingInfo`. Each item has `addedAt` and `track` (`_uri`, `data` of `__typename: "Track"` with
  the same track fields as `fetchPlaylist`: `name`, `artists.items[].profile.name`,
  `albumOfTrack`, `duration.totalMilliseconds`, `contentRating`, `playability`). The player asks
  50 at a time. A non-`Track` `data` is a song Spotify no longer has.
- **`fetchPlaylist`** (verified anonymously, see #156): signed in, it also reads the account's
  private and collaborative playlists. Each `content.items[]` entry carries a **`uid`** (for
  example `"6e4a782b54436844635930"`) next to `itemV2`. Remove and move need it. The playlist
  has `revisionId`, `ownerV2` and `currentUserCapabilities`. The 2026-10-14 hash
  (`8964e8ea…`) still answers today alongside the new one, so Spotify keeps old persisted queries
  for a while after it changes them.

## Writing playlists

### Creating one and adding it to the account

_From the web player's code (`createPlaylist`, `applyChanges`, `setPublishedState`)._ The
`spclient` host is `https://spclient.wg.spotify.com/playlist/v2`. Same Bearer token. Enum
fields may be sent as names or numbers (`ADD`=2, `REM`=3, `MOV`=4,
`UPDATE_ITEM_ATTRIBUTES`=5, `UPDATE_LIST_ATTRIBUTES`=6; client `WEBPLAYER`=5).

```
POST https://spclient.wg.spotify.com/playlist/v2/playlist
{"ops":[{"kind":"UPDATE_LIST_ATTRIBUTES","updateListAttributes":{"newAttributes":{"values":{"name":"My playlist","formatAttributes":[],"pictureSize":[]},"noValue":[]}}}],
 "info":{"source":{"client":"WEBPLAYER"}}}
→ {"uri":"spotify:playlist:<id>","revision":"…"}
```

This makes the playlist but doesn't put it in the account's library. Add it to the rootlist:

```
POST https://spclient.wg.spotify.com/playlist/v2/user/<username>/rootlist/changes
{"deltas":[{"ops":[{"kind":"ADD","add":{"addFirst":true,"items":[{"uri":"spotify:playlist:<id>","attributes":{"timestamp":"<ms>","formatAttributes":[],"availableSignals":[]}}]}}],
            "info":{"source":{"client":"WEBPLAYER"}}}],
 "wantResultingRevisions":false,"wantSyncResult":false,"nonces":[]}
```

Anonymous, the create call answered `400` with an empty body (verified). Expect `401` for a
stale token.

### Public, and who can open it

Spotify has two separate switches:

- **On the profile ("public")**: an attribute of the rootlist entry. In
  `setPublishedState(uri, true)` the player sends to the same `rootlist/changes` URL:
  `{"kind":"UPDATE_ITEM_ATTRIBUTES","updateItemAttributes":{"item":{"uri":"spotify:playlist:<id>"},"newAttributes":{"values":{"public":true,"formatAttributes":[],"availableSignals":[]},"noValue":[]}}}`.
- **Who can open the link**: `GET` / `POST https://spclient.wg.spotify.com/playlist-permission/v1/playlist/<id>/permission/base`.
  The player GETs the current object and POSTs it back with `permissionLevel` changed:
  `VIEWER` lets anyone with the link open it, `BLOCKED` makes it private (`CONTRIBUTOR` makes
  it collaborative). For #487, after creating: set `public: true`, then make sure the base
  permission is `VIEWER`.

Renaming: `POST …/playlist/v2/playlist/<id>/changes` with
`{"deltas":[{"ops":[{"kind":"UPDATE_LIST_ATTRIBUTES","updateListAttributes":{"newAttributes":{"values":{"name":"…","formatAttributes":[],"pictureSize":[]},"noValue":[]}}}],"info":{"source":{"client":"WEBPLAYER"}}}],"wantResultingRevisions":false,"wantSyncResult":false,"nonces":[]}`.

Deleting (removing it from the library, which is what Spotify's Delete does for your own playlist):
`rootlist/changes` with `{"kind":"REM","rem":{"itemsAsKey":true,"items":[{"uri":"spotify:playlist:<id>"}]}}`.

### Adding, removing and reordering songs

GraphQL mutations, all sharing one hash today
(`b907ad6b088d5bf7680fa81198996d58398c2d55dfcdf59fcc959e0be98a418a`). Verified anonymously as
accepted (`"Exception while fetching data (/addItemsToPlaylist) : User is not authorized"`,
service `oxygen-playlists`).

| Operation             | Variables                                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addToPlaylist`       | `{"playlistUri":"spotify:playlist:<id>","playlistItemUris":["spotify:track:<id>",…],"newPosition":{"moveType":"BOTTOM_OF_PLAYLIST","fromUid":null},"interactionId":null}` |
| `removeFromPlaylist`  | `{"playlistUri":"spotify:playlist:<id>","uids":["<uid>",…]}`                                                                                               |
| `moveItemsInPlaylist` | `{"playlistUri":"spotify:playlist:<id>","uids":["<uid>",…],"newPosition":{"moveType":"BEFORE_UID","fromUid":"<uid>"}}`                                    |

`moveType` is `TOP_OF_PLAYLIST`, `BOTTOM_OF_PLAYLIST`, `BEFORE_UID` or `AFTER_UID` (`fromUid`
only for the last two). Uids come from `fetchPlaylist`. The player's own "remove all" fetches up
to 10,000 items and removes their uids in one call. How many uris one `addToPlaylist` takes isn't
known. Batch 100 per call, as the Web API does, until measured.

## Search

`searchTracks`, hash `b02683192a98dde7966b5e6655a79eeb62713eab703eda9902c932818dd52751`. Verified
with the anonymous token (sample: [spotify-samples/search-tracks.json](spotify-samples/search-tracks.json),
trimmed):

```json
{
  "variables": {
    "searchTerm": "Blinding Lights The Weeknd",
    "offset": 0,
    "limit": 10,
    "numberOfTopResults": 20,
    "includeAudiobooks": false,
    "includePreReleases": false,
    "includeAuthors": false
  },
  "operationName": "searchTracks",
  "extensions": { "persistedQuery": { "version": 1, "sha256Hash": "b02683…2751" } }
}
```

→ `data.searchV2.tracksV2` with `totalCount` (it capped at 1000), `pagingInfo.nextOffset` and
`items[].item` (`TrackResponseWrapper`). Its `data` has `uri`, `id`, `name`,
`artists.items[].profile.name`, `albumOfTrack.name/uri/coverArt.sources`,
`duration.totalMilliseconds`, `contentRating.label` (`NONE`, `EXPLICIT`) and
`playability.playable`/`reason`. Title, artists and length is all #487's matcher needs. Spotify
puts the best match first. `searchDesktop` (hash `eef7cc54…4c03`) returns every category at
once and is heavier. Use `searchTracks`.

## Risks

- **Terms.** `/api/token` answers every request with `"_notes": "Usage of this endpoint is not
  permitted under the Spotify Developer Terms and Developer Policy, and applicable law"`, and
  Spotify's User Guidelines forbid automated access (#156). Signing in raises the stakes over
  the link import: if Spotify acts, it's against the owner's own account. The owner should
  accept that knowingly. Writing (export) is more visible than reading.
- **TOTP secret rotation.** The bundle carries versions 59–61, so it has rotated at least that
  often. A stale version shows as `totpVerExpired` and a rotated secret as `400 Unauthorized
  request`. Re-read from the bundle, as above. This is the most likely breakage.
- **Persisted-query hashes.** `fetchPlaylist` changed between 2026-10-14 and 2026-10-18
  (`8964e8ea…` → `21ea11a6…`), though the old one still works. A removed hash answers
  `412 "Invalid query hash"`. Same remedy. Variables can change too: they show up as `errors[]`
  with a validation message. Treat any `errors[]` that isn't "not authorized" as breakage, not
  as an empty library.
- **Expired session vs broken Wave.** Only a `401` from `/api/token` with the cookie means
  "signed out". A `400` there, a `412`, or GraphQL errors mean Wave needs an update. Don't sign
  out for those, and don't loop: try the bundle re-read once per app session.
- **Rate limits.** 100 `searchTracks` calls back to back on one anonymous token: all `200`, about
  0.57 s each, no `Retry-After`. 120 `fetchPlaylist` calls likewise (#156). The ceiling is
  unknown. A 500-song export is 500 searches. Run them one or two at a time, and back off on `429`
  honouring `Retry-After`. Signed-in limits weren't measured.
- **Sign-in methods in a web view.** Google blocks OAuth in embedded web views
  (`disallowed_useragent`, [Google, 2016](https://developers.googleblog.com/2016/08/modernizing-oauth-interactions-in-native-apps.html)),
  so "Continue with Google" will most likely fail. Facebook and Apple may too. Email and
  password or the emailed code are the safe path. #485 should say so on the sign-in screen, or
  test it on the phone. Wave's YT Music sign-in avoids this because it opens Google's own
  `ServiceLogin`, not an OAuth consent screen.
- **Bot checks.** If Spotify's login shows a challenge in the web view, it runs in the page and
  the user solves it there. Not seen here.
- **The official Web API is closed.** `api.spotify.com/v1` answered `429` to the web player's
  anonymous token. Registering a developer app needs Premium and caps it at 5 users
  ([Spotify, 2026-02-06](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)).
  It's no fallback.

## What Wave sends to Spotify (for `docs/spec.md`, #485–#487)

- `accounts.spotify.com`: whatever the user types into Spotify's sign-in page, inside the web view.
- `open.spotify.com`: the `sp_dc` cookie, two TOTP codes and the device time, to get a token.
  Fetching the web player bundle when re-reading the secret sends nothing but the request.
- `api-partner.spotify.com`: the token. Reads: playlist URIs and page offsets. Export: each
  song's title and artists as a search term, the track URIs to add, the uids to remove.
- `spclient.wg.spotify.com`: the token, the exported playlist's name, its URI and its
  public/permission state.
- With every request: the device's IP address and a User-Agent.

Nothing about the Library beyond the exported playlist's name and its songs' titles and artists.
Nothing about play history, stats or the YT Music account.

## Checking it signed in

Run with Node 22+ and the owner's `sp_dc` (browser devtools › Application › Cookies ›
`open.spotify.com`). It reads only, unless `WRITE=1`, in which case it creates a playlist
named "Wave probe", adds and reorders two songs, makes it public and deletes it. Paste the
statuses (not the cookie or tokens) into #484.

```js
// SP_DC=… [WRITE=1] node probe.mjs
import crypto from 'node:crypto'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
const raw = ',7/*F("rLJ2oxaKL^f+E1xvP@N', ver = 61
const key = Buffer.from(raw.split('').map((c, i) => c.charCodeAt(0) ^ ((i % 33) + 9)).join(''), 'utf8')
const totp = (ms) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(Math.floor(ms / 30000))); const h = crypto.createHmac('sha1', key).update(b).digest(); return String((h.readUInt32BE(h[19] & 15) & 0x7fffffff) % 1e6).padStart(6, '0') }
const st = await (await fetch('https://open.spotify.com/api/server-time', { headers: { 'user-agent': UA } })).json()
const q = new URLSearchParams({ reason: 'init', productType: 'web-player', totp: totp(Date.now()), totpServer: totp(st.serverTime * 1000), totpVer: String(ver) })
const tr = await fetch('https://open.spotify.com/api/token?' + q, { headers: { 'user-agent': UA, cookie: 'sp_dc=' + process.env.SP_DC } })
const tok = await tr.json(); console.log('token', tr.status, 'isAnonymous', tok.isAnonymous, 'expires in s', Math.round((tok.accessTokenExpirationTimestampMs - Date.now()) / 1000))
const H = { authorization: 'Bearer ' + tok.accessToken, 'content-type': 'application/json', 'user-agent': UA }
const gql = async (op, hash, variables) => { const r = await fetch('https://api-partner.spotify.com/pathfinder/v2/query', { method: 'POST', headers: H, body: JSON.stringify({ variables, operationName: op, extensions: { persistedQuery: { version: 1, sha256Hash: hash } } }) }); const j = await r.json(); console.log(op, r.status, j.errors?.[0]?.message ?? 'ok'); return j }
const sp = async (method, path, body) => { const r = await fetch('https://spclient.wg.spotify.com' + path, { method, headers: H, body: body && JSON.stringify(body) }); const t = await r.text(); console.log(method, path.replace(/[A-Za-z0-9]{22}/g, '<id>'), r.status); return t ? JSON.parse(t) : null }
const me = (await gql('profileAttributes', '08ffb4730af3746e04a8301396f20875dbbce10c75243803091a9274eacc8ac0', {})).data?.me?.profile
console.log('profile', me && { username: !!me.username, name: !!me.name, photo: !!me.avatar?.sources?.length })
const lib = (await gql('libraryV3', '390c78e5b951029bad359785e69b07b536a509c581cbcd0aded5e5067f187455', { filters: ['Playlists'], order: null, textFilter: null, features: ['LIKED_SONGS'], limit: 50, offset: 0, flatten: true, expandedFolders: [], folderUri: null, includeFoldersWhenFlattening: true })).data?.me?.libraryV3
console.log('library', lib?.totalCount, [...new Set(lib?.items.map((i) => i.item.__typename))])
const liked = (await gql('fetchLibraryTracks', '087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240', { offset: 0, limit: 5 })).data?.me?.library?.tracks
console.log('liked', liked?.totalCount, liked?.items[0] && Object.keys(liked.items[0].track.data))
if (process.env.WRITE === '1') {
  const delta = (ops) => ({ deltas: [{ ops, info: { source: { client: 'WEBPLAYER' } } }], wantResultingRevisions: false, wantSyncResult: false, nonces: [] })
  const { uri } = await sp('POST', '/playlist/v2/playlist', { ops: [{ kind: 'UPDATE_LIST_ATTRIBUTES', updateListAttributes: { newAttributes: { values: { name: 'Wave probe', formatAttributes: [], pictureSize: [] }, noValue: [] } } }], info: { source: { client: 'WEBPLAYER' } } })
  const root = `/playlist/v2/user/${encodeURIComponent(me.username)}/rootlist/changes`
  await sp('POST', root, delta([{ kind: 'ADD', add: { addFirst: true, items: [{ uri, attributes: { timestamp: String(Date.now()), formatAttributes: [], availableSignals: [] } }] } }]))
  await sp('POST', root, delta([{ kind: 'UPDATE_ITEM_ATTRIBUTES', updateItemAttributes: { item: { uri }, newAttributes: { values: { public: true, formatAttributes: [], availableSignals: [] }, noValue: [] } } }]))
  const permPath = `/playlist-permission/v1/playlist/${uri.split(':')[2]}/permission/base`
  const perm = await sp('GET', permPath); console.log('base permission', perm?.permissionLevel)
  await sp('POST', permPath, { ...perm, permissionLevel: 'VIEWER' })
  const M = 'b907ad6b088d5bf7680fa81198996d58398c2d55dfcdf59fcc959e0be98a418a'
  await gql('addToPlaylist', M, { playlistUri: uri, playlistItemUris: ['spotify:track:0VjIjW4GlUZAMYd2vXMi3b', 'spotify:track:7qiZfU4dY1lWllzX7mPBI3'], newPosition: { moveType: 'BOTTOM_OF_PLAYLIST', fromUid: null }, interactionId: null })
  const items = (await gql('fetchPlaylist', '21ea11a6ac75a5f3e01fd365d29c18e0a4a8b7dc09f89bbb5d73910190c6acaf', { uri, offset: 0, limit: 10, enableWatchFeedEntrypoint: false })).data.playlistV2.content.items
  await gql('moveItemsInPlaylist', M, { playlistUri: uri, uids: [items[1].uid], newPosition: { moveType: 'TOP_OF_PLAYLIST', fromUid: null } })
  await gql('removeFromPlaylist', M, { playlistUri: uri, uids: items.map((i) => i.uid) })
  await sp('POST', root, delta([{ kind: 'REM', rem: { itemsAsKey: true, items: [{ uri }] } }]))
}
```

## Sources

- The web player at `https://open.spotify.com/` (desktop UA) and its bundles
  `web-player.0079e2e5.js` (token, TOTP secret, library, playlist writes, endpoint hosts) and
  `xpui-routes-search.26863a01.js` (search operations), from `open.spotifycdn.com/cdn/build/web-player/`,
  fetched 2026-10-18.
- Live requests to `open.spotify.com/api/server-time`, `open.spotify.com/api/token`,
  `api-partner.spotify.com/pathfinder/v2/query`, `spclient.wg.spotify.com/playlist/v2/playlist`,
  `api.spotify.com/v1/search` and `accounts.spotify.com/login`, 2026-10-18.
- Wave's YT Music sign-in, the pattern to mirror:
  `apps/mobile/modules/wave-native/android/src/main/java/expo/modules/wavenative/yt/YtSignInActivity.kt`,
  `YtSignInPage.kt`, `YtSessionStore.kt`.
