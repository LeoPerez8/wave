import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isDestructiveAction,
  ITEM_ACTION_LABELS,
  itemActions,
  splitActionBar,
  type ActionSubject,
  type ItemAction,
  type ItemActionEntry,
} from "./index.ts";

const names = (entries: readonly ItemActionEntry[]): string[] =>
  entries.map((entry) => entry.action);

const song = (fields: { albumId?: number; artistId?: number; favorite?: boolean } = {}) => ({
  albumId: fields.albumId ?? 1,
  artistId: fields.artistId ?? 10,
  favorite: fields.favorite ?? false,
});

const tracks = (
  items: ActionSubject["items"],
  rest: Partial<Omit<ActionSubject, "items" | "kind">> = {},
): ActionSubject => ({ kind: "track", items, surface: "menu", here: "/library/songs", ...rest });

/** Albums checked in the Albums grid, by their album artists. */
const albums = (artistIds: readonly number[]): ActionSubject => ({
  kind: "album",
  items: artistIds.map((artistId) => ({ artistId })),
  surface: "selection",
  here: "/library/albums",
});

describe("itemActions", () => {
  test("a song's menu: queue it, add it to a playlist, star it, go to its album and artist, delete it", () => {
    assert.deepEqual(names(itemActions(tracks([song()]))), [
      "playNext",
      "addToQueue",
      "addToPlaylist",
      "favorite",
      "goToAlbum",
      "goToArtist",
      "delete",
    ]);
  });

  test("Delete comes last for songs, after Select, and is the destructive one", () => {
    const menu = itemActions(tracks([song()], { selectable: true }));
    assert.deepEqual(names(menu).slice(-2), ["select", "delete"]);
    assert.deepEqual(
      Object.keys(ITEM_ACTION_LABELS).filter((action) => isDestructiveAction(action as ItemAction)),
      ["delete"],
    );
    assert.ok(!names(itemActions({ kind: "album", items: [{}], here: "/" })).includes("delete"));
  });

  test("a starred song offers Remove from Favorites instead", () => {
    assert.deepEqual(
      names(itemActions(tracks([song({ favorite: true })]))).filter((name) => name.includes("av")),
      ["unfavorite"],
    );
  });

  test("Select shows in the menu of a list that can select, never in the selection bar", () => {
    assert.ok(names(itemActions(tracks([song()], { selectable: true }))).includes("select"));
    assert.ok(!names(itemActions(tracks([song()]))).includes("select"));
    assert.ok(
      !names(itemActions(tracks([song()], { selectable: true, surface: "selection" }))).includes(
        "select",
      ),
    );
  });

  test("for one song the selection bar offers exactly the menu's entries, Select aside", () => {
    const subject = tracks([song({ favorite: true })], { selectable: true });
    assert.deepEqual(
      itemActions({ ...subject, surface: "selection" }),
      itemActions(subject).filter((entry) => entry.action !== "select"),
    );
  });

  test("Go to Album and Go to Artist lead where the songs all are", () => {
    const entries = itemActions(tracks([song({ albumId: 4, artistId: 9 })]));
    assert.deepEqual(
      entries.filter((entry) => entry.action === "goToAlbum" || entry.action === "goToArtist"),
      [
        { action: "goToAlbum", albumId: 4 },
        { action: "goToArtist", artistId: 9 },
      ],
    );
  });

  test("songs from different albums of one artist offer Go to Artist only", () => {
    const entries = names(
      itemActions(
        tracks([song({ albumId: 1, artistId: 5 }), song({ albumId: 2, artistId: 5 })], {
          surface: "selection",
        }),
      ),
    );
    assert.ok(!entries.includes("goToAlbum"));
    assert.ok(entries.includes("goToArtist"));
  });

  test("songs by different artists on one album offer Go to Album only", () => {
    const entries = names(
      itemActions(
        tracks([song({ albumId: 3, artistId: 5 }), song({ albumId: 3, artistId: 6 })], {
          surface: "selection",
        }),
      ),
    );
    assert.ok(entries.includes("goToAlbum"));
    assert.ok(!entries.includes("goToArtist"));
  });

  test("no Go to entry for the page you're already on", () => {
    const entries = names(
      itemActions(tracks([song({ albumId: 4, artistId: 9 })], { here: "/library/album/4" })),
    );
    assert.ok(!entries.includes("goToAlbum"));
    assert.ok(entries.includes("goToArtist"));
  });

  test("Favorite stars the selection unless every song in it is starred already", () => {
    const mixed = tracks([song({ favorite: true }), song()], { surface: "selection" });
    const starred = tracks([song({ favorite: true }), song({ favorite: true })], {
      surface: "selection",
    });
    assert.ok(names(itemActions(mixed)).includes("favorite"));
    assert.ok(names(itemActions(starred)).includes("unfavorite"));
    assert.ok(!names(itemActions(starred)).includes("favorite"));
  });

  test("songs opened from a playlist offer Remove from Playlist", () => {
    const inPlaylist = { ...song(), inPlaylist: true };
    assert.ok(names(itemActions(tracks([inPlaylist]))).includes("removeFromPlaylist"));
    assert.ok(!names(itemActions(tracks([song()]))).includes("removeFromPlaylist"));
  });

  test("an album: queue it, add it to a playlist, go to its artist", () => {
    assert.deepEqual(names(itemActions({ kind: "album", items: [{ artistId: 3 }], here: "/" })), [
      "playNext",
      "addToQueue",
      "addToPlaylist",
      "goToArtist",
    ]);
  });

  test("selected albums: the menu's entries, Go to Artist only when they share an album artist, no Favorite", () => {
    assert.deepEqual(names(itemActions(albums([3, 3]))), [
      "playNext",
      "addToQueue",
      "addToPlaylist",
      "goToArtist",
    ]);
    assert.deepEqual(names(itemActions(albums([3, 4]))), [
      "playNext",
      "addToQueue",
      "addToPlaylist",
    ]);
    assert.deepEqual(
      names(itemActions({ kind: "album", items: [{ artistId: 3 }], selectable: true, here: "/" })),
      ["playNext", "addToQueue", "addToPlaylist", "goToArtist", "select"],
    );
  });

  test("a playlist can be renamed and deleted, one at a time", () => {
    const one = names(itemActions({ kind: "playlist", items: [{}], here: "/" }));
    assert.deepEqual(one.slice(-2), ["renamePlaylist", "deletePlaylist"]);
    const two = names(
      itemActions({ kind: "playlist", items: [{}, {}], here: "/", surface: "selection" }),
    );
    assert.ok(!two.includes("renamePlaylist"));
  });

  test("a genre, folder, artist or Library entry: queue it and add it to a playlist", () => {
    for (const kind of ["genre", "folder", "artist", "section"] as const) {
      assert.deepEqual(names(itemActions({ kind, items: [{}], here: "/" })), [
        "playNext",
        "addToQueue",
        "addToPlaylist",
      ]);
    }
  });

  test("an empty selection offers nothing", () => {
    assert.deepEqual(itemActions(tracks([], { surface: "selection" })), []);
  });
});

describe("splitActionBar", () => {
  test("every entry gets a button when they fit", () => {
    assert.deepEqual(splitActionBar(["a", "b", "c"], 5), { bar: ["a", "b", "c"], more: [] });
    assert.deepEqual(splitActionBar(["a", "b", "c", "d", "e"], 5), {
      bar: ["a", "b", "c", "d", "e"],
      more: [],
    });
  });

  test("past the slots, the last slot becomes More and holds the rest, in order", () => {
    assert.deepEqual(splitActionBar(["a", "b", "c", "d", "e", "f"], 5), {
      bar: ["a", "b", "c", "d"],
      more: ["e", "f"],
    });
  });
});
