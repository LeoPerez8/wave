import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { copiedLinkOffer, looksAtClipboard, offeredLinkKey, readsCopiedText } from "./index.ts";

const VIDEO = "dQw4w9WgXcQ";
const SPOTIFY_ID = "4PTG3Z6ehGkBFwjybzWkR8";

/** The toast a copied [text] gets, with nothing offered before. */
const toast = (text: string, language: "en" | "pt-BR" = "en") => {
  const offer = copiedLinkOffer(text, null, language);
  return offer === null ? null : { text: offer.text, action: offer.action };
};

describe("the toast a copied link gets", () => {
  test("names the service and the kind, with the action sharing it would take", () => {
    assert.deepEqual(toast(`https://open.spotify.com/track/${SPOTIFY_ID}?si=x`), {
      text: "Spotify song link copied",
      action: "Listen",
    });
    assert.deepEqual(toast("https://music.youtube.com/playlist?list=PLabcdefghij1234567890"), {
      text: "YT Music playlist copied",
      action: "Import",
    });
    assert.deepEqual(toast(`https://open.spotify.com/album/${SPOTIFY_ID}`), {
      text: "Spotify album copied",
      action: "Open",
    });
    assert.deepEqual(toast(`https://open.spotify.com/artist/${SPOTIFY_ID}`), {
      text: "Spotify artist copied",
      action: "Open",
    });
    assert.deepEqual(toast("https://www.deezer.com/br/track/3135556"), {
      text: "Deezer song link copied",
      action: "Listen",
    });
    assert.deepEqual(toast("https://www.deezer.com/en/artist/27"), {
      text: "Deezer artist copied",
      action: "Open",
    });
  });
});

describe("a copied link whose kind the toast can't name", () => {
  test("a short link says only its service, with Open, since only following it tells", () => {
    assert.deepEqual(toast("https://spotify.link/AbCdEf123"), {
      text: "Spotify link copied",
      action: "Open",
    });
    assert.deepEqual(toast("https://link.deezer.com/s/30abcDEF"), {
      text: "Deezer link copied",
      action: "Open",
    });
  });
});

describe("YouTube's links", () => {
  test("carry YT Music's name from YouTube Music's host and YouTube's from the others", () => {
    assert.equal(
      toast(`https://music.youtube.com/watch?v=${VIDEO}`)?.text,
      "YT Music song link copied",
    );
    assert.equal(toast(`https://youtu.be/${VIDEO}`)?.text, "YouTube song link copied");
    assert.equal(
      toast("https://www.youtube.com/playlist?list=PLabcdefghij1234567890")?.text,
      "YouTube playlist copied",
    );
    assert.deepEqual(toast("https://music.youtube.com/browse/MPREb_abcdefghijk"), {
      text: "YT Music album copied",
      action: "Open",
    });
    assert.equal(
      toast("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv")?.text,
      "YouTube artist copied",
    );
  });
});

describe("copied text that isn't a link Wave opens", () => {
  test("gets no toast", () => {
    for (const text of [
      "",
      "Meet at 8",
      "https://example.com/page",
      "https://www.deezer.com/br/album/302127",
      "https://www.youtube.com/@someone",
      "PLabcdefghij1234567890",
    ])
      assert.equal(toast(text), null, text);
  });
});

describe("in Brazilian Portuguese", () => {
  test("the toast keeps the service's name and translates the rest", () => {
    assert.deepEqual(toast(`https://open.spotify.com/track/${SPOTIFY_ID}`, "pt-BR"), {
      text: "Link de música do Spotify copiado",
      action: "Ouvir",
    });
    assert.deepEqual(
      toast("https://music.youtube.com/playlist?list=PLabcdefghij1234567890", "pt-BR"),
      {
        text: "Playlist do YT Music copiada",
        action: "Importar",
      },
    );
    assert.deepEqual(toast("https://spotify.link/AbCdEf123", "pt-BR"), {
      text: "Link do Spotify copiado",
      action: "Abrir",
    });
  });
});

describe("once per link", () => {
  const song = `https://open.spotify.com/track/${SPOTIFY_ID}?si=first`;

  test("the link offered last isn't offered again, however it's written", () => {
    const offered = copiedLinkOffer(song, null);
    assert.ok(offered !== null);
    assert.equal(copiedLinkOffer(song, offered.key), null);
    assert.equal(copiedLinkOffer(`Listen! spotify:track:${SPOTIFY_ID}`, offered.key), null);
    assert.equal(
      copiedLinkOffer(`open.spotify.com/intl-pt/track/${SPOTIFY_ID}?si=other`, offered.key),
      null,
    );
  });

  test("a YouTube video is the same link on YouTube and on YouTube Music", () => {
    const offered = copiedLinkOffer(`https://youtu.be/${VIDEO}`, null);
    assert.equal(
      copiedLinkOffer(`https://music.youtube.com/watch?v=${VIDEO}`, offered?.key ?? null),
      null,
    );
  });

  test("another link is offered", () => {
    const offered = copiedLinkOffer(song, null);
    assert.ok(
      copiedLinkOffer(`https://open.spotify.com/album/${SPOTIFY_ID}`, offered?.key ?? null),
    );
    assert.ok(
      copiedLinkOffer(
        "https://open.spotify.com/track/0000000000000000000000",
        offered?.key ?? null,
      ),
    );
  });

  test("a link Wave copied, or that a share or tap opened, counts as offered", () => {
    const copied = offeredLinkKey(`Ouça no Wave: https://music.youtube.com/watch?v=${VIDEO}&si=x`);
    assert.equal(copiedLinkOffer(`https://music.youtube.com/watch?v=${VIDEO}`, copied), null);
    const shared = offeredLinkKey("https://music.youtube.com/playlist?list=PLabcdefghij1234567890");
    assert.equal(
      copiedLinkOffer(
        "https://music.youtube.com/playlist?list=PLabcdefghij1234567890&si=y",
        shared,
      ),
      null,
    );
  });

  test("text that isn't a link Wave opens marks nothing", () => {
    assert.equal(offeredLinkKey("wave://join/abc"), null);
    assert.equal(offeredLinkKey("Meet at 8"), null);
  });
});

describe("whether Wave looks at the clipboard on a return", () => {
  const usual = {
    offerCopiedLinks: true,
    ytMusic: true,
    online: true,
    welcomeTour: false,
    openedByLink: false,
  };

  test("it does with the switch on, YT Music on, online, after the tour and with no link opening it", () => {
    assert.equal(looksAtClipboard(usual), true);
  });

  test("it doesn't with the switch off, YT Music off, offline, during the tour, or when a share or tap opened Wave", () => {
    assert.equal(looksAtClipboard({ ...usual, offerCopiedLinks: false }), false);
    assert.equal(looksAtClipboard({ ...usual, ytMusic: false }), false);
    assert.equal(looksAtClipboard({ ...usual, online: false }), false);
    assert.equal(looksAtClipboard({ ...usual, welcomeTour: true }), false);
    assert.equal(looksAtClipboard({ ...usual, openedByLink: true }), false);
  });
});

describe("whether Wave reads the copied text, from the clip's description", () => {
  const link = {
    mimeTypes: ["text/plain"],
    classification: "complete",
    urlConfidence: 1,
    sensitive: false,
    timestamp: 1000,
  } as const;

  test("a text Android's classifier finds a link in is read", () => {
    assert.equal(readsCopiedText(link, null), true);
    assert.equal(readsCopiedText({ ...link, mimeTypes: ["text/html"] }, null), true);
    assert.equal(
      readsCopiedText(
        {
          ...link,
          mimeTypes: ["text/uri-list"],
          classification: "notPerformed",
          urlConfidence: null,
        },
        null,
      ),
      true,
    );
  });

  test("plain text, which would show Android's paste notice, isn't", () => {
    assert.equal(readsCopiedText({ ...link, urlConfidence: 0 }, null), false);
    assert.equal(readsCopiedText({ ...link, urlConfidence: 0.2 }, null), false);
  });

  test("a clip that isn't text, or that its app marked sensitive (a password), isn't", () => {
    assert.equal(readsCopiedText({ ...link, mimeTypes: ["image/png"] }, null), false);
    assert.equal(readsCopiedText({ ...link, mimeTypes: ["text/vnd.android.intent"] }, null), false);
    assert.equal(readsCopiedText({ ...link, sensitive: true }, null), false);
  });

  test("a clip still being classified waits for a later return", () => {
    assert.equal(
      readsCopiedText({ ...link, classification: "pending", urlConfidence: null }, null),
      false,
    );
  });

  test("a clip Android didn't classify is read, once", () => {
    const unclassified = { ...link, classification: "notPerformed", urlConfidence: null } as const;
    assert.equal(readsCopiedText(unclassified, null), true);
    assert.equal(readsCopiedText(unclassified, unclassified.timestamp), false);
  });

  test("a clip already read isn't read again", () => {
    assert.equal(readsCopiedText(link, link.timestamp), false);
    assert.equal(readsCopiedText({ ...link, timestamp: 2000 }, link.timestamp), true);
  });
});
