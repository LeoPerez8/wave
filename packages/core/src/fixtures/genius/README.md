These are synthetic fixtures following Genius's documented response envelopes
(https://docs.genius.com/#search-h2 and https://docs.genius.com/#songs-h2).
The description is invented, not a quotation from Genius.
An unauthenticated search on 2026-10-28 returned HTTP 401:
"This call requires an access_token." No token was available to capture real replies.
Song requests use text_format=plain; a missing description may be "?".
search.json also holds a Genius translation page (its artist is a "Genius Traducciones"
account, never the song's) and a shared credit, whose `artist_names` names both artists
while `primary_artist` names the first.

referents-1.json and referents-2.json are two pages of `/referents?song_id=10356&text_format=plain`,
synthetic too, shaped as Genius documents referents (https://docs.genius.com/#referents-h2):
each referent's `fragment`, `is_description`, `song_id`, and its `annotations` with `body.plain`
and `authors[].user`. The first page holds the song's description referent (`is_description`),
which annotations leave out; the second an annotation without text and an unreviewed one
(`state` `pending`, its referent's `classification` `unreviewed`), as Genius marks annotations its
editors haven't accepted yet. An unauthenticated
`/referents` request on 2026-10-28 also returned HTTP 401, so no real reply could be captured.
The fragments differ from the lyrics the way Genius's text differs from LRCLIB's: curly
apostrophes, an em dash, accents, case, a bracketed ad-lib, and one fragment from a verse the
lyrics lack.

lrclib.json is an LRCLIB `/api/get` reply (`syncedLyrics`, `plainLyrics`) for the same invented
song: its lyrics are made up, with a repeated chorus, an ad-lib and an instrumental line.
