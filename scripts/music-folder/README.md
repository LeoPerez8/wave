# Organize the music folder (#159)

A one-off job for the PC. It moves `C:\Meus arquivos\Musicas` from genre folders into Wave's
tree, `<album artist>/<album>/<NN> <title>.mp3`. Names come from Core's `ytDownloadTarget`,
the same function downloads use. Syncthing then carries the result to the phone.

You need Node 22.18 or newer, Python with mutagen (`pip install mutagen`) and Syncthing
running. Run every command from the repo root.

## Phases

Without an `--apply-…` flag the job is a dry run. It writes the plan to
`C:\Meus arquivos\Musicas-organize-plan.txt` and changes nothing.

```sh
node scripts/music-folder/organize.ts                       # dry run: read the plan
node scripts/music-folder/organize.ts --apply-genres        # phase a
node scripts/music-folder/organize.ts --apply-moves         # phase b
node scripts/music-folder/organize.ts --delete-blackplayer  # phase c
```

1. **Phase a: genres.** Every song in a genre folder that has no genre gets the folder's name
   as its genre. The tag is written in place. Then wait until Syncthing shows the phone
   up to date, let Wave scan, and check that the Genres list shows the new genres.
2. **Phase b: moves.** Songs move into the tree with their bytes untouched. Duplicates are
   deleted (the copy outside `.thumbnails` wins, then the higher cutoff in
   `Musicas-quality-report.csv`). Then `.thumbnails`, `.stfolder.removed-*`, the screenshot
   and the emptied genre folders go. This phase refuses to run while any song in a genre
   folder still has no genre. Afterwards, sync, let Wave scan, and compare Stats › All time,
   Most Played, favorites and playlists with what they showed before.
3. **Phase c: BlackPlayer.** Run this only once the BlackPlayer import has been checked in
   Wave on the phone. It deletes the `BlackPlayer*` folders.

`.stfolder` is never touched.

## Safety

- Every apply asks Syncthing's REST API first, using the API key in
  `%LOCALAPPDATA%\Syncthing\config.xml`. It stops if Syncthing can't be reached, or if any
  folder at this path is paused, busy, has errors, or isn't at 100% on every device.
  `--ignore-device <name>` (repeatable) leaves a device out of the check. Ygor's devices share
  the folder as "Músicas Ygor", for example. `--syncthing-config <path>` points at another
  config.
- A genre is written to a `~syncthing~<name>.tmp` copy beside the file, which Syncthing
  ignores. The copy replaces the file only if the audio between the tags is byte for byte the
  same and the genre reads back.
- A move never overwrites a file. A file whose size changed since it was read is skipped.
- Songs that differ but would get the same name are numbered (`Intro (2).mp3`), never deleted.
  The same song kept under different tags (another album, say) is listed under "Look-alikes"
  in the plan, and both copies are kept.

## The log

Each apply appends one JSON object per action to `C:\Meus arquivos\Musicas-organize-log.jsonl`.
Paths are relative to the music folder and separated by `/`. A failed action has an `error`
field.

```json
{"at":"…","phase":"genre","path":"Rock/A - B.mp3","genre":"Rock","sizeBefore":1,"sizeAfter":1}
{"at":"…","phase":"move","from":"Rock/A - B.mp3","to":"A/Album/03 B.mp3","sizeBytes":1}
{"at":"…","phase":"delete-duplicate","path":"Pop/A - B.mp3","keptAs":"A/Album/03 B.mp3","sizeBytes":1}
{"at":"…","phase":"cleanup","path":".thumbnails/"}
{"at":"…","phase":"delete-blackplayer","path":"BlackPlayer/"}
```

To find a song's new path from its old one, look for the `move` entry whose `from` matches,
ignoring case. If the song was a deleted duplicate, use the `keptAs` of its
`delete-duplicate` entry.

## Tests

```sh
node --test "scripts/music-folder/*.test.ts"
```
