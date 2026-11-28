import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  opensOnDesktop,
  SMART_LINK_HOSTS,
  sharedTextImport,
  smartLinkLanding,
  smartLinkNotice,
  smartLinkTarget,
} from "./index.ts";

/** A trimmed copy of a real page (the parts around its service links, as the page encodes them). */
const sample = (name: string): string =>
  readFileSync(new URL(`../../../docs/smart-link-samples/${name}.txt`, import.meta.url), "utf8");

const on = { ytMusic: true };

/** What opening the link a page points to does, as if it had been shared to Wave. */
const opened = (body: string) => {
  const target = smartLinkTarget(body);
  return target === null ? null : sharedTextImport(target, on);
};

describe("a smart link shared to Wave", () => {
  test("a release page's address is a smart link to read, its parameters kept", () => {
    for (const url of [
      "https://fanlink.tv/dreams-album?utm_medium=paid&utm_source=ig",
      "https://song.link/s/4uLU6hMCjMI75M1A2tKUQC",
      "https://album.link/s/7rZmgT2kEqkCMR6VHcloJM",
      "https://lnk.to/radicaloptimism",
      "https://dualipa.lnk.to/radicaloptimism",
      "https://distrokid.com/hyperfollow/psylounge/hyperdancesongpop",
    ]) {
      assert.deepEqual(sharedTextImport(url, on), { kind: "smart", url }, url);
    }
  });

  test("found among words, without its scheme it is read over https", () => {
    assert.deepEqual(sharedTextImport("save & stream 🎧 https://fanlink.tv/dreams-album!", on), {
      kind: "smart",
      url: "https://fanlink.tv/dreams-album",
    });
    assert.deepEqual(sharedTextImport("song.link/s/4uLU6hMCjMI75M1A2tKUQC", on), {
      kind: "smart",
      url: "https://song.link/s/4uLU6hMCjMI75M1A2tKUQC",
    });
  });

  test("other pages on those hosts, and look-alike hosts, say what Wave opens", () => {
    for (const url of [
      "https://distrokid.com/pricing",
      "https://distrokid.com/hyperfollow/psylounge",
      "https://fanlink.tv/",
      "https://notlnk.to/radicaloptimism",
      "https://lnk.to.example.com/x",
    ]) {
      assert.equal(sharedTextImport(url, on).kind, "notice", url);
    }
  });

  test("with YT Music off, it says to turn it on, and nothing is read", () => {
    assert.equal(
      sharedTextImport("https://fanlink.tv/dreams-album", { ytMusic: false }).kind,
      "notice",
    );
  });
});

/** A page with a button for each of [links], in order. */
const page = (...links: string[]) => links.map((link) => `<a href="${link}">x</a>`).join("");

describe("what a smart link's page points to", () => {
  test("fanlink.tv's Spotify album, ahead of its YouTube playlist", () => {
    assert.deepEqual(opened(sample("fanlink")), {
      kind: "song",
      link: { service: "spotifyAlbum", albumId: "7rZmgT2kEqkCMR6VHcloJM" },
    });
  });

  test("song.link's song", () => {
    assert.deepEqual(opened(sample("songlink")), {
      kind: "song",
      link: { service: "spotify", trackId: "4uLU6hMCjMI75M1A2tKUQC" },
    });
  });

  test("album.link's album", () => {
    assert.deepEqual(opened(sample("albumlink")), {
      kind: "song",
      link: { service: "spotifyAlbum", albumId: "7rZmgT2kEqkCMR6VHcloJM" },
    });
  });

  test("lnk.to's Spotify album, ahead of its YouTube Music album playlist", () => {
    assert.deepEqual(opened(sample("lnkto")), {
      kind: "song",
      link: { service: "spotifyAlbum", albumId: "1Mo92916G2mmG7ajpmSVrc" },
    });
  });

  test("HyperFollow's album, its links written with HTML entities too", () => {
    assert.deepEqual(opened(sample("hyperfollow")), {
      kind: "song",
      link: { service: "spotifyAlbum", albumId: "5IHhEixBs1pMwzEfucB1Gz" },
    });
    assert.deepEqual(opened(sample("hyperfollow-entities")), {
      kind: "song",
      link: { service: "spotifyAlbum", albumId: "29OcFDbl4YG2saCKWX6sHk" },
    });
  });

  test("a song goes first, then an album, then a playlist, YouTube Music first among songs and playlists", () => {
    const ytSong = "https://music.youtube.com/watch?v=dQw4w9WgXcQ";
    const spotifySong = "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC";
    const deezerSong = "https://www.deezer.com/track/3135556";
    const album = "https://open.spotify.com/album/7rZmgT2kEqkCMR6VHcloJM";
    const ytPlaylist =
      "https://music.youtube.com/playlist?list=OLAK5uy_mkDVdcmXDwufw0OOss-52qp3nvVQMx9xo";
    const youtubePlaylist = "https://youtube.com/playlist?list=PLOQ9gGMey1FXdRNRfSbYkuL8oMUDxER8A";
    assert.equal(
      smartLinkTarget(page(youtubePlaylist, album, deezerSong, spotifySong, ytSong)),
      ytSong,
    );
    assert.equal(smartLinkTarget(page(deezerSong, spotifySong)), spotifySong);
    assert.equal(smartLinkTarget(page(youtubePlaylist, ytPlaylist, album)), album);
    assert.equal(smartLinkTarget(page(youtubePlaylist, ytPlaylist)), ytPlaylist);
    assert.equal(smartLinkTarget(page(youtubePlaylist)), youtubePlaylist);
  });

  test("a YouTube video is a song after the services' songs, and YT Music albums follow a Spotify album", () => {
    const deezerSong = "https://www.deezer.com/track/3135556";
    const video = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const spotifyAlbum = "https://open.spotify.com/album/7rZmgT2kEqkCMR6VHcloJM";
    const ytAlbum = "https://music.youtube.com/browse/MPREb_06zfD9zt7QK";
    const albumPlaylist =
      "https://music.youtube.com/playlist?list=OLAK5uy_mkDVdcmXDwufw0OOss-52qp3nvVQMx9xo";
    const playlist = "https://music.youtube.com/playlist?list=PLOQ9gGMey1FXdRNRfSbYkuL8oMUDxER8A";
    assert.equal(smartLinkTarget(page(video, deezerSong)), deezerSong);
    assert.equal(smartLinkTarget(page(spotifyAlbum, ytAlbum, video)), video);
    assert.equal(smartLinkTarget(page(albumPlaylist, ytAlbum, spotifyAlbum)), spotifyAlbum);
    assert.equal(smartLinkTarget(page(playlist, albumPlaylist, ytAlbum)), ytAlbum);
    assert.deepEqual(opened(page(playlist, albumPlaylist)), {
      kind: "song",
      link: {
        service: "ytAlbumPlaylist",
        playlistId: "OLAK5uy_mkDVdcmXDwufw0OOss-52qp3nvVQMx9xo",
      },
    });
  });

  test("the desktop passes over the links it doesn't open yet", () => {
    const ytAlbum = "https://music.youtube.com/browse/MPREb_06zfD9zt7QK";
    const albumPlaylist =
      "https://www.youtube.com/playlist?list=OLAK5uy_mkDVdcmXDwufw0OOss-52qp3nvVQMx9xo";
    const playlist = "https://youtube.com/playlist?list=PLOQ9gGMey1FXdRNRfSbYkuL8oMUDxER8A";
    assert.equal(smartLinkTarget(page(ytAlbum, albumPlaylist, playlist), opensOnDesktop), playlist);
    assert.equal(smartLinkTarget(page(ytAlbum, albumPlaylist), opensOnDesktop), null);
  });

  test("a link inside JSON written as an HTML attribute (`&quot;`) is read whole", () => {
    assert.deepEqual(
      opened(
        '<div data-links="{&quot;spotify&quot;:&quot;https:\\/\\/open.spotify.com\\/album\\/7rZmgT2kEqkCMR6VHcloJM&quot;}"></div>',
      ),
      { kind: "song", link: { service: "spotifyAlbum", albumId: "7rZmgT2kEqkCMR6VHcloJM" } },
    );
  });

  test("a page with nothing Wave opens (artists, bare hosts, other sites) points nowhere", () => {
    assert.equal(
      smartLinkTarget(
        '<a href="https://open.spotify.com/artist/3bxfoVnARXp1QOgyAoKsc3">a</a> https://music.youtube.com https://open.spotify.com/album/ https://www.youtube.com/@excape https://example.com/x',
      ),
      null,
    );
    assert.equal(smartLinkTarget(""), null);
  });
});

describe("where a smart link redirected to", () => {
  test("a service's page Wave opens counts, an artist's too", () => {
    for (const url of [
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://music.youtube.com/browse/MPREb_06zfD9zt7QK",
      "https://music.youtube.com/channel/UCiryJZISyBldwm9ocAE-QfQ",
      "https://open.spotify.com/artist/3bxfoVnARXp1QOgyAoKsc3",
      "https://www.deezer.com/artist/27",
      "https://open.spotify.com/album/7rZmgT2kEqkCMR6VHcloJM",
      "https://www.youtube.com/playlist?list=PLOQ9gGMey1FXdRNRfSbYkuL8oMUDxER8A",
    ]) {
      assert.equal(smartLinkLanding(url), url, url);
    }
  });

  test("another page, a short link, or a link the desktop doesn't open, doesn't", () => {
    assert.equal(smartLinkLanding("https://fanlink.tv/dreams-album"), null);
    assert.equal(smartLinkLanding("https://spotify.link/AbCdEf123"), null);
    assert.equal(
      smartLinkLanding("https://open.spotify.com/artist/3bxfoVnARXp1QOgyAoKsc3", opensOnDesktop),
      null,
    );
  });
});

describe("what a smart link that opens nothing says", () => {
  test("offline, and a page out of reach, in English and Portuguese", () => {
    assert.deepEqual(smartLinkNotice("offline"), {
      title: "You're offline",
      message: "Connect to the internet to open this link.",
    });
    assert.deepEqual(smartLinkNotice("unreachable"), {
      title: "This link doesn't open",
      message: "Couldn't reach the link's page. Check your connection and try again.",
    });
    assert.deepEqual(smartLinkNotice("cantOpen"), {
      title: "Can't open this",
      message:
        "Wave opens songs and artists from YouTube, YouTube Music, Spotify and Deezer links, playlists from YouTube, YouTube Music and Spotify links, albums from YouTube Music and Spotify links, and release pages that link to them.",
    });
    assert.deepEqual(smartLinkNotice("offline", "pt-BR"), {
      title: "Você está offline",
      message: "Conecte-se à internet para abrir este link.",
    });
    assert.deepEqual(smartLinkNotice("unreachable", "pt-BR"), {
      title: "Este link não abre",
      message:
        "Não foi possível acessar a página do link. Verifique sua conexão e tente novamente.",
    });
  });
});

/** Whether Android's filter entry [entry] takes [url]: its host (`*.` any subdomain) and path prefix. */
const takes = (entry: (typeof SMART_LINK_HOSTS)[number], url: URL) =>
  (entry.host.startsWith("*.")
    ? url.host.endsWith(entry.host.slice(1))
    : url.host === entry.host) && url.pathname.startsWith(entry.pathPrefix ?? "/");

describe("the smart-link hosts Android hands Wave when tapped", () => {
  const RELEASES = [
    "https://fanlink.tv/dreams-album",
    "https://song.link/s/4uLU6hMCjMI75M1A2tKUQC",
    "https://album.link/s/7rZmgT2kEqkCMR6VHcloJM",
    "https://lnk.to/radicaloptimism",
    "https://dualipa.lnk.to/radicaloptimism",
    "https://distrokid.com/hyperfollow/psylounge/hyperdancesongpop",
    "https://www.distrokid.com/hyperfollow/psylounge/hyperdancesongpop",
  ];
  test("every smart link Wave reads is one a tap brings", () => {
    for (const release of RELEASES) {
      assert.equal(sharedTextImport(release, on).kind, "smart", release);
      assert.ok(
        SMART_LINK_HOSTS.some((entry) => takes(entry, new URL(release))),
        release,
      );
    }
  });

  test("every link a tap brings at a release's path is a smart link Wave reads", () => {
    for (const entry of SMART_LINK_HOSTS) {
      const host = entry.host.replace("*.", "artist.");
      const url = `https://${host}${entry.pathPrefix ?? "/"}someone/release`;
      assert.equal(sharedTextImport(url, on).kind, "smart", url);
    }
  });
});
