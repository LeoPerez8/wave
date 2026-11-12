# Album download progress in album lists

Album cards and rows read one primitive line by album id from the reader the
Playlists list uses (`1083-playlist-download-progress.md`). Nothing new follows
the journal, and with no download running a card only subscribes.

Desktop checks:

- The membership read adds one query for all albums: the saved files' albums,
  by `tracks.path`, which is unique and indexed. It runs no query when no job
  has a saved file, and none at all with an empty journal.
- Which songs are an album's is worked out in memory from the journal's jobs,
  once per counted change. Byte ticks reuse it.

These checks do not measure frame time. Phone runs are still needed, before and
after, with a large Library and a long download queue: open and scroll Albums
and an artist page against the budgets in `712-budgets.md`. Compare each card
with its album page head through saving, completion and Cancel Album Download,
with two albums downloading, in English and Brazilian Portuguese, and check a
narrow card's ellipsis. Record device, build commit and timings here.
