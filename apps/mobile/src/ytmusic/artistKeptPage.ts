/**
 * Fans might also like and About on the Library's artist page (docs/spec.md,
 * "Artist page"): the artist's YouTube Music page, found by name once and kept
 * with their saved answer (`yt_artists`). Core says when a lookup is due and
 * what shows (`artistPageLookupDue`, `artistPageKept`); this asks, saves and
 * remembers a lookup that got no answer.
 */
import type { ArtistRow } from "@wave/client";
import { artistOpeningRequest } from "@wave/client/ytArtistFetch";
import {
  artistPageKept,
  artistPageLookupDue,
  artistPageLookupFailedAt,
  artistPageLookupLine,
  artistPageLookupReads,
  identityKey,
  parseArtistPageLookupFailures,
  storedArtistPageLookupFailures,
  withArtistPageLookupEnded,
  type ArtistPageLookupEnd,
  type ArtistPageLookupFailures,
  type SimilarArtistLink,
  type YtArtistAbout,
  type YtArtistSaved,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useEffect, useMemo, useRef, useState } from "react";

import { persistedSetting } from "@/lib/persistedSetting";
import { useScreenSight } from "@/lib/screenSight";
import { useSettledOnce } from "@/lib/screenTiming";
import { isScreenSettled } from "@/lib/timing";
import { appRuntime } from "@/library/runtime";
import { appLog } from "@/log/appLog";
import { online } from "@/native/waveNative";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { useYtMusicEnabled, ytMusicEnabled } from "@/settings/ytMusic";

import { useSimilarArtists } from "./artistPage";
import { fetchArtist } from "./artistSection";
import { YtMusicError } from "./YtMusic";

type Saved = YtArtistSaved<NativeYtSong>;

/** The app log's tag for the lookups; the allowance and native code log their side. */
const TAG = "WaveArtistPage";

/** The lookups that got no answer, kept on this phone so a restart doesn't try them again early. */
const failures = persistedSetting<ArtistPageLookupFailures>({
  key: "ytmusic.artistPageLookupFailures",
  read: parseArtistPageLookupFailures,
  write: storedArtistPageLookupFailures,
  persistDelayMs: 1000,
});

/** Logs how [name]'s lookup ended and remembers, or forgets, its failure. */
const lookupEnded = (name: string, end: ArtistPageLookupEnd): void => {
  appLog(
    end === "found" || end === "unmatched" ? "info" : "warn",
    TAG,
    artistPageLookupLine(name, end),
  );
  failures.set(
    withArtistPageLookupEnded(
      failures.get(),
      name,
      end === "found" || end === "unmatched" ? null : end,
      Date.now(),
    ),
  );
};

/** The newer of two answers saved for an artist. */
const newer = (a: Saved | null | undefined, b: Saved | null | undefined) =>
  a == null ? b : b == null ? a : a.checkedAt >= b.checkedAt ? a : b;

export interface ArtistKeptPageShown {
  /** Fans might also like: the kept page's similar artists, each with the page a tap opens. */
  readonly similar: readonly SimilarArtistLink<ArtistRow>[];
  /** About: the kept page's description and counts, or null without one. */
  readonly about: YtArtistAbout | null;
}

/**
 * What the Library artist [name]'s page shows of their YouTube Music page,
 * and the lookup that keeps it. [section] is the page's YT Music section
 * (`useYtArtistSection`), which reads what's saved for the artist and whose
 * own answers count here too. Nothing is asked until the page's content is
 * read ([contentReady]) and the screen has settled, and then only when Core
 * says a lookup is due (`artistPageLookupDue`), once per opening: the Artists
 * search takes its turn in the shared allowance (as "an artist page"), each
 * request checks sight, settlement, YT Music's switch and Android's
 * connectivity as it runs, and leaving the page stops it with nothing saved.
 * While the section itself asks, its answer is the lookup. Only the artist's
 * name, their browse id and, for a page kept with every song of theirs, their
 * songs playlist's id are sent.
 */
export const useArtistKeptPage = (
  name: string,
  contentReady: boolean,
  section: {
    readonly saved: Saved | null | undefined;
    readonly asking: () => boolean;
  },
): ArtistKeptPageShown => {
  const key = identityKey(name);
  const enabled = useYtMusicEnabled();
  const settled = useSettledOnce(key);
  const sight = useScreenSight();
  // The lookup's own answer this opening, beside what the section restored or was answered.
  const [answer, setAnswer] = useState<{ readonly key: string; readonly saved: Saved } | null>(
    null,
  );
  const { saved: restored, asking } = section;
  const saved =
    restored === undefined ? undefined : newer(answer?.key === key ? answer.saved : null, restored);

  // One lookup per artist per opening; leaving the page, or another artist on it, stops it.
  const asked = useRef<string | null>(null);
  const leaving = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    leaving.current = controller;
    return () => controller.abort();
  }, [key]);

  useEffect(() => {
    const signal = leaving.current?.signal;
    if (saved === undefined || signal === undefined || asked.current === key) return;
    const due = artistPageLookupDue({
      name,
      enabled,
      online: online(),
      settled,
      contentReady,
      saved,
      failedAt: artistPageLookupFailedAt(failures.get(), name),
      now: Date.now(),
    });
    if (!due) return;
    asked.current = key;
    // The section's own request reads the same page and saves it.
    if (asking()) return;
    const canSend = () =>
      !signal.aborted && sight.visible() && isScreenSettled() && ytMusicEnabled() && online();
    const lookup = artistOpeningRequest(
      canSend,
      fetchArtist(name, key, saved, {
        ...artistPageLookupReads(saved),
        canSend,
        asker: "artistPage",
      }),
    ).pipe(Effect.mapError((error) => new YtMusicError({ reason: error.reason })));
    void appRuntime.runPromise(Effect.result(lookup), { signal }).then(
      (result) => {
        if (signal.aborted) return;
        if (Result.isFailure(result)) return lookupEnded(name, result.failure.reason);
        lookupEnded(name, result.success.outcome);
        setAnswer({ key, saved: result.success });
      },
      // Interrupted: the page is gone, and nothing was saved.
      () => {},
    );
  }, [key, name, enabled, settled, contentReady, saved, asking, sight]);

  const kept = useMemo(() => artistPageKept(saved ?? null, enabled), [saved, enabled]);
  const similar = useSimilarArtists(kept.similar, settled);
  return useMemo(() => ({ similar, about: kept.about }), [similar, kept.about]);
};
