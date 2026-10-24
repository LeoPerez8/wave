import assert from "node:assert/strict";
import { test } from "node:test";
import { selectionOf, type YtArtistAlbum } from "@wave/core";
import type { NativeYtSong } from "../native/waveYtMusic.ts";
import { mixedItemKey, type MixedItem } from "../playback/mixedItems.ts";
import { trackSelectionOf, ytAlbumSelectionOf } from "./mixedSelection.ts";
import { selectableRow } from "./selectableRow.ts";
import type { ListSelection } from "./useListSelection.ts";

test("release tiles and song rows share marks, and selecting taps check instead of opening", () => {
  const release: YtArtistAlbum = {
    kind: "album",
    browseId: "release",
    title: "Album",
    artists: ["Artist"],
    year: null,
    artworkUrl: null,
  };
  const song: NativeYtSong = {
    videoId: "song",
    title: "Song",
    artists: ["Artist"],
    album: null,
    albumId: null,
    durationMs: 180000,
    artworkUrl: null,
    explicit: false,
  };
  const checked = new Set(["track-yt:song"]);
  const page: ListSelection<MixedItem> = {
    selecting: true,
    selection: selectionOf([...checked]),
    isChecked: (item) => checked.has(mixedItemKey(item)),
    start: () => assert.fail("selection already started"),
    toggle: (item) => {
      const key = mixedItemKey(item);
      if (checked.has(key)) checked.delete(key);
      else checked.add(key);
    },
  };
  const open = () => assert.fail("selecting must not open or load the item");
  const row = () => selectableRow(release, ytAlbumSelectionOf(page), open, open);
  assert.equal(row().checked, false);
  assert.equal(selectableRow({ ytSong: song }, trackSelectionOf(page), open, open).checked, true);
  row().onPress();
  assert.equal(row().checked, true);
  row().onLongPress();
  assert.equal(row().checked, true);
  row().onPress();
  assert.equal(row().checked, false);
});
