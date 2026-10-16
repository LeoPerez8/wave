import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createLibraryQueries,
  libraryChangeAffects,
  type LibraryQueryLimits,
  type LibraryQueryOutcome,
} from "./index.ts";

describe("which Library changes a query follows", () => {
  test("a playlist edit reaches playlist queries, not the Songs list", () => {
    const edit = { kind: "playlists", ids: [7] } as const;
    assert.equal(libraryChangeAffects({ tracks: true }, edit), false);
    assert.equal(libraryChangeAffects({ playlists: true, tracks: true }, edit), true);
  });

  test("a playlist screen follows its own playlist only", () => {
    assert.equal(libraryChangeAffects({ playlists: [7] }, { kind: "playlists", ids: [7] }), true);
    assert.equal(libraryChangeAffects({ playlists: [7] }, { kind: "playlists", ids: [3] }), false);
    assert.equal(
      libraryChangeAffects({ playlists: [7] }, { kind: "playlists", ids: [3, 7] }),
      true,
    );
  });

  test("a change that doesn't say which items changed reaches every reader of its kind", () => {
    assert.equal(libraryChangeAffects({ playlists: [7] }, { kind: "playlists" }), true);
    assert.equal(libraryChangeAffects({ favorites: true }, { kind: "favorites" }), true);
  });

  test("plays reach only what reads the play history", () => {
    const play = { kind: "plays", ids: [12] } as const;
    assert.equal(libraryChangeAffects({ tracks: true, favorites: true }, play), false);
    assert.equal(libraryChangeAffects({ tracks: true, plays: true }, play), true);
  });
});

/** A registry on a virtual clock whose reads wait until the test settles them. */
const setup = (limits: Partial<LibraryQueryLimits> = {}) => {
  let time = 0;
  const timers: { at: number; run: () => void; cancelled: boolean }[] = [];
  const reads: { key: string; settle: (outcome: LibraryQueryOutcome<string>) => void }[] = [];
  const queries = createLibraryQueries<string>({
    now: () => time,
    schedule: (ms, run) => {
      const timer = { at: time + ms, run, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
    read: (key, settle) => {
      reads.push({ key, settle });
    },
    limits,
  });
  /** Moves the clock on by [ms], running the timers that fall due, in order. */
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
  /** Settles the oldest read still waiting for [key] with [value]. */
  const answer = (key: string, value: string): void => {
    const index = reads.findIndex((read) => read.key === key);
    assert.notEqual(index, -1, `no read of ${key} waiting`);
    const [read] = reads.splice(index, 1);
    read!.settle({ ok: true, value });
  };
  const readsOf = (key: string): number => reads.filter((read) => read.key === key).length;
  return { queries, reads, advance, answer, readsOf };
};

const SONGS = { tracks: true } as const;

describe("shared Library queries", () => {
  test("screens showing the same query share one read", () => {
    const { queries, answer, readsOf } = setup();
    let told = 0;
    queries.attach("songs", SONGS, { visible: true, onChange: () => told++ });
    queries.attach("songs", SONGS, { visible: true, onChange: () => told++ });
    assert.equal(readsOf("songs"), 1);
    answer("songs", "v1");
    assert.equal(queries.current("songs")?.value, "v1");
    assert.equal(told, 2);
  });

  test("a screen opened later starts from the current result without reading again", () => {
    const { queries, answer, readsOf } = setup();
    queries.attach("songs", SONGS, { visible: true, onChange: () => {} });
    answer("songs", "v1");
    queries.attach("songs", SONGS, { visible: true, onChange: () => {} });
    assert.equal(readsOf("songs"), 0);
    assert.equal(queries.current("songs")?.value, "v1");
    assert.equal(queries.stats().reads, 1);
  });

  test("an edit re-reads at once the queries it reaches, and only those", () => {
    const { queries, answer, readsOf } = setup();
    queries.attach("songs", SONGS, { visible: true, onChange: () => {} });
    queries.attach(
      "playlist:7",
      { playlists: [7], tracks: true },
      {
        visible: true,
        onChange: () => {},
      },
    );
    queries.attach(
      "playlist:3",
      { playlists: [3], tracks: true },
      {
        visible: true,
        onChange: () => {},
      },
    );
    answer("songs", "s1");
    answer("playlist:7", "p7");
    answer("playlist:3", "p3");

    queries.change({ kind: "playlists", ids: [7] });
    assert.deepEqual([readsOf("songs"), readsOf("playlist:7"), readsOf("playlist:3")], [0, 1, 0]);
    answer("playlist:7", "p7 edited");
    assert.equal(queries.current("playlist:7")?.value, "p7 edited");
  });

  test("scan batches re-read a query at most once per throttle window", () => {
    const { queries, answer, readsOf, advance } = setup({ throttleMs: 1500 });
    queries.attach("songs", SONGS, { visible: true, onChange: () => {} });
    answer("songs", "s1");
    queries.change({ kind: "tracks", burst: true });
    queries.change({ kind: "tracks", burst: true });
    queries.change({ kind: "tracks", burst: true });
    assert.equal(readsOf("songs"), 0, "the first read was just now");
    advance(1499);
    assert.equal(readsOf("songs"), 0);
    advance(1);
    assert.equal(readsOf("songs"), 1, "three batches, one read");
    answer("songs", "s2");
    advance(5000);
    assert.equal(readsOf("songs"), 0, "nothing new since");
  });

  test("an edit doesn't wait for a scan's throttle", () => {
    const { queries, answer, readsOf } = setup();
    queries.attach("songs", SONGS, { visible: true, onChange: () => {} });
    answer("songs", "s1");
    queries.change({ kind: "tracks", burst: true });
    queries.change({ kind: "tracks", ids: [4] });
    assert.equal(readsOf("songs"), 1);
  });

  test("changes landing during a read are read once after it", () => {
    const { queries, answer, readsOf, advance } = setup();
    queries.attach("songs", SONGS, { visible: true, onChange: () => {} });
    queries.change({ kind: "tracks", burst: true });
    queries.change({ kind: "tracks", burst: true });
    assert.equal(readsOf("songs"), 1);
    answer("songs", "s1");
    advance(1500);
    assert.equal(readsOf("songs"), 1);
    answer("songs", "s2");
    assert.equal(queries.current("songs")?.value, "s2");
  });
});

describe("hidden screens", () => {
  test("scan batches don't re-read what only hidden screens show; one read when one comes back", () => {
    const { queries, answer, readsOf, advance } = setup();
    let told = 0;
    const tab = queries.attach("songs", SONGS, { visible: true, onChange: () => told++ });
    answer("songs", "s1");
    tab.hide();
    for (let batch = 0; batch < 20; batch++) {
      queries.change({ kind: "tracks", burst: true });
      advance(500);
    }
    assert.equal(readsOf("songs"), 0, "nothing read while hidden");
    assert.equal(queries.stats().paused, 20);

    tab.show();
    assert.equal(readsOf("songs"), 1, "read at once, not after a throttle");
    answer("songs", "s2");
    assert.equal(told, 2);
    assert.equal(readsOf("songs"), 0);
  });

  test("an edit reaches hidden screens at once, so none shows a removed item when it comes back", () => {
    const { queries, answer, readsOf } = setup();
    let told = 0;
    const album = queries.attach("album:3", SONGS, { visible: true, onChange: () => told++ });
    answer("album:3", "with song 9");
    album.hide();
    queries.change({ kind: "tracks", ids: [9] }); // song 9 deleted from another screen
    assert.equal(readsOf("album:3"), 1);
    answer("album:3", "without song 9");
    assert.equal(told, 2, "the hidden screen has the edit before it is shown again");
    album.show();
    assert.equal(readsOf("album:3"), 0, "nothing left to catch up");
  });

  test("a screen shown again reads first the queries it shows, then the hidden ones an edit reached", () => {
    const { queries, reads, answer } = setup();
    const hidden = queries.attach("albums", SONGS, { visible: true, onChange: () => {} });
    queries.attach("songs", SONGS, { visible: true, onChange: () => {} });
    answer("albums", "a1");
    answer("songs", "s1");
    hidden.hide();
    queries.change({ kind: "tracks", ids: [1] });
    assert.deepEqual(
      reads.map((read) => read.key),
      ["songs", "albums"],
    );
  });

  test("a hidden screen still gets its first read, so a warmed tab has content", () => {
    const { queries, readsOf } = setup();
    queries.attach("albums", SONGS, { visible: false, onChange: () => {} });
    assert.equal(readsOf("albums"), 1);
  });

  test("a hidden screen isn't re-rendered by scan reads a visible one asked for; it hears on return", () => {
    const { queries, answer, advance } = setup();
    let hiddenTold = 0;
    const hidden = queries.attach("songs", SONGS, {
      visible: true,
      onChange: () => hiddenTold++,
    });
    answer("songs", "s1");
    hidden.hide();
    queries.attach("songs", SONGS, { visible: true, onChange: () => {} });
    queries.change({ kind: "tracks", burst: true });
    advance(1500);
    answer("songs", "s2");
    assert.equal(hiddenTold, 1);
    hidden.show();
    assert.equal(hiddenTold, 2);
    hidden.show();
    assert.equal(hiddenTold, 2, "told once per result");
  });

  test("Now Playing over a screen pauses it like another tab does", () => {
    const { queries, answer, readsOf } = setup();
    const home = queries.attach(
      "home",
      { tracks: true, plays: true },
      {
        visible: true,
        onChange: () => {},
      },
    );
    answer("home", "h1");
    home.hide(); // covered
    queries.change({ kind: "plays", ids: [5], burst: true });
    queries.change({ kind: "plays", ids: [6], burst: true });
    assert.equal(readsOf("home"), 0);
    home.show(); // uncovered
    assert.equal(readsOf("home"), 1);
  });

  test("a warmed hidden screen is told its first result, to render it ahead", () => {
    const { queries, answer } = setup();
    let told = 0;
    queries.attach("albums", SONGS, { visible: false, onChange: () => told++ });
    answer("albums", "a1");
    assert.equal(told, 1);
  });

  test("refresh re-reads at once even without a change", () => {
    const { queries, answer, readsOf } = setup();
    const songs = queries.attach("songs", SONGS, { visible: true, onChange: () => {} });
    answer("songs", "s1");
    songs.refresh();
    assert.equal(readsOf("songs"), 1);
  });
});

describe("stale reads", () => {
  test("a result an edit overtook is dropped, never shown, and read again", () => {
    const { queries, answer, readsOf } = setup();
    let told = 0;
    queries.attach("album:3", SONGS, { visible: true, onChange: () => told++ });
    answer("album:3", "with the deleted song");
    queries.change({ kind: "tracks", burst: true });
    queries.change({ kind: "tracks", ids: [9] }); // owner deletes a song
    assert.equal(readsOf("album:3"), 1);
    // The delete lands again while that read is under way (a second delete).
    queries.change({ kind: "tracks", ids: [10] });
    answer("album:3", "without song 9 only");
    assert.equal(queries.current("album:3")?.value, "with the deleted song");
    assert.equal(told, 1);
    assert.equal(readsOf("album:3"), 1, "read again at once");
    answer("album:3", "without either");
    assert.equal(queries.current("album:3")?.value, "without either");
    assert.equal(queries.stats().discarded, 1);
  });

  test("a scan batch landing during a read doesn't drop its result: progress shows", () => {
    const { queries, answer } = setup();
    queries.attach("songs", SONGS, { visible: true, onChange: () => {} });
    queries.change({ kind: "tracks", burst: true });
    answer("songs", "s1");
    assert.equal(queries.current("songs")?.value, "s1");
  });

  test("a failed read keeps the last result", () => {
    const { queries, answer, reads } = setup();
    const songs = queries.attach("songs", SONGS, { visible: true, onChange: () => {} });
    answer("songs", "s1");
    songs.refresh();
    reads.shift()!.settle({ ok: false });
    assert.equal(queries.current("songs")?.value, "s1");
    assert.equal(reads.length, 0, "not retried until something changes");
  });

  test("a failed first read isn't retried in a loop; the next screen to show it tries again", () => {
    const { queries, reads, readsOf } = setup();
    queries.attach("songs", SONGS, { visible: true, onChange: () => {} });
    reads.shift()!.settle({ ok: false });
    assert.equal(reads.length, 0);
    queries.attach("songs", SONGS, { visible: true, onChange: () => {} });
    assert.equal(readsOf("songs"), 1);
  });

  test("a read that ends after its last screen left is dropped with it", () => {
    const { queries, reads } = setup();
    const album = queries.attach("album:3", SONGS, { visible: true, onChange: () => {} });
    album.detach();
    queries.change({ kind: "tracks", ids: [1] });
    reads.shift()!.settle({ ok: true, value: "late" });
    assert.equal(queries.current("album:3"), undefined);
  });
});

describe("retention", () => {
  test("a result nobody shows is kept a while for a quick return, then dropped", () => {
    const { queries, answer, readsOf, advance } = setup({ retainMs: 30_000 });
    const album = queries.attach("album:3", SONGS, { visible: true, onChange: () => {} });
    answer("album:3", "a3");
    album.detach();
    advance(10_000);
    const back = queries.attach("album:3", SONGS, { visible: true, onChange: () => {} });
    assert.equal(readsOf("album:3"), 0, "back within the window: no read");
    back.detach();
    advance(30_000);
    assert.equal(queries.current("album:3"), undefined);
    assert.equal(queries.stats().entries, 0);
  });

  test("a change drops a kept result instead of re-reading it for nobody", () => {
    const { queries, answer, readsOf } = setup();
    const album = queries.attach("album:3", SONGS, { visible: true, onChange: () => {} });
    answer("album:3", "a3");
    album.detach();
    queries.change({ kind: "tracks", burst: true });
    assert.equal(readsOf("album:3"), 0);
    assert.equal(queries.current("album:3"), undefined);
  });

  test("at most maxRetained results nobody shows are kept, the least recent dropped first", () => {
    const { queries, answer, advance } = setup({ maxRetained: 2 });
    for (const id of [1, 2, 3]) {
      const album = queries.attach(`album:${id}`, SONGS, { visible: true, onChange: () => {} });
      answer(`album:${id}`, `a${id}`);
      advance(10);
      album.detach();
    }
    assert.equal(queries.current("album:1"), undefined);
    assert.equal(queries.current("album:2")?.value, "a2");
    assert.equal(queries.current("album:3")?.value, "a3");
    assert.equal(queries.stats().retained, 2);
  });

  test("the app hears of every query dropped, so it can let go of what it holds for it", () => {
    let time = 0;
    const dropped: string[] = [];
    const settles: ((outcome: LibraryQueryOutcome<string>) => void)[] = [];
    const queries = createLibraryQueries<string>({
      now: () => time,
      schedule: () => () => {},
      read: (_key, settle) => void settles.push(settle),
      dropped: (key) => dropped.push(key),
      limits: { maxRetained: 1 },
    });
    const loading = queries.attach("album:1", SONGS, { visible: true, onChange: () => {} });
    loading.detach(); // left before its first result
    for (const key of ["album:2", "album:3"]) {
      const album = queries.attach(key, SONGS, { visible: true, onChange: () => {} });
      settles.at(-1)!({ ok: true, value: key });
      time += 10;
      album.detach();
    }
    queries.change({ kind: "tracks" });
    assert.deepEqual(dropped, ["album:1", "album:2", "album:3"]);
  });

  test("a query still shown is never dropped, however many there are", () => {
    const { queries, answer, advance } = setup({ maxRetained: 0, retainMs: 0 });
    queries.attach("songs", SONGS, { visible: false, onChange: () => {} });
    answer("songs", "s1");
    advance(60_000);
    assert.equal(queries.current("songs")?.value, "s1");
  });
});
