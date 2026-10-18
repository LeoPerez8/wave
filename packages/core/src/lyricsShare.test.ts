import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LYRIC_CARD_FALLBACK,
  LYRIC_CARD_TEXT_SIZES,
  isLyricLineSelected,
  lyricCardColours,
  lyricCardFileName,
  lyricCardInk,
  lyricCardLayout,
  lyricShareDestinations,
  lyricStoryBackground,
  instagramStoriesAppId,
  nextLyricCardColour,
  parseLyrics,
  shareableLyricLines,
  sharedLyricLines,
  tapLyricLine,
} from "./index.ts";

/** Ten lines, "L0" to "L9". */
const ten = Array.from({ length: 10 }, (_, i) => `L${i}`);

describe("tapLyricLine", () => {
  test("a tap with nothing selected selects that line", () => {
    assert.deepEqual(tapLyricLine(ten, null, 3), {
      selection: { start: 3, end: 3 },
      accepted: true,
    });
  });

  test("a line next to the block extends it, above or below", () => {
    assert.deepEqual(tapLyricLine(ten, { start: 3, end: 4 }, 5), {
      selection: { start: 3, end: 5 },
      accepted: true,
    });
    assert.deepEqual(tapLyricLine(ten, { start: 3, end: 4 }, 2), {
      selection: { start: 2, end: 4 },
      accepted: true,
    });
  });

  test("lines 3 to 7 can be picked, but not an eighth line on either side", () => {
    let selection = tapLyricLine(ten, null, 3).selection;
    for (const line of [4, 5, 6, 7]) selection = tapLyricLine(ten, selection, line).selection;
    assert.deepEqual(selection, { start: 3, end: 7 });
    assert.deepEqual(tapLyricLine(ten, selection, 8), { selection, accepted: false });
    assert.deepEqual(tapLyricLine(ten, selection, 2), { selection, accepted: false });
  });

  test("a line away from the block can't be added", () => {
    const selection = { start: 3, end: 4 };
    assert.deepEqual(tapLyricLine(ten, selection, 6), { selection, accepted: false });
    assert.deepEqual(tapLyricLine(ten, selection, 0), { selection, accepted: false });
  });

  test("an end line of the block shrinks it", () => {
    assert.deepEqual(tapLyricLine(ten, { start: 3, end: 6 }, 3), {
      selection: { start: 4, end: 6 },
      accepted: true,
    });
    assert.deepEqual(tapLyricLine(ten, { start: 3, end: 6 }, 6), {
      selection: { start: 3, end: 5 },
      accepted: true,
    });
  });

  test("a line inside the block does nothing, as it would break it", () => {
    const selection = { start: 3, end: 6 };
    assert.deepEqual(tapLyricLine(ten, selection, 4), { selection, accepted: false });
  });

  test("tapping the only line selected leaves nothing selected", () => {
    assert.deepEqual(tapLyricLine(ten, { start: 3, end: 3 }, 3), {
      selection: null,
      accepted: true,
    });
  });

  describe("blank lines (a pause, a gap between verses)", () => {
    const verses = ["A", "B", "", "C", "D", "E", "F", "", "G"];

    test("can't be selected", () => {
      assert.deepEqual(tapLyricLine(verses, null, 2), { selection: null, accepted: false });
      const selection = { start: 0, end: 1 };
      assert.deepEqual(tapLyricLine(verses, selection, 2), { selection, accepted: false });
    });

    test("are stepped over: the next verse's first line is next to the block", () => {
      assert.deepEqual(tapLyricLine(verses, { start: 0, end: 1 }, 3), {
        selection: { start: 0, end: 3 },
        accepted: true,
      });
      assert.deepEqual(tapLyricLine(verses, { start: 3, end: 4 }, 1), {
        selection: { start: 1, end: 4 },
        accepted: true,
      });
    });

    test("don't count toward the five lines", () => {
      assert.deepEqual(tapLyricLine(verses, { start: 0, end: 5 }, 6), {
        selection: { start: 0, end: 5 },
        accepted: false,
      });
      assert.deepEqual(tapLyricLine(verses, { start: 1, end: 6 }, 0), {
        selection: { start: 1, end: 6 },
        accepted: false,
      });
      assert.deepEqual(tapLyricLine(verses, { start: 4, end: 6 }, 8), {
        selection: { start: 4, end: 8 },
        accepted: true,
      });
    });

    test("shrinking steps over them too, so the block never starts or ends on one", () => {
      assert.deepEqual(tapLyricLine(verses, { start: 1, end: 4 }, 1), {
        selection: { start: 3, end: 4 },
        accepted: true,
      });
      assert.deepEqual(tapLyricLine(verses, { start: 1, end: 3 }, 3), {
        selection: { start: 1, end: 1 },
        accepted: true,
      });
    });
  });
});

describe("shareableLyricLines", () => {
  test("a song's synced or plain lyrics are its lines as the view shows them", () => {
    assert.deepEqual(shareableLyricLines(parseLyrics("[00:01.00]One\n[00:04.00]\n[00:06.00]Two")), [
      "One",
      "",
      "Two",
    ]);
    assert.deepEqual(shareableLyricLines(parseLyrics("One\n\nTwo")), ["One", "", "Two"]);
  });

  test("a song without lyrics, or whose lyrics are only pauses, has nothing to share", () => {
    assert.equal(shareableLyricLines({ kind: "none" }), null);
    assert.equal(shareableLyricLines(null), null);
    assert.equal(shareableLyricLines(parseLyrics("[00:01.00]\n[00:04.00]")), null);
  });
});

describe("the selected lines", () => {
  const verses = ["A", "B", "", "C", "D"];

  test("are the block's lines with words, in order, for the card", () => {
    assert.deepEqual(sharedLyricLines(verses, { start: 1, end: 3 }), ["B", "C"]);
    assert.deepEqual(sharedLyricLines(verses, null), []);
  });

  test("show as selected; a blank line inside the block doesn't", () => {
    const selection = { start: 1, end: 3 };
    assert.deepEqual(
      verses.map((_, at) => isLyricLineSelected(verses, selection, at)),
      [false, true, false, true, false],
    );
  });
});

describe("the card's colours", () => {
  const palette = {
    dominant: "#203040",
    vibrant: "#E04020",
    darkVibrant: "#801010",
    lightVibrant: "#f0a080",
    muted: "#607080",
    darkMuted: "#203040",
    lightMuted: "#c0c8d0",
  };

  test("start from the cover's dominant colour, then its other swatches, each once", () => {
    assert.deepEqual(lyricCardColours(palette), [
      "#203040",
      "#e04020",
      "#801010",
      "#607080",
      "#f0a080",
      "#c0c8d0",
    ]);
  });

  test("skip missing or broken swatches", () => {
    assert.deepEqual(
      lyricCardColours({ vibrant: "#e04020", muted: "nope", darkMuted: undefined }),
      ["#e04020"],
    );
  });

  test("are Wave's graphite for a song without a palette", () => {
    assert.deepEqual(lyricCardColours(null), [LYRIC_CARD_FALLBACK]);
    assert.deepEqual(lyricCardColours({}), [LYRIC_CARD_FALLBACK]);
  });

  test("a tap moves to the next colour, and after the last back to the first", () => {
    const colours = ["#203040", "#e04020", "#801010"];
    assert.equal(nextLyricCardColour(colours, "#203040"), "#e04020");
    assert.equal(nextLyricCardColour(colours, "#801010"), "#203040");
    assert.equal(nextLyricCardColour(colours, "#123456"), "#203040");
    assert.equal(nextLyricCardColour(["#203040"], "#203040"), "#203040");
  });
});

describe("lyricCardInk", () => {
  test("is white on a dark card and Wave's ink on a light one", () => {
    assert.equal(lyricCardInk("#203040"), "#ffffff");
    assert.equal(lyricCardInk("#801010"), "#ffffff");
    assert.equal(lyricCardInk("#f0a080"), "#121b1d");
    assert.equal(lyricCardInk("#ffffff"), "#121b1d");
  });

  test("on a middle grey, is whichever of the two reads better", () => {
    // White on #777777 is 4.48:1 against 3.9:1 for the ink; on #8a8a8a, 3.45:1 against 5.0:1.
    assert.equal(lyricCardInk("#777777"), "#ffffff");
    assert.equal(lyricCardInk("#8a8a8a"), "#121b1d");
  });
});

/** [count] lines of about [length] characters. */
const lines = (count: number, length: number): string[] =>
  Array.from({ length: count }, () => "word ".repeat(length / 5).trim());

describe("lyricCardLayout", () => {
  const largest = Math.max(...LYRIC_CARD_TEXT_SIZES);

  test("one short line gives a square card in the largest size", () => {
    assert.deepEqual(lyricCardLayout(["Hold on"]), { aspect: 1, textSize: largest });
  });

  test("five long lines give a taller card in a smaller size", () => {
    const five = lyricCardLayout([
      "I've been walking down this empty road for days",
      "Looking for the light that used to guide me home",
      "Every step I take, the shadows follow close behind",
      "And I can hear your voice still calling out my name",
      "So I keep on moving till the morning finds me here",
    ]);
    assert.ok(five.aspect > 1.2, `aspect ${five.aspect}`);
    assert.ok(five.aspect <= 16 / 9);
    assert.ok(five.textSize < largest, `size ${five.textSize}`);
  });

  test("the size never grows as the text does", () => {
    let previous = largest;
    for (const [count, length] of [
      [1, 10],
      [1, 40],
      [2, 40],
      [3, 40],
      [4, 50],
      [5, 50],
      [5, 80],
      [5, 200],
    ] as const) {
      const { textSize } = lyricCardLayout(lines(count, length));
      assert.ok(textSize <= previous, `${count} × ${length}: ${textSize} > ${previous}`);
      previous = textSize;
    }
  });

  test("the card stays between square and 9:16, however much text", () => {
    for (const picked of [[], ["Oh"], lines(3, 40), lines(5, 400), ["x".repeat(500)]]) {
      const { aspect } = lyricCardLayout(picked);
      assert.ok(aspect >= 1 && aspect <= 16 / 9, `aspect ${aspect}`);
    }
  });

  test("text too long for 9:16 takes the smallest size on a 9:16 card", () => {
    assert.deepEqual(lyricCardLayout(lines(5, 400)), {
      aspect: 16 / 9,
      textSize: Math.min(...LYRIC_CARD_TEXT_SIZES),
    });
  });
});

describe("lyricCardFileName", () => {
  const at = new Date(2026, 9, 18, 14, 5, 9);

  test("names the image after the song and when it was made", () => {
    assert.equal(
      lyricCardFileName("Bohemian Rhapsody", at),
      "Wave - Bohemian Rhapsody - 20261018-140509.png",
    );
  });

  test("leaves out what a file name can't hold, and an untitled song is just lyrics", () => {
    assert.equal(
      lyricCardFileName('AC/DC: "Live" <1991>?', at),
      "Wave - AC DC Live 1991 - 20261018-140509.png",
    );
    assert.equal(lyricCardFileName(null, at), "Wave - Lyrics - 20261018-140509.png");
    assert.equal(lyricCardFileName(" / ", at), "Wave - Lyrics - 20261018-140509.png");
  });

  test("keeps a long title to 60 characters", () => {
    const name = lyricCardFileName("a".repeat(100), at);
    assert.equal(name, `Wave - ${"a".repeat(60)} - 20261018-140509.png`);
  });
});

describe("lyricShareDestinations", () => {
  test("with Instagram Stories and WhatsApp on hand, the apps come first, as in Spotify", () => {
    assert.deepEqual(lyricShareDestinations({ instagramStories: true, whatsapp: true }), [
      "instagramStories",
      "whatsapp",
      "save",
      "more",
    ]);
  });

  test("an app that isn't on hand isn't in the row; Save image and More always are", () => {
    assert.deepEqual(lyricShareDestinations({ instagramStories: false, whatsapp: true }), [
      "whatsapp",
      "save",
      "more",
    ]);
    assert.deepEqual(lyricShareDestinations({ instagramStories: true, whatsapp: false }), [
      "instagramStories",
      "save",
      "more",
    ]);
    assert.deepEqual(lyricShareDestinations({ instagramStories: false, whatsapp: false }), [
      "save",
      "more",
    ]);
  });
});

describe("lyricStoryBackground", () => {
  test("the story's top and bottom are both the card's colour, so the sticker sits on it seamlessly", () => {
    assert.deepEqual(lyricStoryBackground("#3a5f8c"), { top: "#3a5f8c", bottom: "#3a5f8c" });
  });

  test("a colour Instagram can't read becomes Wave's graphite", () => {
    assert.deepEqual(lyricStoryBackground("blue"), {
      top: LYRIC_CARD_FALLBACK,
      bottom: LYRIC_CARD_FALLBACK,
    });
  });
});

describe("instagramStoriesAppId", () => {
  test("reads the Facebook App ID Instagram needs from app.config.ts extra", () => {
    assert.equal(
      instagramStoriesAppId({ facebookAppId: " 1234567890123456 " }),
      "1234567890123456",
    );
  });

  test("a build without one, or with something that isn't an App ID, has none", () => {
    assert.equal(instagramStoriesAppId({ facebookAppId: "" }), null);
    assert.equal(instagramStoriesAppId({ facebookAppId: "dev.leoperez.wave" }), null);
    assert.equal(instagramStoriesAppId({ facebookAppId: 1234567890123456 }), null);
    assert.equal(instagramStoriesAppId({}), null);
    assert.equal(instagramStoriesAppId(undefined), null);
  });
});
