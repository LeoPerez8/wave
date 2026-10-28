These are synthetic fixtures following Genius's documented response envelopes
(https://docs.genius.com/#search-h2 and https://docs.genius.com/#songs-h2).
The description is invented, not a quotation from Genius.
An unauthenticated search on 2026-10-28 returned HTTP 401:
"This call requires an access_token." No token was available to capture real replies.
Song requests use text_format=plain; a missing description may be "?".
search.json also holds a Genius translation page (its artist is a "Genius Traducciones"
account, never the song's) and a shared credit, whose `artist_names` names both artists
while `primary_artist` names the first.
