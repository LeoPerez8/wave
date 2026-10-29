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
