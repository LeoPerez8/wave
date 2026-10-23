/** The daily mix input reader, shared by production and the desktop replay. */
import {
  rankPlaysSteps,
  mapSteps,
  sortSteps,
  mixKnownSongsSteps,
  type StreamedSong,
  type MixPlaylistEntry,
  type PlayTotals,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore, SongRow, ArtistRow } from "../library/LibraryStore.ts";
import { binary, byTitleArtistPath } from "../library/binaryOrder.ts";
import { runSteps } from "../lib/stepped.ts";

type MixSong = SongRow & { readonly genres?: readonly string[] };
export const readMixInputs = (
  store: Pick<
    LibraryStore["Service"],
    | "mixCreditPage"
    | "mixSongsPage"
    | "mixArtistsPage"
    | "mixHistoryPage"
    | "mixStreamedPage"
    | "mixPlaylistedPage"
  >,
  between: Effect.Effect<void>,
  now: number,
) =>
  Effect.gen(function* () {
    const allSongs: MixSong[] = [];
    let after = 0;
    for (;;) {
      yield* between;
      const page = yield* store.mixSongsPage(after);
      if (page.length === 0) break;
      for (const song of page) allSongs.push(song);
      after = page.at(-1)!.id;
    }
    // SQLite's order, restored in yielding JS steps.
    const songs = yield* runSteps(sortSteps(allSongs, byTitleArtistPath), between);
    const allArtists: ArtistRow[] = [];
    after = 0;
    for (;;) {
      yield* between;
      const page = yield* store.mixArtistsPage(after);
      if (page.length === 0) break;
      for (const artist of page) allArtists.push(artist);
      after = page.at(-1)!.id;
    }
    const artists = yield* runSteps(
      sortSteps(allArtists, (a, b) => binary(a.sort, b.sort) || a.id - b.id),
      between,
    );
    const byId = new Map<number, MixSong>();
    yield* runSteps(
      mapSteps(songs, (song) => {
        byId.set(song.id, song);
      }),
      between,
    );
    const playedKeys = new Set<string>();
    const totals = new Map<number, PlayTotals>();
    const allTotals = new Map<number, PlayTotals>();
    after = 0;
    for (;;) {
      yield* between;
      const page = yield* store.mixHistoryPage(after);
      if (page.length === 0) break;
      yield* runSteps(
        (function* () {
          for (const row of page) {
            if (row.recordingKey !== null) playedKeys.add(row.recordingKey);
            const song = byId.get(row.trackId);
            if (row.counted && row.startedAt <= now) {
              const before = allTotals.get(row.trackId);
              allTotals.set(row.trackId, {
                id: row.trackId,
                sortKey: "",
                countedPlays: (before?.countedPlays ?? 0) + 1,
                listenedMs: (before?.listenedMs ?? 0) + row.listenedMs,
                latestPlayAt: Math.max(before?.latestPlayAt ?? -Infinity, row.startedAt),
              });
            }
            if (row.counted && row.startedAt <= now && song !== undefined) {
              const previous = totals.get(row.trackId);
              totals.set(row.trackId, {
                id: row.trackId,
                sortKey: song.titleSort,
                countedPlays: (previous?.countedPlays ?? 0) + 1,
                listenedMs: (previous?.listenedMs ?? 0) + row.listenedMs,
                latestPlayAt: Math.max(previous?.latestPlayAt ?? -Infinity, row.startedAt),
              });
            }
            yield;
          }
        })(),
        between,
      );
      after = page.at(-1)!.id;
    }
    const artistTotals = new Map<number, PlayTotals>();
    after = 0;
    for (;;) {
      yield* between;
      const page = yield* store.mixCreditPage(after);
      if (page.length === 0) break;
      yield* runSteps(
        (function* () {
          for (const row of page) {
            const total = allTotals.get(row.id);
            for (const [id, sortKey] of JSON.parse(row.credits) as [number, string][]) {
              if (total !== undefined) {
                const previous = artistTotals.get(id);
                artistTotals.set(id, {
                  ...total,
                  id,
                  sortKey,
                  countedPlays: (previous?.countedPlays ?? 0) + total.countedPlays,
                  listenedMs: (previous?.listenedMs ?? 0) + total.listenedMs,
                  latestPlayAt: Math.max(previous?.latestPlayAt ?? -Infinity, total.latestPlayAt),
                });
              }
              yield;
            }
            yield;
          }
        })(),
        between,
      );
      after = page.at(-1)!.id;
    }
    const artistById = new Map<number, ArtistRow>();
    yield* runSteps(
      mapSteps(artists, (artist) => {
        artistById.set(artist.id, artist);
      }),
      between,
    );
    const ranked = yield* runSteps(rankPlaysSteps(artistTotals.values(), 20), between);
    const topArtists = ranked.flatMap((total) => {
      const artist = artistById.get(total.id);
      return artist === undefined
        ? []
        : [{ id: artist.id, name: artist.name, countedPlays: total.countedPlays }];
    });
    const plays = yield* runSteps(
      sortSteps([...totals.values()], (a, b) => a.id - b.id),
      between,
    );
    const streamed: StreamedSong[] = [];
    after = 0;
    for (;;) {
      yield* between;
      const page = yield* store.mixStreamedPage(after);
      for (const row of page.rows) streamed.push(row);
      if (page.next === null) break;
      after = page.next;
    }
    const playlisted: MixPlaylistEntry[] = [];
    after = 0;
    for (;;) {
      yield* between;
      const page = yield* store.mixPlaylistedPage(after);
      for (const row of page.rows) playlisted.push(row);
      if (page.next === null) break;
      after = page.next;
    }
    const known = yield* runSteps(
      mixKnownSongsSteps({
        library: songs,
        playedRecordingKeys: [...playedKeys],
        streamed,
        playlisted,
      }),
      between,
    );
    return { songs, artists, plays, known, topArtists };
  });
