import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopSelectionActions, desktopSongActions } from "./desktopSongMenu.ts";

const song = { albumId: 7, artistIds: [3], favorite: false };
const actions = (subject: Parameters<typeof desktopSongActions>[0]) =>
  desktopSongActions(subject).map((entry) => entry.action);

test("a song's menu holds the desktop's entries in the phone's order", () => {
  assert.deepEqual(actions({ items: [song], selectable: true }), [
    "playNext",
    "addToQueue",
    "addToPlaylist",
    "favorite",
    "goToAlbum",
    "goToArtist",
    "releaseDate",
    "showInFolder",
    "select",
    "removeFromLibrary",
  ]);
});

test("Magic Queue, Share and Fix Song join the menu once their features do", () => {
  assert.deepEqual(
    actions({
      items: [{ ...song, fixable: true }],
      selectable: true,
      ytMusic: true,
      onlineLookups: true,
      share: true,
    }),
    [
      "playNext",
      "addToQueue",
      "magicQueue",
      "addToPlaylist",
      "favorite",
      "goToAlbum",
      "goToArtist",
      "fixSong",
      "releaseDate",
      "share",
      "showInFolder",
      "select",
      "removeFromLibrary",
    ],
  );
});

test("the selection bar acts on every checked song and leaves out the single-song entries", () => {
  const other = { albumId: 8, artistIds: [4], favorite: true };
  assert.deepEqual(actions({ items: [song, other], surface: "selection", share: true }), [
    "playNext",
    "addToQueue",
    "addToPlaylist",
    "favorite",
    "removeFromLibrary",
  ]);
  assert.deepEqual(actions({ items: [{ ...song, favorite: true }], surface: "selection" }), [
    "playNext",
    "addToQueue",
    "addToPlaylist",
    "unfavorite",
    "goToAlbum",
    "goToArtist",
    "removeFromLibrary",
  ]);
});

test("Go to leaves out the page you're on and offers a choice of several artists", () => {
  const entries = desktopSongActions({
    items: [{ ...song, artistIds: [3, 5] }],
    page: { kind: "album", id: 7 },
  });
  assert.equal(
    entries.some((entry) => entry.action === "goToAlbum"),
    false,
  );
  assert.deepEqual(
    entries.find((entry) => entry.action === "goToArtist"),
    { action: "goToArtist", artists: { kind: "choose", artistIds: [3, 5] } },
  );
  const onArtist = desktopSongActions({ items: [song], page: { kind: "artist", id: 3 } });
  assert.equal(
    onArtist.some((entry) => entry.action === "goToArtist"),
    false,
  );
});

test("a missing song can't be queued but can leave the Library, as on the phone", () => {
  assert.deepEqual(actions({ items: [{ ...song, missing: true }] }), [
    "download",
    "addToPlaylist",
    "favorite",
    "goToAlbum",
    "goToArtist",
    "releaseDate",
    "removeFromLibrary",
  ]);
});

test("one song's menu offers Release Date, whatever kind of song it is, as on the phone", () => {
  assert.ok(actions({ items: [{ ...song, missing: true }] }).includes("releaseDate"));
  assert.ok(actions({ items: [{ streamed: true }] }).includes("releaseDate"));
  assert.ok(!actions({ items: [song, song], surface: "selection" }).includes("releaseDate"));
});

test("Show in Folder is one song's with a file: not a missing song's, nor a streamed one's", () => {
  assert.ok(actions({ items: [song] }).includes("showInFolder"));
  assert.ok(!actions({ items: [{ ...song, missing: true }] }).includes("showInFolder"));
  assert.ok(!actions({ items: [{ streamed: true }] }).includes("showInFolder"));
  assert.ok(!actions({ items: [song, song], surface: "selection" }).includes("showInFolder"));
});

test("no songs, no entries", () => {
  assert.deepEqual(actions({ items: [] }), []);
});

test("a playlist's songs can leave it, from their menu or the selection bar", () => {
  const listed = { ...song, inPlaylist: true };
  assert.deepEqual(actions({ items: [listed], selectable: true }), [
    "playNext",
    "addToQueue",
    "addToPlaylist",
    "favorite",
    "removeFromPlaylist",
    "goToAlbum",
    "goToArtist",
    "releaseDate",
    "showInFolder",
    "select",
    "removeFromLibrary",
  ]);
  assert.ok(
    actions({ items: [listed, listed], surface: "selection" }).includes("removeFromPlaylist"),
  );
  assert.ok(!actions({ items: [song] }).includes("removeFromPlaylist"));
});

test("missing songs offer Download individually and together, including beside a local song", () => {
  const missing = { ...song, missing: true };
  assert.equal(actions({ items: [missing] })[0], "download");
  assert.ok(actions({ items: [missing, missing], surface: "selection" }).includes("download"));
  assert.ok(actions({ items: [missing, song], surface: "selection" }).includes("download"));
});

const selection = (subject: Parameters<typeof desktopSelectionActions>[0]) =>
  desktopSelectionActions(subject).map((entry) => entry.action);

test("a song and an album checked together offer what both kinds share", () => {
  assert.deepEqual(
    selection({
      items: [
        { kind: "track", ...song, fixable: true },
        { kind: "album", artistIds: [3], songs: [{ fixable: true }] },
      ],
      onlineLookups: true,
    }),
    ["playNext", "addToQueue", "addToPlaylist"],
  );
});

test("checked collections of one kind offer Fix Songs, and none of a single item's entries", () => {
  assert.deepEqual(
    selection({
      items: [
        { kind: "playlist", songs: [{ fixable: true }] },
        { kind: "playlist", songs: [] },
      ],
      onlineLookups: true,
    }),
    ["playNext", "addToQueue", "addToPlaylist", "fixSongs"],
  );
});

test("Download shows when a checked item holds a song without a file", () => {
  const album = { kind: "album" as const, songs: [{ missing: true }, {}] };
  assert.deepEqual(selection({ items: [album, { kind: "artist", songs: [{}] }] }), [
    "playNext",
    "addToQueue",
    "addToPlaylist",
    "download",
  ]);
  const streamed = { kind: "playlist" as const, songs: [{ streamed: true }] };
  assert.ok(selection({ items: [streamed, { kind: "track", ...song }] }).includes("download"));
  assert.ok(
    !selection({
      items: [
        { kind: "playlist", songs: [{ streamed: true, downloaded: true }] },
        { kind: "genre", songs: [{}] },
      ],
    }).includes("download"),
  );
  assert.ok(
    selection({
      items: [
        { kind: "track", missing: true },
        { kind: "genre", songs: [{}] },
      ],
    }).includes("download"),
  );
});

test("checked songs alone keep the song selection's entries", () => {
  assert.deepEqual(
    selection({
      items: [
        { kind: "track", ...song },
        { kind: "track", ...song },
      ],
    }),
    actions({ items: [song, song], surface: "selection" }),
  );
});
