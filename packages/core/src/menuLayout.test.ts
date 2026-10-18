import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  discoverMixActions,
  itemActions,
  menuLayout,
  PLAY_ACTION_LABELS,
  unavailableEntryActions,
  ytAlbumDownload,
  ytSongActions,
  type ActionSubject,
  type YtAlbumSong,
} from "./index.ts";

const ytSong = (videoId: string): YtAlbumSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Portishead"],
  album: "Dummy",
  albumId: "MPREb_dummy",
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

const names = (entries: readonly { readonly action: string }[]): string[] =>
  entries.map((entry) => entry.action);

/** A Library item's menu, as `itemActions` plans it. */
const menu = (kind: ActionSubject["kind"], item: ActionSubject["items"][number] = {}) =>
  itemActions({ kind, items: [item], here: "/library", surface: "menu" });

describe("menuLayout", () => {
  test("a Library collection's menu: Play, Play Next and Add to Queue cards, Shuffle first in the list", () => {
    for (const kind of ["album", "artist", "playlist", "genre", "section"] as const) {
      const entries = menu(kind, { artistIds: [3] });
      const layout = menuLayout(kind, entries);
      assert.deepEqual(layout.cards, ["play", "playNext", "addToQueue"], kind);
      assert.equal(layout.list[0]?.action, "shuffle", kind);
      assert.deepEqual(
        names(layout.list.slice(1)),
        names(entries).filter((action) => action !== "playNext" && action !== "addToQueue"),
        kind,
      );
    }
  });

  test("a Discover mix, a YT Music album or a YT Music artist: the same cards, then Shuffle and their own entries", () => {
    const songs = [ytSong("a"), ytSong("b")];
    const download = ytAlbumDownload(songs, { inLibrary: () => false, jobs: [] });
    const mix = menuLayout("discoverMix", discoverMixActions(download));
    assert.deepEqual(mix.cards, ["play", "playNext", "addToQueue"]);
    assert.deepEqual(names(mix.list), ["shuffle", "saveAsPlaylist", "downloadAlbum"]);

    const album = menuLayout(
      "ytAlbum",
      download.actions.map((action) => ({ action })),
    );
    assert.deepEqual(album.cards, ["play", "playNext", "addToQueue"]);
    assert.deepEqual(names(album.list), ["shuffle", "downloadAlbum"]);

    const artist = menuLayout("ytArtist", []);
    assert.deepEqual(artist.cards, ["play", "playNext", "addToQueue"]);
    assert.deepEqual(names(artist.list), ["shuffle"]);
  });

  test("a song's menu (Library, YT Music or unsearched): Play Next and Add to Queue cards, no Play, no Shuffle", () => {
    const library = menuLayout("track", menu("track", { albumId: 1, artistIds: [3] }));
    assert.deepEqual(library.cards, ["playNext", "addToQueue"]);
    assert.deepEqual(names(library.list), [
      "addToPlaylist",
      "favorite",
      "goToAlbum",
      "goToArtist",
      "delete",
    ]);

    const streamed = menuLayout("ytSong", ytSongActions());
    assert.deepEqual(streamed.cards, ["playNext", "addToQueue"]);
    assert.deepEqual(names(streamed.list), ["addToPlaylist"]);

    const unsearched = menuLayout(
      "track",
      menu("track", { streamed: true, unsearched: true, artistNames: ["Björk"], inPlaylist: true }),
    );
    assert.deepEqual(unsearched.cards, ["playNext", "addToQueue"]);
    assert.ok(!names(unsearched.list).includes("playNext"));
    assert.ok(!names(unsearched.list).includes("addToQueue"));
  });

  test("a collection with no songs (a YT Music artist without any) has no cards and no Shuffle, and keeps its list", () => {
    assert.deepEqual(menuLayout("ytArtist", [], { empty: true }), { cards: [], list: [] });
    const songs = [ytSong("a")];
    const download = ytAlbumDownload(songs, { inLibrary: () => false, jobs: [] });
    const entries = download.actions.map((action) => ({ action }));
    assert.deepEqual(menuLayout("ytAlbum", entries, { empty: true }), { cards: [], list: entries });
  });

  test("a missing song, which can't be queued, and an unavailable entry show no cards and keep their list", () => {
    const missing = menu("track", { albumId: 1, artistIds: [3], missing: true });
    const layout = menuLayout("track", missing);
    assert.deepEqual(layout.cards, []);
    assert.deepEqual(layout.list, missing);

    const unavailable = unavailableEntryActions({ search: true }).map((action) => ({ action }));
    assert.deepEqual(menuLayout("unavailableEntry", unavailable), { cards: [], list: unavailable });
  });

  test("cards and the Shuffle row are labelled", () => {
    assert.deepEqual(PLAY_ACTION_LABELS, {
      play: "Play",
      playNext: "Play Next",
      addToQueue: "Add to Queue",
      shuffle: "Shuffle",
    });
  });
});
