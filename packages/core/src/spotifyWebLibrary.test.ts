import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readSpotifyWebLibrary,
  readSpotifyWebPlaylist,
  spotifyLibraryPicker,
  type SpotifyWebAnswer,
} from "./index.ts";

const ok = (data: unknown): SpotifyWebAnswer => ({ ok: true, data });

test("the Web API library lists Liked Songs with its count, then every page of playlists", async () => {
  const requests: string[] = [];
  const result = await readSpotifyWebLibrary(async (path) => {
    requests.push(path);
    if (path === "/v1/me/tracks?limit=1") return ok({ items: [{}], total: 321, next: "ignored" });
    if (path === "/v1/me/playlists?limit=50&offset=0")
      return ok({
        items: [
          {
            id: "road",
            name: "Road trip",
            images: [{ url: "https://i.scdn.co/image/road" }],
            items: { total: 12 },
          },
          null,
        ],
        total: 3,
        next: "https://api.spotify.com/v1/me/playlists?offset=2&limit=50",
      });
    return ok({
      items: [{ id: "old", name: "Older shape", images: null, tracks: { total: 4 } }],
      total: 3,
      next: null,
    });
  });
  assert.deepEqual(requests, [
    "/v1/me/tracks?limit=1",
    "/v1/me/playlists?limit=50&offset=0",
    "/v1/me/playlists?offset=2&limit=50",
  ]);
  assert.deepEqual(result, {
    ok: true,
    playlists: [
      { source: "spotify:collection", title: "Liked Songs", artworkUrl: null, songCount: 321 },
      {
        source: "spotify:playlist:road",
        title: "Road trip",
        artworkUrl: "https://i.scdn.co/image/road",
        songCount: 12,
      },
      { source: "spotify:playlist:old", title: "Older shape", artworkUrl: null, songCount: 4 },
    ],
  });
  assert.ok(result.ok);
  assert.deepEqual(
    spotifyLibraryPicker(result.playlists).rows.map((row) => [row.title, row.line]),
    [
      ["Liked Songs", "321 songs"],
      ["Road trip", "12 songs"],
      ["Older shape", "4 songs"],
    ],
  );
});

test("a library page that fails ends the read with its reason", async () => {
  for (const reason of ["offline", "signedOut", "failed"] as const) {
    const result = await readSpotifyWebLibrary(async (path) =>
      path.startsWith("/v1/me/tracks") ? ok({ items: [], total: 0 }) : { ok: false, reason },
    );
    assert.deepEqual(result, { ok: false, reason });
  }
  assert.deepEqual(await readSpotifyWebLibrary(async () => ({ ok: false, reason: "missing" })), {
    ok: false,
    reason: "failed",
  });
});

test("a library answer Wave can't read, or a next page elsewhere, fails the read", async () => {
  assert.deepEqual(await readSpotifyWebLibrary(async () => ok({ nothing: true })), {
    ok: false,
    reason: "failed",
  });
  for (const next of [
    "https://elsewhere.test/v1/me/playlists?offset=50",
    "https://api.spotify.com/v1/me/albums?offset=50",
    "https://api.spotify.com/v1/me/playlists?limit=50&offset=0",
    7,
  ]) {
    const requests: string[] = [];
    const result = await readSpotifyWebLibrary(async (path) => {
      requests.push(path);
      return path.startsWith("/v1/me/tracks")
        ? ok({ items: [], total: 0 })
        : ok({ items: [{ id: "a", name: "A" }], total: 80, next });
    });
    assert.deepEqual(result, { ok: false, reason: "failed" });
    assert.equal(requests.length, 2);
  }
});

test("a playlist reads every page in Spotify's order, skipping what isn't a song", async () => {
  const requests: string[] = [];
  const pages: [number, number][] = [];
  const result = await readSpotifyWebPlaylist(
    { source: "spotify:playlist:road", title: "Road trip" },
    async (path) => {
      requests.push(path);
      if (path === "/v1/playlists/road/items?limit=50&offset=0")
        return ok({
          items: [
            {
              item: {
                type: "track",
                name: "Airbag",
                artists: [{ name: "Radiohead" }, { name: "" }],
                album: { name: "OK Computer", images: [{ url: "https://i.scdn.co/cover" }] },
                duration_ms: 284000,
              },
            },
            { item: { type: "episode", name: "Episode" } },
            { item: null },
          ],
          total: 5,
          next: "https://api.spotify.com/v1/playlists/road/items?offset=3&limit=50",
        });
      return ok({
        items: [
          {
            track: {
              type: "track",
              name: "Home tape",
              artists: [{ name: "" }],
              album: { name: "", images: [] },
              duration_ms: 1000,
              is_local: true,
            },
          },
          {
            track: {
              type: "track",
              name: "Lucky",
              artists: [{ name: "Radiohead" }],
              album: { name: "OK Computer", images: [] },
              duration_ms: 0,
            },
          },
        ],
        total: 5,
        next: null,
      });
    },
    (read, total) => pages.push([read, total]),
  );
  assert.deepEqual(requests, [
    "/v1/playlists/road/items?limit=50&offset=0",
    "/v1/playlists/road/items?offset=3&limit=50",
  ]);
  assert.deepEqual(pages, [
    [3, 5],
    [5, 5],
  ]);
  assert.deepEqual(result, {
    ok: true,
    playlist: {
      title: "Road trip",
      artworkUrl: null,
      songs: [
        {
          title: "Airbag",
          artists: ["Radiohead"],
          album: "OK Computer",
          durationMs: 284000,
          artworkUrl: "https://i.scdn.co/cover",
        },
        { title: "Home tape", artists: [], album: null, durationMs: 1000 },
        { title: "Lucky", artists: ["Radiohead"], album: "OK Computer", durationMs: null },
      ],
      truncated: false,
      total: 5,
    },
  });
});

test("Liked Songs reads the saved tracks, newest first as Spotify lists them", async () => {
  const result = await readSpotifyWebPlaylist(
    { source: "spotify:collection", title: "Liked Songs" },
    async (path) => {
      assert.equal(path, "/v1/me/tracks?limit=50&offset=0");
      return ok({
        items: [
          {
            added_at: "2026-01-01T00:00:00Z",
            track: {
              type: "track",
              name: "Nude",
              artists: [{ name: "Radiohead" }],
              album: { name: "In Rainbows" },
              duration_ms: 255000,
            },
          },
        ],
        total: 1,
        next: null,
      });
    },
  );
  assert.deepEqual(result, {
    ok: true,
    playlist: {
      title: "Liked Songs",
      artworkUrl: null,
      songs: [{ title: "Nude", artists: ["Radiohead"], album: "In Rainbows", durationMs: 255000 }],
      truncated: false,
      total: 1,
    },
  });
});

test("a playlist that fails says why, and one Spotify no longer has is missing", async () => {
  for (const reason of ["offline", "signedOut", "failed", "missing"] as const)
    assert.deepEqual(
      await readSpotifyWebPlaylist(
        { source: "spotify:playlist:gone", title: "Gone" },
        async () => ({
          ok: false,
          reason,
        }),
      ),
      { ok: false, reason },
    );
  assert.deepEqual(
    await readSpotifyWebPlaylist({ source: "spotify:playlist:odd", title: "Odd" }, async () =>
      ok({ items: "none" }),
    ),
    { ok: false, reason: "failed" },
  );
  let asked = 0;
  assert.deepEqual(
    await readSpotifyWebPlaylist({ source: "not a source", title: "Odd" }, async () => {
      asked += 1;
      return ok({});
    }),
    { ok: false, reason: "failed" },
  );
  assert.equal(asked, 0);
});
