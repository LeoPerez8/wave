import { askWaveService } from "@wave/client/askWaveService";
import type { LibraryDatabase } from "@wave/client/db/database";
import {
  GENIUS_REQUEST_TIMEOUT_MS,
  geniusStorageKey,
  loadGenius,
  translateGenius,
  type GeniusAsk,
  type GeniusService,
} from "@wave/client/geniusSource";
import { createGeniusStorage } from "@wave/client/geniusStorage";
import {
  currentEntry,
  geniusAbout,
  geniusAnswerState,
  geniusReferents,
  geniusTranslationTarget,
  savedGenius,
  songLookup,
  type AppLanguage,
} from "@wave/core";
import { sql } from "drizzle-orm";

import type { GeniusPhase, SongGenius } from "../../shared/lyrics.ts";
import type { WaveAccountService } from "../account/account.ts";
import { geniusInsightsEnabled } from "../library/lyricsAndTags.ts";
import type { PlaybackShape } from "../playback/playback.ts";
import { preference, savePreference } from "../preferences.ts";

export interface DesktopGenius {
  readonly song: (trackId: string, requestId: string, phase: GeniusPhase) => Promise<SongGenius>;
  readonly cancel: (requestId?: string) => void;
}

const HIDDEN: SongGenius = { kind: "hidden" };

/** Main looks up the song from playback and keeps both the session and the cache on this device. */
export const createDesktopGenius = ({
  db,
  account,
  playback,
  language,
  fetch,
}: {
  readonly db: LibraryDatabase;
  readonly account: WaveAccountService;
  readonly playback: Pick<PlaybackShape, "view" | "queueState">;
  readonly language: () => AppLanguage;
  readonly fetch: typeof globalThis.fetch;
}): DesktopGenius => {
  const store = createGeniusStorage({
    read: async (key) => preference(db, key) ?? null,
    write: async (key, value) => savePreference(db, key, value),
    remove: async (key) => {
      db.run(sql`DELETE FROM desktop_settings WHERE key=${key}`);
    },
  });
  let pending: { readonly id: string; readonly controller: AbortController } | undefined;
  const cancel = (id?: string) => {
    if (pending !== undefined && (id === undefined || pending.id === id)) {
      pending.controller.abort();
      pending = undefined;
    }
  };
  const currentTrack = () => currentEntry(playback.queueState())?.trackId;
  return {
    cancel,
    song: async (trackId, id, phase) => {
      if (
        !geniusInsightsEnabled(db) ||
        account.view().account.kind === "unavailable" ||
        currentTrack() !== trackId
      )
        return HIDDEN;
      const current = playback.view().current;
      if (current === null) return HIDDEN;
      const song = songLookup(current);
      if (song === null) return HIDDEN;
      const ask: GeniusAsk = {
        key: trackId,
        song,
        signedIn: account.session().status === "signedIn",
        target: geniusTranslationTarget(language()),
      };
      if (phase === "translate" && ask.target === null) return HIDDEN;

      cancel();
      const controller = new AbortController();
      pending = { id, controller };
      const enabled = () =>
        !controller.signal.aborted && currentTrack() === trackId && geniusInsightsEnabled(db);
      const signal = () =>
        AbortSignal.any([controller.signal, AbortSignal.timeout(GENIUS_REQUEST_TIMEOUT_MS)]);
      const service: GeniusService = {
        ...store,
        enabled,
        get: (path) =>
          askWaveService(
            (method, path, body) => account.request(method, path, body, signal()),
            path,
          ),
        post: async (url, body) => {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body,
            redirect: "error",
            signal: signal(),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status} from Google Translate`);
          return response.json();
        },
      };
      try {
        let saved =
          phase === "read"
            ? await loadGenius(ask, service)
            : savedGenius(await store.read(geniusStorageKey(trackId)), Date.now(), song);
        if (phase === "translate" && saved !== null)
          saved = await translateGenius(ask, saved, service);
        if (!enabled()) return HIDDEN;
        if (saved === null) return { kind: ask.signedIn ? "failed" : "signIn" };
        const state = geniusAnswerState(saved);
        if (state !== "answer") return { kind: state === "failure" ? "failed" : "miss" };
        return {
          kind: "answer",
          about: geniusAbout(saved, ask.target),
          referents: geniusReferents(saved, ask.target) ?? [],
        };
      } finally {
        if (pending?.controller === controller) pending = undefined;
      }
    },
  };
};
