/**
 * An audio file's tags as the shared Kotlin reads them (`RawTags.toMap` in
 * `packages/kotlin-shared`), before Core interprets them: the same fields the phone's scan gets,
 * so both devices build the same recording key from the same file.
 */
export interface SongTags {
  /** Embedded cover bytes. Desktop scan caches these by the phone's SHA-1 identity. */
  readonly artworkBase64?: string | null;
  readonly title: string | null;
  readonly artist: string | null;
  readonly artists: readonly string[];
  readonly album: string | null;
  readonly albumArtist: string | null;
  readonly albumArtists: readonly string[];
  readonly genre: string | null;
  readonly genres: readonly string[];
  /** Original release date, as precise as the tag. */
  readonly releaseDate: string | null;
  /** As tagged, e.g. `2024` or `2024-05-01`. */
  readonly year: string | null;
  /** As tagged, e.g. `3` or `3/12`. */
  readonly trackNumber: string | null;
  readonly discNumber: string | null;
  readonly compilation: boolean;
  readonly durationMs: number;
  readonly sampleRate: number | null;
  readonly bitrateKbps: number | null;
  readonly advisory: string | null;
  /** Embedded lyrics as tagged: plain text, or LRC for synced lyrics (Core tells them apart). */
  readonly lyrics?: string | null;
  /** ReplayGain and R128 tags as tagged, when the file has any. */
  readonly loudnessTags: Readonly<Record<string, string | null>> | null;
  /** The ISRC tag as tagged (Core's `isrcFromTag` reads it). */
  readonly isrc?: string | null;
}
