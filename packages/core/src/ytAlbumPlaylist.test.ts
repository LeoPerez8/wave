import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ytAlbumPlaylistOpening } from "./index.ts";

describe("the album a YouTube Music album playlist opens", () => {
  const head = {
    title: "Pink Moon",
    author: "Nick Drake",
    artworkUrl: "https://yt3.googleusercontent.com/pink",
  };
  const row = (albumId: string | null) => ({ albumId });

  test("is the album its songs name, headed by the playlist's title, maker and cover", async () => {
    assert.deepEqual(
      await ytAlbumPlaylistOpening(async () => ({
        ok: true,
        playlist: { ...head, songs: [row("MPREb_06zfD9zt7QK"), row("MPREb_06zfD9zt7QK")] },
      })),
      {
        album: "MPREb_06zfD9zt7QK",
        read: { title: "Pink Moon", artists: ["Nick Drake"], artworkUrl: head.artworkUrl },
      },
    );
  });

  test("the album most of its songs name wins over a stray one", async () => {
    const opening = await ytAlbumPlaylistOpening(async () => ({
      ok: true,
      playlist: {
        ...head,
        songs: [row("MPREb_other"), row(null), row("MPREb_pink"), row("MPREb_pink")],
      },
    }));
    assert.equal("album" in opening && opening.album, "MPREb_pink");
  });

  test("a playlist whose songs name no album isn't found as one", async () => {
    assert.deepEqual(
      await ytAlbumPlaylistOpening(async () => ({
        ok: true,
        playlist: { ...head, author: null, songs: [row(null)] },
      })),
      { play: "failed", failure: { albumNotFound: { title: "Pink Moon", artists: [] } } },
    );
  });

  test("no answer says why: offline, YT Music off, or YouTube Music not answering", async () => {
    for (const [reason, failure] of [
      ["offline", "albumOffline"],
      ["disabled", "disabled"],
      ["failed", "failed"],
    ] as const) {
      assert.deepEqual(await ytAlbumPlaylistOpening(async () => ({ ok: false, reason })), {
        play: "failed",
        failure,
      });
    }
  });
});
