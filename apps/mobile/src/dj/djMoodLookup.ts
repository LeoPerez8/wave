/** Free-turn ReccoBeats fill for the candidate catalog's local mood cache. */
import {
  deezerTrackCandidates,
  deezerTrackSearchUrl,
  djMedianAudioFeatures,
  pickDeezerTrack,
  songLookup,
  type DjAudioFeatures,
} from "@wave/core";
import { AppState } from "react-native";

import { freeTurn } from "@/lib/backgroundWork";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { online } from "@/native/waveNative";

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

const asFeatures = (value: unknown): DjAudioFeatures | null => {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  for (const key of ["energy", "valence", "acousticness"])
    if (typeof row[key] !== "number" || row[key] < 0 || row[key] > 1) return null;
  if (row.mode !== 0 && row.mode !== 1) return null;
  return {
    energy: row.energy as number,
    valence: row.valence as number,
    acousticness: row.acousticness as number,
    mode: row.mode,
  };
};

const medianFeatures = (rows: readonly unknown[]): DjAudioFeatures | null => {
  const features = rows.flatMap((row) => {
    const value = asFeatures(row);
    return value === null ? [] : [value];
  });
  return djMedianAudioFeatures(features);
};

const featureRows = async (ids: readonly string[]): Promise<readonly Record<string, unknown>[]> => {
  if (ids.length === 0) return [];
  await paceLookup();
  const response = await fetch(
    `${RECCOBEATS}/audio-features?ids=${encodeURIComponent(ids.join(","))}`,
  );
  if (!response.ok) throw new Error(`ReccoBeats HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !Array.isArray((body as { content?: unknown }).content)
  )
    throw new Error("ReccoBeats returned an invalid feature list");
  return (body as { content: Record<string, unknown>[] }).content;
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
  const body: unknown = await response.json();
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
  const body: unknown = await response.json();
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
          await freeTurn("DJ mood lookup: pending songs");
          if (!enabled()) break;
          const pending = await appRuntime.runPromise(store.pendingDjMoodSongs(after, Date.now()));
          if (pending.last === null) break;
          after = pending.last;
          const page = pending.songs;
          const isrcs = new Map<string, string>();
          const unavailable = new Set<string>();
          for (const song of page) {
            await freeTurn("DJ mood lookup: ISRCs");
            if (!enabled()) break;
            try {
              const isrc = await deezerIsrc(song);
              if (isrc !== null) isrcs.set(song.videoId, isrc);
            } catch {
              unavailable.add(song.videoId);
              continue;
            }
          }
          const codes = [...new Set(isrcs.values())];
          const byIsrc = new Map<string, Record<string, unknown>[]>();
          const foundRows = await featureRows(codes);
          for (const row of foundRows) {
            if (typeof row.isrc !== "string") continue;
            const code = row.isrc.toUpperCase();
            const rows = byIsrc.get(code) ?? [];
            rows.push(row);
            byIsrc.set(code, rows);
          }
          const featureByVideo = new Map<string, DjAudioFeatures>();
          const misses: (typeof page)[number][] = [];
          for (const song of page) {
            const code = isrcs.get(song.videoId);
            const features = code === undefined ? null : medianFeatures(byIsrc.get(code) ?? []);
            if (features !== null) featureByVideo.set(song.videoId, features);
            else misses.push(song);
          }
          const fallbackIds = new Map<string, string>();
          const fallbackIsrcs = new Map<string, string>();
          for (const song of misses) {
            await freeTurn("DJ mood lookup: search fallback");
            if (!enabled()) break;
            try {
              const id = await searchFallback(song);
              if (id !== null) fallbackIds.set(song.videoId, id);
            } catch {
              unavailable.add(song.videoId);
              continue;
            }
          }
          const fallbackRows = await featureRows([...new Set(fallbackIds.values())]);
          const byId = new Map(fallbackRows.map((row) => [String(row.id), row]));
          for (const [videoId, id] of fallbackIds) {
            const row = byId.get(id);
            const features = medianFeatures(row === undefined ? [] : [row]);
            if (features !== null) featureByVideo.set(videoId, features);
            if (typeof row?.isrc === "string") fallbackIsrcs.set(videoId, row.isrc.toUpperCase());
          }
          if (!enabled()) break;
          // A stored entry that no longer reads can't be looked up: it waits as a miss.
          const writes = [
            ...page
              .filter(({ videoId }) => !unavailable.has(videoId))
              .map((song) => ({
                videoId: song.videoId,
                isrc: isrcs.get(song.videoId) ?? fallbackIsrcs.get(song.videoId) ?? null,
                features: featureByVideo.get(song.videoId) ?? null,
                checkedAt: Date.now(),
              })),
            ...pending.unreadable.map((videoId) => ({
              videoId,
              isrc: null,
              features: null,
              checkedAt: Date.now(),
            })),
          ];
          if (writes.length > 0) await appRuntime.runPromise(store.keepDjMoodFeatures(writes));
          totalChecked += writes.length;
          totalMatched += writes.filter(({ features }) => features !== null).length;
        }
      }
      if (totalChecked > 0)
        console.info(
          `[wave] DJ mood lookup: ${totalChecked} songs checked, ${totalMatched} matched`,
        );
    } catch {
      // A failed read or unavailable service leaves entries due for the next free turn.
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
