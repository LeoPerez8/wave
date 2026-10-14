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
