/** Free-turn ReccoBeats fill for the candidate catalog's local mood cache. */
import {
  deezerTrackCandidates,
  deezerTrackSearchUrl,
  pickDeezerTrack,
  songLookup,
} from "@wave/core";
import { AppState } from "react-native";

import { freeTurnAlone, inSlice } from "@/lib/backgroundWork";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { online } from "@/native/waveNative";

import { djMoodPageWrites } from "./djMoodPage";

const RECCOBEATS = "https://api.reccobeats.com/v1";
let notify: (() => void) | null = null;
let lastLookupRequestAt = 0;
const paceLookup = async (): Promise<void> => {
  const remaining = 400 - (Date.now() - lastLookupRequestAt);
  if (remaining > 0) await new Promise<void>((resolve) => setTimeout(resolve, remaining));
  lastLookupRequestAt = Date.now();
};

/** Called as radios and artist pages feed the candidate catalog. */
export const requestDjMoodFill = (): void => notify?.();

/**
 * The lookup's turns keep no window in the block log (#1449): each continuation after a request
 * names itself here, so the log blames the lookup for the time it held and no more.
 */
const STEP = "DJ mood lookup";
const turn = (step: string) => freeTurnAlone(`${STEP}: ${step}`);

/** [response]'s body, parsed and read by [read] as a slice of the lookup's [step]. */
const readBody = async <A>(
  response: Response,
  step: string,
  read: (body: unknown) => A,
): Promise<A> => {
  const text = await response.text();
  return inSlice(`${STEP}: ${step}`, () => read(JSON.parse(text) as unknown));
};

const featureRows = async (ids: readonly string[]): Promise<readonly Record<string, unknown>[]> => {
  if (ids.length === 0) return [];
  await paceLookup();
  const response = await fetch(
    `${RECCOBEATS}/audio-features?ids=${encodeURIComponent(ids.join(","))}`,
  );
  if (!response.ok) throw new Error(`ReccoBeats HTTP ${response.status}`);
  return readBody(response, "features", (body) => {
    if (
      typeof body !== "object" ||
      body === null ||
      !Array.isArray((body as { content?: unknown }).content)
    )
      throw new Error("ReccoBeats returned an invalid feature list");
    return (body as { content: Record<string, unknown>[] }).content;
  });
};

/**
 * The exact Deezer track Wave's title, artist and duration matcher selects, including its ISRC.
 * A song Deezer is never asked about (no title, or an artist like "Various Artists") has none, so
 * it goes on to the ReccoBeats search.
 */
const deezerIsrc = async (song: {
  readonly title: string;
  readonly artists: readonly string[];
  readonly durationMs: number | null;
}): Promise<string | null> => {
  const lookup = songLookup({
    title: song.title,
    artist: song.artists.join(", "),
    album: "",
    durationMs: song.durationMs ?? 0,
  });
  if (lookup === null) return null;
  await paceLookup();
  const response = await fetch(deezerTrackSearchUrl(lookup));
  if (!response.ok) throw new Error(`Deezer HTTP ${response.status}`);
  return readBody(response, "ISRCs", (body) => {
    const candidates = deezerTrackCandidates(body);
    if (candidates === null) throw new Error("Deezer returned invalid track results");
    const match = pickDeezerTrack(lookup, candidates);
    if (match === null || typeof body !== "object" || body === null) return null;
    const tracks = (body as { data?: unknown }).data;
    if (!Array.isArray(tracks)) return null;
    const matched = tracks.find(
      (row): row is Record<string, unknown> =>
        typeof row === "object" && row !== null && (row as { id?: unknown }).id === match.trackId,
    );
    return typeof matched?.isrc === "string" && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(matched.isrc)
      ? matched.isrc.toUpperCase()
      : null;
  });
};

const searchFallback = async (song: {
  readonly title: string;
  readonly artists: readonly string[];
  readonly durationMs: number | null;
}): Promise<string | null> => {
  await paceLookup();
  const query = new URLSearchParams({ searchText: song.title, artist: song.artists.join(", ") });
  const response = await fetch(`${RECCOBEATS}/track/search?${query}`);
  if (!response.ok) throw new Error(`ReccoBeats search HTTP ${response.status}`);
  return readBody(response, "search fallback", (body): string | null => {
    if (
      typeof body !== "object" ||
      body === null ||
      !Array.isArray((body as { content?: unknown }).content)
    )
      return null;
    const rows = (body as { content: Record<string, unknown>[] }).content;
    const folded = (value: string) =>
      value
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
    const matches = rows.filter((row) => {
      if (typeof row.trackTitle !== "string" || folded(row.trackTitle) !== folded(song.title))
        return false;
      if (
        typeof row.durationMs === "number" &&
        song.durationMs !== null &&
        Math.abs(row.durationMs - song.durationMs) > 3_000
      )
        return false;
      if (!Array.isArray(row.artists)) return false;
      return row.artists.some(
        (artist) =>
          typeof artist === "object" &&
          artist !== null &&
          typeof (artist as { name?: unknown }).name === "string" &&
          song.artists.some((name) => folded(name) === folded((artist as { name: string }).name)),
      );
    });
    const match = matches[0];
    return typeof match?.id === "string" ? match.id : null;
  });
};

/** Starts a cancellable worker. Each turn handles at most 40 catalog entries. */
export const startDjMoodLookup = (): (() => void) => {
  let stopped = false;
  let running = false;
  let dirty = true;
  const enabled = () => !stopped && AppState.currentState === "active" && online();
  const run = async (): Promise<void> => {
    dirty = true;
    if (running || !enabled()) return;
    running = true;
    try {
      const store = await appRuntime.runPromise(LibraryStore);
      let totalChecked = 0;
      let totalMatched = 0;
      while (dirty && enabled()) {
        dirty = false;
        let after = "";
        while (enabled()) {
          await turn("pending songs");
          if (!enabled()) break;
          const pending = await appRuntime.runPromise(store.pendingDjMoodSongs(after, Date.now()));
          if (pending.last === null) break;
          after = pending.last;
          // Every song of the page is saved, a failure too (#1437): left unsaved, every pass the
          // catalog started asked about it again. Null: the lookup stopped mid-page.
          const writes = await djMoodPageWrites(pending, {
            enabled,
            turn,
            deezerIsrc,
            searchFallback,
            featureRows,
            now: () => Date.now(),
          });
          if (writes === null) break;
          if (writes.length > 0)
            await inSlice(`${STEP}: save`, () =>
              appRuntime.runPromise(store.keepDjMoodFeatures(writes)),
            );
          totalChecked += writes.length;
          totalMatched += writes.filter(({ features }) => features !== null).length;
        }
      }
      if (totalChecked > 0)
        console.info(
          `[wave] DJ mood lookup: ${totalChecked} songs checked, ${totalMatched} matched`,
        );
    } catch {
      // A failed read or save leaves the page due for the next pass.
      console.warn("[wave] DJ mood lookup failed");
    } finally {
      running = false;
    }
  };
  notify = () => {
    dirty = true;
    void run();
  };
  const activity = AppState.addEventListener("change", () => void run());
  void run();
  return () => {
    stopped = true;
    notify = null;
    activity.remove();
  };
};
