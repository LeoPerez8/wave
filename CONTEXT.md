# wave

wave is an Android music player for the music files on the user's own phone. It pairs BlackPlayer EX's features with the iPhone Apple Music app's UI.

## Language

### References

**Feature reference**:
BlackPlayer EX, the Android player whose features wave builds. A feature is in scope only if the Feature reference has it.
_Avoid_: BlackPlayer clone

**UI reference**:
The current iPhone Apple Music app, whose screen structure, navigation and motion wave copies, without Apple's name, icons or artwork.
_Avoid_: iTunes (the original idea, since replaced)

### Music

**Library**:
Every music file on the phone that wave knows about. There is no catalog or streaming content: nothing in wave exists outside the Library.
_Avoid_: collection, catalog

**Track**:
One playable piece of music in the Library, usually one audio file.
_Avoid_: song, file

**Credit**:
The artist tag of a Track as written, such as "Ariana Grande, Doja Cat". A credit names one or more Artists. Rows show the credit as written. A tag with several values gives a credit per value, each naming its own Artists, and rows show them joined with commas.
_Avoid_: artist string

**Artist**:
One person or group in the Library. A Track belongs to every Artist its credit names, so a collaboration counts for each of them and shows on each of their pages.
_Avoid_: performer

**Primary artist**:
The first Artist a credit names. Stats credits a Track's plays to it. Links to a Track's or album's Artists (Go to Artist, Now Playing's artist) don't pick it for you: credited to several, they open the artist choice.

**Artist choice**:
The card Go to Artist opens on a Track or album credited to several Artists: each credited Artist in credit order, the page you're on left out. Picking one opens their page. A streamed song credited to several artists opens it too, its artists being names: those the Library has are its Artists, the others open the YouTube Music artist page.

**Album artist**:
The Artist an album is filed under: the first Artist its album artist credit names. The album also shows under the other credited Artists' Appears on.
