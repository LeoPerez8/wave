/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { removeDislikes, selectDislikedTracks, selectDislikes, setDislikes } from "./dislikes.ts";
import { selectFavoriteTrackIds, setFavorites } from "./playHistory.ts";
import * as schema from "./schema.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const song = (key: string, title: string) => ({
  key,
  title,
  artists: ["Daft Punk", "Pharrell Williams"],
  durationMs: 240_000,
});

describe("dislikes", () => {
  test("a disliked song is kept with how it was listed and when, the newest first", () => {
    setDislikes(db, [song("7", "Get Lucky")], 1_000);
    setDislikes(db, [song("yt:abc", "Contact")], 2_000);
    assert.deepEqual(selectDislikes(db), [
      { ...song("yt:abc", "Contact"), dislikedAt: 2_000 },
      { ...song("7", "Get Lucky"), dislikedAt: 1_000 },
    ]);
  });

  test("disliking a song again keeps when it was first disliked", () => {
    setDislikes(db, [song("7", "Get Lucky")], 1_000);
    setDislikes(db, [song("7", "Get Lucky (Radio Edit)")], 5_000);
    assert.deepEqual(selectDislikes(db), [
      { ...song("7", "Get Lucky (Radio Edit)"), dislikedAt: 1_000 },
    ]);
  });

  test("a removed dislike is gone, the others stay", () => {
    setDislikes(db, [song("7", "Get Lucky"), song("yt:abc", "Contact")], 1_000);
    removeDislikes(db, ["7", "7", "unknown"], 2_000);
    assert.deepEqual(
      selectDislikes(db).map((dislike) => dislike.key),
      ["yt:abc"],
    );
  });

  test("a song disliked again after its dislike was removed is disliked since then", () => {
    setDislikes(db, [song("7", "Get Lucky")], 1_000);
    removeDislikes(db, ["7"], 2_000);
    setDislikes(db, [song("7", "Get Lucky")], 3_000);
    assert.deepEqual(selectDislikes(db), [{ ...song("7", "Get Lucky"), dislikedAt: 3_000 }]);
  });

  test("a star removes its song's dislike, kept under the Track or under its video, and names it", () => {
    const lucky = addTrack(db, { title: "Get Lucky" });
    const contact = addTrack(db, { title: "Contact" });
    const other = addTrack(db, { title: "Motherboard" });
    db.update(schema.tracks).set({ videoId: "abc" }).where(eq(schema.tracks.id, contact)).run();
    setDislikes(
      db,
      [
        song(String(lucky), "Get Lucky"),
        song("yt:abc", "Contact"),
        song(String(other), "Motherboard"),
        song("yt:streamed", "Beyond"),
      ],
      1_000,
    );

    const removed = setFavorites(db, [lucky, contact], true, 2_000);

    assert.deepEqual(removed.toSorted(), [String(lucky), "yt:abc"].toSorted());
    assert.deepEqual(selectFavoriteTrackIds(db).toSorted(), [lucky, contact].toSorted());
    assert.deepEqual(
      selectDislikes(db).map((dislike) => dislike.title),
      ["Beyond", "Motherboard"],
    );
    // The removals wait to go up, as Remove dislike's do.
    assert.deepEqual(
      db
        .select({ key: schema.dislikes.songKey, pushed: schema.dislikes.pushed })
        .from(schema.dislikes)
        .where(eq(schema.dislikes.deleted, true))
        .all()
        .toSorted((a, b) => a.key.localeCompare(b.key)),
      [
        { key: String(lucky), pushed: false },
        { key: "yt:abc", pushed: false },
      ],
    );
  });

  test("unstarring, and starring a song that isn't disliked, leave the dislikes alone", () => {
    const lucky = addTrack(db, { title: "Get Lucky" });
    const contact = addTrack(db, { title: "Contact" });
    setFavorites(db, [lucky], true, 1_000);
    setDislikes(db, [song(String(contact), "Contact")], 2_000);

    assert.deepEqual(setFavorites(db, [lucky], false, 3_000), []);
    assert.deepEqual(setFavorites(db, [lucky], true, 4_000), []);
    assert.deepEqual(
      selectDislikes(db).map((dislike) => dislike.title),
      ["Contact"],
    );
  });
});

describe("the Library's songs the dislikes are about", () => {
  const downloaded = (title: string, videoId: string): number => {
    const id = addTrack(db, { title });
    db.update(schema.tracks).set({ videoId }).where(eq(schema.tracks.id, id)).run();
    return id;
  };
  const byId = (a: { id: number }, b: { id: number }) => a.id - b.id;

  test("a song disliked by its video is told with the Track downloaded from it", () => {
    const lucky = downloaded("Get Lucky", "abc");
    downloaded("Contact", "def");
    setDislikes(db, [song("yt:abc", "Get Lucky")], 1_000);
    assert.deepEqual(selectDislikedTracks(db), [{ id: lucky, videoId: "abc" }]);
  });

  test("a song disliked by its Track id is told with its video, one without a video isn't", () => {
    const lucky = downloaded("Get Lucky", "abc");
    const ripped = addTrack(db, { title: "Ripped" });
    setDislikes(db, [song(String(lucky), "Get Lucky"), song(String(ripped), "Ripped")], 1_000);
    assert.deepEqual(selectDislikedTracks(db), [{ id: lucky, videoId: "abc" }]);
  });

  test("a song disliked under both keys is told once, and both Tracks of one video are told", () => {
    const lucky = downloaded("Get Lucky", "abc");
    const again = downloaded("Get Lucky (copy)", "abc");
    setDislikes(db, [song("yt:abc", "Get Lucky"), song(String(lucky), "Get Lucky")], 1_000);
    assert.deepEqual(selectDislikedTracks(db).sort(byId), [
      { id: lucky, videoId: "abc" },
      { id: again, videoId: "abc" },
    ]);
  });

  test("a removed dislike tells no song", () => {
    downloaded("Get Lucky", "abc");
    setDislikes(db, [song("yt:abc", "Get Lucky")], 1_000);
    removeDislikes(db, ["yt:abc"], 2_000);
    assert.deepEqual(selectDislikedTracks(db), []);
  });
});
