/**
 * Main's side of `window.wave.history`. The window names a cursor or a play; main reads the
 * history and resolves what a play replays.
 */
import { Database } from "@wave/client";
import type { ListeningHistoryCursor, ListeningHistoryFrom } from "@wave/core";
import * as Effect from "effect/Effect";
import { historyPage, historyReplay } from "./library/history.ts";
import { DesktopLibrary } from "./library/library.ts";
import { Playback } from "./playback/playback.ts";
import { YtMusic } from "./yt/ytMusic.ts";

const whole = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const cursor = (value: unknown): value is ListeningHistoryCursor =>
  typeof value === "object" &&
  value !== null &&
  whole((value as ListeningHistoryCursor).startedAt) &&
  whole((value as ListeningHistoryCursor).id);

/** The read the window asked for, rebuilt from checked values; undefined when it isn't one. */
const readFrom = (value: unknown): ListeningHistoryFrom | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const { before, after, around } = value as Record<string, unknown>;
  if (around !== undefined) return whole(around) ? { around } : undefined;
  if (after !== undefined)
    return cursor(after) ? { after: { startedAt: after.startedAt, id: after.id } } : undefined;
  if (before === undefined || before === null) return { before: undefined };
  return cursor(before) ? { before: { startedAt: before.startedAt, id: before.id } } : undefined;
};

export const historyHandlers = {
  "history.page": ([from, query]: readonly unknown[]) =>
    Effect.gen(function* () {
      const read = readFrom(from);
      if (read === undefined || typeof query !== "string" || query.length > 500)
        return yield* Effect.fail(new Error("Refused history.page: invalid page or search"));
      const db = yield* Database;
      const library = yield* DesktopLibrary;
      const yt = yield* YtMusic;
      return historyPage(db, read, query, {
        ytMusic: yt.enabled(),
        keep: yt.keep,
        unavailable: library.unavailable,
      });
    }),
  "history.play": ([playId]: readonly unknown[]) =>
    Effect.gen(function* () {
      if (!whole(playId))
        return yield* Effect.fail(new Error("Refused history.play: invalid play"));
      const yt = yield* YtMusic;
      const playback = yield* Playback;
      const replay = historyReplay(yield* Database, playId, yt.enabled());
      // A removed song, or a stream with YT Music off: the row is dimmed and does nothing.
      if (replay === null) return;
      const play = () => playback.activate([replay.id], 0, { kind: "history", id: null });
      yield* Effect.tryPromise({
        try: () => (replay.streams.length === 0 ? play() : yt.withSongs(replay.streams, play)),
        catch: (error) => error,
      });
    }),
};
