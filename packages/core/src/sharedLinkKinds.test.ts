import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  deezerShortLinkLanding,
  recognisePlaylistLink,
  recogniseSongLink,
  sharedTextImport,
  songLinkKind,
  spotifyShortLinkLanding,
} from "./index.ts";

const on = { ytMusic: true };
const VIDEO = "dQw4w9WgXcQ";

describe("a shared plain YouTube video link", () => {
  test("plays as a YouTube Music link to the same video does, from any of YouTube's hosts", () => {
    for (const text of [
      `https://www.youtube.com/watch?v=${VIDEO}`,
      `https://youtube.com/watch?feature=share&v=${VIDEO}&t=42`,
      `m.youtube.com/watch?v=${VIDEO}`,
      `https://youtu.be/${VIDEO}`,
      `youtu.be/${VIDEO}?si=Ab12_cd-EF`,
      `https://www.youtube.com/shorts/${VIDEO}`,
      `youtube.com/shorts/${VIDEO}?feature=share`,
      `Watch this https://youtu.be/${VIDEO}!`,
    ]) {
      assert.deepEqual(
        sharedTextImport(text, on),
        { kind: "song", link: { service: "ytMusic", videoId: VIDEO } },
        text,
      );
    }
  });

  test("a watch link that carries a playlist is the song, as on YouTube Music", () => {
    assert.deepEqual(
      recogniseSongLink(`https://www.youtube.com/watch?v=${VIDEO}&list=PLMC9KNkIncKtPzgY-5rmhvj7f`),
      { service: "ytMusic", videoId: VIDEO },
    );
  });

  test("a link with no video id, or a malformed one, isn't a song", () => {
    for (const text of [
      "https://www.youtube.com/watch?v=short",
      "https://youtu.be/",
      `https://youtu.be/${VIDEO}/extra`,
      "https://www.youtube.com/shorts/",
      "https://www.youtube.com/@justice",
    ]) {
      assert.equal(recogniseSongLink(text), null, text);
    }
  });
});

const ALBUM_BROWSE = "MPREb_06zfD9zt7QK";
const ALBUM_PLAYLIST = "OLAK5uy_mQ7srIA2o7zWLgK1pnG3XnYnyx85mGbY8";
const CHANNEL = "UCiryJZISyBldwm9ocAE-QfQ";

describe("a shared YouTube Music album link", () => {
  test("an album's page opens that album", () => {
    for (const text of [
      `https://music.youtube.com/browse/${ALBUM_BROWSE}`,
      `music.youtube.com/browse/${ALBUM_BROWSE}?si=x`,
      `Pink Moon - YouTube Music https://music.youtube.com/browse/${ALBUM_BROWSE}.`,
    ]) {
      assert.deepEqual(
        sharedTextImport(text, on),
        { kind: "song", link: { service: "ytAlbum", browseId: ALBUM_BROWSE } },
        text,
      );
    }
  });

  test("an album's playlist opens the album, not the import card", () => {
    for (const text of [
      `https://music.youtube.com/playlist?list=${ALBUM_PLAYLIST}`,
      `https://music.youtube.com/playlist?list=${ALBUM_PLAYLIST}&si=x`,
      `https://www.youtube.com/playlist?list=${ALBUM_PLAYLIST}`,
      `youtube.com/playlist?feature=share&list=${ALBUM_PLAYLIST}`,
    ]) {
      assert.deepEqual(
        sharedTextImport(text, on),
        { kind: "song", link: { service: "ytAlbumPlaylist", playlistId: ALBUM_PLAYLIST } },
        text,
      );
    }
  });

  test("From a Link still imports an album's playlist as a playlist", () => {
    assert.deepEqual(
      recognisePlaylistLink(`https://music.youtube.com/playlist?list=${ALBUM_PLAYLIST}`),
      { ok: true, link: { service: "ytMusic", playlistId: ALBUM_PLAYLIST } },
    );
  });

  test("other browse pages and made playlists aren't albums", () => {
    assert.equal(recogniseSongLink("https://music.youtube.com/browse/FEmusic_home"), null);
    assert.equal(recogniseSongLink(`https://music.youtube.com/browse/${CHANNEL}`), null);
    assert.deepEqual(
      sharedTextImport("https://music.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7f", on),
      { kind: "import", link: { service: "ytMusic", playlistId: "PLMC9KNkIncKtPzgY-5rmhvj7f" } },
    );
  });
});

describe("a shared YouTube or YouTube Music channel link", () => {
  test("opens that channel's YT Music artist page", () => {
    for (const text of [
      `https://music.youtube.com/channel/${CHANNEL}`,
      `https://www.youtube.com/channel/${CHANNEL}?si=x`,
      `youtube.com/channel/${CHANNEL}/`,
      `m.youtube.com/channel/${CHANNEL}`,
    ]) {
      assert.deepEqual(
        sharedTextImport(text, on),
        { kind: "song", link: { service: "ytArtist", channelId: CHANNEL } },
        text,
      );
    }
  });

  test("a handle, a channel's tab or a malformed id isn't one", () => {
    for (const text of [
      "https://www.youtube.com/@NickDrakeOfficial",
      `https://www.youtube.com/channel/${CHANNEL}/videos`,
      "https://www.youtube.com/channel/PLnotachannel",
    ]) {
      assert.equal(recogniseSongLink(text), null, text);
    }
  });
});

const SPOTIFY_ARTIST = "4Z8W4fKeB5YxbusRsdQVPb";
const DEEZER_ARTIST = "399";

describe("a shared Spotify or Deezer artist link", () => {
  test("a Spotify artist's page or URI is an artist to look for", () => {
    for (const text of [
      `https://open.spotify.com/artist/${SPOTIFY_ARTIST}`,
      `https://open.spotify.com/intl-pt/artist/${SPOTIFY_ARTIST}?si=abc`,
      `Radiohead on Spotify https://open.spotify.com/artist/${SPOTIFY_ARTIST}?si=x.`,
      `spotify:artist:${SPOTIFY_ARTIST}`,
    ]) {
      assert.deepEqual(
        sharedTextImport(text, on),
        { kind: "song", link: { service: "spotifyArtist", artistId: SPOTIFY_ARTIST } },
        text,
      );
    }
    assert.equal(recogniseSongLink("https://open.spotify.com/artist/tooShort"), null);
  });

  test("a Deezer artist's page is an artist to look for, its id digits", () => {
    for (const text of [
      `https://www.deezer.com/artist/${DEEZER_ARTIST}`,
      `https://www.deezer.com/br/artist/${DEEZER_ARTIST}?utm_source=deezer`,
      `deezer.com/en/artist/${DEEZER_ARTIST}/`,
    ]) {
      assert.deepEqual(
        sharedTextImport(text, on),
        { kind: "song", link: { service: "deezerArtist", artistId: DEEZER_ARTIST } },
        text,
      );
    }
    assert.equal(recogniseSongLink("https://www.deezer.com/artist/399x"), null);
  });

  test("a Spotify short link that lands on an artist looks for that artist", () => {
    assert.deepEqual(
      spotifyShortLinkLanding(`https://open.spotify.com/artist/${SPOTIFY_ARTIST}?si=1`, ""),
      { kind: "artist", link: { service: "spotifyArtist", artistId: SPOTIFY_ARTIST } },
    );
    assert.deepEqual(
      spotifyShortLinkLanding(
        "https://spotify.app.link/x?_p=1",
        `"https://open.spotify.com/artist/${SPOTIFY_ARTIST}"`,
      ),
      { kind: "artist", link: { service: "spotifyArtist", artistId: SPOTIFY_ARTIST } },
    );
  });

  test("a Deezer short link that lands on an artist looks for that artist", () => {
    assert.deepEqual(deezerShortLinkLanding(`https://www.deezer.com/br/artist/${DEEZER_ARTIST}`), {
      service: "deezerArtist",
      artistId: DEEZER_ARTIST,
    });
  });
});

describe("links Wave still doesn't open", () => {
  test("Deezer albums and playlists, and where a short link lands on one, open nothing", () => {
    for (const text of [
      "https://www.deezer.com/album/302127",
      "https://www.deezer.com/br/playlist/13957557901",
    ]) {
      assert.equal(sharedTextImport(text, on).kind, "notice", text);
      assert.equal(deezerShortLinkLanding(text), null, text);
    }
  });
});

describe("what the Can't open this message says", () => {
  test("it lists every kind of link Wave opens", () => {
    assert.deepEqual(sharedTextImport("https://www.youtube.com/@NickDrakeOfficial", on), {
      kind: "notice",
      title: "Can't open this",
      message:
        "Wave opens songs and artists from YouTube, YouTube Music, Spotify and Deezer links, playlists from YouTube Music and Spotify links, and albums from YouTube Music and Spotify links.",
    });
  });

  test("in Portuguese too", () => {
    assert.deepEqual(sharedTextImport("https://www.deezer.com/album/302127", on, "pt-BR"), {
      kind: "notice",
      title: "Não é possível abrir isto",
      message:
        "O Wave abre músicas e artistas de links do YouTube, do YouTube Music, do Spotify e do Deezer, playlists de links do YouTube Music e do Spotify, e álbuns de links do YouTube Music e do Spotify.",
    });
  });
});

describe("the kind of thing a link opens", () => {
  test("songs, albums and artists, a short link counting as a song until followed", () => {
    for (const [text, kind] of [
      [`https://youtu.be/${VIDEO}`, "song"],
      ["https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", "song"],
      ["https://www.deezer.com/track/3135556", "song"],
      ["https://spotify.link/wud9sAYDbDb", "song"],
      ["https://link.deezer.com/s/32B48GkNdtNqNtV9RmXDe", "song"],
      [`https://music.youtube.com/browse/${ALBUM_BROWSE}`, "album"],
      [`https://music.youtube.com/playlist?list=${ALBUM_PLAYLIST}`, "album"],
      ["https://open.spotify.com/album/7rZmgT2kEqkCMR6VHcloJM", "album"],
      [`https://www.youtube.com/channel/${CHANNEL}`, "artist"],
      [`https://open.spotify.com/artist/${SPOTIFY_ARTIST}`, "artist"],
      [`https://www.deezer.com/artist/${DEEZER_ARTIST}`, "artist"],
    ] as const) {
      const link = recogniseSongLink(text);
      assert.ok(link !== null, text);
      assert.equal(songLinkKind(link), kind, text);
    }
  });
});
