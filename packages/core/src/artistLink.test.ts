import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  artistLinkOpening,
  readDeezerArtist,
  readSpotifyArtist,
  songLinkNotice,
  ytChannelLinkOpening,
  type YtArtistCandidate,
  type SpotifyAnswer,
  type SpotifyRequest,
} from "./index.ts";

const spotifySample = (name: string): string =>
  readFileSync(new URL(`../../../docs/spotify-samples/${name}`, import.meta.url), "utf8");
const DEEZER_ARTIST_JSON = readFileSync(
  new URL("./fixtures/deezer/artist.json", import.meta.url),
  "utf8",
);

const SPOTIFY_ARTIST = "4Z8W4fKeB5YxbusRsdQVPb";

const spotifyAnswering = (answer: SpotifyAnswer | Error) => {
  const asked: SpotifyRequest[] = [];
  const send = async (request: SpotifyRequest): Promise<SpotifyAnswer> => {
    asked.push(request);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { asked, send };
};

describe("reading a Spotify artist from its embed page", () => {
  test("gives their name, asking Spotify only for the artist id", async () => {
    const { asked, send } = spotifyAnswering({
      status: 200,
      body: spotifySample("embed-artist.html"),
    });
    assert.deepEqual(await readSpotifyArtist(SPOTIFY_ARTIST, send), {
      ok: true,
      name: "Radiohead",
    });
    assert.deepEqual(asked, [
      {
        method: "GET",
        url: `https://open.spotify.com/embed/artist/${SPOTIFY_ARTIST}`,
        headers: {},
        body: null,
      },
    ]);
  });

  test("an artist Spotify doesn't have is missing; out of reach or another page says so", async () => {
    const read = (answer: SpotifyAnswer | Error) =>
      readSpotifyArtist(SPOTIFY_ARTIST, spotifyAnswering(answer).send);
    assert.deepEqual(await read({ status: 200, body: spotifySample("embed-not-found.html") }), {
      ok: false,
      reason: "missing",
    });
    assert.deepEqual(await read(new Error("offline")), { ok: false, reason: "unreachable" });
    for (const answer of [
      { status: 200, body: spotifySample("embed-album.html") },
      { status: 500, body: spotifySample("embed-artist.html") },
      { status: 200, body: "<html></html>" },
    ]) {
      assert.deepEqual(await read(answer), { ok: false, reason: "failed" });
    }
  });
});

describe("reading a Deezer artist from its public API", () => {
  test("gives their name, asking Deezer only for the artist id", async () => {
    const asked: string[] = [];
    const read = await readDeezerArtist("399", async (url) => {
      asked.push(url);
      return { status: 200, body: DEEZER_ARTIST_JSON };
    });
    assert.deepEqual(read, { ok: true, name: "Radiohead" });
    assert.deepEqual(asked, ["https://api.deezer.com/artist/399"]);
  });

  test("an artist Deezer doesn't have is missing, and an id that isn't digits isn't asked", async () => {
    const noData = JSON.stringify({
      error: { type: "DataException", message: "no data", code: 800 },
    });
    assert.deepEqual(await readDeezerArtist("99999", async () => ({ status: 200, body: noData })), {
      ok: false,
      reason: "missing",
    });
    assert.deepEqual(
      await readDeezerArtist("399x", async () => {
        throw new Error("Must not ask");
      }),
      { ok: false, reason: "missing" },
    );
  });

  test("Deezer out of reach, over its quota or busy is unreachable; anything else failed", async () => {
    const answering =
      (body: string, status = 200) =>
      async () => ({ status, body });
    assert.deepEqual(
      await readDeezerArtist("399", async () => {
        throw new Error("offline");
      }),
      { ok: false, reason: "unreachable" },
    );
    for (const code of [4, 700]) {
      assert.deepEqual(
        await readDeezerArtist("399", answering(JSON.stringify({ error: { code } }))),
        { ok: false, reason: "unreachable" },
      );
    }
    for (const [body, status] of [
      [DEEZER_ARTIST_JSON, 500],
      ["not json", 200],
      [JSON.stringify({ id: 399, type: "album", title: "OK Computer" }), 200],
    ] as const) {
      assert.deepEqual(await readDeezerArtist("399", answering(body, status)), {
        ok: false,
        reason: "failed",
      });
    }
  });
});

const radiohead: YtArtistCandidate = {
  name: "Radiohead",
  browseId: "UCq19-LqvG35A-30oyAiPiqA",
  audience: 9_000_000,
};

describe("the YT Music artist an artist link opens", () => {
  test("one Artists search for their name, and the artist with the same name opens", async () => {
    const asked: string[] = [];
    const opening = await artistLinkOpening("Radiohead", async (query) => {
      asked.push(query);
      return [
        { name: "Radiohead Tribute", browseId: "UCtribute000000000000000", audience: 12 },
        radiohead,
      ];
    });
    assert.deepEqual(asked, ["Radiohead"]);
    assert.deepEqual(opening, { artist: radiohead.browseId, name: "Radiohead" });
  });

  test("among namesakes, the most followed is the artist", async () => {
    const namesake = { name: "radiohead", browseId: "UCnamesake00000000000000", audience: 40 };
    assert.deepEqual(await artistLinkOpening("Radiohead", async () => [namesake, radiohead]), {
      artist: radiohead.browseId,
      name: "Radiohead",
    });
  });

  test("a search that answered without them says the artist wasn't found, by name", async () => {
    assert.deepEqual(
      await artistLinkOpening("Radiohead", async () => [
        { name: "Thom Yorke", browseId: "UCthom000000000000000000", audience: 1 },
      ]),
      { play: "failed", failure: { artistNotFound: { name: "Radiohead" } } },
    );
  });

  test("no answer from YouTube Music says it didn't answer", async () => {
    assert.deepEqual(await artistLinkOpening("Radiohead", async () => null), {
      play: "failed",
      failure: "failed",
    });
  });
});

describe("the artist a YouTube channel link opens", () => {
  const CHANNEL = "UCiryJZISyBldwm9ocAE-QfQ";

  test("a channel YT Music reads as an artist page opens there, with its name", async () => {
    assert.deepEqual(
      await ytChannelLinkOpening(CHANNEL, async () => ({ ok: true, name: "Nick Drake" })),
      { artist: CHANNEL, name: "Nick Drake" },
    );
  });

  test("a channel YT Music has no artist page for isn't found", async () => {
    assert.deepEqual(
      await ytChannelLinkOpening(CHANNEL, async () => ({ ok: false, reason: "failed" })),
      { play: "failed", failure: { artistNotFound: { name: null } } },
    );
  });

  test("offline or YT Music off says so", async () => {
    assert.deepEqual(
      await ytChannelLinkOpening(CHANNEL, async () => ({ ok: false, reason: "offline" })),
      { play: "failed", failure: "artistOffline" },
    );
    assert.deepEqual(
      await ytChannelLinkOpening(CHANNEL, async () => ({ ok: false, reason: "disabled" })),
      { play: "failed", failure: "disabled" },
    );
  });
});

describe("what an artist link that opens nothing says", () => {
  test("no YT Music artist says so, with the name their service gave", () => {
    assert.deepEqual(songLinkNotice({ artistNotFound: { name: "Radiohead" } }), {
      title: "Couldn't find this artist",
      message: "Radiohead",
    });
    assert.deepEqual(songLinkNotice({ artistNotFound: { name: "Radiohead" } }, "pt-BR"), {
      title: "Não achei esse artista",
      message: "Radiohead",
    });
  });

  test("a channel that isn't an artist on YT Music says so", () => {
    assert.deepEqual(songLinkNotice({ artistNotFound: { name: null } }), {
      title: "Couldn't find this artist",
      message: "YouTube Music has no artist page for this channel.",
    });
    assert.deepEqual(songLinkNotice({ artistNotFound: { name: null } }, "pt-BR"), {
      title: "Não achei esse artista",
      message: "O YouTube Music não tem uma página de artista para este canal.",
    });
  });

  test("offline says to connect to open the artist", () => {
    assert.deepEqual(songLinkNotice("artistOffline"), {
      title: "You're offline",
      message: "Connect to the internet to open this artist.",
    });
    assert.deepEqual(songLinkNotice("artistOffline", "pt-BR"), {
      title: "Você está offline",
      message: "Conecte-se à internet para abrir este artista.",
    });
  });

  test("an artist their service doesn't have says so in artist words", () => {
    assert.deepEqual(songLinkNotice({ unread: "missing", service: "deezer", artist: true }), {
      title: "This link doesn't open",
      message: "Deezer doesn't have the artist it links to.",
    });
    assert.deepEqual(
      songLinkNotice({ unread: "missing", service: "spotify", artist: true }, "pt-BR"),
      { title: "Este link não abre", message: "O Spotify não tem o artista deste link." },
    );
    assert.deepEqual(songLinkNotice({ unread: "unreachable", service: "spotify", artist: true }), {
      title: "This link doesn't open",
      message: "Couldn't reach Spotify. Check your connection and try again.",
    });
  });
});
