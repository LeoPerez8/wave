/** The daily mix input reader, shared by production and the desktop replay. */
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
import type { LibraryStore, SongRow, ArtistRow } from "../library/LibraryStore.ts";
import { binary, byTitleArtistPath } from "../library/binaryOrder.ts";
import { runSteps } from "../lib/stepped.ts";
import type { MixStreamedPlays } from "../library/db/mixInputs.ts";

type MixSong = SongRow & { readonly genres?: readonly string[] };
export const readMixInputs = (
  store: Pick<
    LibraryStore["Service"],
    | "mixCreditPage"
    | "mixSongsPage"
    | "mixArtistsPage"
    | "mixHistoryPage"
    | "mixStreamedPage"
    | "mixStreamedPlaysPage"
    | "mixCreditNamesPage"
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
    // Streamed plays, from their kept per-video totals: known by video and
    // recording key, and credited as Stats credits them (`playedEntityTotals`).
    const streamedPlays: StreamedPlays[] = [];
    const countedStreams: MixStreamedPlays[] = [];
    after = 0;
    for (;;) {
      yield* between;
      const page = yield* store.mixStreamedPlaysPage(after);
      yield* runSteps(
        (function* () {
          for (const row of page.rows) {
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
      if (page.next === null) break;
      after = page.next;
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
      const credits: string[] = [];
      after = 0;
      for (;;) {
        yield* between;
        const page = yield* store.mixCreditNamesPage(after);
        for (const name of page.rows) credits.push(name);
        if (page.next === null) break;
        after = page.next;
      }
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
        streamedPlays,
        playlisted,
      }),
      between,
    );
    return { songs, artists, plays, known, topArtists };
  });
