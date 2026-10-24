import assert from "node:assert/strict";
import { test } from "node:test";
import {
  magicArtistKey,
  magicBatchRadios,
  magicRadioBatch,
  magicSignal,
  parseMagicSession,
  rankRadioSongs,
  startMagicQueue,
  type MagicSongRadioSeed,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { createSongRadioReaders } from "./songRadioReaders.ts";
import { createSongRadioSession, type SongRadioPage } from "./songRadioSession.ts";

test("a liked radio is read once, supplies later batches, and restores from the catalog offline", async () => {
  const original: MagicSongRadioSeed = {
    id: "song:1",
    title: "Seed",
    artists: ["Seed artist"],
    durationMs: 200_000,
    videoId: "seed",
  };
  const liked: MagicSongRadioSeed = {
    id: "song:yt:liked",
    title: "Liked",
    artists: ["Liked artist"],
    durationMs: 180_000,
    videoId: "liked",
  };
  const song = {
    trackId: "yt:liked",
    artists: [magicArtistKey("Liked artist")],
    genre: null,
    style: null,
  };
  let session = startMagicQueue(
    { kind: "track", id: "1", title: "Seed" },
    [{ ...song, trackId: "1" }],
    {
      id: "session",
      random: () => 0,
      radio: { song: original, artists: original.artists, profile: null },
    },
  )!.session;
  const cache = new Map<string, SongRadioPage>();
  const requests: string[] = [];
  const readers = () =>
    createSongRadioReaders((seed) =>
      createSongRadioSession(seed, {
        cached: cache.get(seed.id) ?? null,
        radio: (videoId) =>
          Effect.sync(() => {
            requests.push(videoId);
            return {
              songs: Array.from({ length: 20 }, (_, index) => ({
                videoId: `${videoId}${index}`,
                title: `${videoId} ${index}`,
                artists: seed.artists,
                album: null,
                albumId: null,
                durationMs: 200_000,
                artworkUrl: null,
                explicit: false,
              })),
              continuation: null,
            };
          }),
        search: () => Effect.die("video ids need no search"),
        artist: () => Effect.die("video ids need no artist fallback"),
        more: () => Effect.die("a full pool needs no continuation"),
        save: (page) =>
          Effect.sync(() => {
            cache.set(seed.id, page);
          }),
        fallback: () => assert.fail("unexpected fallback"),
      }),
    );
  const live = readers();
  session = magicSignal(session, { kind: "favorite", song, radio: liked });
  const seeds = () => [...magicBatchRadios(session, () => 0).seeds, ...(session.likedRadios ?? [])];
  await Effect.runPromise(live.read(session.id, seeds(), { online: true, low: false }));
  session = magicSignal(session, { kind: "favorite", song, radio: liked });
  session = magicSignal(session, {
    kind: "download",
    song: { ...song, trackId: "22" },
    radio: { ...liked, id: "song:22" },
  });
  await Effect.runPromise(live.read(session.id, seeds(), { online: true, low: false }));
  assert.deepEqual(requests, ["seed", "liked"]);
  for (let attempt = 0; attempt < 20 && cache.size < 2; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual([...cache.keys()], [original.id, liked.id]);
  session = parseMagicSession(JSON.parse(JSON.stringify(session)))!;
  const restored = await Effect.runPromise(
    readers().read(session.id, seeds(), { online: false, low: true }),
  );
  assert.equal(restored[0]?.page?.songs.length, 20);
  const rank = (id: string) =>
    rankRadioSongs(
      { artists: original.artists },
      {
        pages: restored.flatMap(({ seed, page }) =>
          seed.id !== id || page === null ? [] : [{ ...seed, songs: page.songs }],
        ),
      },
    );
  const batch = magicRadioBatch(rank(original.id), rank(liked.id), { size: 10, newMusicShare: 1 });
  assert.equal(batch.filter((candidate) => candidate.radio?.id === original.id).length, 7);
  assert.equal(batch.filter((candidate) => candidate.radio?.id === liked.id).length, 3);
  assert.deepEqual(requests, ["seed", "liked"]);
});
