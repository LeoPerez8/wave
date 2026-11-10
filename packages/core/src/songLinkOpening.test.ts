import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  libraryFinder,
  linkedYtSong,
  sharedTextImport,
  songLinkLibraryCopy,
  songLinkNotice,
  songLinkPlay,
  type YtSong,
} from "./index.ts";

const VIDEO = "dQw4w9WgXcQ";
const on = { ytMusic: true };
const song = { kind: "song", link: { service: "ytMusic", videoId: VIDEO } };

describe("a shared YouTube Music song link", () => {
  test("the bare link YouTube Music's app shares opens the song, its parameters ignored", () => {
    for (const text of [
      `https://music.youtube.com/watch?v=${VIDEO}`,
      `https://music.youtube.com/watch?v=${VIDEO}&si=Ab12_cd-EF`,
      `https://music.youtube.com/watch?si=Ab12_cd-EF&v=${VIDEO}&feature=share`,
      `http://MUSIC.youtube.com/watch?v=${VIDEO}#t=30`,
      `music.youtube.com/watch?v=${VIDEO}`,
      `  music.youtube.com/watch?v=${VIDEO}&si=x  `,
    ]) {
      assert.deepEqual(sharedTextImport(text, on), song, text);
    }
  });

  test("a link among words, punctuation after it, is found", () => {
    for (const text of [
      `Genesis - YouTube Music\nhttps://music.youtube.com/watch?v=${VIDEO}&si=x`,
      `Listen to this: https://music.youtube.com/watch?v=${VIDEO}.`,
      `"https://music.youtube.com/watch?v=${VIDEO}"`,
    ]) {
      assert.deepEqual(sharedTextImport(text, on), song, text);
    }
  });

  test("a song played from a playlist is the song: the playlist is ignored", () => {
    assert.deepEqual(
      sharedTextImport(
        `https://music.youtube.com/watch?v=${VIDEO}&list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj`,
        on,
      ),
      song,
    );
  });

  test("playlist links still open the import card", () => {
    assert.deepEqual(
      sharedTextImport(
        "https://music.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj",
        on,
      ),
      {
        kind: "import",
        link: { service: "ytMusic", playlistId: "PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj" },
      },
    );
  });

  test("albums, artists, plain YouTube and anything else say what Wave opens", () => {
    for (const text of [
      "https://music.youtube.com/browse/MPREb_ABC123def45",
      "https://music.youtube.com/channel/UCiMhD4jzUqG-IgPzUmmytRQ",
      `https://www.youtube.com/watch?v=${VIDEO}`,
      `https://youtu.be/${VIDEO}`,
      "https://music.youtube.com/watch?v=",
      "https://music.youtube.com/watch?v=not a video",
      "https://music.youtube.com/watch?v=short",
      "https://en.wikipedia.org/wiki/Justice_(band)",
      "a note with no link",
      "",
    ]) {
      assert.deepEqual(
        sharedTextImport(text, on),
        {
          kind: "notice",
          title: "Can't open this",
          message: "Wave opens songs and playlists from YouTube Music and Spotify links.",
        },
        text,
      );
    }
  });

  test("with YT Music off, a song link says to turn it on, and nothing is read", () => {
    assert.deepEqual(
      sharedTextImport(`https://music.youtube.com/watch?v=${VIDEO}`, { ytMusic: false }),
      {
        kind: "notice",
        title: "YT Music is off",
        message:
          "Turn on YT Music in Settings to open songs and playlists from YouTube Music and Spotify links.",
      },
    );
  });
});

const yt = (videoId: string, fields: Partial<YtSong> = {}): YtSong => ({
  videoId,
  title: "Genesis",
  artists: ["Justice"],
  album: "Cross",
  durationMs: 234_000,
  artworkUrl: `https://lh3.googleusercontent.com/${videoId}`,
  explicit: false,
  ...fields,
});

const track = (id: number, fields: Partial<LibraryTrack> = {}): LibraryTrack => ({
  id,
  title: "Genesis",
  artist: "Justice",
  durationMs: 235_000,
  path: `/music/${id}.flac`,
  ...fields,
});

interface LibraryTrack {
  readonly id: number;
  readonly title: string;
  readonly artist: string;
  readonly durationMs: number;
  readonly path: string | null;
}

describe("the song a YouTube Music link names", () => {
  test("is the first song of its radio, which YouTube Music starts with it", () => {
    const genesis = yt(VIDEO);
    assert.equal(linkedYtSong(VIDEO, [genesis, yt("Phantom1234", { title: "Phantom" })]), genesis);
  });

  test("a radio that doesn't start with it, or none, means YouTube Music can't play it", () => {
    assert.equal(linkedYtSong(VIDEO, [yt("Phantom1234")]), null);
    assert.equal(linkedYtSong(VIDEO, []), null);
  });
});

describe("which copy of a linked song plays", () => {
  const genesis = yt(VIDEO);
  const noFind = () => null;

  test("the Library's song downloaded from that video plays first", () => {
    const stored = track(7, { title: "Genesis (Remastered)", durationMs: 0 });
    const other = track(8);
    assert.equal(songLinkLibraryCopy(genesis, { stored, find: libraryFinder([other]) }), stored);
  });

  test("else the Library's same recording, as Search finds it", () => {
    const same = track(8);
    const live = track(9, { title: "Genesis (Live)" });
    assert.equal(
      songLinkLibraryCopy(genesis, { stored: null, find: libraryFinder([live, same]) }),
      same,
    );
    assert.equal(
      songLinkLibraryCopy(genesis, {
        stored: null,
        find: libraryFinder([live, track(10, { durationMs: 300_000 })]),
      }),
      null,
    );
  });

  test("a Library song with no file on this phone isn't a copy that plays", () => {
    const missing = track(7, { path: null });
    assert.equal(
      songLinkLibraryCopy(genesis, { stored: missing, find: libraryFinder([missing]) }),
      null,
    );
    assert.equal(songLinkLibraryCopy(genesis, { stored: null, find: noFind }), null);
  });

  test("a Library copy plays as the Magic Queue that song's own menu starts", () => {
    const copy = track(7);
    assert.deepEqual(songLinkPlay(genesis, copy, genesis), {
      play: "magicQueue",
      from: "library",
      seed: { kind: "track", id: "7", title: "Genesis" },
      track: copy,
    });
  });

  test("without one, the YT Music song streams as its Magic Queue", () => {
    assert.deepEqual(songLinkPlay(genesis, null, genesis), {
      play: "magicQueue",
      from: "stream",
      song: genesis,
    });
  });

  test("with neither, the song isn't found, and nothing near it plays", () => {
    const named = {
      title: "Genesis",
      artists: ["Justice"],
      durationMs: 234_000,
      artworkUrl: null,
      videoId: null,
    };
    assert.deepEqual(songLinkPlay(named, null, null), { play: "notFound", song: named });
  });
});

describe("what a song link that doesn't play says", () => {
  test("offline, a short message says so", () => {
    assert.deepEqual(songLinkNotice("offline"), {
      title: "You're offline",
      message: "Connect to the internet to open this song.",
    });
  });

  test("a video YouTube Music can't play, or no answer, says the link doesn't open", () => {
    const doesntOpen = {
      title: "This link doesn't open",
      message: "YouTube Music couldn't play the song it links to.",
    };
    assert.deepEqual(songLinkNotice("unplayable"), doesntOpen);
    assert.deepEqual(songLinkNotice("failed"), doesntOpen);
  });

  test("YT Music turned off meanwhile says to turn it on", () => {
    assert.deepEqual(songLinkNotice("disabled"), {
      title: "YT Music is off",
      message:
        "Turn on YT Music in Settings to open songs and playlists from YouTube Music and Spotify links.",
    });
  });

  test("a song that isn't found says so with its title and artists", () => {
    assert.deepEqual(
      songLinkNotice({ notFound: { title: "Genesis", artists: ["Justice", "Ed Banger"] } }),
      { title: "Couldn't find this song online", message: "Genesis · Justice & Ed Banger" },
    );
  });

  test("in Portuguese", () => {
    assert.deepEqual(songLinkNotice("offline", "pt-BR"), {
      title: "Você está offline",
      message: "Conecte-se à internet para abrir esta música.",
    });
    assert.deepEqual(songLinkNotice("unplayable", "pt-BR"), {
      title: "Este link não abre",
      message: "O YouTube Music não conseguiu tocar a música deste link.",
    });
    assert.deepEqual(
      songLinkNotice({ notFound: { title: "Genesis", artists: ["Justice"] } }, "pt-BR"),
      {
        title: "Não foi possível encontrar esta música online",
        message: "Genesis · Justice",
      },
    );
  });
});
