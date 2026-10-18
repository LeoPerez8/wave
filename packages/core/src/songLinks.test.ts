import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  lookUpSongLinks,
  songLinkView,
  type SongLinkAsk,
  type SongLinkSearch,
  type YtSong,
} from "./index.ts";

const ODESLI_BODY = JSON.stringify({
  entityUniqueId: "YOUTUBE_VIDEO::4NRXx6U8ABQ",
  pageUrl: "https://song.link/y/4NRXx6U8ABQ",
  linksByPlatform: {
    spotify: { url: "https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b" },
    youtubeMusic: { url: "https://music.youtube.com/watch?v=4NRXx6U8ABQ" },
    youtube: { url: "https://www.youtube.com/watch?v=4NRXx6U8ABQ" },
  },
});

const noSearch: SongLinkSearch = async () => {
  throw new Error("searched");
};

/** The links Odesli's answer [status], [body] gives a song with a video id. */
const answer = (status: number, body: string) =>
  lookUpSongLinks({ videoId: "4NRXx6U8ABQ", search: null }, noSearch, async () => ({
    status,
    body,
  }));

describe("lookUpSongLinks", () => {
  test("asks Odesli by the song's video id and takes its song.link page, Spotify and YT Music links", async () => {
    const asked: string[] = [];
    const ask: SongLinkAsk = async (url) => {
      asked.push(url);
      return { status: 200, body: ODESLI_BODY };
    };
    const state = await lookUpSongLinks({ videoId: "4NRXx6U8ABQ", search: null }, noSearch, ask);
    assert.deepEqual(asked, [
      "https://api.song.link/v1-alpha.1/links?url=https%3A%2F%2Fmusic.youtube.com%2Fwatch%3Fv%3D4NRXx6U8ABQ",
    ]);
    assert.deepEqual(state, {
      status: "found",
      links: {
        page: "https://song.link/y/4NRXx6U8ABQ",
        spotify: "https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b",
        ytMusic: "https://music.youtube.com/watch?v=4NRXx6U8ABQ",
      },
    });
  });

  test("an Odesli request that can't be sent is offline", async () => {
    const state = await lookUpSongLinks({ videoId: "4NRXx6U8ABQ", search: null }, noSearch, () =>
      Promise.reject(new TypeError("Network request failed")),
    );
    assert.deepEqual(state, { status: "offline" });
  });

  test("a song Odesli can't resolve has no links; a refusal or an error is a failure", async () => {
    const notFound = '{"statusCode":404,"code":"could_not_resolve_entity"}';
    assert.deepEqual(await answer(404, notFound), { status: "notFound" });
    assert.deepEqual(await answer(400, notFound), { status: "notFound" });
    assert.deepEqual(await answer(429, '{"statusCode":429}'), { status: "failed" });
    assert.deepEqual(await answer(500, "oops"), { status: "failed" });
    assert.deepEqual(await answer(200, "not json"), { status: "failed" });
  });

  test("a platform Odesli has no link for is null, but YT Music always has the video itself", async () => {
    const body = JSON.stringify({
      pageUrl: "https://song.link/y/abc",
      linksByPlatform: { youtube: { url: "https://www.youtube.com/watch?v=abc" } },
    });
    const state = await lookUpSongLinks({ videoId: "abc", search: null }, noSearch, async () => ({
      status: 200,
      body,
    }));
    assert.deepEqual(state, {
      status: "found",
      links: {
        page: "https://song.link/y/abc",
        spotify: null,
        ytMusic: "https://music.youtube.com/watch?v=abc",
      },
    });
  });
});

const lucky = { title: "Get Lucky", artists: ["Daft Punk"], album: "RAM", durationMs: 369_000 };

const ytSong = (videoId: string, over: Partial<YtSong> = {}): YtSong => ({
  videoId,
  title: "Get Lucky",
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationMs: 368_000,
  artworkUrl: null,
  explicit: false,
  ...over,
});

/** Odesli answering with a page named after the video id it was asked about. */
const odesli: SongLinkAsk = async (url) => ({
  status: 200,
  body: JSON.stringify({ pageUrl: `https://song.link/?${url.split("%3D")[1]}` }),
});

const failingAsk: SongLinkAsk = async () => {
  throw new Error("asked Odesli");
};

describe("lookUpSongLinks for a song without a video id", () => {
  test("searches YT Music once by its title and artists and asks Odesli by the match's video id", async () => {
    const searched: unknown[] = [];
    const state = await lookUpSongLinks(
      { videoId: null, search: lucky },
      async (song) => {
        searched.push(song);
        return {
          ok: true,
          songs: [ytSong("live", { title: "Get Lucky (Live)" }), ytSong("studio")],
        };
      },
      odesli,
    );
    assert.deepEqual(searched, [lucky]);
    assert.deepEqual(state, {
      status: "found",
      links: {
        page: "https://song.link/?studio",
        spotify: null,
        ytMusic: "https://music.youtube.com/watch?v=studio",
      },
    });
  });

  test("with no result that is the song, there are no links and Odesli isn't asked", async () => {
    const state = await lookUpSongLinks(
      { videoId: null, search: lucky },
      async () => ({ ok: true, songs: [ytSong("other", { artists: ["Someone Else"] })] }),
      failingAsk,
    );
    assert.deepEqual(state, { status: "notFound" });
  });

  test("a search that gets no answer is offline or a failure, as it was", async () => {
    const offline = await lookUpSongLinks(
      { videoId: null, search: lucky },
      async () => ({ ok: false, reason: "offline" }),
      failingAsk,
    );
    assert.deepEqual(offline, { status: "offline" });
    const failed = await lookUpSongLinks(
      { videoId: null, search: lucky },
      async () => ({ ok: false, reason: "failed" }),
      failingAsk,
    );
    assert.deepEqual(failed, { status: "failed" });
  });

  test("a song with nothing to search by has no links", async () => {
    assert.deepEqual(await lookUpSongLinks({ videoId: null, search: null }, noSearch, failingAsk), {
      status: "notFound",
    });
  });
});

describe("songLinkView", () => {
  const links = {
    page: "https://song.link/y/abc",
    spotify: null,
    ytMusic: "https://music.youtube.com/watch?v=abc",
  };

  test("Copy Link takes song.link's page and YT Music its link; Spotify with no match is disabled", () => {
    const found = { status: "found", links } as const;
    assert.deepEqual(songLinkView("copyLink", found), {
      url: "https://song.link/y/abc",
      loading: false,
      note: null,
    });
    assert.deepEqual(songLinkView("ytMusic", found), {
      url: "https://music.youtube.com/watch?v=abc",
      loading: false,
      note: null,
    });
    assert.deepEqual(songLinkView("spotify", found), {
      url: null,
      loading: false,
      note: "No Match",
    });
  });

  test("while links load every option is loading; offline, a failure or no match, each says so", () => {
    assert.deepEqual(songLinkView("spotify", { status: "loading" }), {
      url: null,
      loading: true,
      note: null,
    });
    assert.deepEqual(songLinkView("copyLink", { status: "offline" }), {
      url: null,
      loading: false,
      note: "Offline",
    });
    assert.deepEqual(songLinkView("ytMusic", { status: "failed" }), {
      url: null,
      loading: false,
      note: "Unavailable",
    });
    assert.deepEqual(songLinkView("copyLink", { status: "notFound" }), {
      url: null,
      loading: false,
      note: "No Match",
    });
  });
});
