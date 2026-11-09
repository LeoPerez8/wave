/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { EMPTY_QUEUE, reduceQueue, songsToMeasure } from "@wave/core";
import { addTrack, openTestDatabase } from "../library/db/testDatabase.ts";
import {
  saveMeasurement,
  selectAlbumLoudness,
  selectSongLoudness,
  selectSongsToMeasure,
} from "../library/db/loudness.ts";
import * as schema from "../library/db/schema.ts";
import { createEntryGains } from "./songGains.ts";
import { createSongMeasurements } from "./songMeasurements.ts";

test("the queue runner measures the whole album first and delivers completion without a Library change", async () => {
  const db = await openTestDatabase();
  const ids = Array.from({ length: 8 }, (_, i) =>
    addTrack(db, {
      title: `Song ${i}`,
      album: "Live",
      artist: "Band",
      durationMs: 10_000,
      trackNumber: i + 1,
    }),
  );
  const outside = addTrack(db, { title: "Hand-lined", album: "Other" });
  db.update(schema.tracks).set({ modifiedAt: 1 }).run();
  // A new test database's first album has id 1.
  const albumId = 1;
  const state = reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: ids.map(String),
    startIndex: 0,
    context: { kind: "album", id: String(albumId) },
  }).state;
  const withManual = reduceQueue(state, { type: "playNext", trackIds: [String(outside)] }).state;
  const gains = createEntryGains();
  for (const entry of withManual.entries)
    gains.withItem(entry, new Map(), {
      state: withManual,
      album: selectAlbumLoudness(db, albumId),
    });
  const paths: string[] = [];
  let albumUpdates = 0;
  const runner = createSongMeasurements({
    on: () => true,
    wanted: () => songsToMeasure(withManual),
    songsToMeasure: () =>
      Effect.sync(() =>
        selectSongsToMeasure(db, songsToMeasure(withManual, selectAlbumLoudness(db, albumId))),
      ),
    measure: async (path) => {
      paths.push(path);
      return { kind: "measured", loudness: -10, peak: 0.5 };
    },
    cancel: () => {},
    save: (song, value) => Effect.sync(() => saveMeasurement(db, song, value)),
    learned: () => {
      const updates = gains.changes(withManual.entries, selectSongLoudness(db, [...ids, outside]), {
        state: withManual,
        album: selectAlbumLoudness(db, albumId),
      });
      albumUpdates += updates.filter((update) => update.gainSource === "album").length;
    },
  });
  await runner.wake();
  const albumPaths = selectAlbumLoudness(db, albumId)!.songs.map(
    (song) => `/Music/Live/Song ${ids.indexOf(song.id)}.mp3`,
  );
  // The hand-lined song is second in Up Next but is measured after all eight album songs.
  assert.equal(paths.length, 9);
  assert.deepEqual(paths.slice(0, 8), albumPaths);
  assert.equal(albumUpdates, 8);
  assert.equal(
    gains.changes(withManual.entries, selectSongLoudness(db, [...ids, outside]), {
      state: withManual,
      album: selectAlbumLoudness(db, albumId),
    }).length,
    0,
  );
});
