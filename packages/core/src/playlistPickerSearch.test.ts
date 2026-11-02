import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createPlaylistPickerSearch,
  playlistPickerSubjectScrolls,
  placeOverlayCard,
  stepPlaylistPickerSearch,
} from "./index.ts";

test("a short search card scrolls the subject so its fixed field leaves room for results", () => {
  const frame = placeOverlayCard({
    window: { width: 800, height: 360 },
    insets: { top: 24, bottom: 0, left: 0, right: 0 },
    margin: 24,
    maxWidth: 480,
    cardHeight: 600,
    searching: true,
    keyboard: 190,
  });
  assert.equal(frame.maxHeight, 98);
  assert.equal(
    playlistPickerSubjectScrolls({
      searching: true,
      maxHeight: frame.maxHeight,
      fixedHeight: 100,
      entryHeight: 56,
    }),
    true,
  );
});

test("the subject stays under the field with room for a result row, including in portrait", () => {
  const layout = { searching: true, fixedHeight: 100, entryHeight: 56 };
  assert.equal(playlistPickerSubjectScrolls({ ...layout, maxHeight: 491 }), false);
  assert.equal(playlistPickerSubjectScrolls({ ...layout, maxHeight: 156 }), false);
  assert.equal(playlistPickerSubjectScrolls({ ...layout, maxHeight: 155.5 }), true);
  assert.equal(
    playlistPickerSubjectScrolls({
      ...layout,
      maxHeight: 98,
      searching: false,
    }),
    false,
  );
});

test("larger measured text moves the subject into entries sooner, including at zero height", () => {
  assert.equal(
    playlistPickerSubjectScrolls({
      searching: true,
      maxHeight: 220,
      fixedHeight: 160,
      entryHeight: 112,
    }),
    true,
  );
  assert.equal(
    playlistPickerSubjectScrolls({
      searching: true,
      maxHeight: 0,
      fixedHeight: 100,
      entryHeight: 56,
    }),
    true,
  );
});

test("the picker finds names with Find in Playlists' word rules and keeps the supplied order", () => {
  const playlists = [
    { id: 3, name: "Café da manhã", artist: "Other" },
    { id: 1, name: "Manhã, café!", artist: "Other" },
    { id: 2, name: "Afternoon", artist: "Café manhã" },
  ];
  const search = createPlaylistPickerSearch(playlists);
  assert.deepEqual(
    search.show("MAN ca").playlists.map((playlist) => playlist.id),
    [3, 1],
  );
});

test("clear keeps a nonempty search open, empty clear and Back restore the title", () => {
  assert.deepEqual(stepPlaylistPickerSearch(null, "open"), { query: "" });
  assert.deepEqual(stepPlaylistPickerSearch("cafe", "clear"), { query: "" });
  assert.deepEqual(stepPlaylistPickerSearch("", "clear"), { query: null });
  const back = stepPlaylistPickerSearch("cafe", "back");
  assert.deepEqual(back, { query: null });
});

test("text hides New Playlist, clearing restores it, and a missing name has a no-match line", () => {
  const search = createPlaylistPickerSearch([{ name: "Morning" }]);
  assert.equal(search.show("missing").noMatch, true);
  assert.equal(search.show("missing").showNewPlaylist, false);
  assert.equal(search.show("!!!").showNewPlaylist, false);
  assert.equal(search.show("!!!").noMatch, false);
  assert.equal(search.show("").showNewPlaylist, true);
  assert.equal(search.show(null).showNewPlaylist, true);
  assert.deepEqual(search.show("").playlists, [{ name: "Morning" }]);
});
