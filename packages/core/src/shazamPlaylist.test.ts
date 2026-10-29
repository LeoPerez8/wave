import assert from "node:assert/strict";
import { test } from "node:test";
import { planShazamAdd, type PlaylistSong, type YtSong } from "./index.ts";

const song: PlaylistSong = { source: "library", trackId: 42 };

test("a deleted remembered playlist is created again without taking over a user playlist named Shazam", () => {
  const playlists = [
    { id: "user", name: "Shazam" },
    { id: "other", name: "shazám 2" },
  ];
  for (const remembered of [null, "deleted"]) {
    assert.deepEqual(planShazamAdd(remembered, playlists, [song], song), {
      kind: "create",
      name: "Shazam 3",
      song,
      index: 0,
      toast: "Added to Shazam",
    });
  }
});

const heard = {
  title: "Déjà Vu",
  artists: ["Beyoncé"],
  album: null,
  durationMs: null,
  artworkUrl: null,
};

test("deleting Shazam makes the next add create it again", () => {
  assert.deepEqual(planShazamAdd("deleted", [], [], song), {
    kind: "create",
    name: "Shazam",
    song,
    index: 0,
    toast: "Added to Shazam",
  });
});

test("online songs use their video id, while an entry without one can match a saved online song", () => {
  const online: YtSong = { ...heard, videoId: "video", explicit: false };
  const playlists = [{ id: "saved", name: "Shazam" }];
  const existing: PlaylistSong[] = [{ source: "stream", song: online }];
  assert.equal(
    planShazamAdd("saved", playlists, existing, {
      source: "stream",
      song: { ...online, title: "Changed title" },
    }).kind,
    "duplicate",
  );
  assert.equal(
    planShazamAdd("saved", playlists, existing, {
      source: "stream",
      song: { ...online, videoId: "other" },
    }).kind,
    "add",
  );
  assert.equal(
    planShazamAdd("saved", playlists, existing, { source: "unsearched", song: heard }).kind,
    "duplicate",
  );
  assert.equal(
    planShazamAdd("saved", playlists, existing, {
      source: "unsearched",
      song: { ...heard, artists: ["Someone else"] },
    }).kind,
    "add",
  );
  assert.equal(
    planShazamAdd("saved", playlists, existing, {
      source: "unsearched",
      song: { ...heard, title: "Another song" },
    }).kind,
    "add",
  );
});

test("entries without an id are compared by title and artists, across unavailable and unsearched saves", () => {
  const saved: PlaylistSong = { source: "unavailable", song: { ...heard, reason: "notFound" } };
  const incoming: PlaylistSong = {
    source: "unsearched",
    song: {
      ...heard,
      title: "DEJA VU",
      artists: ["Beyonce"],
      album: "Another album",
      durationMs: 120000,
    },
  };
  assert.deepEqual(planShazamAdd("saved", [{ id: "saved", name: "Shazam" }], [saved], incoming), {
    kind: "duplicate",
    playlistId: "saved",
    toast: "Already in Shazam",
  });
});

test("a song already saved by track id is refused with Already in Shazam", () => {
  assert.deepEqual(planShazamAdd("saved", [{ id: "saved", name: "Renamed" }], [song], song), {
    kind: "duplicate",
    playlistId: "saved",
    toast: "Already in Shazam",
  });
});

test("the first Add to Shazam creates a playlist with the song at the top", () => {
  assert.deepEqual(planShazamAdd(null, [], [], song), {
    kind: "create",
    name: "Shazam",
    song,
    index: 0,
    toast: "Added to Shazam",
  });
});

test("the newest song goes to the top of the remembered playlist, even after a rename", () => {
  assert.deepEqual(
    planShazamAdd("saved", [{ id: "saved", name: "Heard around town" }], [song], {
      source: "library",
      trackId: 43,
    }),
    {
      kind: "add",
      playlistId: "saved",
      song: { source: "library", trackId: 43 },
      index: 0,
      toast: "Added to Shazam",
    },
  );
});
