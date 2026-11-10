import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  libraryFinder,
  readDeezerTrack,
  songLinkNotFound,
  trackLinkPlay,
  type DeezerAnswer,
  type YtSong,
} from "./index.ts";

const TRACK = "3135556";
/** A real answer of `api.deezer.com/track/3135556`, fetched 9 Nov 2026. */
const FIXTURE: Record<string, unknown> = JSON.parse(
  readFileSync(new URL("./fixtures/deezer/track.json", import.meta.url), "utf8"),
);

/** A transport answering [answer] and keeping the addresses it was asked for. */
const answering = (answer: DeezerAnswer | Error) => {
  const asked: string[] = [];
  const send = async (url: string): Promise<DeezerAnswer> => {
    asked.push(url);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { asked, send };
};

/** The fixture with [change] made to it, as Deezer would answer it. */
const trackWith = (change: (track: Record<string, unknown>) => void): DeezerAnswer => {
  const track = structuredClone(FIXTURE);
  change(track);
  return { status: 200, body: JSON.stringify(track) };
};

const error = (code: number, type = "DataException"): DeezerAnswer => ({
  status: 200,
  body: JSON.stringify({ error: { type, message: "no data", code } }),
});

describe("reading a Deezer track from its public API", () => {
  test("gives its title, artists, album, length and largest cover, asking Deezer only for the track id", async () => {
    const { asked, send } = answering({ status: 200, body: JSON.stringify(FIXTURE) });
    assert.deepEqual(await readDeezerTrack(TRACK, send), {
      ok: true,
      song: {
        title: "Harder, Better, Faster, Stronger",
        artists: ["Daft Punk"],
        album: "Discovery",
        durationMs: 226_000,
        artworkUrl:
          "https://cdn-images.dzcdn.net/images/cover/5718f7c81c27e0b2417e2a4c45224f8a/1000x1000-000000-80-0-0.jpg",
      },
    });
    assert.deepEqual(asked, [`https://api.deezer.com/track/${TRACK}`]);
  });

  test("every contributor is an artist, featured guests too, in Deezer's order", async () => {
    const answer = trackWith((track) => {
      track.contributors = [
        { name: "Calvin Harris", role: "Main" },
        { name: "Dua Lipa", role: "Featured" },
        { role: "Main" },
      ];
    });
    const read = await readDeezerTrack(TRACK, answering(answer).send);
    assert.deepEqual(read.ok && read.song.artists, ["Calvin Harris", "Dua Lipa"]);
  });

  test("with no contributors, the track's artist is its one artist", async () => {
    const answer = trackWith((track) => {
      delete track.contributors;
    });
    const read = await readDeezerTrack(TRACK, answering(answer).send);
    assert.deepEqual(read.ok && read.song.artists, ["Daft Punk"]);
  });

  test("the full title, its version included, as the same-recording rules need it", async () => {
    const answer = trackWith((track) => {
      track.title = "Harder, Better, Faster, Stronger (Live)";
      track.title_short = "Harder, Better, Faster, Stronger";
    });
    const read = await readDeezerTrack(TRACK, answering(answer).send);
    assert.equal(read.ok && read.song.title, "Harder, Better, Faster, Stronger (Live)");
  });

  test("a smaller cover when the largest is missing; with no album, no cover or length, it still reads", async () => {
    const smaller = trackWith((track) => {
      delete (track.album as Record<string, unknown>).cover_xl;
    });
    const read = await readDeezerTrack(TRACK, answering(smaller).send);
    assert.match(String(read.ok && read.song.artworkUrl), /\/500x500-/u);
    const bare = trackWith((track) => {
      delete track.album;
      delete track.duration;
    });
    const readBare = await readDeezerTrack(TRACK, answering(bare).send);
    assert.deepEqual(
      readBare.ok && [readBare.song.album, readBare.song.artworkUrl, readBare.song.durationMs],
      [null, null, null],
    );
  });

  test("a track Deezer doesn't know is missing: Deezer says so in an answer that's 200", async () => {
    assert.deepEqual(await readDeezerTrack("1", answering(error(800)).send), {
      ok: false,
      reason: "missing",
    });
  });

  test("an id that isn't digits names no track, and Deezer isn't asked", async () => {
    const { asked, send } = answering({ status: 200, body: JSON.stringify(FIXTURE) });
    for (const id of ["302127x", "", "abc"]) {
      assert.deepEqual(await readDeezerTrack(id, send), { ok: false, reason: "missing" }, id);
    }
    assert.deepEqual(asked, []);
  });

  test("Deezer out of reach, over its quota or busy is unreachable", async () => {
    const offline = await readDeezerTrack(
      TRACK,
      answering(new TypeError("Network request failed")).send,
    );
    assert.deepEqual(offline, { ok: false, reason: "unreachable" });
    for (const code of [4, 700]) {
      assert.deepEqual(
        await readDeezerTrack(TRACK, answering(error(code, "Exception")).send),
        { ok: false, reason: "unreachable" },
        String(code),
      );
    }
  });

  test("any other answer is failed", async () => {
    for (const answer of [
      { status: 500, body: "" },
      { status: 200, body: "<html></html>" },
      error(600, "InvalidQueryException"),
      trackWith((track) => {
        track.type = "episode";
      }),
      trackWith((track) => {
        delete track.title;
      }),
    ]) {
      assert.deepEqual(await readDeezerTrack(TRACK, answering(answer).send), {
        ok: false,
        reason: "failed",
      });
    }
  });
});

describe("what a Deezer track plays", () => {
  const read = async () => {
    const answer = await readDeezerTrack(
      TRACK,
      answering({ status: 200, body: JSON.stringify(FIXTURE) }).send,
    );
    assert.ok(answer.ok);
    return answer.song;
  };
  const daftPunk = (videoId: string): YtSong => ({
    videoId,
    title: "Harder, Better, Faster, Stronger",
    artists: ["Daft Punk"],
    album: "Discovery",
    durationMs: 224_000,
    artworkUrl: null,
    explicit: false,
  });

  test("the Library's same recording, with no YouTube Music search", async () => {
    const searched: unknown[] = [];
    const copy = {
      id: 4,
      title: "Harder, Better, Faster, Stronger",
      artist: "Daft Punk",
      durationMs: 226_400,
      path: "/music/hbfs.flac",
    };
    const play = await trackLinkPlay(await read(), {
      find: libraryFinder([copy]),
      search: async (song) => {
        searched.push(song);
        return { ok: true, songs: [] };
      },
    });
    assert.deepEqual(play.play === "magicQueue" && play.from === "library" && play.track, copy);
    assert.deepEqual(searched, []);
  });

  test("else YouTube Music's same recording, searched for once by its title and artists", async () => {
    const searched: unknown[] = [];
    const found = daftPunk("GDpmVUEjagg");
    const play = await trackLinkPlay(await read(), {
      find: libraryFinder([]),
      search: async (song) => {
        searched.push(song);
        return { ok: true, songs: [found] };
      },
    });
    assert.deepEqual(play, { play: "magicQueue", from: "stream", song: found });
    assert.equal(searched.length, 1);
  });

  test("found nowhere, the Couldn't find card shows Deezer's cover and searches its title and artist", async () => {
    const play = await trackLinkPlay(await read(), {
      find: libraryFinder([]),
      search: async () => ({ ok: true, songs: [] }),
    });
    assert.equal(play.play, "notFound");
    assert.deepEqual(play.play === "notFound" && songLinkNotFound(play.song, { search: true }), {
      heading: "Couldn't find this song online",
      title: "Harder, Better, Faster, Stronger",
      artists: "Daft Punk",
      artworkUrl:
        "https://cdn-images.dzcdn.net/images/cover/5718f7c81c27e0b2417e2a4c45224f8a/1000x1000-000000-80-0-0.jpg",
      searchQuery: "Harder, Better, Faster, Stronger Daft Punk",
    });
  });
});
