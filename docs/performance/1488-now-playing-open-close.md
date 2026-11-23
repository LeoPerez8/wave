# #1488 Now Playing opens and closes at once

Ticket #1488, part of #1481. Branch `fix/1488-now-playing-open-close`.

## Cause of the slow close

A long press on a button slot of Now Playing starts edit mode, which takes the pressed view away
while the finger is still down. Android then never sends that touch's end to JS. The tap timing
kept the long press as the touch still under way, so the Back that left edit mode and the Back that
closed Now Playing were both timed from the long press, seconds earlier. The close logged a
response of 5.4 s although the sheet closed at once.

Android's Back now counts from itself when JS still holds a touch whose end it never heard, and
the app log names the age of that touch:
`Back pressed 3.3 s after a touch whose end Wave never heard: Back counts from itself`.

## Cause of the Queue's render blocks

- Legend List's default anchor (Android's `maintainVisibleContentPosition`) held a long Up Next's
  end in place as the Queue first showed, so the list jumped to its last rows and drew every row
  twice. Up Next's list now keeps no anchor; it still opens at its start, placed by `upNextScroll`.
- The Queue mounts hidden once Now Playing has settled, but Legend List mounts its rows only once
  shown, all of a screenful in one task. Up Next now mounts its bar and four songs, then four more a
  frame until the screen and the draw distance under it are full (Core's `listMounts`), then the
  rest, which the list leaves unmounted below the screen.

## Emulator runs

Emulator `emulator-5560`, perf builds repacked from the release APK
(`EXPO_PUBLIC_WAVE_PERF=1`), the 3,000-song seed (`scripts/perf/seed.ts`), offline. The Archive
playlist plays from its first song, so Up Next holds 3,857 songs. Each run opens Now Playing, shows
the Queue for the first time, shows it again, then closes and opens Now Playing three times. A
second script opens Now Playing, long-presses the Lyrics slot into edit mode, then presses Back
twice. Before is the integration branch's build; after is this branch.

Before:

```
Slow Now Playing open to Now Playing from /: response 33 ms, first frame 95 ms, settled 1.2 s
JS blocked 126 ms on / by rendering UpNextList
JS blocked 51 ms on / by rendering UpNextList
Slow Queue to Queue from Now Playing: response 56 ms, first frame 169 ms, settled 169 ms; longest JS block 126 ms
JS blocked 58 ms on / by rendering NowPlayingSheet
Slow Now Playing close to Now Playing closed from Now Playing: response 5.4 s, first frame 5.4 s, settled 6.1 s
```

After (two runs):

```
Slow Now Playing open to Now Playing from /: response 40 ms, first frame 86 ms, settled 893 ms
Slow Queue to Queue from Now Playing: response 22 ms, first frame 60 ms, settled 60 ms; longest JS block 0 ms
Back pressed 3.3 s after a touch whose end Wave never heard: Back counts from itself
Slow Now Playing open to Now Playing from /: response 42 ms, first frame 195 ms, settled 863 ms
Slow Queue to Queue from Now Playing: response 44 ms, first frame 70 ms, settled 70 ms; longest JS block 0 ms
Slow Now Playing open to Now Playing from /: response 19 ms, first frame 51 ms, settled 710 ms
```

The after runs logged no render block on open, close or the Queue, and the close after edit mode
logged no slow close. The first frame of an open, and of the Queue's first showing, is still above
50 ms on the emulator with no JS block, which is native drawing and is left to the phone check.
