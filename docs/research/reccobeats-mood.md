# What ReccoBeats can tell about a song's mood (#1271)

Researched on 2026-11-20 from a Brazilian IP, with curl and small Node scripts, against
ReccoBeats' documentation (`reccobeats.com/docs`) and its live API (`api.reccobeats.com`). This
is the research the mood filters of DJ (#1261, "TBD: mood filters") wait on.

**What was verified and how.**

- **From the documentation:** the pages under `reccobeats.com/docs/documentation` (introduction,
  rate limiting, request and response, resources, terms of service, audio feature extraction),
  the changelog, and the OpenAPI definitions the API reference pages embed.
- **By real requests:** about 400 requests to ReccoBeats over an hour, at most one per second
  apart from one burst of 12. Every lookup form below was called, and coverage was measured on
  234 well-known songs.
- **Not verified:** how any song sounds. Nobody listened to anything in this run. The spot check
  compares ReccoBeats' numbers with how famous recordings are generally known to sound, and
  with Deezer's BPM. That is a weaker test than listening and is labelled as such below.
- **No credential was used and none was needed.** The song names are public hits picked by hand.
  Nothing came from the owner's Library, history or accounts.

## The short answer

ReccoBeats gives eleven numbers per track with no key, and it knew 99% of a 234-song sample
that was 36% Brazilian. Energy is the trustworthy number. Valence follows how bright the music
sounds, not what the song is about, so sad songs with a lively arrangement score as happy, and
that is most of Brazilian samba, pagode, sertanejo and rap. Tempo is doubled or halved for about
one song in five. Songs released in the last four months are missing: only 5 of the 50 songs on
Spotify's Brazilian chart had data.

## What ReccoBeats returns

`GET https://api.reccobeats.com/v1/audio-features?ids=…` answers `{ "content": [ … ] }`, one row
per track:

```json
{
  "id": "25c8ca63-5895-4572-84eb-a7040bc08c4d",
  "href": "https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b",
  "isrc": "USUG11904206",
  "acousticness": 0.00143,
  "danceability": 0.513,
  "energy": 0.73,
  "instrumentalness": 9.54e-5,
  "key": 1,
  "liveness": 0.0897,
  "loudness": -5.94,
  "mode": 1,
  "speechiness": 0.0598,
  "tempo": 171.001,
  "valence": 0.334
}
```

| Field              | Range    | What the documentation says it is                               |
| ------------------ | -------- | --------------------------------------------------------------- |
| `valence`          | 0 to 1   | Emotional tone: low is sad or dark, high is happy or uplifting  |
| `energy`           | 0 to 1   | Intensity and liveliness                                        |
| `tempo`            | 0 to 250 | Estimated beats per minute                                      |
| `acousticness`     | 0 to 1   | Confidence that the track is acoustic                           |
| `danceability`     | 0 to 1   | Suitability for dancing (tempo, rhythm, beat consistency)       |
| `instrumentalness` | 0 to 1   | Likelihood of no vocals; above 0.5 is meant to be instrumental  |
| `speechiness`      | 0 to 1   | Spoken words; above 0.66 is mostly speech, 0.33 to 0.66 has rap |
| `liveness`         | 0 to 1   | Probability of an audience; above 0.8 is likely live            |
| `loudness`         | -60 to 0 | Average loudness in dB                                          |
| `key`              | -1 to 11 | Pitch class (0 is C, 1 is C♯), -1 when no key was detected      |
| `mode`             | 0 or 1   | 1 is major, 0 is minor                                          |

**Mode and key are there.** The changelog adds them on 2025-08-13, and all 232 songs that got an
answer had all eleven fields, none null, no `key` of -1 and no `tempo` of 0. Whether the key and
mode are right was not checked. Rows of the same recording disagreed on `mode` for 25 of 183
songs (see "One ISRC, many rows"), so it should not be trusted alone.

The terms of service say the track metadata is "aggregated from Spotify data" and that the
audio features are "generated entirely by our custom, homemade service". Whether the numbers
equal what Spotify's closed Audio Features endpoint used to return could not be checked: that
endpoint is closed to this research too.

## How a track is looked up

All endpoints are `GET` under `https://api.reccobeats.com/v1`, verified by calling them.

| Endpoint                            | Looks up by                                        | Returns                       |
| ----------------------------------- | -------------------------------------------------- | ----------------------------- |
| `/audio-features?ids=`              | 1 to 40 ids: ReccoBeats id, Spotify track id, ISRC | Feature rows                  |
| `/track?ids=`                       | 1 to 40 ids, the same three kinds                  | Track rows                    |
| `/track/search?searchText=&artist=` | Title (3+ characters), optional artist name or id  | A page of track rows (max 50) |
| `/track/{id}/audio-features`        | ReccoBeats id only                                 | One feature row               |
| `/track/{id}/album`                 | ReccoBeats id only                                 | The track's albums            |
| `/track/recommendation?seeds=`      | 1 to 5 seed ids plus optional feature targets      | Up to 100 track rows          |
| `POST /analysis/audio-features`     | An uploaded audio clip (5 MB, first 30 seconds)    | Nine features, no key or mode |

- **Ids.** A list goes as `ids=a,b,c` or as repeated `ids=` parameters. The three kinds can be
  mixed in one request. A 41st id is refused with `400` and
  `{"status":4004,"errors":[{"path":"getAudioFeatures.ids","message":"size must be between 1 and 40"}]}`.
- **Unknown ids are left out silently.** An unknown id among known ones gives the known rows; a
  request with only unknown ids gives `200` and `{"content":[]}`. The documented `404` did not
  appear on the list endpoints.
- **A track row** has `id`, `trackTitle`, `artists[]` (`id`, `name`, `href`), `durationMs`,
  `isrc`, `href` (the Spotify URL), `availableCountries` and `popularity`. A feature row has no
  title, artist or length, only `id`, `href` and `isrc`.
- **Search** was added on 2026-07-22. It ranks by relevance, then popularity. Title alone returns
  covers first ("Bohemian Rhapsody" gave Angelina Jordan and Pentatonix before Queen), so the
  artist filter is needed, and the artist filter returned nothing for 10 of 234 songs whose
  tracks exist (Queen, ABBA, Johnny Cash, Drake, Nas and PSY among them).

### One ISRC, many rows

Spotify holds one track id per album a recording appears on, and ReccoBeats keeps them all. A
lookup by ISRC returns every one: "Blinding Lights" returned 11 rows, the median song 6, and
"Yellow" 545. One request for 20 ISRCs returned 1,207 rows, at about 330 bytes each. Whether a
large answer is ever cut short is not documented and was not seen.

The rows of one ISRC were each analysed separately and don't always agree. Across 183 songs
with more than one row, the median spread was 0.04 for valence, 0.03 for energy and 0.2 BPM for
tempo. But 60 songs had rows more than 0.15 apart in valence or energy, or more than 10 BPM
apart: "Someone Like You" ranged over 0.68 in valence, and tempo jumped by a factor of two for
31 songs. So a lookup by ISRC should take the median of its rows, not the first.

## Key, rate limits and terms

- **Key.** None. The introduction says "No API access key or authentication required", and
  every request in this run was anonymous.
- **Rate limits.** Not published. The rate limiting page says only that limits are "configured
  internally", that going over gives `429 Too Many Requests` with a `Retry-After` header, and
  that clients should cache. In this run, 221 measured requests at one per 1.2 seconds and one
  burst of 12 at once got no `429`. No rate limit header came back on a `200`. The real ceiling
  is unknown, and it was not probed harder out of courtesy.
- **Latency.** Median 1.2 seconds per request from Brazil, 7.2 seconds at worst. Answers carry
  `Cache-Control: no-store`.
- **Terms of service** (last updated 2026-05-25). Free "for both personal and commercial
  projects". Users agree not to "abuse, overload, or disrupt the API", and an IP may be limited
  or blocked without notice. Data is provided as is, with no accuracy or uptime promise. The API
  may be changed or shut down "at any time, for any reason, and without prior notice". The terms
  say nothing against storing answers, and the rate limiting page asks for caching. They also
  say the track metadata comes from Spotify and that complying with third-party terms is the
  user's responsibility; Wave would store only the eleven numbers, not that metadata.
- **Who runs it.** The pages are written in the first person by one maintainer, who says in the
  changelog (2026-05-25) that they "returned to actively maintaining" it after a pause. Nothing
  says how it is funded.

## From a YT Music song to a ReccoBeats track

A YT Music song has a video id, title, artists, album and length. It has no Spotify id and no
ISRC, so one of three matches is needed.

| Path          | Steps                                                       | What Wave already has                                                                                                                                                                                                 | Needs                                  |
| ------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Spotify id    | Spotify `searchTracks` per song, then `/audio-features`     | `lookUpSpotifyTrack` and `spotifyShareMatch` (Sharing a song, Sharing playlists): one search per song as the signed-in account, first result that is the same recording                                               | A Spotify sign-in                      |
| ISRC          | Deezer track search per song, then `/audio-features`        | Deezer's search rows carry `isrc`. Core reads them for playlist release dates (`releaseLookup.ts`) and already matches streamed songs on Deezer for their genre (`lyricsAndGenre.ts`, Streamed genres)                | Keeping the ISRC of a match Wave makes |
| Title, artist | `/track/search` per song, then `/audio-features` by its ids | The same-recording rules imports and sharing use (title, artists, edition notes, length within 3 seconds; `recordingMatches`, `spotifyYtMatch`), which fit ReccoBeats' rows since they have title, artists and length | Nothing else                           |

- **Spotify id** is the weakest fit. It works only for an owner who signed in to Spotify, it
  sends one web player search per song through endpoints Spotify can change, and
  `docs/spotify-account.md` records that Spotify's token endpoint says such use is not permitted
  under its developer terms. The lookup itself works: all 222 tracks the search found were also
  found by their Spotify id.
- **ISRC** costs one ReccoBeats request per 40 songs once the ISRCs are known. The streamed
  genre lookup already finds the Deezer track for a streamed song when Fix songs online is on;
  today it keeps the genre and not the ISRC that sits in the same row. Its weakness is that
  Deezer's ISRC is sometimes another edition's: 7 songs had data on ReccoBeats under a different
  ISRC than the one Deezer gave.
- **Title and artist** needs no other service but costs one search per song, and the artist
  filter sometimes returns nothing (above).

Either path would make ReccoBeats a new destination in `docs/spec.md` › Network: the phone
would send it song titles and artist names, or ISRCs. There is no key, so nothing has to go
through the sync Worker.

## Coverage on 234 songs

The sample is 234 well-known songs picked by hand: 149 international and 85 Brazilian. Each was
looked up two ways: by the ISRC of its Deezer match, and by ReccoBeats' own search with the
title and artist, taking a row with the same title and artist (preferring one within 3 seconds
of Deezer's length).

| Genre                            | Songs | ISRC from Deezer | Features by ISRC | Features by search | Either path |
| -------------------------------- | ----- | ---------------- | ---------------- | ------------------ | ----------- |
| Pop                              | 22    | 22               | 22               | 21                 | 22          |
| Rock                             | 22    | 22               | 22               | 21                 | 22          |
| Metal and heavy                  | 12    | 11               | 11               | 12                 | 12          |
| Hip hop                          | 15    | 15               | 15               | 13                 | 15          |
| Electronic                       | 16    | 16               | 16               | 16                 | 16          |
| Soul, R&B, funk, disco           | 13    | 13               | 12               | 13                 | 13          |
| Jazz                             | 8     | 8                | 8                | 8                  | 8           |
| Classical, piano, ambient        | 10    | 10               | 8                | 10                 | 10          |
| Country and folk                 | 11    | 11               | 11               | 10                 | 11          |
| Latin                            | 11    | 11               | 10               | 11                 | 11          |
| K-pop and J-pop                  | 5     | 4                | 3                | 4                  | 5           |
| Reggae                           | 4     | 4                | 4                | 4                  | 4           |
| MPB and bossa nova               | 18    | 17               | 16               | 17                 | 17          |
| Samba and pagode                 | 14    | 13               | 13               | 13                 | 14          |
| Sertanejo                        | 14    | 14               | 14               | 14                 | 14          |
| Brazilian funk                   | 13    | 12               | 12               | 13                 | 13          |
| Brazilian rock                   | 16    | 16               | 16               | 14                 | 16          |
| Forró, axé, Brazilian rap, other | 10    | 9                | 7                | 8                  | 9           |
| **Brazilian**                    | 85    | 81               | 78 (92%)         | 79 (93%)           | 83 (98%)    |
| **Not Brazilian**                | 149   | 147              | 142 (95%)        | 143 (96%)          | 149 (100%)  |
| **All**                          | 234   | 228              | 220 (94%)        | 222 (95%)          | 232 (99%)   |

- Every track ReccoBeats knew had features. No track was found without them.
- The two songs with no answer either way were "Garota de Ipanema" (Tom Jobim) and "Xote das
  Meninas" (Luiz Gonzaga). ReccoBeats has both titles, but the search returned only covers and
  the script's Deezer match was missing or another edition. A better matcher would likely find
  them; that was not tried.
- Of the 222 search matches, 183 were the first result, 193 were within 3 seconds of Deezer's
  length, and 158 had the ISRC Deezer gave.
- **This sample flatters ReccoBeats.** These are famous songs (median ReccoBeats popularity 61
  of 100). The candidate catalog also holds deep cuts, and coverage of obscure songs was not
  measured.

### New releases are missing

A second sample used Spotify track ids taken from public playlists' embed pages (the page
`docs/spotify-playlists.md` describes, no token used), looked up by exact Spotify id.

| Playlist (read on 2026-11-20)                     | Songs | With features |
| ------------------------------------------------- | ----- | ------------- |
| Top 500 Most Streamed Songs on Spotify, first 100 | 100   | 86 (86%)      |
| Top 50 - Global                                   | 50    | 33 (66%)      |
| Top 50 - USA                                      | 50    | 31 (62%)      |
| Today's Top Hits                                  | 50    | 21 (42%)      |
| Top 50 - Brazil                                   | 50    | 5 (10%)       |
| Top Brasil                                        | 50    | 4 (8%)        |

- **The catalog stops in late July 2026.** Among the 70 chart tracks ReccoBeats knew, the newest
  release date it reported was 2026-07-24, four months before this research. The search
  endpoint's changelog entry is dated 2026-07-22, and nothing is logged after it. Whether new
  songs are still being added is unknown.
- **The Brazilian gap is more than freshness.** Dating the 45 missing Top 50 - Brazil songs with
  Deezer's album release dates (its first search result, so approximate) put 21 after 2026-07-24 and 24 before it. Recent Brazilian
  releases (live sertanejo, funk) are thin even when they predate the cutoff. On Top 50 - Global
  it was 9 after and 8 before.
- These lookups were by one exact Spotify id. Another Spotify entry of the same recording may be
  in ReccoBeats; that was measured only on the 234-song sample, where the second path raised
  coverage from 94% to 99%.

## Do the numbers match the music?

Not verified by listening. For each property, songs whose character is widely known were
listed, and the number was checked against a threshold (high is 0.6 or more, low is 0.4 or
less). The expectations are the researcher's knowledge of famous recordings, so read this as a
plausibility check.

| Property checked                | Songs | Agree | Examples that agree                                                           | Examples that don't                                                                                               |
| ------------------------------- | ----- | ----- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Energy high (energetic songs)   | 14    | 14    | Raining Blood 0.99, Sandstorm 0.96, Mulher de Fases 0.97, Balada 0.95         | None                                                                                                              |
| Energy low (calm songs)         | 16    | 16    | Spiegel im Spiegel 0.00, Clair de Lune 0.07, O Leãozinho 0.16, Travessia 0.29 | None                                                                                                              |
| Valence high (happy songs)      | 15    | 14    | Happy 0.97, September 0.98, Vou Festejar 0.92, Deixa a Vida Me Levar 0.81     | Mas Que Nada 0.58                                                                                                 |
| Valence low (sad or dark songs) | 22    | 10    | Creep 0.10, Skinny Love 0.11, Hurt 0.15, Epitáfio 0.26, Evidências 0.33       | As Rosas Não Falam 0.81, Negro Drama 0.80, Diário de um Detento 0.77, Pais e Filhos 0.69, N.Y. State of Mind 0.89 |
| Instrumentalness high           | 18    | 13    | An Ending (Ascent) 0.98, River Flows In You 0.98, Strobe 0.93                 | So What 0.00, Take Five 0.00, Blue in Green 0.00, Spiegel im Spiegel 0.01                                         |

- **Energy is reliable** at both ends, across genres and for Brazilian music.
- **High valence is reliable; low valence is not.** Of the 22 sad or dark songs, 8 of the 10 in
  English scored low but only 2 of the 12 Brazilian ones did. Valence follows the arrangement
  (major key, steady groove), and Brazilian music often sets sad words to a bright arrangement:
  "Todo Mundo Vai Sofrer" 0.58, "Infiel" 0.58, "Canto das Três Raças" 0.66, "Trem das Onze"
  0.90. A filter built on low valence would miss most of what a Brazilian listener calls sad.
- **Instrumentalness** works for piano, ambient and electronic music (13 of 14) and fails for
  instrumental jazz (0 of 4). Two songs with vocals scored above 0.5 ("Let It Be" 0.54, "De
  Música Ligera" 0.61).
- **Acousticness and danceability** look plausible (piano pieces 0.93 to 0.99, metal 0.00;
  Brazilian funk 0.78 to 0.98 danceable) but were not checked song by song.

### Melancholic rule check (#1273, 2026-11-21)

I checked five low-valence songs from the sample against a conjunctive rule: energy at or below
0.40, valence at or below 0.40, minor mode, and acousticness at or above 0.50. For each song I
resolved its exact Deezer track and ISRC, then queried ReccoBeats by ISRC. I took the median of
all returned rows for each feature, as the cache will. Requests were anonymous and spaced at
least 1.25 seconds apart. These are the same plausibility checks as the table above, not listening
tests.

| Song                             | ISRC         | Rows | Energy | Valence | Minor mode | Acousticness | Rule |
| -------------------------------- | ------------ | ---: | -----: | ------: | ---------- | -----------: | ---- |
| Creep, Radiohead                 | GBAYE9200070 |    7 |  0.430 |   0.104 | No         |        0.010 | No   |
| Skinny Love, Bon Iver            | US38Y0811503 |    1 |  0.263 |   0.109 | Yes        |        0.845 | Yes  |
| Hurt, Johnny Cash                | USDJ20200650 |    3 |  0.378 |   0.149 | Yes        |        0.719 | Yes  |
| Epitáfio, Titãs                  | BRAMD0100815 |    9 |  0.612 |   0.261 | No         |        0.481 | No   |
| Evidências, Chitãozinho & Xororó | BRMCA9000007 |    8 |  0.446 |   0.330 | No         |        0.710 | No   |

Minor mode alone matched 2 of 5 melancholic examples. The full rule matched 2 of 5. It matched
none of ten upbeat or energetic controls: Raining Blood, Sandstorm, Mulher de Fases, Balada,
Happy, September, Vou Festejar, Deixa a Vida Me Levar, I Will Survive and Don't Stop Me Now.
Minor mode appeared in 5 of those 10 controls, so it also fails as a standalone signal there.
The false-positive bar passes, but the rule misses three melancholic songs and fails the required
4 of 5 recall. Melancholic does not ship. ReccoBeats mode also remains weak evidence on its own;
the research's earlier 14% disagreement across repeated ISRC rows is another reason not to use
it as a standalone mood label.

### Tempo against Deezer's BPM

Deezer's `/track/<id>` gives a `bpm` for many songs. It is another estimate, not ground truth,
but it is independent. It was above zero for 150 of the songs with ReccoBeats features.

| ReccoBeats tempo against Deezer's BPM            | Songs | Share |
| ------------------------------------------------ | ----- | ----- |
| Within 4%                                        | 108   | 72%   |
| Double, half or one and a half times (within 4%) | 28    | 19%   |
| Unrelated                                        | 14    | 9%    |

"Take On Me" came back at 84 where Deezer says 169, "Tempo Perdido" at 186 against 93,
"Tennessee Whiskey" at 49 against 152. More than a quarter of the songs got a tempo Deezer
disagrees with, so a filter on raw tempo would misplace many of them. Energy carries the same intent (fast and driving against slow and calm) with far
fewer errors.

### The extraction endpoint

`POST /v1/analysis/audio-features` takes an audio clip and returns nine features (no key, no
mode), with no key and in under a second. It was tried with Deezer's public 30-second previews
of 10 songs; all 10 answered. For the 8 that also had catalog values, energy was within 0.2 of
the catalog for all 8, valence was more than 0.2 away for 3, and tempo agreed for 2. So a
30-second clip gives a usable energy and little else. It could fill in a new release ReccoBeats
doesn't have, at the price of downloading a 480 KB preview and uploading it per song. Whether
Deezer's terms allow using previews this way was not checked.

## Requests for a batch of 10, and caching

| Path                                 | ReccoBeats requests                              | Other requests                                                                                                 |
| ------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Ids already known (Spotify id, ISRC) | 1                                                | None                                                                                                           |
| ISRC, nothing known yet              | 1                                                | Up to 10 Deezer searches (none where the streamed genre lookup already matched the song and its ISRC was kept) |
| ReccoBeats search                    | 11                                               | None                                                                                                           |
| ISRC first, search for the misses    | 1, plus 1 per miss and 1 more for their features | As the ISRC path                                                                                               |

One features request holds 40 ids, so a batch of 10 is one request and four batches fit in one.
At 1.2 seconds median per request, 11 sequential requests take about 13 seconds; 12 features
requests sent at once all answered in about a second. Neither belongs inside the 8-second deadline a
Magic Queue's radios have, and a batch can't wait on a free service with no uptime promise.

**The results can be cached with the candidate catalog, and should be.** The features describe
a recording and don't change; the documentation asks clients to cache and the terms don't
forbid storing. The shape that fits Wave is the one streamed genres use: eleven numbers kept on
the phone against the song's video id, a completed lookup with no match kept too so it isn't
asked again, filled in on free turns as radios and artist pages feed the catalog, never synced.
A full 5,000-song catalog is 125 features requests once ids are known. A batch then ranks with
what is already there, and a song with no data is neutral, as the parent spec says.

One thing to decide when building: a song with no data today may get data later (ReccoBeats may
catch up on new releases), so "no match" should expire, where a match never needs to.

## Which mood filters the data supports

| Filter          | Built from                                           | Support                                                                                                    |
| --------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Energetic       | High energy                                          | **Well.** 14 of 14, every genre                                                                            |
| Relaxing        | Low energy, helped by high acousticness              | **Well.** 16 of 16                                                                                         |
| Upbeat          | High valence with medium or high energy              | **Well.** 14 of 15, Brazilian songs included                                                               |
| Sad             | Low valence                                          | **Poorly.** 10 of 22, and 2 of 12 for Brazilian songs                                                      |
| Ambient         | High instrumentalness, low energy, high acousticness | **Partly.** Right for piano and ambient pieces (13 of 14); how many catalog songs would qualify is unknown |
| Focus           | High instrumentalness, low speechiness, low energy   | **Partly.** Misses instrumental jazz entirely (0 of 4)                                                     |
| By tempo or BPM | Tempo                                                | **Poorly.** 72% agree with Deezer; one in five is doubled or halved                                        |
| Major or minor  | Mode                                                 | **Unknown.** Present for every song, unchecked, and rows of one recording disagree for 14% of songs        |

Every filter is weak for songs released in the last four months, which is exactly what DJ's New
releases filter raises. With both on, most songs would have no mood data and rank as neutral.

## Other sources found along the way

- **Deezer's `bpm` and `gain`** (`api.deezer.com/track/<id>`, keyless, already a Wave provider).
  A BPM for about two songs in three. It gives tempo only, and one more request per song.
- **ReccoBeats' extraction endpoint** (above): energy for a song the catalog lacks, from a
  30-second clip.
- **ReccoBeats' recommendation endpoint** takes target valence, energy, tempo and the rest as
  parameters. It recommends from ReccoBeats' catalog, not Wave's candidate catalog, so it
  doesn't fit a Magic Queue. Not tested.
- **Core's genre styles** (`genreStyle`), already named in #1261 as the fallback. They need no
  request and cover new releases; they tell Heavy from Soft / acoustic but not a sad song from a
  happy one within a style.
- **Spotify's Audio Features and AcousticBrainz** were taken as closed, as the ticket says. That
  was not rechecked.
- **Not evaluated:** tags from Last.fm (would need a key held by the sync Worker) and analysing
  audio on the phone. Neither was looked at; they are named only so the next research knows they
  were not ruled out.

## What could not be verified

- How any song actually sounds; the spot check rests on general knowledge and Deezer's BPM.
- The rate limit's real ceiling, and whether it is per IP.
- Whether ReccoBeats still adds new releases, and how far behind it usually runs. Only today's
  state was seen: nothing newer than 2026-07-24.
- Coverage of obscure songs, and of the owner's own candidate catalog (deliberately not read).
- Whether `key` and `mode` are correct.
- Whether very large ISRC answers are ever cut short.
- Whether the numbers match Spotify's former Audio Features.
- The Spotify id path end to end: no Spotify account was used, so the ids came from public
  playlist pages and from ReccoBeats' own rows, not from Wave's `searchTracks` match.

## Recommendation

**Build on ReccoBeats, for three filters only: Energetic, Relaxing and Upbeat.** Leave Sad,
Ambient, Focus and anything by tempo out.

- **Why these three.** Energy agreed with every song checked at both ends, and high valence with
  14 of 15. Coverage of established music was 99%, Brazilian music included. The owner's bar is
  "rather not have them than a mediocre version", and these three clear it for catalog music.
- **Why not Sad.** Low valence missed 10 of 12 sad Brazilian songs. A Sad filter that plays
  upbeat pagode is the mediocre version. No source found here fixes that, since it would take the
  lyrics or human tags.
- **Why not Ambient and Focus.** The signal behind them fails on instrumental jazz, and
  nothing here says how many songs of a candidate catalog would qualify. They can be revisited
  once the cached data shows that.
- **How.** Match by the ISRC of the Deezer track Wave already finds for streamed songs, take the
  median of the rows per ISRC, and fall back to ReccoBeats' search for the misses. Cache the
  numbers on the phone against the video id, beside the candidate catalog, filled on free turns.
  Rank with what is cached; a song with no data is neutral; never wait for ReccoBeats in a batch.
- **Know the limits before shipping.** Songs from the last four months have no data, so a mood
  filter does little together with New releases, and little for an owner who mostly plays this
  year's Brazilian chart. The service is one person's free API with no uptime promise that can
  close without notice: the cache keeps the filters working for songs already seen if it does,
  and genre styles remain the fallback for the rest.

If the new-release gap is unacceptable, the answer is to not build mood filters yet. No other
source found here covers new releases with better data.
