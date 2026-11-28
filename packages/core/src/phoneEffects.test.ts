import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_GLASS_SETTINGS,
  EMPTY_FRAME_TALLY,
  effectsVerdict,
  fullGlassNotice,
  glassLayers,
  judgeFrames,
  phoneEffectsLine,
  ownerFullEffects,
  readEffectsVerdict,
  readFullGlassChoice,
  sessionEffects,
  tallyFrames,
  WEAK_PHONE_RULE,
  writeEffectsVerdict,
  writeFullGlassChoice,
  type FrameTally,
} from "./index.ts";

/** [count] half-second windows of [frames] frames whose p95 is [p95FrameMs]. */
const windows = (tally: FrameTally, count: number, p95FrameMs: number, frames = 30): FrameTally => {
  let next = tally;
  for (let i = 0; i < count; i++) next = tallyFrames(next, { frames, p95FrameMs });
  return next;
};

describe("judgeFrames", () => {
  test("says nothing until enough animated windows were measured", () => {
    assert.equal(judgeFrames(EMPTY_FRAME_TALLY), null);
    assert.equal(judgeFrames(windows(EMPTY_FRAME_TALLY, 39, 40)), null);
    assert.equal(judgeFrames(windows(EMPTY_FRAME_TALLY, 40, 40)), "simple");
  });

  test("a phone keeping its frames short gets the full effects", () => {
    // An S24+ scrolling under the glass at 120 Hz: about 8 ms, the odd frame at 20.
    const tally = windows(windows(EMPTY_FRAME_TALLY, 30, 8), 10, 20);
    assert.equal(judgeFrames(tally), "full");
  });

  test("a phone whose frames run past 25 ms in most windows gets the simple effects", () => {
    const tally = windows(windows(EMPTY_FRAME_TALLY, 15, 12), 25, 30);
    assert.equal(judgeFrames(tally), "simple");
  });

  test("half the windows slow is not enough; more than half is", () => {
    assert.equal(judgeFrames(windows(windows(EMPTY_FRAME_TALLY, 20, 12), 20, 30)), "full");
    assert.equal(judgeFrames(windows(windows(EMPTY_FRAME_TALLY, 19, 12), 21, 30)), "simple");
  });

  test("a frame exactly at the slow line isn't slow", () => {
    assert.equal(judgeFrames(windows(EMPTY_FRAME_TALLY, 40, 25)), "full");
    assert.equal(judgeFrames(windows(EMPTY_FRAME_TALLY, 40, 25.1)), "simple");
  });

  test("a window with only a few frames (an idle screen, a one-off redraw) doesn't count", () => {
    const idle = windows(EMPTY_FRAME_TALLY, 100, 60, WEAK_PHONE_RULE.activeFrames - 1);
    assert.equal(judgeFrames(idle), null);
    assert.equal(judgeFrames(windows(idle, 40, 8)), "full");
  });

  test("the rule's numbers are the spec's", () => {
    assert.deepEqual(WEAK_PHONE_RULE, {
      activeFrames: 10,
      slowFrameMs: 25,
      windows: 40,
      slowShare: 0.5,
      recheckDays: 14,
    });
  });
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 21);

describe("sessionEffects", () => {
  test("a phone never measured draws the full effects and measures this session", () => {
    assert.deepEqual(sessionEffects(null, NOW), {
      effects: "full",
      measure: true,
      verdict: null,
      ownerFull: false,
    });
  });

  test("a strong verdict keeps the full effects and measures again", () => {
    const verdict = { effects: "full", counted: 40, slow: 2, judgedAt: NOW - DAY } as const;
    assert.deepEqual(sessionEffects(verdict, NOW), {
      effects: "full",
      measure: true,
      verdict,
      ownerFull: false,
    });
  });

  test("a weak verdict holds the simple effects, unmeasured, for two weeks", () => {
    const verdict = { effects: "simple", counted: 40, slow: 30, judgedAt: NOW - 13 * DAY } as const;
    assert.deepEqual(sessionEffects(verdict, NOW), {
      effects: "simple",
      measure: false,
      verdict,
      ownerFull: false,
    });
  });

  test("after two weeks a weak phone gets one session with the full effects to measure them again", () => {
    const verdict = { effects: "simple", counted: 40, slow: 30, judgedAt: NOW - 14 * DAY } as const;
    assert.deepEqual(sessionEffects(verdict, NOW), {
      effects: "full",
      measure: true,
      verdict,
      ownerFull: false,
    });
  });
});

describe("Full glass, the owner's choice over a weak verdict (#1538)", () => {
  // Noon UTC on 18 Nov: the same day in every time zone the tests run in.
  const weak = {
    effects: "simple",
    counted: 40,
    slow: 30,
    judgedAt: Date.UTC(2026, 10, 18, 12),
  } as const;

  test("the owner's choice draws the full effects and measures nothing", () => {
    assert.deepEqual(sessionEffects(weak, NOW, true), {
      effects: "full",
      measure: false,
      verdict: weak,
      ownerFull: true,
    });
  });

  test("with the owner's choice the 14-day re-check doesn't run", () => {
    const old = { ...weak, judgedAt: NOW - 40 * DAY };
    assert.deepEqual(sessionEffects(old, NOW, true), {
      effects: "full",
      measure: false,
      verdict: old,
      ownerFull: true,
    });
  });

  test("without a weak verdict there is nothing to choose over: the automatic rule runs", () => {
    assert.deepEqual(sessionEffects(null, NOW, true), sessionEffects(null, NOW));
    const strong = { effects: "full", counted: 40, slow: 2, judgedAt: NOW - DAY } as const;
    assert.deepEqual(sessionEffects(strong, NOW, true), sessionEffects(strong, NOW));
  });

  test("turning it on mid-session brings the full effects back at once, unmeasured", () => {
    const simple = sessionEffects(weak, NOW);
    assert.deepEqual(ownerFullEffects(simple, true), {
      effects: "full",
      measure: false,
      verdict: weak,
      ownerFull: true,
    });
  });

  test("turning it off simplifies at once; the next start follows the verdict and its re-check", () => {
    const old = { ...weak, judgedAt: NOW - 40 * DAY };
    const chosen = sessionEffects(old, NOW, true);
    assert.deepEqual(ownerFullEffects(chosen, false), {
      effects: "simple",
      measure: false,
      verdict: old,
      ownerFull: false,
    });
    assert.deepEqual(sessionEffects(old, NOW, false), {
      effects: "full",
      measure: true,
      verdict: old,
      ownerFull: false,
    });
  });

  test("the choice is kept as on or nothing", () => {
    assert.equal(readFullGlassChoice(writeFullGlassChoice(true)), true);
    assert.equal(writeFullGlassChoice(false), null);
    assert.equal(readFullGlassChoice(null), false);
    assert.equal(readFullGlassChoice("sparkly"), false);
  });

  test("the log line says the owner turned the full effects on", () => {
    assert.equal(
      phoneEffectsLine(sessionEffects(weak, NOW, true), NOW),
      "Phone effects: full (turned on by the owner)",
    );
  });

  test("Appearance tells why the glass was simplified and when, with the switch off", () => {
    const notice = fullGlassNotice(sessionEffects(weak, NOW), "en");
    assert.deepEqual(notice, {
      on: false,
      text: "Wave simplified the glass on Nov 18: this phone dropped frames in most animations, so the glass is the plain surface for now.",
    });
    assert.deepEqual(fullGlassNotice(sessionEffects(weak, NOW), "pt-BR"), {
      on: false,
      text: "O Wave simplificou o vidro em 18 de nov.: este celular perdeu quadros na maioria das animações, então o vidro fica com a superfície simples por enquanto.",
    });
  });

  test("with Full glass on, the notice stays and the switch is on", () => {
    const notice = fullGlassNotice(sessionEffects(weak, NOW, true), "en");
    assert.equal(notice?.on, true);
    assert.equal(
      notice?.text,
      "Wave simplified the glass on Nov 18 because this phone dropped frames in most animations. Full glass brings it back.",
    );
    assert.equal(
      fullGlassNotice(sessionEffects(weak, NOW, true), "pt-BR")?.text,
      "O Wave simplificou o vidro em 18 de nov. porque este celular perdeu quadros na maioria das animações. O Vidro completo traz o efeito de volta.",
    );
  });

  test("a phone drawing the full effects by its own verdict, or never measured, shows nothing new", () => {
    assert.equal(fullGlassNotice(sessionEffects(null, NOW), "en"), null);
    const strong = { effects: "full", counted: 40, slow: 2, judgedAt: NOW - DAY } as const;
    assert.equal(fullGlassNotice(sessionEffects(strong, NOW), "en"), null);
    // The re-check session draws the full effects to measure them: nothing to choose there.
    const due = { ...weak, judgedAt: NOW - 14 * DAY };
    assert.equal(fullGlassNotice(sessionEffects(due, NOW), "en"), null);
  });
});

describe("effects verdicts", () => {
  test("a tally becomes a verdict once it can be judged", () => {
    assert.equal(effectsVerdict({ counted: 39, slow: 39 }, NOW), null);
    assert.deepEqual(effectsVerdict({ counted: 40, slow: 30 }, NOW), {
      effects: "simple",
      counted: 40,
      slow: 30,
      judgedAt: NOW,
    });
  });

  test("a stored verdict reads back as written; anything else reads as none", () => {
    const verdict = { effects: "simple", counted: 41, slow: 30, judgedAt: NOW } as const;
    assert.deepEqual(readEffectsVerdict(writeEffectsVerdict(verdict)), verdict);
    assert.equal(readEffectsVerdict(null), null);
    assert.equal(readEffectsVerdict("{"), null);
    assert.equal(
      readEffectsVerdict('{"effects":"sparkly","counted":1,"slow":0,"judgedAt":1}'),
      null,
    );
  });

  test("the app log says once per start which effects this session draws and why", () => {
    assert.equal(
      phoneEffectsLine(sessionEffects(null, NOW), NOW),
      "Phone effects: full (not measured yet; measuring this session)",
    );
    const strong = { effects: "full", counted: 40, slow: 2, judgedAt: NOW - DAY } as const;
    assert.equal(
      phoneEffectsLine(sessionEffects(strong, NOW), NOW),
      "Phone effects: full (2 of 40 animated windows over 25 ms, 1 day ago; measuring this session)",
    );
    const weak = { effects: "simple", counted: 40, slow: 30, judgedAt: NOW - 3 * DAY } as const;
    assert.equal(
      phoneEffectsLine(sessionEffects(weak, NOW), NOW),
      "Phone effects: simple (30 of 40 animated windows over 25 ms, 3 days ago)",
    );
    const due = { ...weak, judgedAt: NOW - 20 * DAY };
    assert.equal(
      phoneEffectsLine(sessionEffects(due, NOW), NOW),
      "Phone effects: full (30 of 40 animated windows over 25 ms, 20 days ago; measuring this session)",
    );
  });
});

describe("glassLayers on a weak phone", () => {
  test("full effects draw the glass as Settings says", () => {
    assert.deepEqual(glassLayers(DEFAULT_GLASS_SETTINGS, "live", "full"), {
      backdrop: true,
      blur: 24,
      refraction: 12,
      coalesce: false,
      opaque: false,
    });
  });

  test("simple effects draw the glass as the opaque surface, recording no backdrop (#1491)", () => {
    const opaque = { backdrop: false, blur: 0, refraction: 0, coalesce: false, opaque: true };
    assert.deepEqual(glassLayers(DEFAULT_GLASS_SETTINGS, "live", "simple"), opaque);
    assert.deepEqual(
      glassLayers({ blur: 40, refraction: 20, tint: 10, rim: 100 }, "live", "simple"),
      opaque,
    );
  });

  test("a probe still draws the simple glass, so one build compares it with the opaque surface", () => {
    // `blur` is the simple glass #1357 shipped: half the radius, rounded up, and no refraction.
    assert.deepEqual(glassLayers(DEFAULT_GLASS_SETTINGS, "blur", "simple"), {
      backdrop: true,
      blur: 12,
      refraction: 0,
      coalesce: false,
      opaque: false,
    });
    assert.equal(glassLayers({ ...DEFAULT_GLASS_SETTINGS, blur: 15 }, "blur", "simple").blur, 8);
    assert.deepEqual(glassLayers(DEFAULT_GLASS_SETTINGS, "coalesced", "simple"), {
      backdrop: true,
      blur: 12,
      refraction: 0,
      coalesce: true,
      opaque: false,
    });
    assert.deepEqual(glassLayers(DEFAULT_GLASS_SETTINGS, "off", "simple"), {
      backdrop: false,
      blur: 0,
      refraction: 0,
      coalesce: false,
      opaque: false,
    });
  });
});
