import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LYRIC_CARD_FALLBACK,
  songCardColours,
  songCardFileName,
  songShareDestinations,
} from "./index.ts";

describe("songShareDestinations with links", () => {
  test("with YT Music on, Copy Link, Spotify and YT Music sit between the apps and More", () => {
    assert.deepEqual(
      songShareDestinations({ instagramStories: true, whatsapp: true }, { links: true }),
      ["instagramStories", "whatsapp", "copyLink", "spotify", "ytMusic", "more"],
    );
  });

  test("with YT Music off, the link options are hidden", () => {
    assert.deepEqual(
      songShareDestinations({ instagramStories: false, whatsapp: true }, { links: false }),
      ["whatsapp", "more"],
    );
  });
});

describe("songShareDestinations", () => {
  test("with Instagram Stories and WhatsApp on hand, they come first, then More", () => {
    assert.deepEqual(songShareDestinations({ instagramStories: true, whatsapp: true }), [
      "instagramStories",
      "whatsapp",
      "more",
    ]);
  });

  test("an app that isn't on hand isn't in the row; More always is, and there's no Save image", () => {
    assert.deepEqual(songShareDestinations({ instagramStories: false, whatsapp: true }), [
      "whatsapp",
      "more",
    ]);
    assert.deepEqual(songShareDestinations({ instagramStories: false, whatsapp: false }), ["more"]);
  });
});

describe("songCardFileName", () => {
  const at = new Date(2026, 9, 18, 9, 5, 7);

  test("names the image after the song and when it was made", () => {
    assert.equal(
      songCardFileName("Blinding Lights", at),
      "Wave - Blinding Lights - 20261018-090507.png",
    );
  });

  test("a song with no usable title is just a song", () => {
    assert.equal(songCardFileName(" / ", at), "Wave - Song - 20261018-090507.png");
  });
});

describe("songCardColours", () => {
  test("the story fades from the cover's dominant colour down to its dark muted one, and the card takes the dark one", () => {
    assert.deepEqual(
      songCardColours({ dominant: "#D08C3A", vibrant: "#e0a040", darkMuted: "#3B2A1C" }),
      { card: "#3b2a1c", ink: "#ffffff", story: { top: "#d08c3a", bottom: "#3b2a1c" } },
    );
  });

  test("without a dark muted swatch, the dark vibrant one ends the fade", () => {
    assert.deepEqual(songCardColours({ dominant: "#d08c3a", darkVibrant: "#5a2e08" }).story, {
      top: "#d08c3a",
      bottom: "#5a2e08",
    });
  });

  test("a light card gets Wave's ink", () => {
    assert.deepEqual(songCardColours({ dominant: "#f4efe6" }), {
      card: "#f4efe6",
      ink: "#121b1d",
      story: { top: "#f4efe6", bottom: "#f4efe6" },
    });
  });

  test("a dark swatch that is the dominant colour itself leaves the next colour to end the fade", () => {
    assert.deepEqual(
      songCardColours({ dominant: "#1a1a40", darkMuted: "#1a1a40", muted: "#6a6a90" }).story,
      {
        top: "#1a1a40",
        bottom: "#6a6a90",
      },
    );
  });

  test("a song without a palette gets Wave's graphite throughout", () => {
    assert.deepEqual(songCardColours(null), {
      card: LYRIC_CARD_FALLBACK,
      ink: "#ffffff",
      story: { top: LYRIC_CARD_FALLBACK, bottom: LYRIC_CARD_FALLBACK },
    });
  });
});
