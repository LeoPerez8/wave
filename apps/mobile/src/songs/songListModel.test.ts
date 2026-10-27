import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, memo } from "react";
import { act, create } from "react-test-renderer";
import type { SongListRowSource } from "@wave/core";
import {
  createSongListModel,
  songRowPresentation,
  type SongRowPresentation,
} from "./songListModel.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const sources: SongListRowSource[] = [1, 2, 3].map((id) => ({
  kind: "librarySummary",
  song: {
    id,
    title: `Song ${id}`,
    artist: "Artist",
    durationMs: 180000,
    explicit: "clean",
    hasFile: true,
  },
}));

test("a playing change renders only the old and new song; a star renders one song", () => {
  const model = createSongListModel();
  const renders = new Map<string, number>();
  const Row = memo((props: SongRowPresentation) => {
    renders.set(props.rowKey, (renders.get(props.rowKey) ?? 0) + 1);
    return null;
  });
  const list = (playing: number, starred: number | null) =>
    createElement(
      "list",
      null,
      ...sources.map((source, index) => {
        const props = model.row(source, {
          playing: index + 1 === playing,
          starred: index + 1 === starred,
        });
        return createElement(Row, { ...props, key: props.rowKey });
      }),
    );
  let root: ReturnType<typeof create>;
  act(() => {
    root = create(list(1, null));
  });
  renders.clear();
  act(() => root.update(list(2, null)));
  assert.deepEqual([...renders.keys()].toSorted(), ["1", "2"]);
  renders.clear();
  act(() => root.update(list(2, 3)));
  assert.deepEqual([...renders.keys()], ["3"]);
  act(() => root.unmount());
});

test("equivalent row inputs reuse their presentation, including unchanged download statuses", () => {
  const model = createSongListModel();
  const source = sources[0]!;
  const before = model.row(source, {
    playing: true,
    leading: { kind: "playDisc" },
    download: { kind: "queued" },
  });
  const after = model.row(
    { ...source },
    { playing: true, leading: { kind: "playDisc" }, download: { kind: "queued" } },
  );
  assert.equal(after, before);
});

test("paging keeps the song key as a loading slot becomes a song; shape determines recycling", () => {
  const model = createSongListModel();
  assert.deepEqual(model.identity({ kind: "loading", key: "1" }), {
    key: "1",
    recycleType: "loadingRow",
  });
  assert.deepEqual(model.identity(sources[0]!), { key: "1", recycleType: "librarySong" });
  assert.deepEqual(model.identity({ kind: "discHeader", key: "disc-2", label: "Disc 2" }), {
    key: "disc-2",
    recycleType: "discHeader",
  });
  const source = {
    kind: "ytMusic" as const,
    song: {
      videoId: "v",
      title: "Song",
      artists: ["Artist"],
      album: null,
      durationMs: null,
      artworkUrl: null,
      explicit: false,
    },
  };
  assert.deepEqual(model.identity(source), { key: "yt:v", recycleType: "ytSong" });
  assert.equal(model.identity({ ...source, occurrence: 1 }).key, "yt:v:occurrence:1");
  assert.equal(model.identity({ ...source, key: "persisted-entry" }).key, "persisted-entry");
});

test("checking a song or advancing its missing download changes only that row's primitive props", () => {
  const model = createSongListModel();
  const missing: SongListRowSource = {
    kind: "missing",
    song: { id: 9, title: "Missing", artist: "Artist", durationMs: 180000, explicit: "explicit" },
  };
  const first = model.row(sources[0]!, { selection: "unchecked" });
  const queued = model.row(missing, { selection: "unchecked", download: { kind: "queued" } });
  const checked = model.row(missing, { selection: "checked", download: { kind: "queued" } });
  assert.equal(model.row(sources[0]!, { selection: "unchecked" }), first);
  assert.equal(checked.checked, true);
  assert.equal(checked.accessibilityRole, "checkbox");
  assert.equal(checked.accessibilityLabel, queued.accessibilityLabel);
  const progress = model.row(missing, {
    selection: "checked",
    download: { kind: "downloading", received: 25, total: 100 },
  });
  assert.equal(progress.progress, 0.25);
  assert.equal(progress.dimmed, true);
  assert.equal(progress.explicit, true);
  assert.match(progress.accessibilityLabel, /explicit/);
  assert.equal(model.row(sources[0]!, { selection: "unchecked" }), first);
  for (const value of Object.values(progress))
    assert.ok(
      value === null || typeof value !== "object",
      "leaf props contain no collections or state objects",
    );
});

test("the row cache releases old rows after its nearby-row budget", () => {
  const model = createSongListModel(2);
  const first = model.row(sources[0]!);
  model.row(sources[1]!);
  model.row(sources[2]!);
  assert.notEqual(model.row(sources[0]!), first);
});

test("a row goes by its list's key, so keyed press handlers find the item", () => {
  const model = createSongListModel();
  assert.equal(model.row(sources[0]!, {}, "playlist-item-40").rowKey, "playlist-item-40");
  assert.equal(model.row(sources[0]!).rowKey, "1");
});

test("a queue row has no star or length cell; History fades its cover and title, not the row", () => {
  const model = createSongListModel();
  const track = { title: "Song", artist: "Artist", thumbPath: null };
  const upNext = model.row({ kind: "queue", entry: { key: "a", trackId: "1" }, track });
  assert.equal(upNext.trailing, false);
  assert.equal(upNext.dimmed, false);
  assert.equal(upNext.fadedCover, false);
  const history = model.row({
    kind: "queue",
    entry: { key: "b", trackId: "1" },
    track,
    history: true,
  });
  assert.equal(history.dimmed, false);
  assert.equal(history.fadedCover, true);
  assert.equal(history.accessibilityLabel, "Song, Artist, downloaded");
  assert.equal(model.row(sources[0]!).trailing, true);
});

test("a song row's cover follows the artwork helper's order: the thumbnail derived from the original wins over another medium file", () => {
  const hash = "0123456789abcdef0123456789abcdef01234567";
  const presented = songRowPresentation({
    kind: "library",
    song: {
      id: 7,
      title: "Song",
      artist: "Artist",
      durationMs: 180000,
      explicit: "clean",
      path: "/music/song.flac",
      thumbPath: null,
      mediumPath: "/data/files/covers/song-medium.jpg",
      artworkPath: `/data/files/artwork/${hash}.jpg`,
    },
  });
  assert.equal(presented.artworkUri, `content://dev.leoperez.wave.artwork/thumbnail/${hash}`);
});
