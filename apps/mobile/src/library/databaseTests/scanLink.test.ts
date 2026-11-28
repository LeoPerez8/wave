/** #1529: a scan that changed nothing doesn't link playlists' entries again, in this process or the next. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { scanEnd } from "@wave/core";
import {
  appendPlaylistSongs,
  createPlaylist,
  selectPlaylistEntries,
} from "@wave/client/db/playlists";
import { addLibrary, addTrack, closeTestDatabase, openTestDatabase } from "@wave/client/testing";

import { loadLibraryStore } from "../../../bench/fastAgain/store.ts";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));

const streamed = (videoId: string, title: string) =>
  ({
    source: "stream",
    song: {
      videoId,
      title,
      artists: ["Radiohead"],
      album: "OK Computer",
      albumId: "MPREb_ok",
      durationMs: 180_000,
      artworkUrl: null,
      explicit: false,
    },
  }) as const;

/** What a scan that read, saved and lost nothing decides at its end. */
const quietScanLinks = (store: Awaited<ReturnType<typeof loadLibraryStore>>) => {
  const { entries, linked } = Effect.runSync(store.playlistLinkRevisions);
  return scanEnd({
    saved: 0,
    gone: 0,
    entriesRevision: entries,
    linkedRevision: linked,
    firstScan: false,
  }).linkEntries;
};

test("a scan that changed nothing links again only when entries changed, even in a new process", async () => {
  const db = await openTestDatabase();
  try {
    addLibrary(db, { tracks: 200, artists: 10, albums: 20 });
    const { playlistId } = createPlaylist(db, "Drive", [streamed("a", "Lucky")], 0);

    const first = await loadLibraryStore(root, db);
    // No link has run on this Library: the first scan links.
    assert.equal(quietScanLinks(first), true);
    await Effect.runPromise(first.linkPlaylistEntries);
    assert.equal(quietScanLinks(first), false);

    // Wave starts again (a new process, a new store on the same Library): still nothing to link.
    const next = await loadLibraryStore(root, db);
    assert.equal(quietScanLinks(next), false);

    // An entry comes (a sync, an import) and the Library meanwhile has its song: the link is due
    // and the entry becomes that song.
    appendPlaylistSongs(db, playlistId, [streamed("b", "Reckoner")], 0);
    addTrack(db, { title: "Reckoner", artist: "Radiohead", durationMs: 180_000 });
    assert.equal(quietScanLinks(next), true);
    assert.equal(await Effect.runPromise(next.linkPlaylistEntries), 1);
    assert.deepEqual(
      selectPlaylistEntries(db, playlistId).map((entry) => entry.source),
      ["stream", "library"],
    );
    assert.equal(quietScanLinks(next), false);
  } finally {
    closeTestDatabase(db);
  }
});
