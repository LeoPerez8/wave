/** Actual LibraryStore reads, one at a time; no hand-written SQL replays. */
import { statsWindow } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { createHash } from "node:crypto";

import { loadLibraryStore } from "../store.ts";
import type { BenchMeasurement, FastAgainBench } from "../types.ts";

/** Compare identities across schema versions, ignoring fields introduced since the reference. */
const identity = (value: unknown): unknown => {
  if (value instanceof Map)
    return [...value.entries()]
      .toSorted(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([key, row]) => [key, identity(row)]);
  if (Array.isArray(value)) return value.map(identity);
  if (value !== null && typeof value === "object") {
    const row = value as Record<string, unknown>;
    if (typeof row.id === "number") return { id: row.id };
    if (row.trackId !== undefined) return { trackId: row.trackId };
    if (typeof row.path === "string") return { path: row.path };
    return Object.fromEntries(
      Object.keys(row)
        .toSorted()
        .map((key) => [key, identity(row[key])]),
    );
  }
  return value;
};
const resultKey = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(identity(value)) ?? "undefined")
    .digest("hex");

export const bench: FastAgainBench = {
  name: "libraryReads",
  async run(context) {
    const { fixture } = context;
    const store = await loadLibraryStore(context.root, fixture.db);
    const ids = fixture.songIds.slice(0, 50);
    const small = fixture.targets.small.artistId;
    const large = fixture.targets.large.artistId;
    const window = statsWindow("all", fixture.now);
    const albumIds = [...fixture.targets.small.albumIds, ...fixture.targets.large.albumIds];
    const paths = fixture.db
      .all<{ path: string }>(
        sql`SELECT path FROM tracks WHERE path IS NOT NULL ORDER BY id LIMIT 50`,
      )
      .map((row) => row.path);
    // Deliberately name the public store operations. Absent historical APIs
    // are reported as unavailable, never timed as empty or zero-cost reads.
    const reads: readonly [read: string, method: string, args?: readonly unknown[]][] = [
      ...[
        "playlistEntriesRevision",
        "listPendingFavorites",
        "pendingFileDeletions",
        "countTracks",
        "countLibrary",
        "countSectionSongs",
        "measureScale",
        "listSongs",
        "songFindTexts",
        "listLibraryLookupSongs",
        "listSongGenres",
        "listAlbums",
        "listArtists",
        "listGenres",
        "listPlaylists",
        "playlistsLastPlayed",
        "unsearchedEntries",
        "trackPaths",
        "importTracks",
        "importedPlays",
        "playedRecordingKeys",
        "tasteHistory",
        "favoriteTrackIds",
        "listFavorites",
        "qualityFiles",
        "duplicateCheckFiles",
        "homeAdded",
        "homePlays",
        "homeFavorites",
        "latestPlay",
        "listeningSums",
        "countedListening",
        "artistPhotoLookups",
        "listArtistPhotos",
        "streamedSongs",
        "playlistedSongs",
        "knownVideos",
        "candidateCatalog",
        "ytArtistSimilar",
        "listRoots",
        "excludedFolders",
        "loadPlayback",
        "listRecentSearches",
      ].map((name): [string, string] => [name, name]),
      ["playlistRecommendationInput", "playlistRecommendationInput", [fixture.playlistId]],
      ["hasUnscannedRoot", "hasUnscannedRoot", [["/Music"]]],
      ["listArtistSongsPage/50", "listArtistSongsPage", [large, { offset: 0, limit: 50 }]],
      [
        "listPlaylistEntriesPage/50",
        "listPlaylistEntriesPage",
        [fixture.playlistId, { offset: 0, limit: 50 }],
      ],
      ["artistCovers/2", "artistCovers", [[small, large]]],
      ["indexedFiles/50", "indexedFiles", [paths]],
      ["missingSongs", "missingSongs", []],
      ["albumsMissingSongs/32", "albumsMissingSongs", [albumIds]],
      ["videoIds/50", "videoIds", [ids]],
      ["playlistImageOriginal", "playlistImageOriginal", [fixture.playlistId]],
      ["noBetterCopies", "noBetterCopies", ["upgrade"]],
      ["replacedTrack", "replacedTrack", [fixture.songIds[0]]],
      ["albumsByIds/32", "albumsByIds", [albumIds]],
      ["artistsByIds/2", "artistsByIds", [[small, large]]],
      ["linkRows", "linkRows", [{ artistId: small, albumId: fixture.albumId }]],
      ["ytArtist", "ytArtist", ["library-artist-0"]],
      ["savedLyrics", "savedLyrics", ["00000000001"]],
      ["lyricsSearchTrack", "lyricsSearchTrack", [fixture.songIds[0]]],
      ["listSongOrder/title", "listSongOrder", [{ key: "title", descending: false }]],
      ["songSummaries/50", "songSummaries", [ids]],
      ["songsWithIds/50", "songsWithIds", [ids]],
      ["songsByIds/50", "songsByIds", [ids]],
      ["listAlbumsPage/50", "listAlbumsPage", [{ offset: 0, limit: 50 }]],
      ["listArtistsPage/50", "listArtistsPage", [{ offset: 0, limit: 50 }]],
      ["getArtist/20", "getArtist", [small]],
      ["getArtist/300", "getArtist", [large]],
      ["getAlbum/10", "getAlbum", [fixture.albumId]],
      ["getGenre", "getGenre", [fixture.genreId]],
      ["getPlaylist/50", "getPlaylist", [fixture.playlistId]],
      ["trackDetails", "trackDetails", [fixture.songIds[0]]],
      ["knownFiles", "knownFiles", [["/Music"]]],
      ["home", "home", []],
      ["trackPlayTotals/all", "trackPlayTotals", [window]],
      ["creditedPlayTotals/all", "creditedPlayTotals", [window]],
      ["artistPlays/20", "artistPlays", [small, fixture.now]],
      ["artistPlays/300", "artistPlays", [large, fixture.now]],
      ["songGenres/50", "songGenres", [ids]],
      ["artistFirstPlays/2", "artistFirstPlays", [[small, large]]],
    ];
    const measurements: BenchMeasurement[] = [];
    for (const [read, method, args] of reads) {
      const member = (store as unknown as Record<string, unknown>)[method];
      if (member === undefined) {
        measurements.push({
          read,
          status: "unavailable",
          reason: `${method} is absent from this worktree's LibraryStore`,
        });
        continue;
      }
      const effect =
        args === undefined ? member : (member as (...args: readonly unknown[]) => unknown)(...args);
      measurements.push(
        context.measure(read, () => Effect.runSync(effect as Effect.Effect<unknown, unknown>), {
          resultKey,
          details: {
            source: "actual LibraryStore Effect",
            phase: "warm read",
            notifications: "read-only service; no subscriber writes",
          },
        }),
      );
    }
    return measurements;
  },
};
