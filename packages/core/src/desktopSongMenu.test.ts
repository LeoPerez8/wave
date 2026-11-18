import assert from "node:assert/strict";
import { test } from "node:test";
import { desktopSongActions } from "./desktopSongMenu.ts";
import { catalogueOf } from "./localisation.ts";

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
    "select",
    "removeFromLibrary",
  ]);
});

test("Magic Queue, Copy Link and Fix Song join the menu once their features do", () => {
  assert.deepEqual(
    actions({
      items: [{ ...song, fixable: true }],
      selectable: true,
      ytMusic: true,
      onlineLookups: true,
      copyLink: true,
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
      "share",
      "select",
      "removeFromLibrary",
    ],
  );
  assert.equal(catalogueOf("en", "desktop").itemActions.labels.share, "Copy Link");
  assert.equal(catalogueOf("pt-BR", "desktop").itemActions.labels.share, "Copiar Link");
});

test("the selection bar acts on every checked song and leaves out the single-song entries", () => {
  const other = { albumId: 8, artistIds: [4], favorite: true };
  assert.deepEqual(actions({ items: [song, other], surface: "selection", copyLink: true }), [
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
    "addToPlaylist",
    "favorite",
    "goToAlbum",
    "goToArtist",
    "removeFromLibrary",
  ]);
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
    "select",
    "removeFromLibrary",
  ]);
  assert.ok(
    actions({ items: [listed, listed], surface: "selection" }).includes("removeFromPlaylist"),
  );
  assert.ok(!actions({ items: [song] }).includes("removeFromPlaylist"));
});
