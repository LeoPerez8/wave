/**
 * Lyrics translated into the app's language (docs/spec.md, "Lyrics translation"), as on the
 * phone: Core builds the request to Google Translate and reads its reply, and the shared loader
 * keeps each song's translation in the device-local `desktop_settings` store, so it shows again
 * with no request. The Translate switch is kept there too, never synced. Main reads the song's
 * lyrics itself, so the window names a queue track and never the text to send; while the switch
 * is off nothing is read or sent.
 */
import type { LibraryDatabase } from "@wave/client/db/database";
import { translateLyrics, type TranslationService } from "@wave/client/lyricsTranslationSource";
import { appLyricsTranslationTarget, type AppLanguage } from "@wave/core";
import { sql } from "drizzle-orm";

import type { SongLyrics, SongTranslation } from "../../shared/lyrics.ts";
import { preference, savePreference } from "../preferences.ts";

/** The phone's key for the same switch. */
const TRANSLATE_SETTING = "settings.translateLyrics";

/** A request that takes longer than this has failed, as on the phone. */
export const TRANSLATION_TIMEOUT_MS = 15_000;

export interface LyricsTranslationDeps {
  readonly db: LibraryDatabase;
  /** What the Lyrics view shows for a queue track (`Lyrics.song`). */
  readonly song: (trackId: string) => Promise<SongLyrics>;
  /** POSTs the form `body` to Google Translate at `url` and gives its JSON; rejects when it can't. */
  readonly post: (url: string, body: string) => Promise<unknown>;
}

export interface LyricsTranslationShape {
  /** Whether the Translate button is on. */
  readonly on: () => boolean;
  readonly setOn: (on: boolean) => void;
  /** The queue track's lyrics translated into the app's `language`; `off` while Translate is off. */
  readonly song: (trackId: string, language: AppLanguage) => Promise<SongTranslation>;
}

const OFF: SongTranslation = { kind: "off" };

/** The text of each lyric line, in order; null for a song without lyrics. */
const linesOf = (lyrics: SongLyrics): readonly string[] | null =>
  lyrics.kind === "synced"
    ? lyrics.lines.map((line) => line.text)
    : lyrics.kind === "unsynced"
      ? lyrics.lines
      : null;

export const createLyricsTranslation = (deps: LyricsTranslationDeps): LyricsTranslationShape => {
  const { db } = deps;
  const service: TranslationService = {
    read: async (key) => preference(db, key) ?? null,
    keep: async (key, value) => savePreference(db, key, value),
    drop: async (key) => {
      db.run(sql`DELETE FROM desktop_settings WHERE key=${key}`);
    },
    post: deps.post,
  };
  /** Translations running, by song, language and lyrics: the panel and Now Playing share one. */
  const running = new Map<string, Promise<SongTranslation>>();
  const on = () => preference(db, TRANSLATE_SETTING) === "on";

  const translate = async (
    song: string,
    lines: readonly string[],
    target: string,
  ): Promise<SongTranslation> => {
    const translation = await translateLyrics({ song, lines, target }, service);
    if (translation === null) return OFF;
    if (translation === "failed") return { kind: "failed" };
    return translation.kind === "sameLanguage"
      ? translation
      : { kind: "translated", lines: translation.lines };
  };

  return {
    on,
    setOn: (value) => {
      if (value) savePreference(db, TRANSLATE_SETTING, "on");
      else db.run(sql`DELETE FROM desktop_settings WHERE key=${TRANSLATE_SETTING}`);
    },
    song: async (trackId, language) => {
      if (!on()) return OFF;
      const lines = linesOf(await deps.song(trackId));
      if (lines === null || !on()) return OFF;
      const target = appLyricsTranslationTarget(language);
      const key = JSON.stringify([trackId, target, lines]);
      const known = running.get(key);
      if (known !== undefined) return known;
      const started = translate(trackId, lines, target).finally(() => running.delete(key));
      running.set(key, started);
      return started;
    },
  };
};
