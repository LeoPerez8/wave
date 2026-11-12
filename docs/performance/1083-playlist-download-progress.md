# Playlist download progress in the Playlists list

The row reads one primitive line by playlist id. One reader follows the journal
for all visible rows. It stops when its last visible subscriber leaves and drops
its membership cache. Opening a playlist page is never part of reading progress.

Desktop checks:

- Among 2,000 streamed entries, the membership query returns the one entry
  belonging to the journal song, using the existing video index.
- Unsearched entries and failed searches use the new listed-title index. It is
  added on upgrade without changing the entries.
- Two visible playlists share one membership read. Byte progress causes no
  further read, no count rebuild, and no notification to an idle row.
- Saving, retrying and cancelling update only the lines that changed. A Library
  edit during a read discards its stale answer. Hidden screens follow no source.

These checks do not measure frame time. Before and after phone runs are still
needed, with many playlists and a large download queue, for the opening and
scrolling budgets in `712-budgets.md`. Check List, Grid and Large Cards, including
a narrow card's ellipsis, in English and Brazilian Portuguese. Start downloads
from the playlist menu, Retry Failed and selection, then compare each row with
its page head through saving, completion and cancellation. Run two playlists
together, including a shared song. Record device, build commit and timings here.
