/**
 * Lyrics: what the Lyrics panel and Now Playing show for a queue track (docs/spec.md, "Lyrics
 * online"), decided by Core as on the phone.
 *
 * - A Library song shows its file's lyrics (tags or a sidecar `.lrc`, read by the JVM). A file
 *   with none is searched online (`libraryLyrics`): LRCLIB, then YT Music for a song downloaded
 *   from a video. A miss is remembered for a week (`lyricsMisses`). The phone writes a hit into
 *   the file through the shared Kotlin writer and rereads its Library entry.
 * - A YT Music song (`nonDLyrics`) shows what is saved against its video, else is searched the
 *   same way, and a hit or a miss is saved (`savedLyrics`).
 *
 * Nothing is asked online while Settings' "Fix songs online" is off. A source that can't be
 * reached makes the answer `failed`, which is never kept: asking again searches again.
 */
import {
  LRCLIB_HEADERS,
  libraryLyrics,
  libraryLyricsSong,
  lrclibCandidates,
  lrclibSearchUrl,
  nonDLyrics,
  nonDLyricsSong,
  parseTrackId,
  pickFoundLyrics,
  pickLyrics,
  ytMusicFoundLyrics,
  type FoundLyrics,
  type LyricsAnswer,
  type LyricsSearchSong,
  type LyricsSource,
  type LyricsSources,
  type NonDSongDetails,
} from "@wave/core";
import { Database } from "@wave/client";
import type { LibraryDatabase } from "@wave/client/db/database";
import { keepLyricsMiss, selectLyricsSearchTrack } from "@wave/client/db/lyricsMisses";
import { keepSavedLyrics, selectSavedLyrics } from "@wave/client/db/savedLyrics";
import { selectPlayableSongs } from "@wave/client/db/tracks";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { Kotlin } from "../kotlin/kotlin.ts";
import { YtMusic } from "../yt/ytMusic.ts";
import { DesktopLibrary } from "../library/library.ts";
import { lookupsEnabled } from "../lookupSettings.ts";

import type { SongLyrics } from "../../shared/lyrics.ts";
import { createKaraokeSwitch, type KaraokeSwitchShape } from "./karaoke.ts";
import {
  createLyricsTranslation,
  TRANSLATION_TIMEOUT_MS,
  type LyricsTranslationShape,
} from "./translation.ts";

/** How long a source may take before it counts as unreachable, as on the phone. */
const LOOKUP_TIMEOUT_MS = 30_000;

export interface LyricsDeps {
  readonly db: LibraryDatabase;
  /** The lyrics in the file at `path` and in its sidecar (`readLyrics` on the JVM). */
  readonly readFile: (path: string) => Promise<LyricsSources>;
  /** Writes a found lyric into the file (or sidecar), then rereads its Library entry. */
  readonly writeFile: (path: string, text: string) => Promise<void>;
  /** LRCLIB's JSON answer at `url`; fails when it can't be reached. */
  readonly lrclib: (url: string, headers: Readonly<Record<string, string>>) => Promise<unknown>;
  /** YT Music's lyrics for a video (plain text), or null (`ytLyrics` on the JVM). */
  readonly ytMusic: (videoId: string) => Promise<string | null>;
  /** A queued YT Music song's details, as the queue keeps them. */
  readonly ytSong: (videoId: string) => NonDSongDetails | undefined;
  readonly ytMusicOn: () => boolean;
  readonly now: () => number;
  readonly timeoutMs?: number;
}

export interface SongLyricsShape {
  /** What the Lyrics view shows for the queue track `trackId`. */
  readonly song: (trackId: string) => Promise<SongLyrics>;
}

export interface LyricsShape extends SongLyricsShape {
  /** The Translate button and what it shows under the lines. */
  readonly translation: LyricsTranslationShape;
  /** The Karaoke button's switch. */
  readonly karaoke: KaraokeSwitchShape;
}

const NONE: SongLyrics = { kind: "none" };
const FAILED: SongLyrics = { kind: "failed" };

export const createLyrics = (deps: LyricsDeps): SongLyricsShape => {
  const timeoutMs = deps.timeoutMs ?? LOOKUP_TIMEOUT_MS;
  /** Library songs' lyrics found online this session, by track id. */
  const found = new Map<number, SongLyrics>();
  /** Searches running, by track id: asking again joins them. */
  const running = new Map<string, Promise<SongLyrics>>();

  const lookupsOn = () => lookupsEnabled(deps.db);

  const withTimeout = <A>(promise: Promise<A>): Promise<A> =>
    new Promise<A>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out")), timeoutMs);
      promise.then(resolve, reject).finally(() => clearTimeout(timer));
    });

  /** Asks [source] about [song]; never fails: a failure is an answer. */
  const ask = async (source: LyricsSource, song: LyricsSearchSong): Promise<LyricsAnswer> => {
    try {
      let lyrics: FoundLyrics | null = null;
      if (source === "lrclib" && song.lookup !== null) {
        const candidates = lrclibCandidates(
          await withTimeout(deps.lrclib(lrclibSearchUrl(song.lookup), LRCLIB_HEADERS)),
        );
        if (candidates === null) return { ok: false };
        lyrics = pickFoundLyrics(song.lookup, candidates);
      } else if (source === "ytMusic" && song.videoId !== null) {
        lyrics = ytMusicFoundLyrics(await withTimeout(deps.ytMusic(song.videoId)));
      }
      return { ok: true, lyrics };
    } catch (error) {
      console.warn(`[lyrics] ${source} couldn't be asked: ${String(error)}`);
      return { ok: false };
    }
  };

  /** Asks the sources [next] names, one at a time, until it says it's done. */
  const search = async (
    song: LyricsSearchSong,
    next: (
      answers: readonly LyricsAnswer[],
    ) => { readonly ask: LyricsSource } | { readonly done: SongLyrics },
  ): Promise<SongLyrics> => {
    const answers: LyricsAnswer[] = [];
    for (;;) {
      const step = next(answers);
      if ("done" in step) return step.done;
      answers.push(await ask(step.ask, song));
    }
  };

  const librarySong = async (id: number): Promise<SongLyrics> => {
    const path = selectPlayableSongs(deps.db, [id])[0]?.path ?? null;
    if (path === null) return NONE;
    const own = pickLyrics(await deps.readFile(path));
    if (own.kind !== "none") return own;
    const known = found.get(id);
    if (known !== undefined) return known;
    const track = selectLyricsSearchTrack(deps.db, id);
    if (track === null) return NONE;
    const song = libraryLyricsSong(track);
    const on = lookupsOn();
    const ytOn = deps.ytMusicOn();
    let write: FoundLyrics | undefined;
    const result = await search(song, (answers) => {
      const step = libraryLyrics(song, {
        missedAt: track.missedAt,
        answers,
        lookupsOn: on,
        ytMusicOn: ytOn,
        now: deps.now(),
      });
      switch (step.kind) {
        case "searching":
          return { ask: step.ask };
        case "lyrics":
          write = step.write;
          found.set(id, step.lyrics);
          return { done: step.lyrics };
        case "none":
          if (step.remember !== null) keepLyricsMiss(deps.db, id, step.remember);
          return { done: NONE };
        case "failed":
          return { done: FAILED };
      }
    });
    if (write !== undefined)
      await deps.writeFile(path, write.text).catch((error) => {
        console.warn(`[lyrics] The found lyrics couldn't be saved: ${String(error)}`);
      });
    return result;
  };

  const ytSong = async (trackId: string): Promise<SongLyrics> => {
    const ref = parseTrackId(trackId);
    const details = ref?.kind === "yt" ? (deps.ytSong(ref.videoId) ?? null) : null;
    // What is saved for the video shows even before its details are known.
    const song =
      nonDLyricsSong(trackId, details) ??
      (ref?.kind === "yt" ? { lookup: null, videoId: ref.videoId } : null);
    if (song === null) return NONE;
    const saved = song.videoId === null ? null : selectSavedLyrics(deps.db, song.videoId);
    if (ref?.kind === "yt" && details === null && saved?.kind !== "found") return NONE;
    const on = lookupsOn();
    const ytOn = deps.ytMusicOn();
    return search(song, (answers) => {
      const now = deps.now();
      const step = nonDLyrics(song, { saved, answers, lookupsOn: on, ytMusicOn: ytOn, now });
      switch (step.kind) {
        case "searching":
          return { ask: step.ask };
        case "lyrics":
        case "notFound":
          if (step.save !== null) keepSavedLyrics(deps.db, step.save.videoId, step.save.saved, now);
          return { done: step.kind === "lyrics" ? step.lyrics : NONE };
        case "failed":
          return { done: FAILED };
        case "off":
          return { done: NONE };
      }
    });
  };

  const song = (trackId: string): Promise<SongLyrics> => {
    const ref = parseTrackId(trackId);
    return ref?.kind === "library" ? librarySong(ref.id) : ytSong(trackId);
  };

  return {
    song: (trackId) => {
      const known = running.get(trackId);
      if (known !== undefined) return known;
      const started = song(trackId).finally(() => running.delete(trackId));
      running.set(trackId, started);
      return started;
    },
  };
};

export class Lyrics extends Context.Service<Lyrics, LyricsShape>()("@wave/desktop/Lyrics") {}

/** Lyrics over the Library, the JVM (files and YT Music) and LRCLIB at `fetch`. */
export const lyricsLayer = (options: { readonly fetch?: typeof globalThis.fetch } = {}) =>
  Layer.effect(
    Lyrics,
    Effect.gen(function* () {
      const db = yield* Database;
      const kotlin = yield* Kotlin;
      const yt = yield* YtMusic;
      const library = yield* DesktopLibrary;
      const fetch = options.fetch ?? globalThis.fetch;
      const lyrics = createLyrics({
        db,
        readFile: (path) => Effect.runPromise(kotlin.call("readLyrics", { path })),
        writeFile: async (path, lyrics) => {
          const report = await Effect.runPromise(
            kotlin.call("tags.writeSong", {
              path,
              lyrics,
              genre: null,
              trackNumber: null,
              discNumber: null,
              year: null,
              advisory: null,
            }),
          );
          if ("failed" in report) throw new Error("The lyrics tag write failed");
          await library.importFile(path);
        },
        lrclib: async (url, headers) => {
          const response = await fetch(url, { headers });
          if (!response.ok) throw new Error(`LRCLIB answered ${response.status}`);
          return response.json();
        },
        ytMusic: (videoId) => Effect.runPromise(kotlin.call("ytLyrics", { videoId })),
        ytSong: yt.song,
        ytMusicOn: yt.enabled,
        now: Date.now,
      });
      // Google Translate goes through the `fetch` of the moment, which a check can replace.
      const translateFetch: typeof globalThis.fetch =
        options.fetch ?? ((input, init) => globalThis.fetch(input, init));
      return {
        ...lyrics,
        karaoke: createKaraokeSwitch(db),
        translation: createLyricsTranslation({
          db,
          song: lyrics.song,
          post: async (url, body) => {
            const response = await translateFetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
              body,
              redirect: "error",
              signal: AbortSignal.timeout(TRANSLATION_TIMEOUT_MS),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status} from Google Translate`);
            return response.json();
          },
        }),
      };
    }),
  );
