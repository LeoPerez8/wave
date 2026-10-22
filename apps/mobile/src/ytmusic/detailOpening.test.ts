import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import {
  ytAlbumOpening,
  ytArtistOpeningState,
  ytArtistPageOpening,
  ytArtistSectionView,
  YT_ARTIST_SECTION_START,
} from "@wave/core";
import { artistOpeningRequest } from "./artistOpeningRequest.ts";

for (const page of ["artist", "album", "named YT artist"] as const) {
  test(`${page} shows offline before settlement and bypasses a YouTube API that never answers`, async () => {
    let requests = 0;
    const request = Effect.promise(() => {
      requests++;
      return new Promise<never>(() => {});
    });
    const state = YT_ARTIST_SECTION_START;
    const context = { enabled: true, now: 1000, settled: false, online: false };
    const note =
      page === "artist"
        ? ytArtistSectionView(ytArtistOpeningState(state, false), {
            ...context,
            name: "Justice",
            integrated: true,
            inLibrary: () => true,
          })?.note
        : page === "album"
          ? ytAlbumOpening(state, {
              ...context,
              name: "Justice",
              artistId: 1,
              album: { title: "Cross", albumArtistIds: [1] },
              tracks: [],
              elsewhere: () => null,
              integrated: true,
              contentReady: false,
              releasePage: () => undefined,
            }).view?.note
          : ytArtistPageOpening(state, {
              ...context,
              librarySong: () => null,
              libraryAlbum: () => null,
            }).view.note;
    assert.equal(note, "offline", "rendering the note waits for no saved-answer read or finder");
    // The production execution boundary also handles a network loss after scheduling.
    let connected = true;
    const guarded = artistOpeningRequest(() => connected, request);
    connected = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    try {
      const result = await Effect.runPromise(Effect.flip(guarded), { signal: controller.signal });
      assert.deepEqual(result, { reason: "offline" });
      assert.equal(requests, 0);
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  });
}
