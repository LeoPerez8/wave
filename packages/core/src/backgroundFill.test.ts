import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NO_FILL,
  fillAnswered,
  fillPauseLine,
  nextFillStep,
  type BackgroundFill,
  type FillPlaylist,
  type FillStep,
  type UnsearchedSong,
} from "./index.ts";

const song = (title: string): UnsearchedSong => ({
  title,
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationMs: 369_000,
  artworkUrl: null,
});

const playlist = (id: number, usedAt: number | null, titles: readonly string[]): FillPlaylist => ({
  id,
  usedAt,
  songs: titles.map(song),
});

const world = (playlists: readonly FillPlaylist[]) => ({
  playlists,
  downloading: false,
  ytMusicOn: true,
});

/** The title the step searches, or the step itself when it searches nothing. */
const searched = (step: FillStep): string | FillStep =>
  step.kind === "search" ? step.song.title : step;

/** The titles the fill searches, one a second from [start], each found. */
const searchesInTurn = (
  playlists: readonly FillPlaylist[],
  count: number,
  start = 0,
): (string | FillStep)[] => {
  let fill: BackgroundFill = NO_FILL;
  const titles: (string | FillStep)[] = [];
  let left = playlists;
  for (let at = 0; titles.length < count; at += 1) {
    const next = nextFillStep(fill, world(left), start + at * 1000);
    fill = next.fill;
    titles.push(searched(next.step));
    if (next.step.kind !== "search") break;
    const { title } = next.step.song;
    left = left.map((one) => ({ ...one, songs: one.songs.filter((s) => s.title !== title) }));
  }
  return titles;
};

describe("the background fill's order", () => {
  test("the playlist opened or played last, top to bottom, then the others, the most recent first", () => {
    const playlists = [
      playlist(1, 100, ["One More Time"]),
      playlist(2, null, ["Aerodynamic"]),
      playlist(3, 300, ["Touch", "Contact"]),
      playlist(4, 200, ["Veridis Quo"]),
    ];
    assert.deepEqual(searchesInTurn(playlists, 6), [
      "Touch",
      "Contact",
      "Veridis Quo",
      "One More Time",
      "Aerodynamic",
      { kind: "idle" },
    ]);
  });

  test("opening another playlist moves the fill to it", () => {
    const first = nextFillStep(
      NO_FILL,
      world([playlist(1, 100, ["Touch", "Contact"]), playlist(2, 50, ["Aerodynamic"])]),
      0,
    );
    assert.equal(searched(first.step), "Touch");
    const opened = [playlist(1, 100, ["Contact"]), playlist(2, 900, ["Aerodynamic"])];
    assert.equal(searched(nextFillStep(first.fill, world(opened), 1000).step), "Aerodynamic");
  });
});

describe("when the background fill waits", () => {
  test("one search a second", () => {
    const playlists = [playlist(1, 100, ["Touch", "Contact"])];
    const first = nextFillStep(NO_FILL, world(playlists), 5000);
    assert.equal(searched(first.step), "Touch");
    const left = [playlist(1, 100, ["Contact"])];
    assert.deepEqual(nextFillStep(first.fill, world(left), 5400).step, {
      kind: "wait",
      until: 6000,
    });
    assert.equal(searched(nextFillStep(first.fill, world(left), 6000).step), "Contact");
  });

  test("nothing while any download is queued or downloading; it goes on once the queue is empty", () => {
    const playlists = [playlist(1, 100, ["Touch"])];
    const downloading = { ...world(playlists), downloading: true };
    assert.deepEqual(nextFillStep(NO_FILL, downloading, 0).step, { kind: "idle" });
    assert.equal(searched(nextFillStep(NO_FILL, world(playlists), 0).step), "Touch");
  });

  test("nothing while YT Music is off: it looks again a minute later", () => {
    const off = { ...world([playlist(1, 100, ["Touch"])]), ytMusicOn: false };
    assert.deepEqual(nextFillStep(NO_FILL, off, 0).step, { kind: "wait", until: 60_000 });
  });
});

describe("what a failed search does to the background fill", () => {
  const FAILED = { kind: "failed", reason: "failed" } as const;
  const FOUND = { kind: "found" } as const;

  test("the song goes to the back of its playlist's line, still unsearched, and the others go on", () => {
    let fill: BackgroundFill = NO_FILL;
    let at = 0;
    const step = (playlists: readonly FillPlaylist[]): string | FillStep => {
      const next = nextFillStep(fill, world(playlists), at);
      fill = next.fill;
      return searched(next.step);
    };
    const answer = (title: string, settled: typeof FAILED | typeof FOUND): void => {
      fill = fillAnswered(fill, song(title), settled, at).fill;
      at += 1000;
    };
    const other = playlist(1, 100, ["Aerodynamic"]);
    assert.equal(step([playlist(2, 200, ["Touch", "Contact"]), other]), "Touch");
    answer("Touch", FAILED);
    assert.equal(step([playlist(2, 200, ["Touch", "Contact"]), other]), "Contact");
    answer("Contact", FOUND);
    // Asked again a minute after it failed at the soonest: the other playlist goes meanwhile.
    assert.equal(step([playlist(2, 200, ["Touch"]), other]), "Aerodynamic");
    answer("Aerodynamic", FOUND);
    assert.deepEqual(step([playlist(2, 200, ["Touch"])]), { kind: "wait", until: 60_000 });
    at = 60_000;
    assert.equal(step([playlist(2, 200, ["Touch"])]), "Touch");
  });

  test("a song whose search keeps failing never stops the others", () => {
    let fill: BackgroundFill = NO_FILL;
    const titles = ["Touch", "Contact", "Doin' It Right", "Fragments of Time"];
    let left = titles;
    const asked: string[] = [];
    for (let at = 0; left.length > 0 && at < 100_000; at += 1000) {
      const next = nextFillStep(fill, world([playlist(1, 100, left)]), at);
      fill = next.fill;
      if (next.step.kind !== "search") continue;
      const { title } = next.step.song;
      asked.push(title);
      const fails = title === "Touch";
      fill = fillAnswered(fill, next.step.song, fails ? FAILED : FOUND, at).fill;
      if (!fails) left = left.filter((one) => one !== title);
      if (left.length === 1) break;
    }
    assert.deepEqual(asked, titles, "each of the others searched once, after Touch failed");
  });

  test("offline, the song keeps its place and the fill looks again a minute later", () => {
    const playlists = [playlist(1, 100, ["Touch", "Contact"])];
    const first = nextFillStep(NO_FILL, world(playlists), 0);
    const offline = { kind: "failed", reason: "offline" } as const;
    const { fill } = fillAnswered(first.fill, song("Touch"), offline, 500);
    assert.deepEqual(nextFillStep(fill, world(playlists), 1000).step, {
      kind: "wait",
      until: 60_500,
    });
    assert.equal(searched(nextFillStep(fill, world(playlists), 60_500).step), "Touch");
  });
});

describe("refusals and the background fill's pauses", () => {
  const REFUSED = { kind: "failed", reason: "failed" } as const;
  const titles = Array.from({ length: 20 }, (_, n) => `Song ${n + 1}`);

  /** Searches [answers] in turn as fast as the fill lets them, and the pauses it took after each. */
  const run = (answers: readonly ("refused" | "found")[]) => {
    let fill: BackgroundFill = NO_FILL;
    let at = 0;
    let left = titles;
    const pauses: (number | null)[] = [];
    for (const answer of answers) {
      let next = nextFillStep(fill, world([playlist(1, 100, left)]), at);
      if (next.step.kind === "wait") {
        at = next.step.until;
        next = nextFillStep(fill, world([playlist(1, 100, left)]), at);
      }
      assert.equal(next.step.kind, "search");
      if (next.step.kind !== "search") break;
      const asked = next.step.song;
      const answered = fillAnswered(
        next.fill,
        asked,
        answer === "found" ? { kind: "found" } : REFUSED,
        at,
      );
      fill = answered.fill;
      pauses.push(answered.pause === null ? null : answered.pause.until - at);
      if (answer === "found") left = left.filter((title) => title !== asked.title);
    }
    return pauses;
  };

  test("several different searches refused in a row pause the fill, longer each time", () => {
    const refused = Array.from({ length: 13 }, () => "refused" as const);
    assert.deepEqual(run(refused), [
      null,
      null,
      2000,
      5000,
      10_000,
      20_000,
      60_000,
      2 * 60_000,
      5 * 60_000,
      10 * 60_000,
      15 * 60_000,
      15 * 60_000,
      15 * 60_000,
    ]);
  });

  test("an answer ends the run of refusals: the next ones start over", () => {
    assert.deepEqual(
      run(["refused", "refused", "refused", "refused", "found", "refused", "refused", "refused"]),
      [null, null, 2000, 5000, null, null, null, 2000],
    );
  });

  test("the same song refused again counts once", () => {
    let fill: BackgroundFill = NO_FILL;
    for (const [at, title] of [
      [0, "Touch"],
      [60_000, "Touch"],
      [120_000, "Touch"],
      [180_000, "Contact"],
    ] as const) {
      const answered = fillAnswered(fill, song(title), REFUSED, at);
      fill = answered.fill;
      assert.equal(answered.pause, null, `${title} at ${at}`);
    }
  });

  test("each pause goes in the app log: how long, why, and when the fill goes on", () => {
    let fill: BackgroundFill = NO_FILL;
    const lines: string[] = [];
    for (const [at, title] of [
      [0, "Touch"],
      [1000, "Contact"],
      [2000, "Doin' It Right"],
      [4000, "Fragments of Time"],
    ] as const) {
      const answered = fillAnswered(
        fill,
        song(title),
        REFUSED,
        Date.UTC(2026, 9, 17, 13, 14, 0) + at,
      );
      fill = answered.fill;
      if (answered.pause !== null) lines.push(fillPauseLine(answered.pause));
    }
    assert.deepEqual(lines, [
      "The background fill pauses for 2 s: YouTube Music refused 3 different searches in a row; it goes on at 13:14:04 UTC",
      "The background fill pauses for 5 s: YouTube Music refused 4 different searches in a row; it goes on at 13:14:09 UTC",
    ]);
  });
});

test("settling an indexed fill song removes every occurrence without revisiting unrelated song keys", async () => {
  const { indexFillPlaylists } = await import("./index.ts");
  let titleReads = 0;
  const untouched = {
    ...song("Untouched"),
    get title() {
      titleReads++;
      return "Untouched";
    },
  };
  const settled = song("Touch");
  const index = indexFillPlaylists([
    { id: 1, usedAt: 100, songs: [settled, song("Contact"), settled] },
    { id: 2, usedAt: 200, songs: [settled] },
    { id: 3, usedAt: null, songs: [untouched] },
  ]);
  const before = index.playlists();
  titleReads = 0;
  index.drop(settled);
  const after = index.playlists();
  assert.equal(titleReads, 0);
  assert.deepEqual(
    after.map((p) => p.songs.map((s) => s.title)),
    [["Contact"], [], ["Untouched"]],
  );
  assert.equal(after[2], before[2]);
  assert.equal(index.empty(), false);
  assert.equal(searched(nextFillStep(NO_FILL, world(after), 0).step), "Contact");
  index.drop(song("Contact"));
  index.drop(untouched);
  assert.equal(index.empty(), true);
});
