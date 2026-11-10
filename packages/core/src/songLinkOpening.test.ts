import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  libraryFinder,
  linkedYtSong,
  sharedTextImport,
  songLinkLibraryCopy,
  songLinkNotice,
  songLinkPlay,
  spotifyShortLinkLanding,
  songLinkNotFound,
  trackLinkPlay,
  type SpotifySong,
  type YtSong,
  type YtSongSearch,
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

const TRACK = "4uLU6hMCjMI75M1A2tKUQC";
const spotifySong = { kind: "song", link: { service: "spotify", trackId: TRACK } };

describe("a shared Spotify song link", () => {
  test("a track link, with a locale, the embed player or parameters, opens the song", () => {
    for (const text of [
      `https://open.spotify.com/track/${TRACK}`,
      `https://open.spotify.com/track/${TRACK}?si=4f2a9c1b8e7d4c3a`,
      `https://open.spotify.com/intl-pt/track/${TRACK}?si=4f2a&context=spotify%3Aplaylist%3Ax`,
      `https://open.spotify.com/embed/track/${TRACK}`,
      `open.spotify.com/track/${TRACK}/`,
      `spotify:track:${TRACK}`,
    ]) {
      assert.deepEqual(sharedTextImport(text, on), spotifySong, text);
    }
  });

  test("the text Spotify's app shares, the link among words, is found", () => {
    for (const text of [
      `Never Gonna Give You Up - Rick Astley https://open.spotify.com/track/${TRACK}?si=x`,
      `Listen to this on Spotify!\nhttps://open.spotify.com/intl-de/track/${TRACK}.`,
      `"spotify:track:${TRACK}"`,
    ]) {
      assert.deepEqual(sharedTextImport(text, on), spotifySong, text);
    }
  });

  test("a short link is a song link to follow, as only Spotify knows what it names", () => {
    for (const text of [
      "https://spotify.link/wud9sAYDbDb",
      "Never Gonna Give You Up https://spotify.link/wud9sAYDbDb?_branch=1",
      "https://spotify.app.link/wud9sAYDbDb",
    ]) {
      const host = text.includes("app.link") ? "spotify.app.link" : "spotify.link";
      assert.deepEqual(
        sharedTextImport(text, on),
        { kind: "song", link: { service: "spotifyShort", url: `https://${host}/wud9sAYDbDb` } },
        text,
      );
    }
  });

  test("playlist links still open the import card", () => {
    assert.deepEqual(
      sharedTextImport("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", on),
      {
        kind: "import",
        link: { service: "spotify", playlistId: "37i9dQZF1DXcBWIGoYBM5M" },
      },
    );
  });

  test("albums, artists, podcasts and malformed ids say what Wave opens", () => {
    for (const text of [
      `https://open.spotify.com/album/${TRACK}`,
      `https://open.spotify.com/artist/${TRACK}`,
      `https://open.spotify.com/episode/${TRACK}`,
      "https://open.spotify.com/track/tooShort",
      `https://open.spotify.com/track/${TRACK}/extra`,
      "spotify:track:",
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
});

describe("where a shared Spotify short link lands", () => {
  const SONG = "3HDsUtYD9XztWhwQY2smjt";
  const PLAYLIST = "1RTENWq73MEx1Pop40ZZ5S";

  test("on a track's page, it plays that track", () => {
    assert.deepEqual(
      spotifyShortLinkLanding(
        `https://open.spotify.com/track/${SONG}?si=abc&_branch_match_id=123`,
        "",
      ),
      { kind: "song", link: { service: "spotify", trackId: SONG } },
    );
  });

  test("on Branch's page for apps, the first Spotify page it names is the track", () => {
    assert.deepEqual(
      spotifyShortLinkLanding(
        "https://spotify.app.link/wud9sAYDbDb?_p=c214",
        `<script>window.location = "https://open.spotify.com/track/${SONG}?si=1";</script>`,
      ),
      { kind: "song", link: { service: "spotify", trackId: SONG } },
    );
  });

  test("on a playlist, it opens the import card", () => {
    const playlist = { kind: "import", link: { service: "spotify", playlistId: PLAYLIST } };
    assert.deepEqual(
      spotifyShortLinkLanding(`https://open.spotify.com/playlist/${PLAYLIST}?si=abc`, ""),
      playlist,
    );
    assert.deepEqual(
      spotifyShortLinkLanding(
        "https://spotify.app.link/x?_p=1",
        `<a href="https://open.spotify.com/playlist/${PLAYLIST}">Open</a>`,
      ),
      playlist,
    );
  });

  test("anywhere else (a profile, an album, no Spotify page), it opens nothing", () => {
    for (const [url, body] of [
      ["https://spotify.app.link/uszhQI5hT3b?_p=1", '"https://open.spotify.com/user/leo"'],
      ["https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC", ""],
      ["https://spotify.link/nothing", "<html></html>"],
    ] as const) {
      assert.equal(spotifyShortLinkLanding(url, body), null, url);
    }
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

/** A search answering [answer], counting how often it is asked and for what. */
const searching = (answer: YtSongSearch<YtSong> | null) => {
  const asked: SpotifySong[] = [];
  const search = async (wanted: SpotifySong) => {
    asked.push(wanted);
    return answer;
  };
  return { asked, search };
};

describe("what a song another service's link names plays", () => {
  const read: SpotifySong = {
    title: "Genesis",
    artists: ["Justice"],
    album: null,
    durationMs: 234_500,
    artworkUrl: "https://image-cdn-ak.spotifycdn.com/image/genesis",
  };
  const linked = {
    title: "Genesis",
    artists: ["Justice"],
    durationMs: 234_500,
    artworkUrl: "https://image-cdn-ak.spotifycdn.com/image/genesis",
    videoId: null,
  };
  test("the Library's same recording plays, with no YouTube Music search", async () => {
    const copy = track(8);
    const { asked, search } = searching({ ok: true, songs: [yt(VIDEO)] });
    assert.deepEqual(
      await trackLinkPlay(read, {
        find: libraryFinder([track(7, { title: "Genesis (Live)" }), copy]),
        search,
      }),
      {
        play: "magicQueue",
        from: "library",
        seed: { kind: "track", id: "8", title: "Genesis" },
        track: copy,
      },
    );
    assert.deepEqual(asked, []);
  });

  test("else YouTube Music is searched once for it, and its same recording streams", async () => {
    const found = yt(VIDEO);
    const { asked, search } = searching({ ok: true, songs: [found] });
    assert.deepEqual(
      await trackLinkPlay(read, { find: libraryFinder([track(7, { path: null })]), search }),
      { play: "magicQueue", from: "stream", song: found },
    );
    assert.deepEqual(asked, [read]);
  });

  test("no same recording online, it isn't found: its title, artists and cover are shown", async () => {
    assert.deepEqual(
      await trackLinkPlay(read, {
        find: libraryFinder([]),
        search: searching({ ok: true, songs: [] }).search,
      }),
      { play: "notFound", song: linked },
    );
  });

  test("a search that fails says why, and nothing plays", async () => {
    for (const [answer, failure] of [
      [{ ok: false, reason: "offline" }, "offline"],
      [{ ok: false, reason: "failed" }, "searchFailed"],
      [{ ok: false, reason: "disabled" }, "disabled"],
      [null, "searchFailed"],
    ] as const) {
      assert.deepEqual(
        await trackLinkPlay(read, { find: libraryFinder([]), search: searching(answer).search }),
        { play: "failed", failure },
      );
    }
  });
});

describe("what a Spotify song link that doesn't play says", () => {
  test("a track Spotify doesn't have, Spotify out of reach, or an answer Wave can't read", () => {
    assert.deepEqual(songLinkNotice({ unread: "missing", service: "spotify" }), {
      title: "This link doesn't open",
      message: "Spotify doesn't have the song it links to.",
    });
    assert.deepEqual(songLinkNotice({ unread: "unreachable", service: "spotify" }), {
      title: "This link doesn't open",
      message: "Couldn't reach Spotify. Check your connection and try again.",
    });
    assert.deepEqual(songLinkNotice({ unread: "failed", service: "spotify" }), {
      title: "This link doesn't open",
      message: "Spotify didn't answer as expected.",
    });
  });

  test("no answer to YouTube Music's search says so", () => {
    assert.deepEqual(songLinkNotice("searchFailed"), {
      title: "This link doesn't open",
      message: "YouTube Music didn't answer. Try again later.",
    });
  });

  test("a short link to neither a song nor a playlist says what Wave opens", () => {
    assert.deepEqual(songLinkNotice("cantOpen"), {
      title: "Can't open this",
      message: "Wave opens songs and playlists from YouTube Music and Spotify links.",
    });
  });

  test("in Portuguese", () => {
    assert.deepEqual(songLinkNotice({ unread: "missing", service: "spotify" }, "pt-BR"), {
      title: "Este link não abre",
      message: "O Spotify não tem a música deste link.",
    });
    assert.deepEqual(songLinkNotice({ unread: "unreachable", service: "spotify" }, "pt-BR"), {
      title: "Este link não abre",
      message: "Não foi possível acessar o Spotify. Verifique sua conexão e tente novamente.",
    });
    assert.deepEqual(songLinkNotice({ unread: "failed", service: "spotify" }, "pt-BR"), {
      title: "Este link não abre",
      message: "O Spotify não respondeu como esperado.",
    });
    assert.deepEqual(songLinkNotice("searchFailed", "pt-BR"), {
      title: "Este link não abre",
      message: "O YouTube Music não respondeu. Tente novamente mais tarde.",
    });
  });
});

describe("the Couldn't find card", () => {
  const senorita = {
    title: "Señorita",
    artists: ["Shawn Mendes", "Camila Cabello"],
    durationMs: 190_800,
    artworkUrl: "https://image-cdn-ak.spotifycdn.com/image/senorita",
    videoId: null,
  };

  test("shows the song's title, artists and cover, and searches for its title and main artist", () => {
    assert.deepEqual(songLinkNotFound(senorita, { search: true }), {
      heading: "Couldn't find this song online",
      title: "Señorita",
      artists: "Shawn Mendes & Camila Cabello",
      artworkUrl: "https://image-cdn-ak.spotifycdn.com/image/senorita",
      searchQuery: "Señorita Shawn Mendes",
    });
  });

  test("with no Search tab, it offers no Search", () => {
    assert.equal(songLinkNotFound(senorita, { search: false }).searchQuery, null);
  });

  test("a credit that names two artists searches for the first", () => {
    assert.equal(
      songLinkNotFound(
        { ...senorita, artists: ["Shawn Mendes & Camila Cabello"] },
        { search: true },
      ).searchQuery,
      "Señorita Shawn Mendes",
    );
  });

  test("in Portuguese", () => {
    assert.equal(
      songLinkNotFound(senorita, { search: true }, "pt-BR").heading,
      "Não foi possível encontrar esta música online",
    );
  });
});
