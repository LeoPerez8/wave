import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  catalogueOf,
  lookUpSongVideo,
  lookUpSpotifyTrack,
  songLinkView,
  SONG_LINKS_LOADING,
  type SongLinkSearch,
  type SpotifyAccountAnswer,
  type YtSong,
} from "./index.ts";

const noSearch: SongLinkSearch = async () => {
  throw new Error("searched");
};

describe("lookUpSongVideo", () => {
  test("a song with its own video id has it, with nothing asked", async () => {
    assert.deepEqual(await lookUpSongVideo({ videoId: "4NRXx6U8ABQ", search: null }, noSearch), {
      status: "found",
      videoId: "4NRXx6U8ABQ",
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

describe("lookUpSongVideo for a song without a video id", () => {
  test("searches YT Music once by its title and artists and takes the match's video id", async () => {
    const searched: unknown[] = [];
    const state = await lookUpSongVideo({ videoId: null, search: lucky }, async (song) => {
      searched.push(song);
      return { ok: true, songs: [ytSong("live", { title: "Get Lucky (Live)" }), ytSong("studio")] };
    });
    assert.deepEqual(searched, [lucky]);
    assert.deepEqual(state, { status: "found", videoId: "studio" });
  });

  test("with no result that is the song, there is no video", async () => {
    const state = await lookUpSongVideo({ videoId: null, search: lucky }, async () => ({
      ok: true,
      songs: [ytSong("other", { artists: ["Someone Else"] })],
    }));
    assert.deepEqual(state, { status: "notFound" });
  });

  test("a search that gets no answer is offline or a failure", async () => {
    const offline = await lookUpSongVideo({ videoId: null, search: lucky }, async () => ({
      ok: false,
      reason: "offline",
    }));
    assert.deepEqual(offline, { status: "offline" });
    const failed = await lookUpSongVideo({ videoId: null, search: lucky }, async () => ({
      ok: false,
      reason: "failed",
    }));
    assert.deepEqual(failed, { status: "failed" });
  });

  test("a song with nothing to search by has no video", async () => {
    assert.deepEqual(await lookUpSongVideo({ videoId: null, search: null }, noSearch), {
      status: "notFound",
    });
  });
});

/** A `searchTracks` result for the track [uri], as Spotify's web player answers it. */
const spotifyTrack = (uri: string, over: { title?: string; artists?: string[] } = {}) => ({
  item: {
    __typename: "TrackResponseWrapper",
    data: {
      __typename: "Track",
      uri,
      name: over.title ?? "Get Lucky",
      artists: { items: (over.artists ?? ["Daft Punk"]).map((name) => ({ profile: { name } })) },
      albumOfTrack: { name: "Random Access Memories" },
      duration: { totalMilliseconds: 368_000 },
      playability: { playable: true },
    },
  },
});

const searchAnswer = (...items: unknown[]): SpotifyAccountAnswer => ({
  ok: true,
  data: { searchV2: { tracksV2: { items } } },
});

const signedIn = async () => true;

describe("lookUpSpotifyTrack", () => {
  test("signed in, searches Spotify once by title and artists and shares the matching track", async () => {
    const terms: string[] = [];
    const state = await lookUpSpotifyTrack(lucky, {
      signedIn,
      search: async (term) => {
        terms.push(term);
        return searchAnswer(
          spotifyTrack("spotify:track:live", { title: "Get Lucky - Live" }),
          spotifyTrack("spotify:track:0VjIjW4GlUZAMYd2vXMi3b"),
        );
      },
    });
    assert.deepEqual(terms, ["Get Lucky Daft Punk"]);
    assert.deepEqual(state, {
      status: "found",
      url: "https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b",
    });
  });

  test("signed out, nothing is sent and Spotify is disabled saying so", async () => {
    const state = await lookUpSpotifyTrack(lucky, {
      signedIn: async () => false,
      search: async () => {
        throw new Error("searched Spotify");
      },
    });
    assert.deepEqual(state, { status: "signedOut" });
    assert.deepEqual(songLinkView("spotify", { ...SONG_LINKS_LOADING, spotify: state }), {
      url: null,
      loading: false,
      note: "Signed Out",
    });
  });

  /** Spotify's lookup when its search answers [answer]. */
  const answering = (answer: SpotifyAccountAnswer) =>
    lookUpSpotifyTrack(lucky, { signedIn, search: async () => answer });

  test("no result that is the same recording is no match; an unreadable answer is a failure", async () => {
    const other = spotifyTrack("spotify:track:other", { artists: ["Someone Else"] });
    assert.deepEqual(await answering(searchAnswer(other)), { status: "notFound" });
    assert.deepEqual(await answering({ ok: true, data: { oops: true } }), { status: "failed" });
  });

  test("a search with no answer is offline, signed out (a session Spotify refused) or a failure", async () => {
    assert.deepEqual(await answering({ ok: false, reason: "offline" }), { status: "offline" });
    assert.deepEqual(await answering({ ok: false, reason: "signedOut" }), { status: "signedOut" });
    assert.deepEqual(await answering({ ok: false, reason: "failed" }), { status: "failed" });
    assert.deepEqual(await answering({ ok: false, reason: "changed" }), { status: "failed" });
  });

  test("a song with no artist to match it by, or nothing to search by, isn't searched", async () => {
    const search = async (): Promise<SpotifyAccountAnswer> => {
      throw new Error("searched Spotify");
    };
    const unknown = { ...lucky, artists: ["Unknown Artist"] };
    assert.deepEqual(await lookUpSpotifyTrack(unknown, { signedIn, search }), {
      status: "notFound",
    });
    assert.deepEqual(await lookUpSpotifyTrack(null, { signedIn, search }), { status: "notFound" });
  });
});

describe("songLinkView", () => {
  test("with the video id, Copy Link takes its song.link page and YT Music its watch page", () => {
    const state = { ...SONG_LINKS_LOADING, video: { status: "found", videoId: "abc" } } as const;
    assert.deepEqual(songLinkView("copyLink", state), {
      url: "https://song.link/y/abc",
      loading: false,
      note: null,
    });
    assert.deepEqual(songLinkView("ytMusic", state), {
      url: "https://music.youtube.com/watch?v=abc",
      loading: false,
      note: null,
    });
  });

  test("each destination goes by its own lookup: one failing disables only itself", () => {
    const spotifyFailed = {
      video: { status: "found", videoId: "abc" },
      spotify: { status: "failed" },
    } as const;
    assert.equal(
      songLinkView("ytMusic", spotifyFailed).url,
      "https://music.youtube.com/watch?v=abc",
    );
    assert.equal(songLinkView("copyLink", spotifyFailed).url, "https://song.link/y/abc");
    assert.deepEqual(songLinkView("spotify", spotifyFailed), {
      url: null,
      loading: false,
      note: "Unavailable",
    });

    const noVideo = {
      video: { status: "notFound" },
      spotify: { status: "found", url: "https://open.spotify.com/track/x" },
    } as const;
    assert.deepEqual(songLinkView("copyLink", noVideo), {
      url: null,
      loading: false,
      note: "No Match",
    });
    assert.deepEqual(songLinkView("ytMusic", noVideo), {
      url: null,
      loading: false,
      note: "No Match",
    });
    assert.deepEqual(songLinkView("spotify", noVideo), {
      url: "https://open.spotify.com/track/x",
      loading: false,
      note: null,
    });
  });

  test("a lookup still going shows loading on its own options; offline says so", () => {
    const state = { video: { status: "offline" }, spotify: { status: "loading" } } as const;
    assert.deepEqual(songLinkView("spotify", state), { url: null, loading: true, note: null });
    assert.deepEqual(songLinkView("copyLink", state), {
      url: null,
      loading: false,
      note: "Offline",
    });
  });

  test("in Portuguese, says why a destination has no link in Portuguese", () => {
    const pt = catalogueOf("pt-BR");
    const view = (status: "failed" | "notFound" | "signedOut" | "offline") =>
      songLinkView("spotify", { ...SONG_LINKS_LOADING, spotify: { status } }, pt).note;
    assert.deepEqual((["failed", "notFound", "signedOut", "offline"] as const).map(view), [
      "Indisponível",
      "Nenhum Resultado",
      "Sessão finalizada",
      "Offline",
    ]);
  });
});
