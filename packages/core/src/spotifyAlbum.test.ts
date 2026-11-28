import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  albumLinkOpening,
  readSpotifyAlbum,
  ytAlbumPlaylistOpening,
  type SpotifyAnswer,
  type SpotifyRequest,
} from "./index.ts";

const sample = (name: string): string =>
  readFileSync(new URL(`../../../docs/spotify-samples/${name}`, import.meta.url), "utf8");

const ALBUM = "7rZmgT2kEqkCMR6VHcloJM";
const EMBED = sample("embed-album.html");

const answering = (answer: SpotifyAnswer | Error) => {
  const asked: SpotifyRequest[] = [];
  const send = async (request: SpotifyRequest): Promise<SpotifyAnswer> => {
    asked.push(request);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { asked, send };
};

describe("reading a Spotify album from its embed page", () => {
  test("gives its title, artists and largest cover, asking Spotify only for the album id", async () => {
    const { asked, send } = answering({ status: 200, body: EMBED });
    assert.deepEqual(await readSpotifyAlbum(ALBUM, send), {
      ok: true,
      album: {
        title: "excapecore.",
        artists: ["excape."],
        artworkUrl:
          "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b2738579d8bbb437414acc271b74",
      },
    });
    assert.deepEqual(asked, [
      {
        method: "GET",
        url: `https://open.spotify.com/embed/album/${ALBUM}`,
        headers: {},
        body: null,
      },
    ]);
  });

  test("an album Spotify doesn't have is missing", async () => {
    const { send } = answering({ status: 200, body: sample("embed-not-found.html") });
    assert.deepEqual(await readSpotifyAlbum(ALBUM, send), { ok: false, reason: "missing" });
  });

  test("a page that isn't an album, or another status, is a failed read", async () => {
    for (const answer of [
      { status: 200, body: sample("embed-track.html") },
      { status: 500, body: EMBED },
      { status: 200, body: "<html></html>" },
    ]) {
      const { send } = answering(answer);
      assert.deepEqual(await readSpotifyAlbum(ALBUM, send), { ok: false, reason: "failed" });
    }
  });

  test("no answer is Spotify out of reach", async () => {
    const { send } = answering(new Error("network"));
    assert.deepEqual(await readSpotifyAlbum(ALBUM, send), { ok: false, reason: "unreachable" });
  });
});

const found = (title: string, artists: readonly string[], browseId: string) => ({
  title,
  artists,
  browseId,
});

describe("which YT Music album a Spotify album link opens", () => {
  const album = { title: "excapecore.", artists: ["excape."], artworkUrl: null };

  test("one Albums search for its title and main artist, opening the same title by one of its artists", async () => {
    const asked: string[] = [];
    const opening = await albumLinkOpening(album, async (query) => {
      asked.push(query);
      return [
        found("excapecore.", ["Someone Else"], "MPREb_other"),
        found("Excapecore", ["excape."], "MPREb_match"),
      ];
    });
    assert.deepEqual(asked, ["excapecore. excape."]);
    assert.deepEqual(opening, { album: "MPREb_match" });
  });

  test("a search that answered without it says it isn't on YouTube Music", async () => {
    const opening = await albumLinkOpening(album, async () => [
      found("DREAMS COME TRUE", ["excape."], "MPREb_single"),
    ]);
    assert.deepEqual(opening, {
      play: "failed",
      failure: { albumNotFound: { title: "excapecore.", artists: ["excape."] } },
    });
  });

  test("no answer from the search is YouTube Music not answering", async () => {
    assert.deepEqual(await albumLinkOpening(album, async () => null), {
      play: "failed",
      failure: "failed",
    });
  });
});

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
