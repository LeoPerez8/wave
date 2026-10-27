import assert from "node:assert/strict";
import { test } from "node:test";

import {
  songRowSwipeDirections,
  itemActions,
  rowSwipeActions,
  SWIPE_CHOICES,
  type ActionItem,
  type SwipeSettings,
  type YtDownloadStatus,
  ytSongActions,
  ytDownloadActions,
  unavailableEntryActions,
  type StreamedArtistLink,
  type LibraryArtistRef,
} from "./index.ts";

test("row facts give the default queue and removal swipes without constructing a menu", () => {
  assert.deepEqual(songRowSwipeDirections({ kind: "track", item: {}, here: "/library/songs" }), {
    right: "addToQueue",
    left: "delete",
  });
  assert.deepEqual(
    songRowSwipeDirections({ kind: "track", item: { missing: true }, here: "/library/songs" }),
    { right: null, left: "removeFromLibrary" },
  );
  assert.deepEqual(
    songRowSwipeDirections({
      kind: "track",
      item: { inPlaylist: true },
      here: "/library/playlist/1",
    }),
    { right: "addToQueue", left: "removeFromPlaylist" },
  );
});

test("YT Music and unavailable directions match their menus, including retries and disabled swipes", () => {
  const artists: readonly (StreamedArtistLink<LibraryArtistRef> | undefined)[] = [
    undefined,
    { kind: "here" },
    { kind: "open", target: { kind: "yt", name: "Daft Punk" } },
  ];
  for (let mask = 0; mask < 64; mask++) {
    const options = {
      inPlaylist: (mask & 1) !== 0,
      favorite: (mask & 2) !== 0,
      album: (mask & 4) !== 0 ? "MPREb_1" : null,
      ytAlbumHere: (mask & 8) !== 0 ? "MPREb_1" : null,
      ytMusic: (mask & 16) !== 0,
      playing: (mask & 32) !== 0,
    };
    for (const artist of artists)
      for (const download of statuses)
        for (const inLibrary of [true, false]) {
          const menu = [
            ...ytSongActions(artist, options).map((entry) => entry.action),
            ...ytDownloadActions(download, { inLibrary }),
          ];
          for (const setting of settings)
            assert.deepEqual(
              songRowSwipeDirections(
                { kind: "ytMusic", artists: artist, options, download, inLibrary },
                setting,
              ),
              rowSwipeActions(menu, setting),
              JSON.stringify({ options, artist, download, inLibrary, setting }),
            );
        }
  }
  for (const setting of settings)
    assert.deepEqual(
      songRowSwipeDirections({ kind: "unavailable" }, setting),
      rowSwipeActions(unavailableEntryActions({ search: true }), setting),
    );
  assert.equal(
    songRowSwipeDirections(
      { kind: "ytMusic", options: {} },
      { enabled: true, right: "favorite", left: "share" },
    ).right,
    null,
  );
});

test("streamed track artist directions match itemActions on Library and YT artist pages", () => {
  for (const enabled of [false, true])
    for (const here of ["/search", "/library/artist/7"]) {
      for (const artistNames of [
        [],
        ["Unknown Artist"],
        ["Daft Punk"],
        ["Guest"],
        ["Daft Punk", "Guest"],
      ]) {
        const item: ActionItem = { streamed: true, artistNames };
        for (const ytArtistHere of [null, "Guest"]) {
          const streamedArtists = {
            enabled,
            libraryArtist: (name: string) => (name === "Daft Punk" ? { id: 7, name } : null),
            ytArtistHere,
          };
          const menu = itemActions({ kind: "track", items: [item], here, streamedArtists }).map(
            (entry) => entry.action,
          );
          for (const setting of settings)
            assert.deepEqual(
              songRowSwipeDirections({ kind: "track", item, here, streamedArtists }, setting),
              rowSwipeActions(menu, setting),
            );
        }
      }
    }
});

const statuses: readonly (YtDownloadStatus | null)[] = [
  null,
  { kind: "queued" },
  { kind: "downloading", received: 10, total: 100 },
  { kind: "saving" },
  { kind: "failed", reason: "failed" },
  { kind: "done", path: "/new.m4a" },
];

const settings: readonly SwipeSettings[] = [
  ...SWIPE_CHOICES.flatMap((right) =>
    SWIPE_CHOICES.map((left) => ({ enabled: true, right, left })),
  ),
  { enabled: false, right: "addToQueue", left: "remove" },
];

test("every configured direction agrees with itemActions across Library, missing and unsearched row facts", () => {
  for (let mask = 0; mask < 64; mask++) {
    for (const here of [
      "/library/songs",
      "/library/album/3",
      "/library/artist/7",
      "/favorites/artist/7",
    ]) {
      for (const download of statuses) {
        const item: ActionItem = {
          missing: (mask & 1) !== 0,
          favorite: (mask & 2) !== 0,
          inPlaylist: (mask & 4) !== 0,
          fixable: (mask & 8) !== 0,
          albumId: 3,
          artistIds: (mask & 16) !== 0 ? [7, 8] : [7],
          download,
        };
        const options = {
          here,
          onlineLookups: (mask & 32) !== 0,
          ytMusic: (mask & 16) !== 0,
          playing: (mask & 8) !== 0,
        };
        const menu = itemActions({ kind: "track", items: [item], ...options }).map(
          (entry) => entry.action,
        );
        for (const setting of settings) {
          assert.deepEqual(
            songRowSwipeDirections({ kind: "track", item, ...options }, setting),
            rowSwipeActions(menu, setting),
            JSON.stringify({ item, options, setting }),
          );
        }
      }
    }
  }
  for (const item of [
    {},
    { artistIds: [] },
    { unsearched: true, streamed: true },
    { streamed: true, downloaded: true },
    { missing: true, streamed: true },
  ] as const) {
    const menu = itemActions({ kind: "track", items: [item], here: "/search" }).map(
      (entry) => entry.action,
    );
    for (const setting of settings)
      assert.deepEqual(
        songRowSwipeDirections({ kind: "track", item, here: "/search" }, setting),
        rowSwipeActions(menu, setting),
      );
  }
});
