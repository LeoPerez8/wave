import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  readSpotifyPlaylist,
  spotifyEmbed,
  spotifyPlaylistPage,
  type SpotifyAnswer,
  type SpotifyRequest,
} from "./index.ts";

const sample = (name: string): string =>
  readFileSync(new URL(`../../../docs/spotify-samples/${name}`, import.meta.url), "utf8");
const json = (name: string): unknown => JSON.parse(sample(name));

const ID = "1RTENWq73MEx1Pop40ZZ5S";
const EMBED = sample("embed-playlist.html");
const ok = (body: string): SpotifyAnswer => ({ status: 200, body });

/** The embed page with [count] songs, numbered. */
const embedWith = (count: number): string => {
  const script = /<script[^>]*>([\s\S]*?)<\/script>/u.exec(EMBED)?.[1] ?? "";
  const data = JSON.parse(script) as {
    props: { pageProps: { state: { data: { entity: { trackList: unknown[] } } } } };
  };
  const entity = data.props.pageProps.state.data.entity;
  const first = entity.trackList[0] as Record<string, unknown>;
  entity.trackList = Array.from({ length: count }, (_, n) => ({ ...first, title: `Song ${n}` }));
  return EMBED.replace(script, JSON.stringify(data));
};

/** A `fetchPlaylist` answer of [titles] for a playlist of [total] items. */
const pageOf = (titles: readonly string[], total: number): string => {
  const page = json("fetch-playlist-user-page.json") as {
    data: { playlistV2: { content: { totalCount: number; items: unknown[] } } };
  };
  const content = page.data.playlistV2.content;
  const item = content.items[0] as { itemV2: { data: Record<string, unknown> } };
  content.totalCount = total;
  content.items = titles.map((name) => ({
    ...item,
    itemV2: { ...item.itemV2, data: { ...item.itemV2.data, name } },
  }));
  return JSON.stringify(page);
};

/** A transport that answers the embed page with [embed] and each `fetchPlaylist` with [pages]. */
const spotify = (
  embed: () => Promise<SpotifyAnswer>,
  pages: (offset: number) => Promise<SpotifyAnswer>,
) => {
  const asked: SpotifyRequest[] = [];
  const transport = async (request: SpotifyRequest): Promise<SpotifyAnswer> => {
    asked.push(request);
    if (request.method === "GET") return embed();
    const { variables } = JSON.parse(request.body ?? "{}") as { variables: { offset: number } };
    return pages(variables.offset);
  };
  return { asked, transport };
};

describe("readSpotifyPlaylist", () => {
  test("reads the embed page, then every song with its token, page after page", async () => {
    const titles = ["A", "B", "C", "D", "E"];
    const { asked, transport } = spotify(
      async () => ok(EMBED),
      async (offset) => ok(pageOf(titles.slice(offset, offset + 2), titles.length)),
    );
    const read = await readSpotifyPlaylist(ID, transport);
    assert.ok(read.ok);
    assert.equal(read.playlist.title, "Top 500 Most Streamed Songs on Spotify");
    assert.deepEqual(
      read.playlist.songs.map((song) => song.title),
      titles,
    );
    assert.equal(read.playlist.songs[0]?.album, "After Hours");
    assert.equal(read.playlist.truncated, false);
    assert.equal(read.playlist.total, 5, "Spotify's own count");
    assert.deepEqual(asked[0], {
      method: "GET",
      url: `https://open.spotify.com/embed/playlist/${ID}`,
      headers: {},
      body: null,
    });
    assert.deepEqual(
      asked.slice(1).map((request) => JSON.parse(request.body ?? "").variables.offset),
      [0, 2, 4],
    );
  });

  test("asks fetchPlaylist for the playlist's URI and a page, with the embed's token, and nothing else", async () => {
    const { asked, transport } = spotify(
      async () => ok(EMBED),
      async () => ok(pageOf(["A"], 1)),
    );
    await readSpotifyPlaylist(ID, transport);
    const request = asked[1];
    assert.equal(request?.method, "POST");
    assert.equal(request?.url, "https://api-partner.spotify.com/pathfinder/v2/query");
    assert.deepEqual(request?.headers, {
      Authorization: "Bearer ANONYMOUS-TOKEN-REDACTED",
      "Content-Type": "application/json",
    });
    assert.deepEqual(JSON.parse(request?.body ?? ""), {
      variables: {
        uri: `spotify:playlist:${ID}`,
        offset: 0,
        limit: 500,
        enableWatchFeedEntrypoint: false,
      },
      operationName: "fetchPlaylist",
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash: "8964e8eafb21aa992a7d951d256d83285c04be2105d209262901de70cb97584a",
        },
      },
    });
  });

  test("when fetchPlaylist fails, the embed page's songs are read instead", async () => {
    for (const fails of [
      async () => ({ status: 412, body: '{"errors":[{"message":"Invalid query hash"}]}' }),
      async () => ({ status: 401, body: "" }),
      async () => ok("{}"),
      async (): Promise<SpotifyAnswer> => {
        throw new TypeError("Network request failed");
      },
    ]) {
      const { transport } = spotify(async () => ok(EMBED), fails);
      const read = await readSpotifyPlaylist(ID, transport);
      assert.ok(read.ok);
      assert.deepEqual(
        read.playlist.songs.map((song) => song.title),
        ["Blinding Lights", "Believer", "EVERYTHING I OWN"],
      );
      assert.equal(read.playlist.truncated, false);
      assert.equal(read.playlist.total, 3, "the embed page gives no count of its own");
    }
  });

  test("the embed page's 100 songs may not be all of them, so the playlist reads as cut short", async () => {
    const { transport } = spotify(
      async () => ok(embedWith(100)),
      async () => ({ status: 412, body: "" }),
    );
    const read = await readSpotifyPlaylist(ID, transport);
    assert.ok(read.ok);
    assert.equal(read.playlist.songs.length, 100);
    assert.equal(read.playlist.truncated, true);
  });

  test("an unknown, private or deleted playlist is missing, and nothing more is asked", async () => {
    const { asked, transport } = spotify(
      async () => ok(sample("embed-not-found.html")),
      async () => ok(pageOf([], 0)),
    );
    assert.deepEqual(await readSpotifyPlaylist(ID, transport), { ok: false, reason: "missing" });
    assert.equal(asked.length, 1);
  });

  test("Spotify out of reach, or an embed page that isn't one, fails the read", async () => {
    const unreachable = spotify(
      async () => {
        throw new TypeError("Network request failed");
      },
      async () => ok(""),
    );
    assert.deepEqual(await readSpotifyPlaylist(ID, unreachable.transport), {
      ok: false,
      reason: "unreachable",
    });
    for (const answer of [{ status: 503, body: "" }, ok("<html>Rate limited</html>")]) {
      const failed = spotify(
        async () => answer,
        async () => ok(""),
      );
      assert.deepEqual(await readSpotifyPlaylist(ID, failed.transport), {
        ok: false,
        reason: "failed",
      });
    }
  });

  test("reads all 3,000 songs of a large playlist without truncating it", async () => {
    const { asked, transport } = spotify(
      async () => ok(EMBED),
      async (offset) =>
        ok(
          pageOf(
            Array.from({ length: 500 }, (_, n) => `Song ${offset + n}`),
            3000,
          ),
        ),
    );
    const read = await readSpotifyPlaylist(ID, transport);
    assert.ok(read.ok);
    assert.equal(read.playlist.songs.length, 3000);
    assert.equal(read.playlist.truncated, false);
    assert.equal(asked.length, 7);
    assert.equal(read.playlist.songs.at(-1)?.title, "Song 2999");
  });

  test("once cancelled, nothing more is asked", async () => {
    const controller = new AbortController();
    const { asked, transport } = spotify(
      async () => {
        controller.abort();
        return ok(EMBED);
      },
      async () => ok(pageOf(["A"], 1)),
    );
    const read = await readSpotifyPlaylist(ID, transport, controller.signal);
    assert.equal(read.ok, false);
    assert.equal(asked.length, 1);
  });
});

describe("spotifyPlaylistPage", () => {
  test("a page of a user's playlist gives its name, cover, size and songs", () => {
    const page = spotifyPlaylistPage(json("fetch-playlist-user-page.json"));
    assert.ok(page !== null && page !== "notFound");
    assert.equal(page.title, "Top 500 Most Streamed Songs on Spotify");
    assert.equal(
      page.artworkUrl,
      "https://image-cdn-ak.spotifycdn.com/image/ab67706c0000d72c382aa90240a57bb77c6ddd0d",
    );
    assert.equal(page.total, 495);
    assert.equal(page.items, 3);
    assert.deepEqual(page.songs, [
      {
        title: "Blinding Lights",
        artists: ["The Weeknd"],
        album: "After Hours",
        durationMs: 200_040,
        artworkUrl: "https://i.scdn.co/image/ab67616d00001e028863bc11d2aa12b54f5aeb36",
      },
      {
        title: "Believer",
        artists: ["Imagine Dragons"],
        album: "Evolve",
        durationMs: 204_346,
        artworkUrl: "https://i.scdn.co/image/ab67616d00001e025675e83f707f1d7271e5cf8a",
      },
      {
        title: "EVERYTHING I OWN",
        artists: ["MELINDA LINDNER"],
        album: "BEST OF BREAD",
        durationMs: 207_530,
        artworkUrl: "https://i.scdn.co/image/ab67616d00001e023696aa3d9c16220c966009bc",
      },
    ]);
  });

  test("a song keeps every artist, in Spotify's order", () => {
    const page = json("fetch-playlist-user-page.json") as {
      data: {
        playlistV2: {
          content: {
            items: { itemV2: { data: { artists: { items: { profile: { name: string } }[] } } } }[];
          };
        };
      };
    };
    page.data.playlistV2.content.items[0]?.itemV2.data.artists.items.push({
      profile: { name: "Rosalía" },
    });
    const read = spotifyPlaylistPage(page);
    assert.ok(read !== null && read !== "notFound");
    assert.deepEqual(read.songs[0]?.artists, ["The Weeknd", "Rosalía"]);
  });

  test("an editorial playlist's last page reads the same way", () => {
    const page = spotifyPlaylistPage(json("fetch-playlist-editorial-page.json"));
    assert.ok(page !== null && page !== "notFound");
    assert.equal(page.title, "Today’s Top Hits");
    assert.equal(
      page.artworkUrl,
      "https://i.scdn.co/image/ab67706f00000002526040498d89ec622e9d3495",
    );
    assert.equal(page.total, 50);
    assert.equal(page.songs.length, 2);
  });

  test("a local file keeps its name and artist, and a song not playable here keeps its details and cover", () => {
    const page = spotifyPlaylistPage(json("fetch-playlist-local-and-restricted.json"));
    assert.ok(page !== null && page !== "notFound");
    assert.equal(page.items, 10);
    assert.deepEqual(page.songs[1], {
      title: "100 Amazing Bass Lines",
      artists: [],
      album: null,
      durationMs: 785_000,
    });
    assert.deepEqual(page.songs[9], {
      title: "The Abduction",
      artists: ["John Williams"],
      album: "Star Wars: The Force Awakens (Original Motion Picture Soundtrack)",
      durationMs: 145_293,
      artworkUrl: "https://i.scdn.co/image/ab67616d00001e02e2add5f2d1440a02e4e10a75",
    });
    assert.equal(page.songs.length, 10);
  });

  test("an unknown playlist and a malformed one are not found; anything else is unreadable", () => {
    assert.equal(spotifyPlaylistPage(json("fetch-playlist-not-found.json")), "notFound");
    assert.equal(spotifyPlaylistPage(json("fetch-playlist-bad-uri.json")), "notFound");
    assert.equal(spotifyPlaylistPage({ errors: [{ message: "boom" }] }), null);
    assert.equal(spotifyPlaylistPage("<html>"), null);
  });

  test("an item that isn't a song (an episode) is skipped but still counted as read", () => {
    const page = json("fetch-playlist-editorial-page.json") as {
      data: { playlistV2: { content: { items: unknown[] } } };
    };
    page.data.playlistV2.content.items.push({
      itemV2: { __typename: "EpisodeResponseWrapper", data: { __typename: "Episode", name: "Ep" } },
    });
    const read = spotifyPlaylistPage(page);
    assert.ok(read !== null && read !== "notFound");
    assert.equal(read.songs.length, 2);
    assert.equal(read.items, 3);
  });
});

describe("spotifyEmbed", () => {
  test("the embed page gives the playlist's name, cover, first songs and an anonymous token", () => {
    assert.deepEqual(spotifyEmbed(sample("embed-playlist.html")), {
      status: "found",
      token: "ANONYMOUS-TOKEN-REDACTED",
      playlist: {
        title: "Top 500 Most Streamed Songs on Spotify",
        artworkUrl:
          "https://image-cdn-ak.spotifycdn.com/image/ab67706c0000d72c382aa90240a57bb77c6ddd0d",
        songs: [
          { title: "Blinding Lights", artists: ["The Weeknd"], album: null, durationMs: 200_040 },
          { title: "Believer", artists: ["Imagine Dragons"], album: null, durationMs: 204_346 },
          {
            title: "EVERYTHING I OWN",
            artists: ["MELINDA LINDNER"],
            album: null,
            durationMs: 207_530,
          },
        ],
      },
    });
  });

  test("an unknown playlist's embed page says so; a page without the data is unreadable", () => {
    assert.deepEqual(spotifyEmbed(sample("embed-not-found.html")), { status: "notFound" });
    assert.equal(spotifyEmbed("<html><body>Rate limited</body></html>"), null);
  });
});
