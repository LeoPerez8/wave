import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  RECOGNIZE_CARD_ACTION_LABELS,
  recognizeCardView,
  recognizeHoldsPlayback,
  recognizeLogLine,
  startRecognize,
  stepRecognize,
  type RecognizeCardView,
  type RecognizedSong,
  type RecognizeEvent,
  type RecognizeFailure,
  type RecognizeLogOutcome,
  type RecognizeSession,
  type RecognizeStep,
} from "./index.ts";

/** Runs [events] from a new microphone session; the last step. */
const run = (...events: readonly RecognizeEvent[]): RecognizeStep =>
  events.reduce<RecognizeStep>((step, event) => stepRecognize(step.session, event), {
    session: startRecognize("microphone"),
    ask: null,
  });

/** The asks [events] make, in order, as the seconds heard when each went out. */
const asks = (...events: readonly RecognizeEvent[]): readonly number[] => {
  let session: RecognizeSession = startRecognize("microphone");
  const at: number[] = [];
  for (const event of events) {
    const step = stepRecognize(session, event);
    if (step.ask !== null) at.push(step.session.heardMs / 1000);
    session = step.session;
  }
  return at;
};

const heard = (seconds: number): RecognizeEvent => ({ kind: "heard", ms: seconds * 1000 });
const noMatch: RecognizeEvent = { kind: "answer", answer: { kind: "noMatch" } };
const cancel: RecognizeEvent = { kind: "cancel" };
const failed = (failure: RecognizeFailure, status: number | null = null): RecognizeEvent => ({
  kind: "answer",
  answer: { kind: "failed", failure, status },
});

const SONG: RecognizedSong = {
  title: "I Will Survive",
  artist: "Gloria Gaynor",
  album: "Love Tracks",
  coverUrl: "https://is1-ssl.mzstatic.com/image/thumb/cover/400x400cc.jpg",
  isrc: "USUR10200634",
  releaseYear: 1978,
};
const match: RecognizeEvent = { kind: "answer", answer: { kind: "match", song: SONG } };

describe("the listening schedule", () => {
  test("asks for the first time once 4 seconds are heard", () => {
    let step = stepRecognize(startRecognize("microphone"), { kind: "heard", ms: 3_750 });
    assert.equal(step.ask, null);
    step = stepRecognize(step.session, { kind: "heard", ms: 4_000 });
    assert.deepEqual(step.ask, { last: false });
  });

  test("waits for an answer before asking again", () => {
    assert.deepEqual(asks(heard(4), heard(8), heard(9)), [4]);
  });

  test("a no match keeps listening and asks again at 8 and 12 seconds", () => {
    assert.deepEqual(asks(heard(4), noMatch, heard(6), heard(8), noMatch, heard(12)), [4, 8, 12]);
  });

  test("an answer that comes after the next step was heard asks again at once", () => {
    assert.deepEqual(asks(heard(4), heard(8.5), noMatch), [4, 8.5]);
  });

  test("only the third ask is the last", () => {
    const last = run(heard(4), noMatch, heard(8), noMatch, heard(12));
    assert.deepEqual(last.ask, { last: true });
    assert.deepEqual(run(heard(4), noMatch, heard(8)).ask, { last: false });
  });
});

describe("the session's end", () => {
  test("goes on until something ends it", () => {
    assert.equal(run(heard(4), noMatch, heard(8)).session.ended, null);
  });

  test("a match at any step ends it with the song", () => {
    for (const events of [
      [heard(4), match],
      [heard(4), noMatch, heard(8), match],
      [heard(4), noMatch, heard(8), noMatch, heard(12), match],
    ]) {
      assert.deepEqual(run(...events).session.ended, { kind: "match", song: SONG });
    }
  });

  test("no match at 12 seconds ends it with no match", () => {
    const end = run(heard(4), noMatch, heard(8), noMatch, heard(12), noMatch);
    assert.deepEqual(end.session.ended, { kind: "noMatch" });
    assert.equal(end.session.heardMs, 12_000);
  });

  test("a failed ask ends it with its failure, never as no match", () => {
    assert.deepEqual(run(heard(4), failed("network")).session.ended, {
      kind: "failed",
      failure: "network",
      status: null,
    });
    // Even the last ask: a refusal isn't a song Shazam doesn't know.
    const refused = run(heard(4), noMatch, heard(8), noMatch, heard(12), failed("refused", 429));
    assert.deepEqual(refused.session.ended, { kind: "failed", failure: "refused", status: 429 });
  });

  test("a capture that stops ends it as a failure", () => {
    assert.deepEqual(run(heard(2), { kind: "captureFailed" }).session.ended, {
      kind: "failed",
      failure: "capture",
      status: null,
    });
  });

  test("Cancel ends it at any point", () => {
    for (const events of [
      [cancel],
      [heard(2), cancel],
      [heard(4), cancel],
      [heard(4), noMatch, heard(9), cancel],
      [heard(4), noMatch, heard(8), noMatch, heard(12), cancel],
    ]) {
      assert.deepEqual(run(...events).session.ended, { kind: "cancelled" });
    }
  });

  test("nothing changes it once it has ended", () => {
    const cancelled = run(heard(4), cancel);
    for (const event of [match, noMatch, heard(8), { kind: "captureFailed" } as const]) {
      const after = stepRecognize(cancelled.session, event);
      assert.deepEqual(after.session.ended, { kind: "cancelled" });
      assert.equal(after.ask, null);
    }
    assert.deepEqual(stepRecognize(run(heard(4), match).session, cancel).session.ended, {
      kind: "match",
      song: SONG,
    });
  });

  test("a capture that stops after the last ask went out doesn't end it", () => {
    const last = run(heard(4), noMatch, heard(8), noMatch, heard(12), { kind: "captureFailed" });
    assert.equal(last.session.ended, null);
    assert.deepEqual(stepRecognize(last.session, match).session.ended, {
      kind: "match",
      song: SONG,
    });
  });
});

const labels = (view: RecognizeCardView): readonly string[] =>
  view.actions.map((action) => RECOGNIZE_CARD_ACTION_LABELS[action]);

describe("the card", () => {
  test("says it's listening over the wave, with Cancel", () => {
    const view = recognizeCardView({ kind: "listening" });
    assert.equal(view.title, "Listening…");
    assert.equal(view.listening, true);
    assert.equal(view.cover, false);
    assert.deepEqual(labels(view), ["Cancel"]);
  });

  test("shows the song's cover, title, artist and album, with Done", () => {
    const view = recognizeCardView({ kind: "ended", end: { kind: "match", song: SONG } });
    assert.equal(view.title, "I Will Survive");
    assert.deepEqual(view.lines, ["Gloria Gaynor", "Love Tracks"]);
    assert.equal(view.cover, true);
    assert.equal(view.coverUrl, SONG.coverUrl);
    assert.equal(view.listening, false);
    assert.deepEqual(labels(view), ["Done"]);
  });

  test("leaves out an album Shazam doesn't name", () => {
    const view = recognizeCardView({
      kind: "ended",
      end: { kind: "match", song: { ...SONG, album: null, coverUrl: null } },
    });
    assert.deepEqual(view.lines, ["Gloria Gaynor"]);
    assert.equal(view.coverUrl, null);
  });

  test("says No match, with Try Again", () => {
    const view = recognizeCardView({ kind: "ended", end: { kind: "noMatch" } });
    assert.equal(view.title, "No match");
    assert.equal(view.cover, false);
    assert.deepEqual(labels(view), ["Close", "Try Again"]);
  });

  test("says No connection, with Try Again", () => {
    const view = recognizeCardView({ kind: "offline" });
    assert.equal(view.title, "No connection");
    assert.deepEqual(labels(view), ["Close", "Try Again"]);
  });

  test("says the microphone is off and opens Wave's settings", () => {
    const view = recognizeCardView({ kind: "denied" });
    assert.equal(view.title, "Microphone access is off");
    assert.match(view.lines.join(" "), /settings/i);
    assert.deepEqual(labels(view), ["Close", "Open Settings"]);
  });

  test("says a failure is a failure, never No match", () => {
    for (const failure of ["network", "refused", "unreadable", "capture"] as const) {
      const view = recognizeCardView({
        kind: "ended",
        end: { kind: "failed", failure, status: failure === "refused" ? 429 : null },
      });
      assert.equal(view.title, "Couldn't recognize the song");
      assert.equal(view.lines.length, 1);
      assert.deepEqual(labels(view), ["Close", "Try Again"]);
    }
  });
});

const line = (outcome: RecognizeLogOutcome, heardMs: number): string =>
  recognizeLogLine({ source: "microphone", heardMs, outcome });

describe("the app log's line", () => {
  test("names the source, the seconds heard and the outcome", () => {
    assert.equal(
      line({ kind: "match", song: SONG }, 4_096),
      "Recognize through the microphone: a match after 4.1 s",
    );
    assert.equal(
      line({ kind: "noMatch" }, 12_000),
      "Recognize through the microphone: no match after 12.0 s",
    );
    assert.equal(
      line({ kind: "failed", failure: "refused", status: 429 }, 4_000),
      "Recognize through the microphone: failed after 4.0 s (refused, HTTP 429)",
    );
    assert.equal(
      line({ kind: "failed", failure: "network", status: null }, 8_000),
      "Recognize through the microphone: failed after 8.0 s (network)",
    );
    assert.equal(
      line({ kind: "cancelled" }, 2_340),
      "Recognize through the microphone: cancelled after 2.3 s",
    );
    assert.equal(
      line({ kind: "offline" }, 0),
      "Recognize through the microphone: offline, nothing heard",
    );
    assert.equal(
      line({ kind: "denied" }, 0),
      "Recognize through the microphone: microphone permission denied, nothing heard",
    );
  });

  test("never holds the song", () => {
    const written = line({ kind: "match", song: SONG }, 4_000);
    for (const field of [SONG.title, SONG.artist, SONG.album!, SONG.isrc!]) {
      assert.equal(written.includes(field), false, field);
    }
  });
});

describe("Wave's own playback", () => {
  test("pauses while the microphone listens", () => {
    assert.equal(recognizeHoldsPlayback("microphone"), true);
  });
});
