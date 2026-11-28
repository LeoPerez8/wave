import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { SMART_LINK_HOSTS, sharedTextImport, smartLinkNotice, smartLinkTarget } from "./index.ts";

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

  test("a song goes first, then an album, then a playlist, YouTube Music first among each", () => {
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

describe("what a smart link that opens nothing says", () => {
  test("offline, and a page out of reach, in English and Portuguese", () => {
    assert.deepEqual(smartLinkNotice("offline"), {
      title: "You're offline",
      message: "Connect to the internet to open this link.",
    });
    assert.deepEqual(smartLinkNotice("unreachable"), {
      title: "This link doesn't open",
      message: "Couldn't reach its page. Check your connection and try again.",
    });
    assert.deepEqual(smartLinkNotice("offline", "pt-BR"), {
      title: "Você está offline",
      message: "Conecte-se à internet para abrir este link.",
    });
    assert.deepEqual(smartLinkNotice("unreachable", "pt-BR"), {
      title: "Este link não abre",
      message: "Não foi possível acessar a página dele. Verifique sua conexão e tente novamente.",
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
      const url = `https://${host}${entry.pathPrefix ?? ""}/someone/release`;
      assert.equal(sharedTextImport(url, on).kind, "smart", url);
    }
  });
});
