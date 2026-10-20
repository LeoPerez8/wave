import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  itemActions,
  rowSwipeActions,
  unavailableEntryActions,
  ytSongActions,
  type ActionItem,
} from "./index.ts";

/** A Library song's long-press menu, as its row offers it on [here]. */
const songMenu = (song: ActionItem, here = "/library/songs") =>
  itemActions({ kind: "track", items: [song], here }).map((entry) => entry.action);

const libraryFile: ActionItem = { albumId: 3, artistIds: [7], missing: false };

describe("rowSwipeActions", () => {
  test("a Library song swipes right to Add to Queue and left to Delete", () => {
    assert.deepEqual(rowSwipeActions(songMenu(libraryFile)), {
      right: "addToQueue",
      left: "delete",
    });
  });

  test("in a playlist, left removes the song from the playlist rather than deleting its file", () => {
    const menu = songMenu({ ...libraryFile, inPlaylist: true }, "/library/playlist/4");
    assert.deepEqual(rowSwipeActions(menu), { right: "addToQueue", left: "removeFromPlaylist" });
  });

  test("a missing song can't be queued: right is inert, left removes it from the Library", () => {
    assert.deepEqual(rowSwipeActions(songMenu({ ...libraryFile, missing: true })), {
      right: null,
      left: "removeFromLibrary",
    });
  });

  test("a YT Music song in Search queues on the right and has nothing to remove on the left", () => {
    const menu = ytSongActions(undefined, { favorite: false }).map((entry) => entry.action);
    assert.deepEqual(rowSwipeActions(menu), { right: "addToQueue", left: null });
  });

  test("a YT Music entry in a playlist swipes left out of the playlist", () => {
    const menu = ytSongActions(undefined, { inPlaylist: true }).map((entry) => entry.action);
    assert.deepEqual(rowSwipeActions(menu), { right: "addToQueue", left: "removeFromPlaylist" });
  });

  test("a playlist's unavailable entry doesn't queue but still swipes out of the playlist", () => {
    assert.deepEqual(rowSwipeActions(unavailableEntryActions({ search: true })), {
      right: null,
      left: "removeFromPlaylist",
    });
  });

  test("with swipes off, no direction runs anything", () => {
    const off = { enabled: false, right: "addToQueue", left: "remove" } as const;
    assert.deepEqual(rowSwipeActions(songMenu(libraryFile), off), { right: null, left: null });
  });

  test("a direction set to another action runs that entry of the row's menu", () => {
    const settings = { enabled: true, right: "playNext", left: "goToAlbum" } as const;
    assert.deepEqual(rowSwipeActions(songMenu(libraryFile), settings), {
      right: "playNext",
      left: "goToAlbum",
    });
  });

  test("Favorite runs as the row's menu offers the star: Remove from Favorites on a starred one", () => {
    const settings = { enabled: true, right: "favorite", left: "remove" } as const;
    assert.equal(rowSwipeActions(songMenu(libraryFile), settings).right, "favorite");
    const starred = songMenu({ ...libraryFile, favorite: true });
    assert.equal(rowSwipeActions(starred, settings).right, "unfavorite");
  });

  test("a direction set to an action the row's menu lacks does nothing on that row", () => {
    // Go to Album on the album's own page, Magic Queue on a YT Music song.
    const onAlbum = songMenu(libraryFile, "/library/album/3");
    const goToAlbum = { enabled: true, right: "goToAlbum", left: "remove" } as const;
    assert.equal(rowSwipeActions(onAlbum, goToAlbum).right, null);
    const ytMenu = ytSongActions(undefined).map((entry) => entry.action);
    const magic = { enabled: true, right: "magicQueue", left: "remove" } as const;
    assert.equal(rowSwipeActions(ytMenu, magic).right, null);
  });
});
