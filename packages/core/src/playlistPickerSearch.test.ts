import assert from "node:assert/strict";
import { test } from "node:test";

import { createPlaylistPickerSearch, stepPlaylistPickerSearch } from "./index.ts";

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

test("clear keeps a nonempty search open, empty clear closes it, and Back closes search before the card", () => {
  assert.deepEqual(stepPlaylistPickerSearch(null, "open"), { query: "", dismiss: false });
  assert.deepEqual(stepPlaylistPickerSearch("cafe", "clear"), { query: "", dismiss: false });
  assert.deepEqual(stepPlaylistPickerSearch("", "clear"), { query: null, dismiss: false });
  const back = stepPlaylistPickerSearch("cafe", "back");
  assert.deepEqual(back, { query: null, dismiss: false });
  assert.deepEqual(stepPlaylistPickerSearch(back.query, "back"), { query: null, dismiss: true });
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
