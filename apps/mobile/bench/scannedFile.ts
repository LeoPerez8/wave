/** A new file as the scanner reads it, which the scan benches save in batches. */
import { normalizeTrack } from "@wave/core";

import type { IndexedTrack } from "@wave/client";

/** Where the scanned files live. */
export const ROOT = "/storage/emulated/0/Music";

/** File [n] of a synthetic Library: 300 artists, 900 albums, 25 genres. */
export const scannedFile = (n: number, artist = `Artist ${n % 300}`): IndexedTrack => ({
  ...normalizeTrack({
    path: `${ROOT}/Artist ${n % 300}/Album ${n % 900}/${n} Song ${n}.flac`,
    title: `Song ${n}`,
    artist,
    album: `Album ${n % 900}`,
    albumArtist: `Artist ${n % 300}`,
    trackNumber: String((n % 12) + 1),
    genre: `Genre ${n % 25}`,
    year: String(1970 + (n % 50)),
    durationMs: 180_000 + (n % 120_000),
  }),
  sizeBytes: 20_000_000 + n,
  modifiedAt: 1_700_000_000_000 + n,
  sampleRate: 44_100,
  bitrateKbps: 900,
  artworkHash: null,
  hasLyrics: false,
  explicit: "unknown",
});
