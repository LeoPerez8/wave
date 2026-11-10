import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { deezerShortLinkLanding, sharedTextImport, songLinkNotice } from "./index.ts";

const on = { ytMusic: true };
const TRACK = "3135556";
const deezerSong = { kind: "song", link: { service: "deezer", trackId: TRACK } };
const NOT_OPENED = {
  kind: "notice",
  title: "Can't open this",
  message:
    "Wave opens songs from YouTube Music, Spotify and Deezer links, and playlists from YouTube Music and Spotify links.",
};

describe("a shared Deezer song link", () => {
  test("a track link, with a locale, www, no scheme or parameters, opens the song", () => {
    for (const text of [
      `https://www.deezer.com/track/${TRACK}`,
      `https://www.deezer.com/br/track/${TRACK}`,
      `https://www.deezer.com/en/track/${TRACK}?host=0&utm_campaign=clipboard-generic&deferredFl=1`,
      `http://deezer.com/track/${TRACK}/`,
      `www.deezer.com/fr/track/${TRACK}`,
      `DEEZER.COM/track/${TRACK}#x`,
    ]) {
      assert.deepEqual(sharedTextImport(text, on), deezerSong, text);
    }
  });

  test("the link among words, punctuation after it, is found", () => {
    for (const text of [
      `Harder, Better, Faster, Stronger - Daft Punk https://www.deezer.com/track/${TRACK}?utm_source=deezer`,
      `Listen on Deezer:\nhttps://www.deezer.com/br/track/${TRACK}.`,
    ]) {
      assert.deepEqual(sharedTextImport(text, on), deezerSong, text);
    }
  });

  test("a short link is a song link to follow, as only Deezer knows what it names", () => {
    for (const [text, url] of [
      [
        "https://link.deezer.com/s/32B48GkNdtNqNtV9RmXDe",
        "https://link.deezer.com/s/32B48GkNdtNqNtV9RmXDe",
      ],
      [
        "Ouça no Deezer https://link.deezer.com/s/32B48GkNdtNqNtV9RmXDe?utm=x",
        "https://link.deezer.com/s/32B48GkNdtNqNtV9RmXDe",
      ],
      ["https://deezer.page.link/U6BTQ2Q1KpmNt2yh8", "https://deezer.page.link/U6BTQ2Q1KpmNt2yh8"],
      ["dzr.page.link/U6BTQ2Q1KpmNt2yh8", "https://dzr.page.link/U6BTQ2Q1KpmNt2yh8"],
    ] as const) {
      assert.deepEqual(
        sharedTextImport(text, on),
        { kind: "song", link: { service: "deezerShort", url } },
        text,
      );
    }
  });

  test("albums, artists, playlists, podcasts and ids that aren't a number say what Wave opens", () => {
    for (const text of [
      "https://www.deezer.com/album/302127",
      "https://www.deezer.com/br/artist/27",
      "https://www.deezer.com/playlist/13957557901",
      "https://www.deezer.com/episode/789681271",
      "https://www.deezer.com/track/302127x",
      "https://www.deezer.com/track/",
      `https://www.deezer.com/track/${TRACK}/extra`,
      "https://link.deezer.com/",
      "https://www.deezer.com/deezer-links-404",
    ]) {
      assert.deepEqual(sharedTextImport(text, on), NOT_OPENED, text);
    }
  });

  test("in Portuguese, the message names Deezer too", () => {
    assert.deepEqual(sharedTextImport("https://www.deezer.com/album/302127", on, "pt-BR"), {
      kind: "notice",
      title: "Não é possível abrir isto",
      message:
        "O Wave abre músicas de links do YouTube Music, do Spotify e do Deezer, e playlists de links do YouTube Music e do Spotify.",
    });
  });

  test("with YT Music off, a Deezer song link says to turn it on", () => {
    const shared = sharedTextImport(`https://www.deezer.com/track/${TRACK}`, { ytMusic: false });
    assert.equal(shared.kind, "notice");
  });
});

describe("where a followed Deezer short link lands", () => {
  test("on a track's page, after Deezer's redirects pick a locale, it plays that track", () => {
    for (const url of [
      "https://www.deezer.com/br/track/585594592?host=0&utm_campaign=clipboard-generic&deferredFl=1",
      "https://www.deezer.com/track/70893453?utm_campaign=clipboard-generic&deferredFl=1",
    ]) {
      const trackId = /track\/(\d+)/u.exec(url)?.[1];
      assert.deepEqual(deezerShortLinkLanding(url), { service: "deezer", trackId }, url);
    }
  });

  test("on an album, a playlist, an artist, an episode or Deezer's dead-link page, it opens nothing", () => {
    for (const url of [
      "https://www.deezer.com/br/album/792251411?host=0",
      "https://www.deezer.com/br/playlist/13957557901",
      "https://www.deezer.com/br/artist/85032562",
      "https://www.deezer.com/br/episode/789681271",
      "https://www.deezer.com/deezer-links-404",
      "https://link.deezer.com/s/30abcdefghij",
      "https://deezer.page.link/U6BTQ2Q1KpmNt2yh8",
      "https://example.com/track/585594592",
    ]) {
      assert.equal(deezerShortLinkLanding(url), null, url);
    }
  });
});

describe("what a Deezer song link that doesn't play says", () => {
  test("a track Deezer doesn't have, Deezer out of reach, or an answer Wave can't read", () => {
    assert.deepEqual(songLinkNotice({ unread: "missing", service: "deezer" }), {
      title: "This link doesn't open",
      message: "Deezer doesn't have the song it links to.",
    });
    assert.deepEqual(songLinkNotice({ unread: "unreachable", service: "deezer" }), {
      title: "This link doesn't open",
      message: "Couldn't reach Deezer. Check your connection and try again.",
    });
    assert.deepEqual(songLinkNotice({ unread: "failed", service: "deezer" }), {
      title: "This link doesn't open",
      message: "Deezer didn't answer as expected.",
    });
  });

  test("a short link to an album, a playlist or nothing says what Wave opens", () => {
    assert.deepEqual(songLinkNotice("cantOpen"), {
      title: NOT_OPENED.title,
      message: NOT_OPENED.message,
    });
  });

  test("in Portuguese", () => {
    assert.deepEqual(songLinkNotice({ unread: "missing", service: "deezer" }, "pt-BR"), {
      title: "Este link não abre",
      message: "O Deezer não tem a música deste link.",
    });
    assert.deepEqual(songLinkNotice({ unread: "unreachable", service: "deezer" }, "pt-BR"), {
      title: "Este link não abre",
      message: "Não foi possível acessar o Deezer. Verifique sua conexão e tente novamente.",
    });
  });
});
