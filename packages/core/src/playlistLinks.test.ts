import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  PLAYLIST_NAME_MAX,
  linkImportView,
  planLinkImport,
  playlistImportSources,
  recognisePlaylistLink,
  sharedTextImport,
  spotifyShortLinkTarget,
  type YtAlbumSong,
} from "./index.ts";

const ID = "PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj";

const yt = (videoId: string, title: string, fields: Partial<YtAlbumSong> = {}): YtAlbumSong => ({
  videoId,
  title,
  artists: ["Justice"],
  album: "Cross",
  albumId: "MPREb_cross",
  durationMs: null,
  artworkUrl: `https://lh3.googleusercontent.com/${videoId}`,
  explicit: false,
  ...fields,
});

/** The Library as an import matches it: Justice's Genesis and Phantom. */
const library = [
  { id: 11, title: "Genesis", artist: "Justice", durationMs: 234_000 },
  { id: 12, title: "Phantom", artist: "Justice", durationMs: 262_000 },
];

const playlist = (songs: readonly YtAlbumSong[], fields = {}) => ({
  title: "Drive",
  artworkUrl: "https://lh3.googleusercontent.com/drive",
  songs,
  truncated: false,
  ...fields,
});

/** The card's input once [songs] have been read. */
const read = (songs: readonly YtAlbumSong[], fields = {}) => {
  const source = playlist(songs, fields);
  return { status: "read", playlist: source, plan: planLinkImport(source, library) } as const;
};

describe("playlistImportSources", () => {
  test("Import asks: From a Link or From Files", () => {
    assert.deepEqual(playlistImportSources({ ytMusic: true }), ["link", "files"]);
  });

  test("with YT Music off, Import goes straight to files", () => {
    assert.deepEqual(playlistImportSources({ ytMusic: false }), ["files"]);
  });
});

describe("linkImportView", () => {
  test("a read playlist shows its cover, name, songs and how many the Library has, with Import", () => {
    assert.deepEqual(
      linkImportView(
        read([yt("g1", "Genesis"), yt("s1", "Stress"), yt("w1", "Waters of Nazareth")]),
      ),
      {
        name: "Drive",
        artworkUrl: "https://lh3.googleusercontent.com/drive",
        line: "3 songs · 1 in your Library",
        note: null,
        canImport: true,
        retry: false,
      },
    );
  });

  test("while it's read, the card says so and offers neither Import nor Try Again", () => {
    assert.deepEqual(linkImportView({ status: "reading" }), {
      name: null,
      artworkUrl: null,
      line: "Reading the playlist…",
      note: null,
      canImport: false,
      retry: false,
    });
  });

  test("offline, a failed read or an unknown playlist shows a message with Try Again", () => {
    const offline = linkImportView({ status: "failed", reason: "offline" });
    assert.equal(offline.line, "You're offline. Try again when you're back online.");
    assert.deepEqual([offline.canImport, offline.retry, offline.name], [false, true, null]);
    const failed = linkImportView({ status: "failed", reason: "failed" });
    assert.equal(
      failed.line,
      "Couldn't read this playlist. It may be private or deleted, or YouTube Music didn't answer.",
    );
    assert.deepEqual([failed.canImport, failed.retry], [false, true]);
  });

  test("with YT Music turned off meanwhile, it says so without Try Again", () => {
    const off = linkImportView({ status: "failed", reason: "disabled" });
    assert.equal(off.line, "YT Music is off in Settings.");
    assert.deepEqual([off.canImport, off.retry], [false, false]);
  });

  test("a playlist with no songs has nothing to import", () => {
    const view = linkImportView(read([]));
    assert.equal(view.name, "Drive");
    assert.equal(view.line, "It has no songs to import.");
    assert.equal(view.canImport, false);
  });

  test("every song in the Library, or none, says so", () => {
    assert.equal(linkImportView(read([yt("g1", "Genesis")])).line, "1 song · all in your Library");
    assert.equal(
      linkImportView(read([yt("s1", "Stress"), yt("w1", "Waters")])).line,
      "2 songs · none in your Library",
    );
  });

  test("a playlist longer than what's read says only its first songs come", () => {
    const view = linkImportView(
      read([yt("s1", "Stress"), yt("w1", "Waters")], { truncated: true }),
    );
    assert.equal(view.note, "It goes on past 2 songs. Only those are imported.");
  });
});

describe("planLinkImport", () => {
  test("songs the Library has are its tracks, the rest stream, in the playlist's order", () => {
    const stays = yt("s1", "Stress");
    const plan = planLinkImport(
      playlist([
        yt("g1", "Genesis", { durationMs: 235_000 }),
        stays,
        yt("p1", "Phantom", { artists: ["Justice", "Daft Punk"], durationMs: 262_000 }),
      ]),
      library,
    );
    assert.deepEqual(plan.songs, [
      { source: "library", trackId: 11 },
      { source: "stream", song: stays },
      { source: "library", trackId: 12 },
    ]);
    assert.equal(plan.inLibrary, 2);
  });

  test("a playlist of only Library songs makes an ordinary playlist", () => {
    const plan = planLinkImport(playlist([yt("p1", "Phantom"), yt("g1", "Genesis")]), library);
    assert.deepEqual(plan.songs, [
      { source: "library", trackId: 12 },
      { source: "library", trackId: 11 },
    ]);
  });

  test("a song that comes twice, or two that are one Library song, goes in once", () => {
    const stays = yt("s1", "Stress");
    const plan = planLinkImport(
      playlist([yt("g1", "Genesis"), stays, yt("g2", "Genesis (Remastered)"), stays]),
      library,
    );
    assert.deepEqual(plan.songs, [
      { source: "library", trackId: 11 },
      { source: "stream", song: stays },
    ]);
    assert.equal(plan.inLibrary, 1);
  });

  test("the playlist is named after the source, as a playlist name can be", () => {
    assert.equal(
      planLinkImport(playlist([], { title: "  Night   Drive " }), library).name,
      "Night Drive",
    );
    assert.equal(planLinkImport(playlist([], { title: " " }), library).name, "Imported Playlist");
    assert.equal(
      planLinkImport(playlist([], { title: "x".repeat(140) }), library).name,
      "x".repeat(PLAYLIST_NAME_MAX),
    );
  });
});

describe("recognisePlaylistLink", () => {
  test("a YouTube Music playlist link gives its playlist id", () => {
    assert.deepEqual(recognisePlaylistLink(`https://music.youtube.com/playlist?list=${ID}`), {
      ok: true,
      link: { service: "ytMusic", playlistId: ID },
    });
  });

  test("YouTube's playlist links work too, on any of its hosts, with or without a scheme or extra parameters", () => {
    for (const text of [
      `https://www.youtube.com/playlist?list=${ID}`,
      `https://m.youtube.com/playlist?list=${ID}&si=Ab12_cd-EF`,
      `http://youtube.com/playlist?si=Ab12_cd-EF&list=${ID}#top`,
      `music.youtube.com/playlist?list=${ID}&si=Ab12_cd-EF`,
      `  https://MUSIC.youtube.com/playlist?list=${ID}\n`,
    ]) {
      assert.deepEqual(
        recognisePlaylistLink(text),
        { ok: true, link: { service: "ytMusic", playlistId: ID } },
        text,
      );
    }
  });

  test("the bare id, or list= and the id, names the playlist too", () => {
    for (const [text, playlistId] of [
      [ID, ID],
      [`list=${ID}`, ID],
      ["OLAK5uy_kVYZxqZ3pXv3d8T9eJbI3ZJkQm1zO5qYw", "OLAK5uy_kVYZxqZ3pXv3d8T9eJbI3ZJkQm1zO5qYw"],
      [
        "RDCLAK5uy_lBNUteBRencHzKelu5iDHwLF6mYqjL-JU",
        "RDCLAK5uy_lBNUteBRencHzKelu5iDHwLF6mYqjL-JU",
      ],
      // A browse id is the playlist id after VL.
      [`VL${ID}`, ID],
    ] as const) {
      assert.deepEqual(
        recognisePlaylistLink(text),
        { ok: true, link: { service: "ytMusic", playlistId } },
        text,
      );
    }
  });

  test("a link shared with words around it is found among them", () => {
    assert.deepEqual(
      recognisePlaylistLink(
        `Drive\nhttps://music.youtube.com/playlist?list=${ID}&si=Ab12 via Wave`,
      ),
      { ok: true, link: { service: "ytMusic", playlistId: ID } },
    );
  });

  test("a link to a song, even one played from a playlist, is rejected as a song", () => {
    for (const text of [
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      `https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${ID}`,
      `https://youtu.be/dQw4w9WgXcQ?list=${ID}`,
    ]) {
      assert.deepEqual(
        recognisePlaylistLink(text),
        { ok: false, problem: "song", reason: "This is a link to a song, not a playlist." },
        text,
      );
    }
  });

  test("any other YouTube link is rejected as not a playlist", () => {
    for (const text of [
      "https://music.youtube.com/",
      "https://music.youtube.com/channel/UCiMhD4jzUqG-IgPzUmmytRQ",
      "https://music.youtube.com/playlist",
      "https://music.youtube.com/playlist?list=",
      "https://www.youtube.com/playlist?list=PL%20oops",
    ]) {
      assert.deepEqual(
        recognisePlaylistLink(text),
        { ok: false, problem: "notPlaylist", reason: "This link isn't to a playlist." },
        text,
      );
    }
  });

  test("text that isn't a link is rejected, and nothing at all asks for one", () => {
    assert.deepEqual(recognisePlaylistLink("my favourite songs"), {
      ok: false,
      problem: "notLink",
      reason: "Paste a link to a YouTube Music or Spotify playlist.",
    });
    assert.deepEqual(recognisePlaylistLink("  \n"), {
      ok: false,
      problem: "empty",
      reason: "Paste a link to a YouTube Music or Spotify playlist.",
    });
  });

  test("a link to a site other than YouTube is rejected, saying where Wave imports from", () => {
    assert.deepEqual(recognisePlaylistLink(`https://example.com/playlist?list=${ID}`), {
      ok: false,
      problem: "otherSite",
      reason: "Wave imports playlists from YouTube Music and Spotify links.",
    });
  });
});

describe("recognisePlaylistLink: Spotify", () => {
  const SPOTIFY = "1RTENWq73MEx1Pop40ZZ5S";
  const spotify = { ok: true, link: { service: "spotify", playlistId: SPOTIFY } };

  test("a Spotify playlist link gives its playlist id, extra parameters ignored", () => {
    for (const text of [
      `https://open.spotify.com/playlist/${SPOTIFY}`,
      `https://open.spotify.com/playlist/${SPOTIFY}?si=4f2a9c1b8e7d4c3a&pt=abc`,
      `https://open.spotify.com/intl-pt/playlist/${SPOTIFY}?si=4f2a9c1b8e7d4c3a`,
      `https://open.spotify.com/intl-pt-BR/playlist/${SPOTIFY}`,
      `https://open.spotify.com/user/daanmathijs1999/playlist/${SPOTIFY}`,
      `https://open.spotify.com/embed/playlist/${SPOTIFY}?utm_source=generator`,
      `open.spotify.com/playlist/${SPOTIFY}`,
      `http://OPEN.spotify.com/playlist/${SPOTIFY}/`,
    ]) {
      assert.deepEqual(recognisePlaylistLink(text), spotify, text);
    }
  });

  test("a Spotify URI names the playlist too", () => {
    for (const text of [
      `spotify:playlist:${SPOTIFY}`,
      `spotify:user:daanmathijs1999:playlist:${SPOTIFY}`,
    ]) {
      assert.deepEqual(recognisePlaylistLink(text), spotify, text);
    }
  });

  test("a short share link is kept to follow, as only Spotify knows what it names", () => {
    assert.deepEqual(recognisePlaylistLink("https://spotify.link/uszhQI5hT3b"), {
      ok: true,
      link: { service: "spotifyShort", url: "https://spotify.link/uszhQI5hT3b" },
    });
    assert.deepEqual(recognisePlaylistLink("spotify.app.link/uszhQI5hT3b?_p=c21436"), {
      ok: true,
      link: { service: "spotifyShort", url: "https://spotify.app.link/uszhQI5hT3b" },
    });
  });

  test("a link to a Spotify song is rejected as a song, and other Spotify pages as not playlists", () => {
    for (const text of [
      "https://open.spotify.com/track/3HDsUtYD9XztWhwQY2smjt?si=1",
      "https://open.spotify.com/intl-de/track/3HDsUtYD9XztWhwQY2smjt",
      "spotify:track:3HDsUtYD9XztWhwQY2smjt",
    ]) {
      assert.deepEqual(
        recognisePlaylistLink(text),
        { ok: false, problem: "song", reason: "This is a link to a song, not a playlist." },
        text,
      );
    }
    for (const text of [
      "https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj",
      "https://open.spotify.com/artist/1Xyo4u8uXC1ZmMpatF05PJ",
      "https://open.spotify.com/user/daanmathijs1999",
      "https://open.spotify.com/playlist/abc",
      "https://open.spotify.com/",
      "spotify:album:4yP0hdKOZPNshxUOjY0cZj",
      "https://spotify.link/",
    ]) {
      assert.deepEqual(
        recognisePlaylistLink(text),
        { ok: false, problem: "notPlaylist", reason: "This link isn't to a playlist." },
        text,
      );
    }
  });
});

describe("spotifyShortLinkTarget", () => {
  const SPOTIFY = "1RTENWq73MEx1Pop40ZZ5S";

  test("a short link that lands on Spotify's page names that page's playlist", () => {
    assert.deepEqual(
      spotifyShortLinkTarget(
        `https://open.spotify.com/playlist/${SPOTIFY}?si=abc&_branch_match_id=123`,
        "",
      ),
      { ok: true, link: { service: "spotify", playlistId: SPOTIFY } },
    );
  });

  test("one that lands on Branch's page names the first Spotify page in it", () => {
    const body = `<html><head><meta property="al:android:url" content="spotify://playlist/${SPOTIFY}">
<script>window.location = "https://open.spotify.com/playlist/${SPOTIFY}?si=abc&_branch_match_id=1";</script>
<a href="https://open.spotify.com/playlist/${SPOTIFY}">Open</a></head></html>`;
    assert.deepEqual(spotifyShortLinkTarget("https://spotify.app.link/uszhQI5hT3b?_p=c214", body), {
      ok: true,
      link: { service: "spotify", playlistId: SPOTIFY },
    });
  });

  test("a short link to a song, or to nothing Wave knows, says so", () => {
    assert.deepEqual(
      spotifyShortLinkTarget(
        "https://spotify.app.link/wud9sAYDbDb?_p=c214",
        'location = "https://open.spotify.com/track/3HDsUtYD9XztWhwQY2smjt?si=1"',
      ),
      { ok: false, problem: "song", reason: "This is a link to a song, not a playlist." },
    );
    assert.deepEqual(spotifyShortLinkTarget("https://spotify.link/nothing", "<html></html>"), {
      ok: false,
      problem: "notPlaylist",
      reason: "This link isn't to a playlist.",
    });
  });
});

describe("sharedTextImport", () => {
  const on = { ytMusic: true };

  test("the bare link YouTube Music's app shares opens its playlist's import", () => {
    assert.deepEqual(
      sharedTextImport(`https://music.youtube.com/playlist?list=${ID}&si=Ab12_cd-EF`, on),
      { kind: "import", link: { service: "ytMusic", playlistId: ID } },
    );
  });

  test("a link other apps share among words, even with punctuation after it, is found", () => {
    for (const text of [
      `Drive - YouTube Music
https://music.youtube.com/playlist?list=${ID}`,
      `Listen to Drive: https://music.youtube.com/playlist?list=${ID}.`,
      `Drive (https://www.youtube.com/playlist?list=${ID}), via my browser`,
      `"https://music.youtube.com/playlist?list=${ID}&si=Ab12_cd-EF"`,
    ]) {
      assert.deepEqual(
        sharedTextImport(text, on),
        { kind: "import", link: { service: "ytMusic", playlistId: ID } },
        text,
      );
    }
  });

  test("the text Spotify's app shares opens its playlist's import", () => {
    const SPOTIFY = "37i9dQZF1DXcBWIGoYBM5M";
    const spotify = { kind: "import", link: { service: "spotify", playlistId: SPOTIFY } };
    for (const text of [
      `https://open.spotify.com/playlist/${SPOTIFY}?si=4f2a9c1b8e7d4c3a`,
      `Today's Top Hits https://open.spotify.com/playlist/${SPOTIFY}?si=4f2a9c1b8e7d4c3a`,
      `Check out this playlist on Spotify!\nhttps://open.spotify.com/intl-pt/playlist/${SPOTIFY}?si=4f2a`,
      `spotify:playlist:${SPOTIFY}`,
    ]) {
      assert.deepEqual(sharedTextImport(text, on), spotify, text);
    }
    assert.deepEqual(sharedTextImport("Today's Top Hits https://spotify.link/uszhQI5hT3b", on), {
      kind: "import",
      link: { service: "spotifyShort", url: "https://spotify.link/uszhQI5hT3b" },
    });
  });

  test("anything else shared says what Wave imports", () => {
    for (const text of [
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=Ab12_cd-EF",
      "https://music.youtube.com/browse/MPREb_ABC123def45",
      "https://music.youtube.com/channel/UCiMhD4jzUqG-IgPzUmmytRQ",
      `https://example.com/playlist?list=${ID}`,
      "Look at this: https://en.wikipedia.org/wiki/Justice_(band)",
      "a note with no link",
      // An id on its own is something to paste, not a link to share.
      ID,
      "",
    ]) {
      assert.deepEqual(
        sharedTextImport(text, on),
        {
          kind: "notice",
          title: "Can't import this",
          message: "Wave imports playlists from YouTube Music and Spotify links.",
        },
        text,
      );
    }
  });

  test("with YT Music off, whatever is shared says to turn it on, and nothing is read", () => {
    for (const text of [`https://music.youtube.com/playlist?list=${ID}`, "a note with no link"]) {
      assert.deepEqual(
        sharedTextImport(text, { ytMusic: false }),
        {
          kind: "notice",
          title: "YT Music is off",
          message:
            "Turn on YT Music in Settings to import playlists from YouTube Music and Spotify links.",
        },
        text,
      );
    }
  });
});
