/**
 * YouTube Music's chart for Artist mixes' last seeds (docs/spec.md, "Artist
 * mixes"): its top artists, read signed out and without a country, at most
 * once a week, and kept on the phone (not synced), so offline and cold
 * builds use the last read. Core says when it's due (`ytChartReadDue`).
 */
import {
  parseYtChart,
  storedYtChart,
  withYtChartRead,
  ytChartReadDue,
  type YtChartArtist,
  type YtChartKept,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { persistedSetting } from "@/lib/persistedSetting";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { YtMusic } from "@/ytmusic/YtMusic";

/** The chart as last read. */
const kept = persistedSetting<YtChartKept | null>({
  key: "home.ytChart",
  read: parseYtChart,
  write: storedYtChart,
});

/** A build waits this long for the chart, as it does for a radio. */
const READ_TIMEOUT = "8 seconds";

/** When this session's last read failed; null when none did. */
let failedAt: number | null = null;

/**
 * The chart's top artists for a build: read again when it's due and YT
 * Music is on, else as kept. A read that fails, times out or finds no
 * artists leaves the kept chart, if any, and isn't tried again for a while.
 */
export const chartArtists = Effect.gen(function* () {
  const last = kept.get();
  if (!ytMusicEnabled() || !ytChartReadDue(last, { now: Date.now(), failedAt }))
    return last?.artists ?? [];
  const ytMusic = yield* YtMusic;
  const read: readonly YtChartArtist[] = yield* ytMusic.chartArtists.pipe(
    Effect.timeout(READ_TIMEOUT),
    Effect.map((artists) => artists.map(({ name, browseId }) => ({ name, browseId }))),
    Effect.orElseSucceed(() => []),
  );
  const now = Date.now();
  failedAt = read.length === 0 ? now : null;
  const next = withYtChartRead(last, read, now);
  kept.set(next);
  return next?.artists ?? [];
});
