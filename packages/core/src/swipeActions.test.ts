import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  itemActions,
  rowSwipeActions,
  DEFAULT_SWIPE_SETTINGS,
  SWIPE_CHOICES,
  readSwipeSettings,
  storedSwipeSettings,
  swipesChoose,
  ytDownloadActions,
  swipeChoiceLabel,
  unavailableEntryActions,
  ytSongActions,
  type ActionItem,
  type SwipeSettings,
} from "./index.ts";

/** A Library song's long-press menu, as its row offers it on [here]. */
const songMenu = (song: ActionItem, here = "/library/songs") =>
  itemActions({ kind: "track", items: [song], here }).map((entry) => entry.action);

const libraryFile: ActionItem = { albumId: 3, artistIds: [7], missing: false };

/** A Library song's menu in Songs, with online lookups on or off (Fix Song). */
const lookupsMenu = (song: ActionItem, onlineLookups: boolean) =>
  itemActions({ kind: "track", items: [song], here: "/library/songs", onlineLookups }).map(
    (entry) => entry.action,
  );

/** Both directions set to [choice]. */
const both = (choice: SwipeSettings["right"]): SwipeSettings => ({
  enabled: true,
  right: choice,
  left: choice,
});

/** A YT Music song's menu, its download entries after the rest, as its row offers them. */
const ytMenu = (
  options: Parameters<typeof ytSongActions>[1],
  download: ReturnType<typeof ytDownloadActions> = [],
) => [...ytSongActions(undefined, options).map((entry) => entry.action), ...download];

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

  test("Download runs on a missing song and does nothing on a song with a file", () => {
    const settings = { enabled: true, right: "download", left: "remove" } as const;
    assert.equal(
      rowSwipeActions(songMenu({ ...libraryFile, missing: true }), settings).right,
      "download",
    );
    assert.equal(rowSwipeActions(songMenu(libraryFile), settings).right, null);
  });

  test("Download retries a failed download and does nothing while one is on its way", () => {
    const settings = { enabled: true, right: "remove", left: "download" } as const;
    const failed = {
      ...libraryFile,
      missing: true,
      download: { kind: "failed", reason: "failed" },
    } as const;
    assert.equal(rowSwipeActions(songMenu(failed), settings).left, "retryDownload");
    const queued = { ...libraryFile, missing: true, download: { kind: "queued" } } as const;
    assert.equal(rowSwipeActions(songMenu(queued), settings).left, null);
  });
});

describe("configured swipes on each kind of row", () => {
  test("Go to Album on a YT Music song without an album does nothing", () => {
    const withAlbum = ytMenu({ album: "MPREb_1", ytMusic: true });
    assert.equal(rowSwipeActions(withAlbum, both("goToAlbum")).right, "goToAlbum");
    assert.equal(
      rowSwipeActions(ytMenu({ album: null, ytMusic: true }), both("goToAlbum")).right,
      null,
    );
  });

  test("Download on a YT Music song downloads it until the Library has it", () => {
    const notYet = ytMenu({}, ytDownloadActions(null, { inLibrary: false }));
    assert.equal(rowSwipeActions(notYet, both("download")).left, "download");
    const done = ytMenu(
      {},
      ytDownloadActions({ kind: "done", path: "/a.m4a" }, { inLibrary: true }),
    );
    assert.equal(rowSwipeActions(done, both("download")).left, null);
  });

  test("an unavailable entry offers neither a star nor a share: those directions do nothing", () => {
    const menu = unavailableEntryActions({ search: true });
    assert.deepEqual(rowSwipeActions(menu, both("favorite")), { right: null, left: null });
    assert.deepEqual(rowSwipeActions(menu, both("share")), { right: null, left: null });
  });

  test("Fix Song runs only on a song it can fix, with online lookups on", () => {
    const fixable = { ...libraryFile, fixable: true };
    assert.equal(rowSwipeActions(lookupsMenu(fixable, true), both("fixSong")).right, "fixSong");
    assert.equal(rowSwipeActions(lookupsMenu(fixable, false), both("fixSong")).right, null);
    assert.equal(rowSwipeActions(lookupsMenu(libraryFile, true), both("fixSong")).right, null);
  });
});

describe("swipesChoose", () => {
  test("says whether either direction runs a choice, never with swipes off", () => {
    const settings = { enabled: true, right: "goToArtist", left: "remove" } as const;
    assert.equal(swipesChoose(settings, "goToArtist"), true);
    assert.equal(swipesChoose(settings, "remove"), true);
    assert.equal(swipesChoose(settings, "download"), false);
    assert.equal(swipesChoose({ ...settings, enabled: false }, "goToArtist"), false);
  });
});

describe("SWIPE_CHOICES", () => {
  test("Settings offers a song row's menu actions, Remove standing for each way out", () => {
    assert.deepEqual(SWIPE_CHOICES.map(swipeChoiceLabel), [
      "Play Next",
      "Add to Queue",
      "Magic Queue",
      "Add to Playlist",
      "Favorite",
      "Download",
      "Go to Album",
      "Go to Artist",
      "Fix Song",
      "Share",
      "Remove",
    ]);
  });
});

describe("stored swipe settings", () => {
  test("a fresh install swipes, right adding to the queue and left removing", () => {
    assert.deepEqual(readSwipeSettings(null), {
      enabled: true,
      right: "addToQueue",
      left: "remove",
    });
  });

  test("nothing is kept at the defaults", () => {
    assert.equal(storedSwipeSettings(DEFAULT_SWIPE_SETTINGS), null);
  });

  test("changed settings read back as they were saved", () => {
    const settings = { enabled: false, right: "favorite", left: "goToArtist" } as const;
    assert.deepEqual(readSwipeSettings(storedSwipeSettings(settings)), settings);
  });

  test("a choice this Wave doesn't know, or a broken value, falls back to its default", () => {
    assert.deepEqual(readSwipeSettings('{"enabled":"yes","right":"teleport","left":"share"}'), {
      enabled: true,
      right: "addToQueue",
      left: "share",
    });
    assert.deepEqual(readSwipeSettings("not json"), DEFAULT_SWIPE_SETTINGS);
  });
});
