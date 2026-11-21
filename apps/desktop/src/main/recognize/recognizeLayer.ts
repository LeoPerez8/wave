/**
 * Recognize as a service of main: the session (`desktopRecognize.ts`) over the JVM, the Library,
 * YT Music and playback, the card the window shows, and the result card's buttons.
 */
import { Database } from "@wave/client";
import type { LibraryDatabase } from "@wave/client/db/database";
import { addToPlaylist, addToShazam } from "@wave/client/db/playlists";
import { trackQuery } from "@wave/client/db/tracks";
import { resolveRecognition } from "@wave/client/resolveRecognition";
import {
  SHAZAM_PLAYLIST_SETTING,
  recognizeCardView,
  recognizePlaylistSong,
  ytTrackId,
  type AppLanguage,
  type Catalogue,
  type PlaylistSong,
  type RecognizeCard,
  type RecognizeResult,
  type RecognizeSource,
  type YtAlbumSong,
} from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  RecognizeCaptureEnd,
  RecognizeCaptureVia,
  RecognizeRunAction,
  RecognizeRunResult,
  RecognizeView,
} from "../../shared/recognize.ts";
import { refuseCollaborative } from "../library/collaborativePlaylists.ts";
import { Downloads } from "../downloads/downloadsLayer.ts";
import { Kotlin } from "../kotlin/kotlin.ts";
import type { KotlinEvent, KotlinMethod } from "../kotlin/protocol.ts";
import { Playback } from "../playback/playback.ts";
import { keepPreference, syncedPreference } from "../sync/desktopSync.ts";
import {
  runStreamedAction,
  streamedLibraryFacts,
  type StreamedSongPorts,
} from "../yt/streamedSong.ts";
import { YtMusic, ytSongs } from "../yt/ytMusic.ts";
import { createDesktopRecognize } from "./desktopRecognize.ts";

/** A Library song as Recognize finds it: its Library row. */
type LibrarySong = ReturnType<ReturnType<typeof trackQuery>["all"]>[number];
type Result = RecognizeResult<LibrarySong, YtAlbumSong>;

export interface RecognizeShape {
  readonly start: (source: RecognizeSource) => RecognizeView;
  readonly view: () => RecognizeView;
  readonly close: () => void;
  readonly audio: (session: number, pcm: Uint8Array) => void;
  readonly captureEnded: (session: number, why: RecognizeCaptureEnd) => void;
  readonly run: (action: RecognizeRunAction, playlistId?: number) => Promise<RecognizeRunResult>;
  /** Whether the window may capture [kind] now (`capturePermissions.ts`). */
  readonly allows: (kind: "microphone" | "systemAudio") => boolean;
}

export class Recognize extends Context.Service<Recognize, RecognizeShape>()(
  "@wave/desktop/Recognize",
) {}

export interface RecognizeOptions {
  readonly online: () => boolean;
  readonly microphone: () => "granted" | "denied";
  readonly systemAudio: Exclude<RecognizeCaptureVia, "microphone">;
  readonly catalogue: () => Catalogue;
  readonly language: () => AppLanguage;
  readonly events: (listener: (event: KotlinEvent) => void) => () => void;
  /** Opens the system's microphone privacy settings; null where there is no such page. */
  readonly openPrivacySettings: (() => Promise<void>) | null;
  /** A cover's https address as a data URL, or null. */
  readonly fetchCover: (url: string) => Promise<string | null>;
  readonly log: (level: "info" | "warn", line: string) => void;
}

/** The song's cover address on the card [card], if it shows one. */
const coverUrl = (card: RecognizeCard<LibrarySong, YtAlbumSong>): string | null => {
  switch (card.kind) {
    case "resolving":
      return card.song.coverUrl;
    case "resolved":
      return card.result.song.artworkUrl;
    case "ended":
      return card.end.kind === "match" ? card.end.song.coverUrl : null;
    default:
      return null;
  }
};

/** What a song saved to a playlist is: the Library's song when it has a YT Music one. */
const playlistSong = (db: LibraryDatabase, result: Result): PlaylistSong =>
  result.kind === "stream"
    ? (() => {
        const { track } = streamedLibraryFacts(db, result.song);
        return track === null
          ? ({ source: "stream", song: result.song } as const)
          : ({ source: "library", trackId: track.id } as const);
      })()
    : recognizePlaylistSong(result);

export const recognizeLayer = (options: RecognizeOptions) =>
  Layer.effect(
    Recognize,
    Effect.gen(function* () {
      const db = yield* Database;
      const kotlin = yield* Kotlin;
      const playback = yield* Playback;
      const yt = yield* YtMusic;
      const downloads = yield* Downloads;
      const call = (method: KotlinMethod, params: object) =>
        Effect.runPromise(kotlin.call(method, params as never));
      const session = createDesktopRecognize<LibrarySong, YtAlbumSong>({
        kotlin: (method, params) => call(method, params),
        events: options.events,
        online: options.online,
        microphone: options.microphone,
        systemAudio: options.systemAudio,
        locale: options.language,
        playback: {
          playing: playback.playing,
          pause: () => playback.pause(),
          play: () => playback.play(),
        },
        resolve: (song, signal) =>
          resolveRecognition(
            {
              library: async () => trackQuery(db, "files").all(),
              ytMusic: yt.enabled,
              search: async (_asker, query) => {
                if (!options.online()) return { ok: false, reason: "offline" };
                try {
                  const page = (await call("search", { query })) as { songs?: unknown };
                  return { ok: true, songs: ytSongs(page.songs) };
                } catch {
                  return { ok: false, reason: "failed" };
                }
              },
            },
            song,
            signal,
          ),
        log: options.log,
      });
      yield* Effect.addFinalizer(() => Effect.sync(session.dispose));

      const covers = new Map<string, string | null>();
      const cover = (url: string | null): string | null => {
        if (url === null || !url.startsWith("https://")) return null;
        if (!covers.has(url)) {
          covers.set(url, null);
          void options.fetchCover(url).then(
            (data) => covers.set(url, data),
            () => undefined,
          );
        }
        return covers.get(url) ?? null;
      };

      const streamPorts = (): StreamedSongPorts => ({
        db,
        ytMusic: yt.enabled,
        downloads,
        queue: (type, id) => playback.dispatch({ type, trackIds: [ytTrackId(id)] }),
        changed: playback.refresh,
      });

      /** A streamed song's download, as its menu shows it. */
      const downloadFacts = (song: YtAlbumSong) => {
        const { track, hasFile } = streamedLibraryFacts(db, song);
        return {
          inLibrary: hasFile,
          status:
            track !== null && !hasFile
              ? downloads.status(track.id)
              : downloads.ytStatus(song.videoId),
        };
      };

      const view = (): RecognizeView => {
        const { open, attempt, source, card, capture } = session.state();
        const result = card.kind === "resolved" ? card.result : null;
        const facts = result?.kind === "stream" ? downloadFacts(result.song) : null;
        return {
          open,
          attempt,
          source,
          card: recognizeCardView(
            card,
            {
              ytMusic: yt.enabled(),
              status: facts?.status ?? null,
              inLibrary: facts?.inLibrary ?? false,
              denied:
                options.openPrivacySettings === null ? ["tryAgain"] : ["openSettings", "tryAgain"],
            },
            options.catalogue(),
          ),
          capture,
          album: result?.kind === "library" ? result.track.albumId : null,
          cover: cover(coverUrl(card)),
        };
      };

      const shown = (): Result => {
        const { card } = session.state();
        if (card.kind !== "resolved") throw new Error("The card shows no song");
        return card.result;
      };

      const run = async (
        action: RecognizeRunAction,
        playlistId?: number,
      ): Promise<RecognizeRunResult> => {
        if (action === "openSettings") {
          await options.openPrivacySettings?.();
          return { kind: "done" };
        }
        const result = shown();
        if (result.kind === "stream") yt.keep([result.song]);
        switch (action) {
          case "play":
            if (result.kind === "library") {
              const started = await playback.activate([String(result.track.id)], 0, {
                kind: "search",
                id: null,
              });
              if (started.kind === "nothing") throw new Error("The song cannot play here");
            } else if (result.kind === "stream") await playback.startYt([result.song.videoId], 0);
            else throw new Error("The song has nothing to play");
            return { kind: "done" };
          case "playNext":
            if (result.kind === "library") {
              await playback.dispatch({ type: "playNext", trackIds: [String(result.track.id)] });
              return { kind: "queued", count: 1 };
            }
            if (result.kind !== "stream") throw new Error("The song has nothing to play");
            return (await runStreamedAction(
              streamPorts(),
              result.song,
              "playNext",
            )) as RecognizeRunResult;
          case "addToShazam": {
            const saved = addToShazam(
              db,
              syncedPreference(db, SHAZAM_PLAYLIST_SETTING),
              playlistSong(db, result),
              Date.now(),
              options.language(),
            );
            keepPreference(db, SHAZAM_PLAYLIST_SETTING, saved.syncId);
            // The playlist and the setting naming it go up with the next sync, as any edit does.
            playback.refresh();
            // The desktop's playlists list the Library's songs: a streamed one comes into it.
            if (result.kind === "stream") {
              const facts = downloadFacts(result.song);
              if (!facts.inLibrary && facts.status === null)
                await runStreamedAction(streamPorts(), result.song, "download");
            }
            return { kind: "shazam", message: saved.toast };
          }
          case "addToPlaylist": {
            if (playlistId === undefined) throw new Error("No playlist to add to");
            refuseCollaborative(db, playlistId);
            if (result.kind === "stream")
              return (await runStreamedAction(
                streamPorts(),
                result.song,
                "addToPlaylist",
                playlistId,
              )) as RecognizeRunResult;
            const added = addToPlaylist(db, playlistId, [playlistSong(db, result)], Date.now());
            playback.refresh();
            return {
              kind: "playlist",
              name: added.name,
              added: added.added,
              alreadyIn: added.alreadyIn,
            };
          }
          case "download":
          case "cancelDownload":
          case "retryDownload":
            if (result.kind !== "stream") throw new Error("Only a YT Music song downloads");
            await runStreamedAction(streamPorts(), result.song, action);
            return { kind: "done" };
        }
      };

      return {
        start: (source) => {
          session.start(source);
          return view();
        },
        view,
        close: session.close,
        audio: session.audio,
        captureEnded: session.captureEnded,
        run,
        allows: session.allows,
      };
    }),
  );
