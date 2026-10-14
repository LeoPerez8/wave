import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  PLAYLIST_NAME_MAX,
  linkImportView,
  planLinkImport,
  playlistImportSources,
  recognisePlaylistLink,
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
      reason: "Paste a link to a YouTube Music playlist.",
    });
    assert.deepEqual(recognisePlaylistLink("  \n"), {
      ok: false,
      problem: "empty",
      reason: "Paste a link to a YouTube Music playlist.",
    });
  });

  test("a link to a site other than YouTube is rejected, saying where Wave imports from", () => {
    assert.deepEqual(recognisePlaylistLink(`https://example.com/playlist?list=${ID}`), {
      ok: false,
      problem: "otherSite",
      reason: "Wave imports playlists from YouTube Music links.",
    });
  });
});
