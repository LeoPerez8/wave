import assert from "node:assert/strict";
import { describe, mock, test } from "node:test";

import {
  createFindableList,
  createLibraryQueries,
  foldAccentsAndCase,
  LIBRARY_QUERY_LIMITS,
  longListBurstPace,
  playlistInLibrarySteps,
  type LibraryQueryOutcome,
  type YtSong,
} from "./index.ts";

/** Opening a 4,875-song playlist (#842): what its first render must not do. */
const TEXTS = [
  { title: "Halo", artist: "Beyoncé", album: "I Am" },
  { title: "Crazy in Love", artist: "Beyoncé", album: "Dangerously" },
  { title: "Yellow", artist: "Coldplay", album: "Parachutes" },
];

const finish = (steps: Generator<void, void>): number => {
  let taken = 0;
  while (!steps.next().done) taken += 1;
  return taken;
};

describe("Find over a long list", () => {
  test("showing the whole list prepares nothing for Find", () => {
    let described = 0;
    const list = createFindableList(
      TEXTS,
      (text) => {
        described += 1;
        return text;
      },
      true,
    );
    assert.deepEqual(list.show("").songs, TEXTS);
    assert.equal(list.show("").found, null);
    assert.equal(described, 0);
  });

  test("the first query still finds, when nothing was prepared ahead", () => {
    const list = createFindableList(TEXTS, (text) => text, true);
    assert.deepEqual(list.show("beyonce").found, [0, 1]);
  });

  test("preparing goes a song at a time, and the query after it describes nothing more", () => {
    let described = 0;
    const list = createFindableList(
      TEXTS,
      (text) => {
        described += 1;
        return text;
      },
      true,
    );
    const steps = list.prepare();
    steps.next();
    assert.equal(described, 1, "one song a step");
    assert.ok(finish(steps) >= TEXTS.length - 1);
    assert.equal(described, TEXTS.length);
    assert.deepEqual(list.show("coldplay").found, [2]);
    assert.equal(described, TEXTS.length);
  });

  test("a query typed halfway through preparing finishes it, and preparing then just ends", () => {
    let described = 0;
    const list = createFindableList(
      TEXTS,
      (text) => {
        described += 1;
        return text;
      },
      true,
    );
    const steps = list.prepare();
    steps.next();
    assert.deepEqual(list.show("yellow").found, [2]);
    assert.equal(described, TEXTS.length);
    assert.equal(finish(steps), 0);
    assert.equal(described, TEXTS.length);
  });

  test("with Find off there is nothing to prepare", () => {
    assert.equal(finish(createFindableList(TEXTS, (text) => text, false).prepare()), 0);
  });
});

describe("folding text", () => {
  test("plain ASCII text skips Unicode normalization, the slow part on the phone", () => {
    const normalize = mock.method(String.prototype, "normalize");
    try {
      assert.equal(foldAccentsAndCase("  The  BEATLES\t"), "the beatles");
      assert.equal(normalize.mock.callCount(), 0);
      assert.equal(foldAccentsAndCase("Beyoncé"), "beyonce");
      assert.equal(normalize.mock.callCount(), 1);
    } finally {
      normalize.mock.restore();
    }
  });

  test("text beyond ASCII folds as it always did", () => {
    assert.equal(foldAccentsAndCase("Straße Émilie ﬁn"), "strasse emilie fin");
    assert.equal(foldAccentsAndCase("ÆON  Łódź"), "aeon lodz");
  });
});

/** A registry on a virtual clock whose reads wait until the test settles them. */
const registry = (paceOf?: (value: string) => number) => {
  let time = 0;
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  const reads: ((outcome: LibraryQueryOutcome<string>) => void)[] = [];
  const queries = createLibraryQueries<string>({
    now: () => time,
    schedule: (ms, run) => {
      const timer = { at: time + ms, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    read: (_key, settle) => {
      reads.push(settle);
    },
    limits: { throttleMs: 1500 },
    ...(paceOf === undefined ? {} : { burstPace: paceOf }),
  });
  const advance = (ms: number): void => {
    const end = time + ms;
    for (;;) {
      const due = timers
        .filter((timer) => !timer.cancelled && timer.at <= end)
        .toSorted((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      due.cancelled = true;
      time = due.at;
      due.run();
    }
    time = end;
  };
  const answer = (value: string): void => reads.shift()!({ ok: true, value });
  return { queries, reads, advance, answer };
};

const PLAYLIST = { playlists: [54], tracks: true } as const;
const holdsTwoAndThree = (_value: string, trackId: number): boolean =>
  trackId === 2 || trackId === 3;

const opened = (paceOf?: (value: string) => number) => {
  const setup = registry(paceOf);
  setup.queries.attach("playlist:54", PLAYLIST, {
    visible: true,
    onChange: () => {},
    holdsTrack: holdsTwoAndThree,
  });
  setup.answer("rows");
  return setup;
};

describe("a playlist's rows are read once per opening", () => {
  test("a scan batch of songs the playlist doesn't hold leaves it as read", () => {
    const { queries, reads, advance } = opened();
    queries.change({ kind: "tracks", ids: [8, 9], burst: true, scanned: true });
    advance(60_000);
    assert.equal(reads.length, 0);
  });

  test("a scan batch naming one of its songs reads it again", () => {
    const { queries, reads, advance } = opened();
    queries.change({ kind: "tracks", ids: [8, 3], burst: true, scanned: true });
    advance(1500);
    assert.equal(reads.length, 1);
  });

  test("a download landing may move entries onto its song: it reads again", () => {
    const { queries, reads, advance } = opened();
    queries.change({ kind: "tracks", ids: [8], burst: true });
    advance(1500);
    assert.equal(reads.length, 1);
  });

  test("a deletion that doesn't name its songs reads again at once", () => {
    const { queries, reads } = opened();
    queries.change({ kind: "tracks" });
    assert.equal(reads.length, 1);
  });

  test("a scan batch during the first read can't be judged yet: one read follows", () => {
    const { queries, reads, advance, answer } = registry();
    queries.attach("playlist:54", PLAYLIST, {
      visible: true,
      onChange: () => {},
      holdsTrack: holdsTwoAndThree,
    });
    queries.change({ kind: "tracks", ids: [8], burst: true, scanned: true });
    answer("rows");
    advance(1500);
    assert.equal(reads.length, 1);
  });
});

describe("how often a long list's bursts re-read it", () => {
  const LONG_PACE = 20_000;

  test("a burst waits the pace the last result sets, counted from when its read ended", () => {
    const { queries, reads, advance, answer } = registry(() => LONG_PACE);
    queries.attach("playlist:54", PLAYLIST, { visible: true, onChange: () => {} });
    advance(500);
    answer("rows");
    queries.change({ kind: "playlists", ids: [54], burst: true });
    advance(LONG_PACE - 1);
    assert.equal(reads.length, 0);
    advance(1);
    assert.equal(reads.length, 1);
  });

  test("a pace shorter than the throttle leaves the throttle", () => {
    const { queries, reads, advance, answer } = registry(() => 10);
    queries.attach("playlist:54", PLAYLIST, { visible: true, onChange: () => {} });
    answer("rows");
    queries.change({ kind: "playlists", ids: [54], burst: true });
    advance(1499);
    assert.equal(reads.length, 0);
    advance(1);
    assert.equal(reads.length, 1);
  });

  test("an edit doesn't wait for the pace", () => {
    const { queries, reads, answer } = registry(() => LONG_PACE);
    queries.attach("playlist:54", PLAYLIST, { visible: true, onChange: () => {} });
    answer("rows");
    queries.change({ kind: "playlists", ids: [54] });
    assert.equal(reads.length, 1);
  });
});

describe("a list's burst pace", () => {
  test("a list of a few hundred songs keeps the throttle, a 4,875-song one waits far longer", () => {
    assert.ok(longListBurstPace(300) <= LIBRARY_QUERY_LIMITS.throttleMs);
    assert.ok(longListBurstPace(4875) >= 15_000);
  });
});

const song = (videoId: string): YtSong => ({
  videoId,
  title: videoId,
  artists: ["Artist"],
  album: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

describe("which of a playlist's songs the Library has, asked a song at a time", () => {
  const entries = [
    { source: "stream", itemId: 1, song: song("a") },
    { source: "library", itemId: 2, track: { path: "/a.mp3" } },
    { source: "stream", itemId: 3, song: song("b") },
  ] as const;

  test("each stream entry is asked once, a step each, and the answers are kept", () => {
    const asked: string[] = [];
    const steps = playlistInLibrarySteps(entries, (candidate) => {
      asked.push(candidate.videoId);
      return candidate.videoId === "b";
    });
    assert.equal(steps.next().done, false);
    assert.deepEqual(asked, ["a"]);
    let next = steps.next();
    while (next.done !== true) next = steps.next();
    assert.deepEqual(asked, ["a", "b"]);
    const inLibrary = next.value;
    assert.equal(inLibrary(song("b")), true);
    assert.equal(inLibrary(song("a")), false);
    assert.deepEqual(asked, ["a", "b"], "the answers don't ask again");
  });
});
