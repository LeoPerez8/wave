import assert from "node:assert/strict";
import { test } from "node:test";
import { createTimingSession } from "./timingSession.ts";

const setup = (
  context: () => { background: readonly string[]; offline: boolean } = () => ({
    background: [],
    offline: false,
  }),
) => {
  let now = 0;
  let wall = new Date(2026, 9, 22, 14, 2).getTime();
  const lines: string[] = [];
  const events: string[] = [];
  const session = createTimingSession({
    now: () => now,
    wallNow: () => wall,
    write: (line) => lines.push(line),
    context,
    build: () => ({ version: "test", commit: "abc1234" }),
  });
  session.onTransition((event) => events.push(`${event.id}:${event.phase}`));
  return {
    session,
    lines,
    events,
    at: (time: number) => {
      now = time;
    },
    wallAt: (time: number) => {
      wall = time;
    },
    wall: () => wall,
  };
};

test("settled needs transition end AND content drawn, in either order, only once", () => {
  for (const contentFirst of [true, false]) {
    const { session, at, events, lines } = setup();
    const id = session.begin("push", "/artist/12");
    at(20);
    session.response(id);
    at(30);
    session.frame(id);
    at(40);
    (contentFirst ? session.content : session.end)(id);
    assert.equal(session.isSettled(), false);
    at(50);
    (contentFirst ? session.end : session.content)(id);
    assert.equal(session.isSettled(), true);
    assert.deepEqual(events, [`${id}:start`, `${id}:settled`]);
    session.end(id);
    session.content(id);
    assert.equal(events.length, 2);
    assert.deepEqual(lines, []);
  }
});

test("superseding a transition cancels its counters and ignores stale draw/end callbacks", () => {
  const { session, at, events, lines } = setup();
  const first = session.begin("push", "/first");
  at(10);
  const last = session.begin("tab", "/last");
  session.response(first);
  session.frame(first);
  session.content(first);
  session.end(first);
  assert.equal(session.isSettled(), false);
  assert.deepEqual(events, [`${first}:start`, `${first}:cancelled`, `${last}:start`]);
  at(30);
  session.response(last);
  session.frame(last);
  session.content(last);
  session.end(last);
  assert.equal(session.isSettled(), true);
  assert.deepEqual(lines, []);
});

test("a tap that opened nothing ends unmeasured and the screen under it is settled again", () => {
  const { session, events, lines } = setup();
  const page = session.routeCommitted("/library/artist/3")!;
  session.frame(page);
  session.content(page);
  session.end(page);
  let released = 0;
  session.onSettled(() => {
    if (session.isSettled()) released++;
  });
  const tap = session.begin("goToArtist", "Artist");
  assert.equal(session.isSettled(), false);
  session.dismiss(tap + 1);
  assert.equal(session.active()?.id, tap, "another id cannot end it");
  session.dismiss(tap);
  assert.equal(session.active(), null);
  assert.equal(session.isSettled(), true);
  assert.equal(released, 1);
  assert.deepEqual(events, [`${tap}:start`, `${tap}:cancelled`]);
  session.dismiss(tap);
  session.response(tap);
  assert.equal(released, 1);
  assert.deepEqual(lines, []);
});

test("slow tap and screen record different milestones and summary retains throttled samples", () => {
  const { session, at, wallAt, wall, lines } = setup();
  session.routeCommitted("/albums");
  const id = session.begin("push", "/artist/12");
  at(120);
  session.response(id);
  at(180);
  session.frame(id);
  at(1400);
  session.content(id);
  at(1500);
  session.end(id);
  session.leave();
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, /response 120 ms, first frame 180 ms, settled 1.5 s/);
  assert.match(lines[1]!, /content 1.4 s/);
  assert.match(lines[2]!, /1 taps; push 1 median 120 ms p90 120 ms/);
  at(2000);
  const second = session.begin("tab", "/songs");
  at(2020);
  session.response(second);
  session.frame(second);
  session.content(second);
  session.end(second);
  const base = wall();
  wallAt(base + 299999);
  session.leave();
  assert.equal(lines.length, 3);
  wallAt(base + 300000);
  session.leave();
  assert.equal(lines.length, 4);
  assert.match(lines[3]!, /tab 1 median 20 ms p90 20 ms/);
  wallAt(base + 600000);
  session.leave();
  assert.equal(lines.length, 4);
});

test("cold-launch screens settle without a fake tap or summary", () => {
  const { session, at, lines } = setup();
  const id = session.routeCommitted("/")!;
  at(20);
  session.frame(id);
  session.end(id);
  at(401);
  session.content(id);
  assert.equal(session.isSettled(), true);
  session.leave();
  assert.deepEqual(lines, [
    "Slow screen /: first frame 20 ms, content 401 ms (budget 150 ms / 400 ms); reads: none",
  ]);
});

test("reads, JS blocks, missed frames and hitches join the opening and speed summary", () => {
  const { session, at, lines } = setup();
  const id = session.begin("push", "/artist/12");
  session.jsBlock(-30, 10); // Before the touch: not this transition's block.
  session.jsBlock(20, 380);
  session.read("artist", 45);
  session.hitch(800);
  session.onTransition((event) => {
    if (event.phase === "settled") session.frames(event.id, 3);
  });
  at(410);
  session.response(id);
  session.frame(id);
  session.content(id);
  session.end(id);
  session.leave();
  assert.match(lines[0]!, /longest JS block 380 ms$/);
  assert.match(lines[1]!, /reads: artist 45 ms$/);
  assert.match(lines[2]!, /missed frames 3/);
  assert.match(lines[2]!, /hitches 1 \(longest 800 ms\)/);
});

test("late UI frame totals reach the same screen summary", () => {
  const { session, at, lines } = setup();
  const id = session.begin("push", "/last");
  at(20);
  session.response(id);
  session.frame(id);
  session.content(id);
  session.end(id);
  session.frames(id, 4);
  session.leave();
  assert.match(lines[0]!, /missed frames 4/);
});

test("a settled listener can navigate without the old completion erasing the new transition", () => {
  const { session, at } = setup();
  const id = session.begin("push", "/first");
  let next = 0;
  session.onTransition((event) => {
    if (event.id === id && event.phase === "settled") next = session.begin("push", "/next");
  });
  at(20);
  session.response(id);
  session.frame(id);
  session.content(id);
  session.end(id);
  assert.equal(session.active()?.id, next);
  assert.equal(session.isSettled(), false);
});

test("an intermediate tab commit cannot become the last tap's destination or first frame", () => {
  const { session, at, lines } = setup();
  const id = session.begin("tab", "/(tabs)/songs");
  at(10);
  assert.equal(session.routeCommitted("/library"), null);
  assert.equal(session.active()?.to, "/(tabs)/songs");
  at(130);
  assert.equal(session.routeCommitted("/songs"), id);
  at(160);
  session.frame(id);
  session.content(id);
  session.end(id);
  assert.match(lines[0]!, /to \/songs from \/: response 130 ms, first frame 160 ms/);
});

test("a pushed screen committed on the way to a section tab is intermediate", () => {
  const { session, at, lines } = setup();
  const id = session.begin("tab", "/(tabs)/songs");
  at(10);
  assert.equal(session.routeCommitted("/library/album/12"), null);
  assert.equal(session.active()?.to, "/(tabs)/songs");
  at(130);
  assert.equal(session.routeCommitted("/songs"), id);
  at(160);
  session.frame(id);
  session.content(id);
  session.end(id);
  assert.match(lines[0]!, /to \/songs from \/: response 130 ms, first frame 160 ms/);
});

test("switching to Home or Search with a pushed screen still settles the tab timing", () => {
  for (const target of ["/", "/(tabs)/search"]) {
    const { session, at, lines } = setup();
    const id = session.begin("tab", target);
    at(120);
    assert.equal(session.routeCommitted("/library/album/12"), id);
    at(180);
    session.frame(id);
    session.content(id);
    session.end(id);
    assert.equal(session.isSettled(), true);
    assert.match(lines[0]!, /to \/library\/album\/12.*settled 180 ms/);
  }
});

test("rapidly superseded taps still count without inventing response timestamps", () => {
  const { session, at, lines } = setup();
  session.begin("push", "/first");
  at(10);
  const last = session.begin("tab", "/last");
  at(30);
  session.response(last);
  session.frame(last);
  session.content(last);
  session.end(last);
  session.leave();
  assert.match(lines[0]!, /2 taps/);
  assert.match(lines[0]!, /push 1 response not observed/);
  assert.match(lines[0]!, /tab 1 median 20 ms p90 20 ms/);
});

test("a measured response survives cancellation even when the screen never finished", () => {
  const { session, at, lines } = setup();
  const first = session.begin("push", "/first");
  at(101);
  session.response(first);
  at(110);
  const last = session.begin("tab", "/last");
  at(130);
  session.response(last);
  session.frame(last);
  session.content(last);
  session.end(last);
  session.leave();
  assert.match(lines[0]!, /push 1 median 101 ms p90 101 ms/);
  assert.match(lines[0]!, /slow 1/);
});

test("work that started and ended within the tap window and offline state are retained", () => {
  let background = ["scan"];
  let offline = false;
  const { session, at, lines } = setup(() => ({ background, offline }));
  const id = session.begin("push", "/artist/12");
  background = ["import", "3 downloads", "Magic Queue batch"];
  offline = true;
  session.backgroundChanged();
  background = [];
  offline = false;
  at(1200);
  session.response(id);
  session.frame(id);
  session.content(id);
  session.end(id);
  assert.match(
    lines[0]!,
    /meanwhile: scan, import, 3 downloads, Magic Queue batch; offline; longest JS block 0 ms$/,
  );
});

test("the real slow-read boundary contributes its operation to the opening screen", async (t) => {
  const { connectLibraryReadLog, onSlowLibraryRead, timeLibraryRead } =
    await import("../log/slowLibraryReads.ts");
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const lines: string[] = [];
  const session = createTimingSession({
    now: () => now,
    wallNow: () => 0,
    write: (line) => lines.push(line),
    context: () => ({ background: [], offline: false }),
    build: () => ({ version: "test", commit: "abc1234" }),
  });
  const flush = connectLibraryReadLog({ route: session.route, write: (line) => lines.push(line) });
  const stop = onSlowLibraryRead((read) => session.read(read.operation, read.durationMs));
  t.after(() => {
    stop();
    flush();
  });
  const id = session.begin("push", "/artist/12");
  session.routeCommitted("/artist/12");
  session.frame(id);
  assert.deepEqual(
    timeLibraryRead("artist songs", () => {
      now = 450;
      return [1, 2];
    }),
    [1, 2],
  );
  session.content(id);
  session.end(id);
  assert.match(
    lines.find((line) => line.startsWith("Slow screen"))!,
    /reads: artist songs 450 ms$/,
  );
  flush();
  assert.match(lines.at(-1)!, /Read "artist songs" held JS 450 ms \(2 rows\) on \/artist\/12$/);
});

/** A pop drawn 20 ms after it began, as the phone's are (#866). */
const finishPop = (h: ReturnType<typeof setup>, id: number, began: number) => {
  h.at(began + 10);
  h.session.response(id);
  h.at(began + 20);
  h.session.frame(id);
  h.session.content(id);
  h.at(began + 450);
  h.session.end(id);
};

test("a Back press after a scroll counts from itself, not from the scroll (#866)", () => {
  const h = setup();
  h.at(100);
  h.session.touch(100);
  h.at(150);
  h.session.touchEnded(); // The list's native scroll takes the touch over, finger still down.
  h.at(2650);
  assert.equal(h.session.hasTouch(), false);
  const id = h.session.beginTouched("pop", "/playlists");
  finishPop(h, id, 2650);
  assert.deepEqual(h.lines, []);
});

test("a touch lasts 300 ms past its end, then whatever begins counts from now", () => {
  const h = setup();
  h.at(100);
  h.session.touch(100);
  h.at(200);
  h.session.touchEnded();
  h.at(499);
  assert.equal(h.session.hasTouch(), true);
  h.at(500);
  assert.equal(h.session.hasTouch(), false);
});

test("a press whose JS was blocked counts from its touch, however late JS heard the lift", () => {
  const h = setup();
  // Touch at 100, lift at 150; JS was blocked until 900, then hears both and the press together.
  h.at(900);
  h.session.touch(100);
  h.at(905);
  h.session.touchEnded();
  h.at(910);
  const id = h.session.beginTouched("pop", "/playlists");
  finishPop(h, id, 910);
  assert.match(h.lines[0]!, /^Slow pop to \/playlists from \/: response 820 ms/);
});

test("a press handled before the root hears the lift leaves no touch behind", () => {
  const h = setup();
  h.at(100);
  h.session.touch(100);
  h.at(110);
  h.session.beginTouched("pop", "/playlists");
  h.session.touchEnded();
  assert.equal(h.session.hasTouch(), false);
});

test("a new touch doesn't inherit the end of the one before it", () => {
  const h = setup();
  h.at(100);
  h.session.touch(100);
  h.session.touchEnded();
  h.at(1000);
  h.session.touch(1000);
  h.at(2000);
  assert.equal(h.session.hasTouch(), true);
});

test("leaving the app forgets a touch whose end may never come", () => {
  const h = setup();
  h.at(100);
  h.session.touch(100);
  h.session.forgetTouch();
  assert.equal(h.session.hasTouch(), false);
});

test("an on-screen press counts from its touch, which it uses up", () => {
  const h = setup();
  h.at(100);
  h.session.touch(90);
  assert.equal(h.session.hasTouch(), true);
  h.at(3000);
  const id = h.session.beginTouched("pop", "/playlists");
  assert.equal(h.session.hasTouch(), false);
  finishPop(h, id, 3000);
  assert.match(h.lines[0]!, /^Slow pop to \/playlists from \/: response 2\.9 s/);
  h.lines.length = 0;
  const next = h.session.beginTouched("pop", "/");
  finishPop(h, next, 3450);
  assert.deepEqual(h.lines, []);
});

test("a touch stamped in another clock or a minute ago counts as now", () => {
  for (const stamp of [1_700_000_000_000, 1000]) {
    const h = setup();
    h.at(100_000);
    h.session.touch(stamp);
    const id = h.session.beginTouched("pop", "/playlists");
    finishPop(h, id, 100_000);
    assert.deepEqual(h.lines, []);
  }
});
