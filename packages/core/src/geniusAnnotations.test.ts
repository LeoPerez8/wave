import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  GENIUS_REFERENTS_PER_PAGE,
  geniusReferentsPage,
  geniusLineSegments,
  geniusReferentsUrl,
  geniusSection,
  parseLyrics,
  placeGeniusReferents,
  type GeniusReferent,
} from "./index.ts";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/genius/${name}.json`, import.meta.url), "utf8"));

test("Genius's referents for a song are asked page by page as plain text", () => {
  assert.equal(
    geniusReferentsUrl(10356, 2),
    `https://api.genius.com/referents?song_id=10356&text_format=plain&per_page=${GENIUS_REFERENTS_PER_PAGE}&page=2`,
  );
});

test("a referents page gives each fragment with its annotations' text and authors", () => {
  const page = geniusReferentsPage(fixture("referents-1"), 10356);
  assert.ok(page);
  assert.equal(page.last, true);
  // The song's description (is_description) is the About card's, not a lyric's.
  assert.deepEqual(
    page.referents.map((referent) => referent.id),
    [2001, 2002, 2003, 2004],
  );
  assert.deepEqual(page.referents[0], {
    id: 2001,
    fragment: "paper lanterns",
    annotations: [
      {
        text: "The lanterns stand for the friends who left town.",
        authors: ["Lantern Keeper", "Bo Reads"],
        state: "accepted",
      },
    ],
  });
});

test("a referent without annotation text is dropped, another song's never read", () => {
  const page = geniusReferentsPage(fixture("referents-2"), 10356);
  assert.deepEqual(
    page?.referents.map((referent) => referent.id),
    [2005, 2006, 2007],
  );
  assert.deepEqual(geniusReferentsPage(fixture("referents-2"), 1)?.referents, []);
  assert.equal(geniusReferentsPage({ meta: { status: 401 } }, 10356), null);
  assert.equal(geniusReferentsPage({ meta: { status: 200 }, response: {} }, 10356), null);
});

test("an annotation Genius's editors haven't reviewed yet is kept, marked pending", () => {
  const page = geniusReferentsPage(fixture("referents-2"), 10356);
  const attic = page?.referents.find((referent) => referent.id === 2006);
  assert.deepEqual(
    attic?.annotations.map((annotation) => annotation.state),
    ["pending"],
  );
});

test("a full page of referents isn't the last: the next page is asked", () => {
  const reply = fixture("referents-2");
  const one = reply.response.referents[0];
  reply.response.referents = Array.from({ length: GENIUS_REFERENTS_PER_PAGE }, (_, at) => ({
    ...one,
    id: 5000 + at,
  }));
  const page = geniusReferentsPage(reply, 10356);
  assert.equal(page?.last, false);
  assert.equal(page?.referents.length, GENIUS_REFERENTS_PER_PAGE);
});

/** LRCLIB's synced lyrics for the fixtures' song, as Wave's lines. */
const lrclibLines = (): string[] => {
  const lyrics = parseLyrics(fixture("lrclib").syncedLyrics);
  assert.equal(lyrics.kind, "synced");
  return lyrics.kind === "synced" ? lyrics.lines.map((line) => line.text) : [];
};
const allReferents = (): readonly GeniusReferent[] => [
  ...(geniusReferentsPage(fixture("referents-1"), 10356)?.referents ?? []),
  ...(geniusReferentsPage(fixture("referents-2"), 10356)?.referents ?? []),
];
/** Each line's highlighted text with its referents' ids, for reading the placement at a glance. */
const marked = (lines: readonly string[], referents: readonly GeniusReferent[]) => {
  const placement = placeGeniusReferents(lines, referents);
  return {
    lines: placement.lines.map((spans, at) =>
      spans.map((span) => [
        lines[at]!.slice(span.start, span.end),
        ...span.referents.map((each) => each.id),
      ]),
    ),
    unplaced: placement.unplaced.map((referent) => referent.id),
  };
};

test("Genius's fragments land on LRCLIB's lines despite case, accents, punctuation and ad-libs", () => {
  const lines = lrclibLines();
  assert.deepEqual(marked(lines, allReferents()), {
    lines: [
      [["paper lanterns", 2001]],
      [["Hold the light, don't let it go", 2002]],
      [["Carry it home through the snow", 2002]],
      [["Cafe on the corner", 2003]],
      [["Say goodbye to the summer", 2004]],
      [["Burn, burn, little flame", 2005]],
      [["Nobody here remembers your name", 2005]],
      [],
      [["Rock 'n' roll in the attic", 2006]],
      [["Hold the light, don't let it go", 2002]],
      [["Carry it home through the snow", 2002]],
      [["Burn, burn, little flame", 2005]],
      [["Nobody here remembers your name", 2005]],
    ],
    unplaced: [2007],
  });
});

const referent = (id: number, fragment: string): GeniusReferent => ({
  id,
  fragment,
  annotations: [{ text: `Note ${id}`, authors: [], state: "accepted" }],
});

test("a fragment matches whole words only, and an ad-lib inside a line stays covered", () => {
  const lines = ["Hold me in the old house", "Sing (sing it!) along with ME", "Ünder the sky"];
  assert.deepEqual(
    marked(lines, [referent(1, "old"), referent(2, "sing along with me"), referent(3, "under")]),
    {
      lines: [[["old", 1]], [["Sing (sing it!) along with ME", 2]], [["Ünder", 3]]],
      unplaced: [],
    },
  );
  assert.deepEqual(marked(["Holding on"], [referent(1, "old")]).unplaced, [1]);
});

test("places never overlap: the longer fragment wins, the shorter goes where it still fits", () => {
  const lines = ["Run, run away", "We run"];
  assert.deepEqual(marked(lines, [referent(1, "run"), referent(2, "run, run away")]), {
    lines: [[["Run, run away", 2]], [["run", 1]]],
    unplaced: [],
  });
});

test("a shorter fragment found only inside a longer one's highlight joins it: a tap there opens both", () => {
  assert.deepEqual(marked(["Run, run away"], [referent(1, "run"), referent(2, "run run away")]), {
    lines: [[["Run, run away", 2, 1]]],
    unplaced: [],
  });
  // Across lines, each line's part of the highlight carries both.
  assert.deepEqual(
    marked(
      ["Hold the light", "Carry it home"],
      [referent(1, "light, carry"), referent(2, "Hold the light / carry it home")],
    ),
    { lines: [[["Hold the light", 2, 1]], [["Carry it home", 2, 1]]], unplaced: [] },
  );
  // Half in a highlight and half out fits neither way.
  assert.deepEqual(
    marked(["We run away now"], [referent(1, "away now"), referent(2, "we run away")]),
    { lines: [[["We run away", 2]]], unplaced: [1] },
  );
});

test("unsynced lyrics with section headings and blank lines take fragments too", () => {
  const lines = ["[Chorus]", "Oh, the night", "", "is young"];
  assert.deepEqual(marked(lines, [referent(1, "Oh the night\nIs young"), referent(2, "(Oh)")]), {
    lines: [[], [["Oh, the night", 1]], [], [["is young", 1]]],
    unplaced: [2],
  });
});

test("a fragment that is only a section heading explains the section: it goes to More insights under its name", () => {
  // Wave's lyrics rarely have headings; even where they do, a section isn't one line.
  const lines = ["[Verse 1]", "Oh, the night", "[Outro]", "Is young"];
  assert.deepEqual(
    marked(lines, [referent(1, "[Verse 1]"), referent(2, " [Outro]\n"), referent(3, "the night")]),
    { lines: [[], [["the night", 3]], [], []], unplaced: [1, 2] },
  );
  assert.equal(geniusSection("[Verse 1]"), "Verse 1");
  assert.equal(geniusSection(" [Outro]\n"), "Outro");
  assert.equal(geniusSection("[Chorus: Freddie Mercury]"), "Chorus: Freddie Mercury");
  assert.equal(geniusSection("[Chorus] Oh, the night"), null);
  assert.equal(geniusSection("Oh, the night (oh)"), null);
});

test("a line splits where a highlight or a sung word starts or ends, for Karaoke under highlights", () => {
  const text = "We hang paper lanterns high";
  const [spans] = placeGeniusReferents([text], [referent(1, "paper lanterns")]).lines;
  const segments = geniusLineSegments(text, spans!, [0, 3, 8, 14, 23]);
  assert.deepEqual(
    segments.map((segment) => [
      text.slice(segment.start, segment.end),
      segment.word,
      ...segment.referents.map((each) => each.id),
    ]),
    [
      ["We ", 0],
      ["hang ", 1],
      ["paper ", 2, 1],
      ["lanterns", 3, 1],
      [" ", 3],
      ["high", 4],
    ],
  );
  assert.deepEqual(
    geniusLineSegments("  Hi", [], [2]).map((segment) => [
      segment.start,
      segment.end,
      segment.word,
    ]),
    [
      [0, 2, -1],
      [2, 4, 0],
    ],
  );
});

test("referents are saved with the song's Genius answer; an answer saved before them has none yet", async () => {
  const { savedGenius, storedGenius } = await import("./index.ts");
  const song = { title: "Paper Lanterns", artist: "The Example Band" };
  const match = { id: 10356, title: "Paper Lanterns", artist: "The Example Band", url: "u" };
  const answer = {
    checkedAt: 100,
    match,
    description: null,
    referents: allReferents(),
    translations: {},
  };
  assert.deepEqual(savedGenius(storedGenius(song, answer), 200, song), answer);
  const before = JSON.parse(storedGenius(song, answer));
  delete before.referents;
  assert.deepEqual(savedGenius(JSON.stringify(before), 200, song), { ...answer, referents: null });
  // Saved before Wave kept an annotation's state: it reads as accepted.
  before.referents = [{ id: 1, fragment: "x", annotations: [{ text: "Note", authors: [] }] }];
  assert.deepEqual(savedGenius(JSON.stringify(before), 200, song)?.referents, [
    { id: 1, fragment: "x", annotations: [{ text: "Note", authors: [], state: "accepted" }] },
  ]);
  before.referents = [{ id: 1, fragment: "x", annotations: [{ text: 1 }] }];
  assert.equal(savedGenius(JSON.stringify(before), 200, song), null);
});
