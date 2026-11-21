/**
 * YT Music on the desktop (docs/spec-desktop.md): the account-wide setting, Search's YouTube
 * Music songs, the stream addresses the audio process asks for, and the covers the window
 * shows. The requests run in the JVM; this service decides what reaches the window.
 *
 * A stream address and its headers are the session's: they go to the audio process and are
 * never logged or shown.
 */
import { parseTrackId, type QueueEntry, type YtAlbumSong } from "@wave/core";
import { Database } from "@wave/client";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { YtStatus } from "../../shared/yt.ts";
import type { ResolvedStream } from "../audio/protocol.ts";
import { Kotlin } from "../kotlin/kotlin.ts";
import type { KotlinMethods } from "../kotlin/protocol.ts";
import { readRemoteImage } from "../library/remoteImage.ts";
import { preference, savePreference } from "../preferences.ts";

export interface YtSearch {
  readonly status: YtStatus;
  readonly songs: readonly YtAlbumSong[];
}

/** The phone's synced key and encoding: "off" is off, anything else (or nothing) is on. */
export const YT_MUSIC_SETTING = "settings.ytMusic";
/** The queue's YT Music songs, as the phone keeps them, for a cold start. */
export const QUEUED_YT_TRACKS = "playback.ytTracks";

type YtMethod = "search" | "resolveStream" | "setYtMusic";
/** A JVM call; rejects with an error carrying the JVM's `code`. */
export type YtCall = <M extends YtMethod>(
  method: M,
  params: KotlinMethods[M]["params"],
) => Promise<KotlinMethods[M]["result"]>;

export interface YtMusicDeps {
  readonly read: (key: string) => string | undefined;
  readonly save: (key: string, value: string) => void;
  readonly call: YtCall;
  readonly fetch?: typeof globalThis.fetch;
  /** The largest cover taken, in bytes. */
  readonly maxArtworkBytes?: number;
}

export interface YtMusicShape {
  readonly enabled: () => boolean;
  /** Tells the JVM the setting; call once it's up. */
  readonly start: () => Promise<void>;
  readonly setEnabled: (on: boolean) => Promise<void>;
  /** YouTube Music's songs for `query`. Never rejects. */
  readonly search: (query: string) => Promise<YtSearch>;
  /** A song a search or the saved queue named, by its video id. */
  readonly song: (videoId: string) => YtAlbumSong | undefined;
  /** Remembers songs another page brought (artist pages, radios, Related), so they can play. */
  readonly keep: (songs: readonly YtAlbumSong[]) => void;
  /** Keeps a large batch available until the play request has settled. */
  readonly withSongs: <A>(songs: readonly YtAlbumSong[], play: () => Promise<A>) => Promise<A>;
  /** Where the engine fetches `videoId` from; `fresh` skips the JVM's cached address. */
  readonly resolve: (videoId: string, fresh: boolean) => Promise<ResolvedStream>;
  /** Keeps the details of the YT Music songs in `entries` (a queue's) for the next launch. */
  readonly keepQueued: (entries: readonly QueueEntry[], undo?: readonly QueueEntry[]) => void;
  /** A cover from YouTube's image hosts as a data URL, or null. */
  readonly artwork: (url: string) => Promise<string | null>;
}

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** YouTube's image hosts; the window's CSP loads nothing else. */
const ARTWORK_HOSTS = [
  /^(lh|yt)\d\.googleusercontent\.com$/,
  /^i\d?\.ytimg\.com$/,
  /^yt\d\.ggpht\.com$/,
];
/** Songs a session remembers before the oldest are dropped. */
const KNOWN_LIMIT = 2_000;
const ARTWORK_LIMIT = 300;

const text = (value: unknown): value is string => typeof value === "string";

/** One song as the JVM answers it, or undefined when it isn't one. */
const ytSong = (value: unknown): YtAlbumSong | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const song = value as Record<string, unknown>;
  const artists = Array.isArray(song["artists"]) ? song["artists"].filter(text) : [];
  const videoId = song["videoId"];
  const title = song["title"];
  if (!text(videoId) || !VIDEO_ID.test(videoId) || !text(title)) return undefined;
  const optional = (key: string) => (text(song[key]) ? (song[key] as string) : null);
  const duration = song["durationMs"];
  return {
    videoId,
    title,
    artists,
    album: optional("album"),
    albumId: optional("albumId"),
    durationMs: typeof duration === "number" && Number.isFinite(duration) ? duration : null,
    artworkUrl: optional("artworkUrl"),
    explicit: song["explicit"] === true,
    videoType: optional("videoType"),
  };
};

export const ytSongs = (value: unknown): YtAlbumSong[] =>
  Array.isArray(value) ? value.flatMap((item) => ytSong(item) ?? []) : [];

const codeOf = (error: unknown): string | undefined => {
  const code = (error as { code?: unknown } | null)?.code;
  return text(code) ? code : undefined;
};

const coded = (code: string, message: string) => Object.assign(new Error(message), { code });

const artworkAllowed = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.port === "" &&
      ARTWORK_HOSTS.some((host) => host.test(parsed.hostname))
    );
  } catch {
    return false;
  }
};

export const createYtMusic = (deps: YtMusicDeps): YtMusicShape => {
  const fetchImage = deps.fetch ?? globalThis.fetch;
  const maxArtworkBytes = deps.maxArtworkBytes ?? 2_000_000;
  const known = new Map<string, YtAlbumSong>();
  let queued = new Map<string, YtAlbumSong>();
  const batches = new Set<ReadonlyMap<string, YtAlbumSong>>();
  const songOf = (videoId: string): YtAlbumSong | undefined => {
    for (const batch of batches) {
      const song = batch.get(videoId);
      if (song !== undefined) return song;
    }
    return queued.get(videoId) ?? known.get(videoId);
  };
  // A later search can know less about a song already seen (a radio often omits its album).
  const withDetails = (song: YtAlbumSong): YtAlbumSong => {
    const before = songOf(song.videoId);
    return before === undefined
      ? song
      : {
          ...song,
          album: song.album ?? before.album,
          albumId: song.albumId ?? before.albumId,
          artworkUrl: song.artworkUrl ?? before.artworkUrl,
          durationMs: song.durationMs ?? before.durationMs,
        };
  };
  const remember = (song: YtAlbumSong) => {
    const updated = withDetails(song);
    known.delete(song.videoId);
    known.set(song.videoId, updated);
    if (queued.has(song.videoId)) queued.set(song.videoId, updated);
    if (known.size > KNOWN_LIMIT) known.delete(known.keys().next().value!);
  };
  const songsFor = (entries: readonly QueueEntry[]) => {
    const songs = new Map<string, YtAlbumSong>();
    for (const { trackId } of entries) {
      const ref = parseTrackId(trackId);
      if (ref?.kind !== "yt" || songs.has(ref.videoId)) continue;
      const song = songOf(ref.videoId);
      if (song) songs.set(ref.videoId, song);
    }
    return songs;
  };
  try {
    for (const song of ytSongs(JSON.parse(deps.read(QUEUED_YT_TRACKS) ?? "[]")))
      queued.set(song.videoId, song);
  } catch {
    // A queue saved by a broken build: its songs are skipped like any unknown song.
  }
  const covers = new Map<string, Promise<string | null>>();
  const enabled = () => deps.read(YT_MUSIC_SETTING) !== "off";
  const tell = () => deps.call("setYtMusic", { enabled: enabled() }).catch(() => undefined);

  const cover = (url: string) => readRemoteImage(fetchImage, url, maxArtworkBytes);

  return {
    enabled,
    start: async () => {
      await tell();
    },
    setEnabled: async (on) => {
      deps.save(YT_MUSIC_SETTING, on ? "on" : "off");
      await tell();
    },
    search: async (query) => {
      const trimmed = query.trim();
      if (!enabled()) return { status: "disabled", songs: [] };
      if (trimmed === "") return { status: "ok", songs: [] };
      try {
        const page = (await deps.call("search", { query: trimmed })) as { songs?: unknown } | null;
        const songs = ytSongs(page?.songs);
        for (const song of songs) remember(song);
        return { status: "ok", songs };
      } catch (error) {
        const code = codeOf(error);
        const status: YtStatus =
          code === "ERR_YT_OFFLINE"
            ? "offline"
            : code === "ERR_YT_DISABLED"
              ? "disabled"
              : "failed";
        return { status, songs: [] };
      }
    },
    song: songOf,
    keep: (songs) => {
      for (const song of songs) remember(song);
    },
    withSongs: async (songs, play) => {
      const batch = new Map(songs.map((song) => [song.videoId, withDetails(song)]));
      batches.add(batch);
      try {
        return await play();
      } finally {
        batches.delete(batch);
      }
    },
    resolve: async (videoId, fresh) => {
      if (!enabled()) throw coded("ERR_YT_DISABLED", "YT Music is off");
      const found = await deps.call("resolveStream", { videoId, fresh });
      const headers = Object.fromEntries(
        Object.entries(found?.headers ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
      if (
        !text(found?.url) ||
        !found.url.startsWith("https://") ||
        !Number.isSafeInteger(found.itag)
      )
        throw coded("ERR_YT_FAILED", "YouTube sent no usable address");
      return {
        url: found.url,
        headers,
        mimeType: text(found.mimeType) ? found.mimeType : "",
        itag: found.itag,
        contentLength:
          typeof found.contentLength === "number" && found.contentLength > 0
            ? found.contentLength
            : null,
      };
    },
    keepQueued: (entries, undo = []) => {
      const current = songsFor(entries);
      queued = new Map([...songsFor(undo), ...current]);
      deps.save(QUEUED_YT_TRACKS, JSON.stringify([...current.values()]));
    },
    artwork: (url) => {
      if (!artworkAllowed(url)) return Promise.resolve(null);
      const kept = covers.get(url);
      if (kept !== undefined) return kept;
      const fetched = cover(url);
      covers.set(url, fetched);
      // A cover that didn't arrive is asked for again next time.
      void fetched.then((data) => data === null && covers.delete(url));
      if (covers.size > ARTWORK_LIMIT) covers.delete(covers.keys().next().value!);
      return fetched;
    },
  };
};

export class YtMusic extends Context.Service<YtMusic, YtMusicShape>()("@wave/desktop/YtMusic") {}

/** YtMusic over the Library's settings and the JVM. */
export const ytMusicLayer = (options: { readonly fetch?: typeof globalThis.fetch } = {}) =>
  Layer.effect(
    YtMusic,
    Effect.gen(function* () {
      const db = yield* Database;
      const kotlin = yield* Kotlin;
      const yt = createYtMusic({
        read: (key) => preference(db, key),
        save: (key, value) => savePreference(db, key, value),
        call: (method, params) => Effect.runPromise(kotlin.call(method, params)),
        ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      });
      // Written to the JVM now, ahead of any later call, and never waited for: Wave's start
      // doesn't hang on a JVM that is slow or silent. It never rejects.
      void yt.start();
      return yt;
    }),
  );
