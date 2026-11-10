import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { readSpotifyTrack, type SpotifyAnswer, type SpotifyRequest } from "./index.ts";

const sample = (name: string): string =>
  readFileSync(new URL(`../../../docs/spotify-samples/${name}`, import.meta.url), "utf8");

const TRACK = "4uLU6hMCjMI75M1A2tKUQC";
const EMBED = sample("embed-track.html");

/** A transport answering [answer] and keeping what it was asked. */
const answering = (answer: SpotifyAnswer | Error) => {
  const asked: SpotifyRequest[] = [];
  const send = async (request: SpotifyRequest): Promise<SpotifyAnswer> => {
    asked.push(request);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { asked, send };
};

/** The track embed page with its entity changed by [change]. */
const embedWith = (change: (entity: Record<string, unknown>) => void): string => {
  const script = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/u.exec(EMBED)?.[1] ?? "";
  const data = JSON.parse(script) as {
    props: { pageProps: { state: { data: { entity: Record<string, unknown> } } } };
  };
  change(data.props.pageProps.state.data.entity);
  return EMBED.replace(script, JSON.stringify(data));
};

describe("reading a Spotify track from its embed page", () => {
  test("gives its title, artists, length and largest cover, asking Spotify only for the track id", async () => {
    const { asked, send } = answering({ status: 200, body: EMBED });
    assert.deepEqual(await readSpotifyTrack(TRACK, send), {
      ok: true,
      song: {
        title: "Never Gonna Give You Up",
        artists: ["Rick Astley"],
        album: null,
        durationMs: 213_573,
        artworkUrl:
          "https://image-cdn-ak.spotifycdn.com/image/ab67616d0000b273255e131abc1410833be95673",
      },
    });
    assert.deepEqual(asked, [
      {
        method: "GET",
        url: `https://open.spotify.com/embed/track/${TRACK}`,
        headers: {},
        body: null,
      },
    ]);
  });

  test("every credited artist, in Spotify's order", async () => {
    const page = embedWith((entity) => {
      entity.artists = [{ name: "Shawn Mendes" }, { name: "Camila Cabello" }, { uri: "x" }];
    });
    const read = await readSpotifyTrack(TRACK, answering({ status: 200, body: page }).send);
    assert.deepEqual(read.ok && read.song.artists, ["Shawn Mendes", "Camila Cabello"]);
  });

  test("with no cover or length, it still reads", async () => {
    const page = embedWith((entity) => {
      delete entity.visualIdentity;
      delete entity.duration;
    });
    const read = await readSpotifyTrack(TRACK, answering({ status: 200, body: page }).send);
    assert.deepEqual(read.ok && [read.song.artworkUrl, read.song.durationMs], [null, null]);
  });

  test("a track Spotify doesn't have is missing", async () => {
    // Spotify answers an unknown track id as it does an unknown playlist: 200, with status 404.
    const body = sample("embed-not-found.html");
    assert.deepEqual(await readSpotifyTrack(TRACK, answering({ status: 200, body }).send), {
      ok: false,
      reason: "missing",
    });
  });

  test("Spotify out of reach is unreachable", async () => {
    assert.deepEqual(await readSpotifyTrack(TRACK, answering(new Error("offline")).send), {
      ok: false,
      reason: "unreachable",
    });
  });

  test("an answer that isn't a track's page failed", async () => {
    for (const answer of [
      { status: 503, body: EMBED },
      { status: 200, body: "<html>Rate limited</html>" },
      { status: 200, body: sample("embed-playlist.html") },
      {
        status: 200,
        body: embedWith((entity) => {
          delete entity.name;
          delete entity.title;
        }),
      },
    ]) {
      assert.deepEqual(await readSpotifyTrack(TRACK, answering(answer).send), {
        ok: false,
        reason: "failed",
      });
    }
  });
});
