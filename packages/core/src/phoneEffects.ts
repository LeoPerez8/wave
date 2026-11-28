import { formatDate } from "./formatting.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";

/**
 * Weak phones get simpler heavy effects (docs/spec.md › Fluidity, #1357).
 * Whether a phone is weak comes from its own frame times, never a model list:
 * the app's frame meter reports half-second windows (frame count and p95 frame
 * time, from Android's FrameMetrics), Wave tallies them and judges once enough
 * animated windows came in.
 *
 * - `full`: the effects as designed (a strong phone looks exactly as before).
 * - `simple`: the glass is the theme's opaque surface (#1491), and Now
 *   Playing's ground changes colour without its crossfade.
 */
export type PhoneEffects = "full" | "simple";

/** The rule, as the spec records it. */
export const WEAK_PHONE_RULE = {
  /** A window counts only with at least this many frames: something was animating. */
  activeFrames: 10,
  /** A window is slow when its p95 frame took longer than this (1.5 frames at 60 Hz). */
  slowFrameMs: 25,
  /** Counted windows needed before judging: 20 s of animation. */
  windows: 40,
  /** The phone is weak when more than this share of the counted windows was slow. */
  slowShare: 0.5,
  /** A weak verdict is measured again, with the full effects, after this many days. */
  recheckDays: 14,
} as const;

/** One half-second window of the frame meter. */
export interface FrameWindow {
  readonly frames: number;
  readonly p95FrameMs: number;
}

/** Counted (animated) windows so far, and how many of them were slow. */
export interface FrameTally {
  readonly counted: number;
  readonly slow: number;
}

export const EMPTY_FRAME_TALLY: FrameTally = { counted: 0, slow: 0 };

/** [tally] with [window] added; a window with too few frames to say anything leaves it as is. */
export const tallyFrames = (tally: FrameTally, window: FrameWindow): FrameTally => {
  if (!(window.frames >= WEAK_PHONE_RULE.activeFrames)) return tally;
  const slow = window.p95FrameMs > WEAK_PHONE_RULE.slowFrameMs;
  return { counted: tally.counted + 1, slow: tally.slow + (slow ? 1 : 0) };
};

/** The effects [tally] calls for; null while it holds too few windows to tell. */
export const judgeFrames = (tally: FrameTally): PhoneEffects | null => {
  if (tally.counted < WEAK_PHONE_RULE.windows) return null;
  return tally.slow > tally.counted * WEAK_PHONE_RULE.slowShare ? "simple" : "full";
};

/** A judged tally, kept on the phone so the next start knows its effects. */
export interface EffectsVerdict {
  readonly effects: PhoneEffects;
  readonly counted: number;
  readonly slow: number;
  /** When it was judged, in ms since the epoch. */
  readonly judgedAt: number;
}

/** [tally] judged at [now]; null while it can't be judged yet. */
export const effectsVerdict = (tally: FrameTally, now: number): EffectsVerdict | null => {
  const effects = judgeFrames(tally);
  return effects === null
    ? null
    : { effects, counted: tally.counted, slow: tally.slow, judgedAt: now };
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What one session draws, fixed at start from the last verdict: Wave's own
 * verdict never changes it mid-session. A phone is measured only while it
 * draws the full effects, so the simple ones can't make a weak phone look
 * strong; a weak verdict is re-measured once it's `recheckDays` old.
 *
 * Over a weak verdict the owner can turn the full effects back on
 * (Settings › Appearance › Full glass, #1538): their choice wins, at once and
 * on every start, and while it's on nothing measures, the re-check included.
 */
export interface SessionEffects {
  readonly effects: PhoneEffects;
  /** Whether this session tallies its frames for the next start's verdict. */
  readonly measure: boolean;
  /** The verdict it started from. */
  readonly verdict: EffectsVerdict | null;
  /** Whether the owner's Full glass is drawing the full effects over a weak verdict. */
  readonly ownerFull: boolean;
}

const isWeak = (verdict: EffectsVerdict | null): verdict is EffectsVerdict =>
  verdict !== null && verdict.effects === "simple";

/**
 * This session's effects from [verdict], and from the owner's Full glass
 * ([ownerFull]), which counts only over a weak verdict: the switch shows only
 * there, and nothing measures while it's on, so a stored choice without one
 * can't keep a phone from being measured.
 */
export const sessionEffects = (
  verdict: EffectsVerdict | null,
  now: number,
  ownerFull = false,
): SessionEffects => {
  if (!isWeak(verdict)) return { effects: "full", measure: true, verdict, ownerFull: false };
  if (ownerFull) return { effects: "full", measure: false, verdict, ownerFull: true };
  const due = now - verdict.judgedAt >= WEAK_PHONE_RULE.recheckDays * DAY_MS;
  return due
    ? { effects: "full", measure: true, verdict, ownerFull: false }
    : { effects: "simple", measure: false, verdict, ownerFull: false };
};

/**
 * [session] once the owner turns Full glass [on] or off, mid-session. On, the
 * full effects come back at once; off, the glass simplifies at once, and the
 * next start follows the verdict again, its re-check included. Neither starts
 * the frame meter mid-session.
 */
export const ownerFullEffects = (session: SessionEffects, on: boolean): SessionEffects => {
  if (!isWeak(session.verdict)) return session;
  return on
    ? { ...session, effects: "full", measure: false, ownerFull: true }
    : { ...session, effects: "simple", measure: false, ownerFull: false };
};

/** The owner's Full glass as stored on this phone (never synced); anything but "on" is off. */
export const readFullGlassChoice = (stored: string | null): boolean => stored === "on";

/** What to store for Full glass; off removes the key. */
export const writeFullGlassChoice = (on: boolean): string | null => (on ? "on" : null);

/** What Settings › Appearance › Glass adds on a phone judged weak. */
export interface FullGlassNotice {
  /** Why the glass was simplified, and when. */
  readonly text: string;
  /** The Full glass switch. */
  readonly on: boolean;
}

/**
 * Appearance's notice and Full glass switch for [session]; null leaves the
 * Glass section as it is: a phone drawing the full effects by its own verdict,
 * never measured, or in its re-check session.
 */
export const fullGlassNotice = (
  session: SessionEffects,
  language: AppLanguage,
): FullGlassNotice | null => {
  const { verdict } = session;
  if (!isWeak(verdict) || (session.effects === "full" && !session.ownerFull)) return null;
  const strings = catalogueOf(language).settings.fullGlass;
  const date = formatDate(language, verdict.judgedAt);
  return session.ownerFull
    ? { text: strings.simplifiedFullOn(date), on: true }
    : { text: strings.simplified(date), on: false };
};

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** A stored verdict; null for nothing stored or anything unreadable. */
export const readEffectsVerdict = (stored: string | null): EffectsVerdict | null => {
  if (stored === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { effects, counted, slow, judgedAt } = raw as Record<string, unknown>;
  if (effects !== "full" && effects !== "simple") return null;
  if (!isCount(counted) || !isCount(slow) || !isCount(judgedAt)) return null;
  return { effects, counted, slow, judgedAt };
};

export const writeEffectsVerdict = (verdict: EffectsVerdict): string => JSON.stringify(verdict);

const daysAgo = (judgedAt: number, now: number): string => {
  const days = Math.max(0, Math.floor((now - judgedAt) / DAY_MS));
  // not UI text: the app log's line
  return days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
};

/** The app log's line for [session], written once per start. */
export const phoneEffectsLine = (session: SessionEffects, now: number): string => {
  // not UI text: the app log's line
  if (session.ownerFull) return "Phone effects: full (turned on by the owner)";
  const { verdict } = session;
  const why =
    verdict === null
      ? "not measured yet"
      : `${verdict.slow} of ${verdict.counted} animated windows over ${WEAK_PHONE_RULE.slowFrameMs} ms, ${daysAgo(verdict.judgedAt, now)}`;
  // not UI text: the app log's line
  return `Phone effects: ${session.effects} (${why}${session.measure ? "; measuring this session" : ""})`;
};
