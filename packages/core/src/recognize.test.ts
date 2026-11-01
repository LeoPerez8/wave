import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { catalogueOf } from "./localisation.ts";
import {
  RECOGNIZE_CARD_ACTION_LABELS,
  recognizeCardActionLabels,
  recognizeCardView,
  recognizeHoldsPlayback,
  recognizeLogLine,
  recognizeSource,
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

describe("the audio source", () => {
  test("audible phone audio and a silent microphone still follow the recognition schedule", () => {
    for (const [source, audible] of [
      ["playback", true],
      ["microphone", false],
    ] as const) {
      const step = stepRecognize(startRecognize(source), { kind: "heard", ms: 4_000, audible });
      assert.deepEqual(step.ask, { last: false });
      assert.equal(step.session.ended, null);
    }
  });

  test("blocked capture offers the microphone and declining consent never says No match", () => {
    const blocked = recognizeCardView({ kind: "ended", end: { kind: "blocked" } });
    assert.equal(blocked.title, "This app blocks audio capture");
    assert.deepEqual(labels(blocked), ["Close", "Use Microphone"]);
    const declined = stepRecognize(startRecognize("playback"), { kind: "consentDeclined" });
    assert.deepEqual(declined.session.ended, { kind: "consentDeclined" });
    assert.equal(
      recognizeCardView({ kind: "ended", end: { kind: "consentDeclined" } }).title,
      "Phone audio access declined",
    );
    assert.equal(
      recognizeLogLine({ source: "playback", heardMs: 4_000, outcome: { kind: "blocked" } }),
      "Recognize through this phone: app blocks capture after 4.0 s",
    );
  });
  test("switching to the phone starts a fresh schedule and ignores the earlier answer", () => {
    const previous = stepRecognize(startRecognize("microphone"), { kind: "heard", ms: 8_000 });
    assert.equal(previous.session.asking, true);
    let next = startRecognize("playback");
    next = stepRecognize(next, { kind: "answer", answer: { kind: "noMatch" } }).session;
    assert.equal(next.ended, null);
    assert.equal(stepRecognize(next, { kind: "heard", ms: 3_750 }).ask, null);
    const first = stepRecognize(next, { kind: "heard", ms: 4_000 });
    assert.equal(first.session.asked, 1);
    assert.deepEqual(first.ask, { last: false });
  });

  test("silent phone audio ends at the first window as blocked capture without asking", () => {
    const early = stepRecognize(startRecognize("playback"), {
      kind: "heard",
      ms: 3_750,
      audible: false,
    });
    assert.equal(early.session.ended, null);
    const blocked = stepRecognize(early.session, { kind: "heard", ms: 4_000, audible: false });
    assert.deepEqual(blocked.session.ended, { kind: "blocked" });
    assert.equal(blocked.ask, null);
  });
  test("chooses the phone when another media player is active, discounting Wave", () => {
    assert.equal(recognizeSource({ activeMediaPlayers: 1, waveMediaPlayers: 0 }), "playback");
    assert.equal(recognizeSource({ activeMediaPlayers: 2, waveMediaPlayers: 1 }), "playback");
    assert.equal(recognizeSource({ activeMediaPlayers: 1, waveMediaPlayers: 1 }), "microphone");
    assert.equal(recognizeSource({ activeMediaPlayers: 0, waveMediaPlayers: 0 }), "microphone");
    assert.equal(recognizeSource({ activeMediaPlayers: 2, waveMediaPlayers: 2 }), "microphone");
    assert.equal(recognizeHoldsPlayback("playback"), false);
  });
});

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
/** The controller's clock at [seconds], with Wave in the foreground or not. */
const tick = (seconds: number, foreground = true): RecognizeEvent => ({
  kind: "tick",
  atMs: seconds * 1000,
  foreground,
});
const captureFailed: RecognizeEvent = { kind: "captureFailed" };
const CAPTURE_FAILED = { kind: "failed", failure: "capture", status: null } as const;
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

  test("a capture that stops ends it as a failure once Wave stays in the foreground for a second", () => {
    const stopped = run(tick(1), heard(2), tick(2), captureFailed);
    assert.equal(stopped.session.ended, null);
    assert.equal(stepRecognize(stopped.session, tick(2.5)).session.ended, null);
    assert.deepEqual(stepRecognize(stopped.session, tick(3)).session.ended, CAPTURE_FAILED);
  });

  test("a capture that stops as Wave leaves the foreground ends it as Cancel", () => {
    // Hiding Wave stops the capture, and either report may reach JS first.
    const stopped = run(tick(1), heard(2), tick(2), captureFailed);
    assert.deepEqual(stepRecognize(stopped.session, tick(2.5, false)).session.ended, {
      kind: "cancelled",
    });
    const pending = run(tick(1), heard(4), tick(2), captureFailed);
    assert.equal(pending.session.asking, true);
    assert.deepEqual(stepRecognize(pending.session, tick(4.5, false)).session.ended, {
      kind: "cancelled",
    });
  });

  test("a capture that stops while an ask is out waits for its answer", () => {
    const stopped = run(tick(0), heard(4), heard(5), tick(1), captureFailed, tick(9));
    assert.equal(stopped.session.ended, null);
    assert.deepEqual(stepRecognize(stopped.session, match).session.ended, {
      kind: "match",
      song: SONG,
    });
    // No more audio is coming, so a no match can't wait for the next step.
    const none = stepRecognize(stopped.session, noMatch);
    assert.deepEqual(none.session.ended, CAPTURE_FAILED);
    assert.equal(none.ask, null);
    assert.deepEqual(stepRecognize(stopped.session, failed("refused", 429)).session.ended, {
      kind: "failed",
      failure: "refused",
      status: 429,
    });
  });

  test("a no match that comes soon after the capture stopped still waits out the second", () => {
    const stopped = run(tick(0), heard(4), heard(8), tick(1), captureFailed, noMatch);
    assert.equal(stopped.session.ended, null);
    assert.equal(stopped.ask, null);
    assert.deepEqual(stepRecognize(stopped.session, tick(2)).session.ended, CAPTURE_FAILED);
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

describe("a failed request", () => {
  test("a 429 at the first step keeps listening and the next step's match ends it", () => {
    const refused = run(heard(4), failed("refused", 429));
    assert.equal(refused.session.ended, null);
    assert.equal(refused.ask, null);
    const next = stepRecognize(refused.session, heard(8));
    assert.deepEqual(next.ask, { last: false });
    assert.deepEqual(stepRecognize(next.session, match).session.ended, {
      kind: "match",
      song: SONG,
    });
  });

  test("a 5xx or no answer before the last step also waits for the next step", () => {
    for (const failure of [failed("refused", 500), failed("refused", 503), failed("network")]) {
      assert.deepEqual(asks(heard(4), failure, heard(6), heard(8), failure, heard(12)), [4, 8, 12]);
    }
  });

  /** A session whose last step's request went out at 4 seconds on the clock. */
  const lastStep = [tick(0), heard(4), noMatch, tick(2), heard(8), noMatch, tick(4), heard(12)];

  test("the last step retries after growing delays, then ends as that failure", () => {
    const refused = failed("refused", 429);
    const first = run(...lastStep, refused);
    assert.equal(first.session.ended, null);
    assert.equal(first.ask, null);
    assert.equal(stepRecognize(first.session, tick(4.5)).ask, null);

    const second = run(...lastStep, refused, tick(5));
    assert.deepEqual(second.ask, { last: true });
    assert.equal(run(...lastStep, refused, tick(5), refused, tick(6.5)).ask, null);

    const third = [...lastStep, refused, tick(5), refused, tick(7)];
    assert.deepEqual(run(...third).ask, { last: true });
    assert.equal(run(...third, refused, tick(10.5)).ask, null);

    const fourth = [...third, refused, tick(11)];
    assert.deepEqual(run(...fourth).ask, { last: true });

    // The next delay would pass the limit Core sets for the card's wait.
    assert.deepEqual(run(...fourth, refused).session.ended, {
      kind: "failed",
      failure: "refused",
      status: 429,
    });
  });

  test("a request that takes long to fail uses up the last step's wait", () => {
    const slow = run(...lastStep, tick(14), failed("network"));
    assert.deepEqual(slow.session.ended, { kind: "failed", failure: "network", status: null });
  });

  test("a retry's answer ends the session as any last answer does", () => {
    const retried = [...lastStep, failed("network"), tick(5)];
    assert.deepEqual(run(...retried, match).session.ended, { kind: "match", song: SONG });
    assert.deepEqual(run(...retried, noMatch).session.ended, { kind: "noMatch" });
    assert.deepEqual(run(...retried, failed("unreadable")).session.ended, {
      kind: "failed",
      failure: "unreadable",
      status: null,
    });
  });

  test("any other failure ends it at once, at any step", () => {
    for (const [failure, status] of [
      ["refused", 400],
      ["refused", 403],
      ["refused", 404],
      ["refused", null],
      ["unreadable", null],
      ["capture", null],
    ] as const) {
      const ended = { kind: "failed", failure, status };
      assert.deepEqual(run(heard(4), failed(failure, status)).session.ended, ended);
      const last = run(...lastStep, failed(failure, status));
      assert.deepEqual(last.session.ended, ended);
      assert.equal(last.ask, null);
    }
  });

  test("a capture failure before the last step ends it even after a retryable failure", () => {
    const stopped = run(tick(0), heard(4), failed("refused", 429), tick(1), captureFailed, tick(2));
    assert.deepEqual(stopped.session.ended, CAPTURE_FAILED);
  });

  test("Cancel during a backoff ends it, and neither the clock nor a late answer moves it", () => {
    const waiting = run(...lastStep, failed("refused", 503));
    const cancelled = stepRecognize(waiting.session, cancel);
    assert.deepEqual(cancelled.session.ended, { kind: "cancelled" });
    const later = stepRecognize(cancelled.session, tick(5));
    assert.equal(later.ask, null);
    assert.deepEqual(stepRecognize(later.session, match).session.ended, { kind: "cancelled" });
  });

  test("a backoff waits only while Wave is in the foreground", () => {
    const hidden = run(...lastStep, failed("network"), tick(9, false));
    assert.equal(hidden.ask, null);
    assert.equal(hidden.session.ended, null);
    assert.deepEqual(stepRecognize(hidden.session, tick(10)).ask, { last: true });
  });

  test("a no match followed by a failure on the last step ends as the failure, never No match", () => {
    const ended = run(...lastStep, failed("refused", 400));
    assert.deepEqual(ended.session.ended, { kind: "failed", failure: "refused", status: 400 });
  });
});

describe("a session that stalls", () => {
  test("audio that stops advancing for 3 seconds ends it as a capture failure", () => {
    const quiet = run(tick(0), tick(1), heard(1), tick(3.5));
    assert.equal(quiet.session.ended, null);
    assert.deepEqual(stepRecognize(quiet.session, tick(4)).session.ended, CAPTURE_FAILED);
    // Each step of audio starts the wait again.
    const going = run(tick(0), tick(2), heard(1), tick(4), heard(2), tick(6), heard(3), tick(8));
    assert.equal(going.session.ended, null);
  });

  test("a capture that never starts ends after 3 seconds", () => {
    assert.equal(run(tick(0), tick(2.5)).session.ended, null);
    assert.deepEqual(run(tick(0), tick(3)).session.ended, CAPTURE_FAILED);
  });

  test("time while Wave is hidden, behind Android's consent dialog, doesn't count", () => {
    const consent = run(tick(0), tick(1, false), tick(30, false), tick(32));
    assert.equal(consent.session.ended, null);
    assert.deepEqual(stepRecognize(consent.session, tick(33)).session.ended, CAPTURE_FAILED);
  });

  test("once every step's audio is heard, only the asks are waited for", () => {
    const heardAll = run(tick(0), heard(4), heard(12), tick(12), tick(20));
    assert.equal(heardAll.session.ended, null);
    const last = run(tick(0), heard(4), noMatch, heard(8), noMatch, heard(12), tick(12), tick(20));
    assert.equal(last.session.ended, null);
    assert.deepEqual(stepRecognize(last.session, match).session.ended, {
      kind: "match",
      song: SONG,
    });
  });

  test("an ask unanswered for 35 seconds ends it as no answer", () => {
    const asked = run(tick(0), heard(4), noMatch, heard(8), noMatch, tick(2), heard(12));
    assert.deepEqual(asked.ask, { last: true });
    assert.equal(stepRecognize(asked.session, tick(36.5)).session.ended, null);
    assert.deepEqual(stepRecognize(asked.session, tick(37)).session.ended, {
      kind: "failed",
      failure: "network",
      status: null,
    });
  });

  test("a clock that goes back changes nothing", () => {
    const back = run(tick(10), heard(1), tick(5), tick(7));
    assert.equal(back.session.ended, null);
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
const logged = (outcome: RecognizeLogOutcome, failedAsks: number): string =>
  recognizeLogLine({ source: "microphone", heardMs: 8_000, outcome, failedAsks });

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

  test("says how many requests failed before the outcome", () => {
    assert.equal(
      logged({ kind: "match", song: SONG }, 1),
      "Recognize through the microphone: a match after 8.0 s, 1 request failed before it",
    );
    assert.equal(
      logged({ kind: "failed", failure: "refused", status: 429 }, 3),
      "Recognize through the microphone: failed after 8.0 s (refused, HTTP 429), 3 requests failed before it",
    );
    assert.equal(
      recognizeLogLine({
        source: "microphone",
        heardMs: 8_000,
        outcome: { kind: "match", song: SONG },
        failedAsks: 2,
        lookup: "library",
      }),
      "Recognize through the microphone: a match after 8.0 s, 2 requests failed before it, YT Music lookup: library",
    );
    assert.equal(
      logged({ kind: "noMatch" }, 0),
      "Recognize through the microphone: no match after 8.0 s",
    );
  });

  test("a session counts the failed requests it went on from", () => {
    assert.equal(startRecognize("microphone").failedAsks, 0);
    const refused = failed("refused", 429);
    const going = run(heard(4), refused, heard(8), refused, heard(12), failed("network"));
    assert.equal(going.session.ended, null);
    assert.equal(going.session.failedAsks, 3);
    // The failure that ends a session is its outcome, not a failure before it.
    assert.equal(run(heard(4), failed("unreadable")).session.failedAsks, 0);
    assert.equal(run(heard(4), refused, heard(8), failed("unreadable")).session.failedAsks, 1);
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

test("Recognize's buttons follow the app language", () => {
  const labels = recognizeCardActionLabels(catalogueOf("pt-BR"));
  assert.equal(labels.listenAgain, "Ouvir Novamente");
  assert.equal(labels.done, "OK");
  assert.equal(recognizeCardActionLabels().listenAgain, "Listen Again");
});

test("Recognize's listening and failure messages follow the app language", () => {
  const pt = catalogueOf("pt-BR");
  assert.equal(recognizeCardView({ kind: "listening" }, undefined, pt).title, "Ouvindo…");
  assert.deepEqual(recognizeCardView({ kind: "offline" }, undefined, pt).lines, [
    "Conecte-se à internet para reconhecer uma música.",
  ]);
  assert.equal(
    recognizeCardView(
      { kind: "ended", end: { kind: "failed", failure: "capture", status: null } },
      undefined,
      pt,
    ).lines[0],
    "A captura de áudio parou de enviar som.",
  );
});
