import assert from "node:assert/strict";
import { test } from "node:test";
import {
  magicArtistKey,
  magicSignal,
  magicRadioBatch,
  magicRadioExclusions,
  rankRadioSongs,
  parseMagicSession,
  startMagicQueue,
  type MagicSongRadioSeed,
  type YtAlbumSong,
} from "./index.ts";

const original: MagicSongRadioSeed = {
  id: "song:1",
  title: "Original",
  artists: ["Seed artist"],
  durationMs: 200_000,
  videoId: "original",
};
const liked: MagicSongRadioSeed = {
  id: "song:yt:liked",
  title: "Liked song",
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
const start = () =>
  startMagicQueue({ kind: "track", id: "1", title: "Original" }, [{ ...song, trackId: "1" }], {
    id: "session",
    random: () => 0,
    radio: { song: original, artists: original.artists, profile: null },
  })!.session;

test("a favorite keeps the song's radio for later batches", () => {
  const learned = magicSignal(start(), { kind: "favorite", song, radio: liked });
  assert.deepEqual(learned.likedRadios, [liked]);
  assert.deepEqual(learned.radioSeed, original);
});

test("downloads and hand additions learn radios; skips, removals and completed plays do not", () => {
  for (const kind of ["download", "added"] as const)
    assert.deepEqual(magicSignal(start(), { kind, song, radio: liked }).likedRadios, [liked]);
  for (const kind of ["skip", "removed", "playedThrough"] as const)
    assert.equal(magicSignal(start(), { kind, song, radio: liked }).likedRadios, undefined);
});

test("liking twice and then downloading the recording keeps one radio, without replacing the seed", () => {
  let session = magicSignal(start(), { kind: "favorite", song, radio: liked });
  session = magicSignal(session, { kind: "download", song, radio: liked });
  session = magicSignal(session, {
    kind: "favorite",
    song: { ...song, trackId: "22" },
    radio: { ...liked, id: "song:22" },
  });
  session = magicSignal(session, { kind: "favorite", song, radio: original });
  assert.deepEqual(session.likedRadios, [liked]);
});

test("liked radios survive restart, while old or malformed saved data has none", () => {
  const session = magicSignal(start(), { kind: "favorite", song, radio: liked });
  assert.deepEqual(parseMagicSession(JSON.parse(JSON.stringify(session))), session);
  assert.equal(parseMagicSession(start())?.likedRadios, undefined);
  assert.equal(parseMagicSession({ ...session, likedRadios: [{ id: 1 }] })?.likedRadios, undefined);
});

test("liking a list song or the artist seed's playing song adds its own radio", () => {
  const { radioSeed: _original, ...listSession } = start();
  const list = { ...listSession, seedSongs: [{ ...liked, plays: 1 }] };
  assert.deepEqual(magicSignal(list, { kind: "favorite", song, radio: liked }).likedRadios, [
    liked,
  ]);
  const artist = { ...start(), radioSeed: { ...liked, id: "artist:4", kind: "artist" as const } };
  assert.deepEqual(magicSignal(artist, { kind: "favorite", song, radio: liked }).likedRadios, [
    liked,
  ]);
});

const pageSongs = (prefix: string): YtAlbumSong[] =>
  Array.from({ length: 20 }, (_, index) => ({
    videoId: `${prefix}${index}`,
    title: `${prefix} ${index}`,
    artists: [prefix],
    album: null,
    albumId: null,
    durationMs: 200_000,
    artworkUrl: null,
    explicit: false,
  }));
const ranked = (id: string) =>
  rankRadioSongs(
    { artists: original.artists },
    {
      pages: [{ id, artists: [id], songs: pageSongs(id) }],
    },
  );

test("each learning trigger supplies about a third of a later batch and the seed keeps the majority", () => {
  for (const kind of ["favorite", "download", "added"] as const) {
    const session = magicSignal(start(), { kind, song, radio: liked });
    const learned = session.likedRadios!.flatMap((radio) => ranked(radio.id));
    for (const size of [9, 10]) {
      const batch = magicRadioBatch(ranked(original.id), learned, { size, newMusicShare: 1 });
      assert.equal(batch.length, size);
      assert.equal(batch.filter((candidate) => candidate.radio?.id === liked.id).length, 3);
      assert.equal(
        batch.filter((candidate) => candidate.radio?.id === original.id).length,
        size - 3,
      );
    }
  }
});

test("either radio pool fills shortages without repeating recordings from both pools", () => {
  const seed = ranked("seed");
  const learned = ranked("liked");
  const options = { size: 10, newMusicShare: 1 };
  assert.equal(magicRadioBatch(seed.slice(0, 2), learned, options).length, 10);
  assert.equal(magicRadioBatch(seed, [], options).length, 10);
  const batch = magicRadioBatch(seed, [...seed, ...learned], options);
  assert.equal(batch.length, 10);
  assert.equal(new Set(batch.map((candidate) => candidate.trackId)).size, 10);
  assert.equal(batch.filter((candidate) => candidate.radio?.id === "liked").length, 3);
});

const mixed = (id: string) =>
  ranked(id).map((candidate, index) => ({
    ...candidate,
    source: index % 2 === 0 ? ("library" as const) : ("stream" as const),
  }));

test("New music keeps its total share while the two radio pools both contribute", () => {
  const first = magicRadioBatch(mixed("seed"), mixed("liked"), { size: 9, newMusicShare: 0.6 });
  assert.equal(first.filter((candidate) => candidate.source === "stream").length, 5);
  assert.equal(first.filter((candidate) => candidate.radio?.id === "liked").length, 3);
  const later = magicRadioBatch(mixed("seed"), mixed("liked"), { size: 10, newMusicShare: 0.6 });
  assert.equal(later.filter((candidate) => candidate.source === "stream").length, 6);
  assert.equal(later.filter((candidate) => candidate.radio?.id === "liked").length, 3);
});

test("a liked Library recording with no video id cannot return from its searched radio", () => {
  const { videoId: _video, ...recording } = liked;
  const session = magicSignal(start(), {
    kind: "favorite",
    song: { ...song, trackId: "22" },
    radio: { ...recording, id: "song:22" },
  });
  const page = {
    ...pageSongs("liked")[0]!,
    title: liked.title,
    artists: liked.artists,
    durationMs: liked.durationMs,
  };
  const excluded = magicRadioExclusions(session, [page]);
  assert.ok(excluded.has("22"));
  assert.ok(excluded.has(`yt:${page.videoId}`));
});
