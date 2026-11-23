import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowseRow } from "../../shared/browse.ts";
import { searchSections, type LibrarySearchView, type SearchKind } from "../../shared/search.ts";

const row = (id: number, title = `Row ${id}`): BrowseRow => ({
  id,
  title,
  artist: "",
  album: "",
  artworkHash: null,
  durationMs: 0,
  count: 0,
  year: null,
  genre: null,
  trackNumber: null,
  favorite: false,
  path: null,
  unavailable: false,
});
const rows = (count: number, from = 1) => Array.from({ length: count }, (_, i) => row(from + i));
const group = (kind: SearchKind, count: number, total = count) => ({
  kind,
  items: rows(count, kind === "song" ? 1 : 100),
  total,
});
const view = (value: Partial<LibrarySearchView>): LibrarySearchView => ({
  query: "q",
  top: null,
  groups: [],
  lyrics: [],
  lyricsFirst: false,
  namesSong: false,
  ...value,
});
const lyric = (id: number) => ({ row: row(id), line: "a line", ranges: [] });
const shape = (sections: ReturnType<typeof searchSections>) =>
  sections.map((section) =>
    section.type === "top"
      ? "top"
      : `${section.type === "lyrics" ? "lyrics" : section.kind}:${section.shown}/${section.total}${
          section.more ? " more" : ""
        }${section.capped ? " capped" : ""}`,
  );

test("Search shows Albums, Artists and Playlists shelves regardless of match ranking", () => {
  assert.deepEqual(
    shape(
      searchSections(
        view({
          groups: [group("artist", 2), group("playlist", 1), group("album", 3), group("song", 2)],
        }),
        new Set(),
      ),
    ),
    ["song:2/2", "album:3/3", "artist:2/2", "playlist:1/1"],
  );
});

test("Search shows the top result, then Songs with its lyrics, then the shelves", () => {
  const sections = searchSections(
    view({
      top: { kind: "album", row: row(100) },
      groups: [group("album", 6), group("song", 12), group("artist", 2)],
      lyrics: [lyric(50), lyric(51)],
    }),
    new Set(),
  );
  assert.deepEqual(shape(sections), [
    "top",
    "song:8/12 more",
    "lyrics:2/2",
    "album:4/6 more",
    "artist:2/2",
  ]);
});

test("a shown group opens fully, and says when only the best matches are listed", () => {
  const capped = view({ groups: [group("song", 200, 340), group("album", 3)] });
  assert.deepEqual(shape(searchSections(capped, new Set(["song"]))), [
    "song:200/340 capped",
    "album:3/3",
  ]);
  assert.deepEqual(
    shape(searchSections(view({ groups: [group("playlist", 9)] }), new Set())),
    ["playlist:9/9"],
    "a lone group shows everything",
  );
});

test("lyrics come first from three words, and after the top result when no song matches", () => {
  const lyrics = [lyric(1), lyric(2), lyric(3), lyric(4), lyric(5), lyric(6)];
  assert.deepEqual(
    shape(
      searchSections(view({ lyricsFirst: true, groups: [group("song", 2)], lyrics }), new Set()),
    ),
    ["lyrics:5/6 more", "song:2/2"],
  );
  assert.deepEqual(
    shape(
      searchSections(
        view({ top: { kind: "artist", row: row(7) }, groups: [group("artist", 1)], lyrics }),
        new Set(["lyrics"]),
      ),
    ),
    ["top", "lyrics:6/6", "artist:1/1"],
  );
});

test("a song plays at its place among the songs Search lists, lyrics hits after the Songs group", () => {
  const sections = searchSections(
    view({ groups: [group("song", 12)], lyrics: [lyric(50), lyric(51)] }),
    new Set(),
  );
  const lyricsSection = sections.find((section) => section.type === "lyrics");
  assert.equal(lyricsSection?.type === "lyrics" && lyricsSection.firstIndex, 12);
});
