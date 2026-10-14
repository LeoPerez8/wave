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

# Replace the low-quality songs from Soulseek (#161)

A one-off job for the PC. `replace.ts` takes each song on `C:\Meus arquivos\Musicas-to-replace.txt`
and looks on Soulseek for a genuine 320 kbps copy of the same recording. The new audio goes
in at the same path, so Wave sees the same Track with its plays, favorites and playlist places.
The old file's tags and artwork stay, and the peer's are dropped.

It works before and after the organize job. It looks for each list entry in this order:

1. its new path in `Musicas-organize-log.jsonl`, when the log exists;
2. its old path, `<genre>/<Artist - Title>.mp3`;
3. its tags: the one file whose artist and title make up the old name. YouTube-style names
   ("Paramore - Decode (HQ Audio)", "2026 - LAGUM") are matched by their words. When two
   files fit, the job reports both paths and skips the song rather than guess.

## What you need

- Node 22.18 or newer. Run every command from the repo root.
- Python with numpy, miniaudio and mutagen (`pip install numpy miniaudio mutagen`).
- A JDK 17 or newer in `JAVA_HOME` (`C:\tools\jdk-17.0.20.1+1` on the PC). The job compiles
  Wave's own Soulseek client with the Kotlin compiler that Gradle cached for the Android build.
  That happens once and takes a few seconds; the classes go to `%TEMP%\wave-pc-soulseek`.
- Syncthing running with the folder in sync, for `--apply`, the same check as the organize job.
- A Soulseek account. The job reads `SOULSEEK_USERNAME` and `SOULSEEK_PASSWORD`, and asks for
  whichever is missing (the password isn't echoed). It keeps the login in memory only, never in
  a file, the log or the report.

## Commands

```powershell
$env:JAVA_HOME = "C:\tools\jdk-17.0.20.1+1"
node scripts/music-folder/replace.ts                    # dry run: finds and measures, changes nothing
node scripts/music-folder/replace.ts --apply --limit 5  # try the first 5 songs
node scripts/music-folder/replace.ts --apply            # the rest; Ctrl+C is safe, run it again to resume
node scripts/music-folder/replace.ts --apply --retry    # try the rejected ones again later
```

The dry run writes `Musicas-replace-report.txt` beside the folder. It lists every entry with
its path now, its current cutoff and the Soulseek search it will run. Other options:
`--folder`, `--max-peers <n>` (peer files tried per song, 10 by default), `--ignore-device
<name>` and `--syncthing-config`, as in the organize job.

Afterwards, rebuild the quality report with the same measurement and check that the replaced
songs read OK:

```powershell
python -I scripts/music-folder/audio.py report "C:\Meus arquivos\Musicas" "C:\Meus arquivos\Musicas-quality-report.csv"
```

If you replace before organizing, rebuild the quality report before `--apply-moves` too. The
organize job picks which duplicate to keep by the report's cutoff.

## What makes a copy acceptable

The checks run in this order, and the first one that fails is recorded as the reason:

1. Core's Soulseek matching picks the peers (`soulseekQuery`, `soulseekCandidates`): the same
   title, main artist and edition (no live, remix, edit or other remaster), 320 kbps claimed,
   and a claimed duration within 3 s. When a peer's file is rejected, Core picks among the
   others, up to `--max-peers`.
2. Wave's client downloads it and checks every MPEG frame (`Mp3Validation.kt`): the exact byte
   count, MPEG-1 Layer III, 320 kbps in every frame, one sample rate.
3. `audio.py probe` checks the frames again, so fake peers in the tests go through the same rule.
4. The measured duration is within 3 s of the old file's.
5. Core's `soulseekReceivedMatches`: the file's own tags don't name another recording.
6. The spectrum reaches 19.5 kHz, measured as `Musicas-quality-report.csv` was: the middle 60 s
   decoded to mono, 4096-point Hann windows, the highest 250 Hz band edge with a 10 dB cliff
   across 1 kHz either side. No cliff counts as OK, as in the report. The dry run reproduced
   the report's cutoff for all 352 listed songs.

A file that already passes (the copy kept from a duplicate, say) is left alone.

## Safety

- The download lands in `Musicas-replace-work\`, outside the music folder.
- `audio.py replace` writes the old file's ID3v2 tag, the new audio and the old APEv2/ID3v1
  tags to `~syncthing~<name>.tmp` beside the song. Syncthing ignores that name. The job reads
  the copy back and checks its audio and tag bytes. It copies the old file to
  `Musicas-replace-originals\<path>`, and only then `os.replace` swaps the new file in. If the
  song changed since it was measured, the job writes nothing over it.
- Wave's client shares nothing: it advertises 0 folders and 0 files, returns empty browse
  results, and refuses upload requests.
- Windows may ask whether Java can use the network. Allow it on private networks. If you deny
  it, peers can't connect to the PC, and fewer of them can send.

## The log and resuming

Each song tried appends one JSON line to `Musicas-replace-log.jsonl`, keyed by its list line:
`replaced` (path, new cutoff, peer file, every peer tried before with why), `already-good`,
`rejected` (every peer tried and why), `no-candidates` or `failed` (offline, say). A run skips
songs that are `replaced` or `already-good`, and `rejected` and `no-candidates` ones unless you
pass `--retry`. `failed` songs are tried again. The report is rewritten after every song.

# Tests

```sh
node --test "scripts/music-folder/*.test.ts"
```

`replace-song.test.ts` replaces a song in place on throwaway MP3s, with fake peers instead of
Soulseek. It needs Python with imageio-ffmpeg as well, to encode the files. `soulseek.test.ts`
runs Wave's client through the bridge against a fake server on localhost and needs
`JAVA_HOME`. Each skips when its tools are missing.
