/**
 * The daily mix input reader, shared by production and the desktop replay.
 * Each source is one read, whatever the Library's size (#1351); the JS work
 * on its rows runs in steps between [between]'s turns.
 */
import {
  rankEntityPlaysSteps,
  mapSteps,
  sortSteps,
  mixKnownSongsSteps,
  sortKey,
  streamedCredits,
  type EntityPlayTotals,
  type StreamedPlays,
  type StreamedSong,
  type MixPlaylistEntry,
  type PlayedSeedArtist,
  type PlayTotals,
  type YtAlbumSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore } from "../library/LibraryStore.ts";
import type { SongRow, ArtistRow } from "@wave/client";
import { binary, byTitleArtistPath } from "../library/binaryOrder.ts";
import { runSteps } from "../lib/stepped.ts";
import type { MixStreamedPlays } from "@wave/client/db/mixInputs";

type MixSong = SongRow & { readonly genres?: readonly string[] };
export const readMixInputs = (
  store: Pick<
    LibraryStore["Service"],
    | "mixSongs"
    | "mixArtists"
    | "mixPlayTotals"
    | "mixPlayedRecordingKeys"
    | "mixCredits"
    | "mixStreamedPlays"
    | "mixCreditNames"
    | "mixStreamed"
    | "mixPlaylisted"
  >,
  between: Effect.Effect<void>,
  now: number,
) =>
  Effect.gen(function* () {
    yield* between;
    const allSongs: MixSong[] = [...(yield* store.mixSongs)];
    // SQLite's order, restored in yielding JS steps.
    const songs = yield* runSteps(sortSteps(allSongs, byTitleArtistPath), between);
    yield* between;
    const allArtists: ArtistRow[] = [...(yield* store.mixArtists)];
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
    yield* between;
    const playedKeys = new Set<string>(yield* store.mixPlayedRecordingKeys);
    const totals = new Map<number, PlayTotals>();
    const allTotals = new Map<number, PlayTotals>();
    // Each song's counted plays, summed by SQLite as the history walk summed them.
    yield* between;
    const songTotals = yield* store.mixPlayTotals(now);
    yield* runSteps(
      (function* () {
        for (const row of songTotals) {
          const total = (sortKey: string): PlayTotals => ({
            id: row.trackId,
            sortKey,
            countedPlays: row.countedPlays,
            listenedMs: row.listenedMs,
            latestPlayAt: row.latestPlayAt,
          });
          allTotals.set(row.trackId, total(""));
          const song = byId.get(row.trackId);
          if (song !== undefined) totals.set(row.trackId, total(song.titleSort));
          yield;
        }
      })(),
      between,
    );
    const artistTotals = new Map<number, PlayTotals>();
    {
      yield* between;
      const page = yield* store.mixCredits;
      yield* runSteps(
        (function* () {
          for (const row of page) {
            const total = allTotals.get(row.id);
            for (const [id, key] of JSON.parse(row.credits) as [number, string][]) {
              if (total !== undefined) {
                const previous = artistTotals.get(id);
                artistTotals.set(id, {
                  ...total,
                  id,
                  sortKey: key,
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
    }
    // Streamed plays, from their kept per-video totals: known by video and
    // recording key, and credited as Stats credits them (`playedEntityTotals`).
    const streamedPlays: StreamedPlays[] = [];
    const countedStreams: MixStreamedPlays[] = [];
    {
      yield* between;
      const rows = yield* store.mixStreamedPlays;
      yield* runSteps(
        (function* () {
          for (const row of rows) {
            if (row.song !== null)
              streamedPlays.push({
                song: row.song,
                recordingKey: row.recordingKey,
                plays: row.plays,
                firstPlayedAt: row.firstPlayedAt,
                inLibrary: row.trackId !== null,
              });
            else if (row.recordingKey !== null) playedKeys.add(row.recordingKey);
            if (row.countedPlays > 0) countedStreams.push(row);
            yield;
          }
        })(),
        between,
      );
    }
    // An online artist (`artist:<name>`) keeps the name it was last credited by.
    type Credited = EntityPlayTotals & { readonly name?: string };
    const credited = new Map<number | string, Credited>(artistTotals);
    const credit = (
      id: number | string,
      key: string,
      row: MixStreamedPlays,
      name?: string,
    ): void => {
      const previous = credited.get(id);
      credited.set(id, {
        id,
        ...(name === undefined ? {} : { name }),
        sortKey: key,
        countedPlays: (previous?.countedPlays ?? 0) + row.countedPlays,
        listenedMs: (previous?.listenedMs ?? 0) + row.countedListenedMs,
        latestPlayAt: Math.max(previous?.latestPlayAt ?? 0, row.latestPlayAt),
      });
    };
    // Credits as the Library writes them, read only for songs it doesn't have.
    let resolve: ((song: YtAlbumSong) => ReturnType<ReturnType<typeof streamedCredits>>) | null =
      null;
    if (countedStreams.some((row) => row.trackId === null && row.song !== null)) {
      yield* between;
      const credits = yield* store.mixCreditNames;
      yield* between;
      resolve = streamedCredits({ artists, albums: [], credits });
    }
    yield* runSteps(
      (function* () {
        for (const row of countedStreams) {
          if (row.trackId !== null) {
            const song = byId.get(row.trackId);
            if (song !== undefined) {
              const previous = totals.get(row.trackId);
              totals.set(row.trackId, {
                id: row.trackId,
                sortKey: song.titleSort,
                countedPlays: (previous?.countedPlays ?? 0) + row.countedPlays,
                listenedMs: (previous?.listenedMs ?? 0) + row.countedListenedMs,
                latestPlayAt: Math.max(previous?.latestPlayAt ?? -Infinity, row.latestPlayAt),
              });
            }
            for (const [id, key] of row.credits) credit(id, key, row);
          } else if (row.song !== null && resolve !== null)
            for (const artist of resolve(row.song).artists)
              credit(artist.id, sortKey(artist.name), row, artist.name);
          yield;
        }
      })(),
      between,
    );
    const artistById = new Map<number, ArtistRow>();
    yield* runSteps(
      mapSteps(artists, (artist) => {
        artistById.set(artist.id, artist);
      }),
      between,
    );
    const ranked = yield* runSteps(rankEntityPlaysSteps(credited.values(), 20), between);
    const topArtists = ranked.flatMap((total): PlayedSeedArtist[] => {
      if (typeof total.id === "string")
        return total.name === undefined
          ? []
          : [{ id: total.id, name: total.name, countedPlays: total.countedPlays }];
      const artist = artistById.get(total.id);
      return artist === undefined
        ? []
        : [{ id: artist.id, name: artist.name, countedPlays: total.countedPlays }];
    });
    const plays = yield* runSteps(
      sortSteps([...totals.values()], (a, b) => a.id - b.id),
      between,
    );
    yield* between;
    const streamed: readonly StreamedSong[] = yield* store.mixStreamed;
    yield* between;
    const playlisted: readonly MixPlaylistEntry[] = yield* store.mixPlaylisted;
    const known = yield* runSteps(
      mixKnownSongsSteps({
        library: songs,
        playedRecordingKeys: [...playedKeys],
        streamed,
        streamedPlays,
        playlisted,
      }),
      between,
    );
    return { songs, artists, plays, known, topArtists };
  });
