/**
 * The decisions the download journal (Kotlin's `DurableDownloads`) leases to main, answered as
 * the phone's `YtDownloads.answer` does: the source, tags and place of a download (prepare),
 * whether the audio that arrived is the song (confirm), where in the Library's folders it lands
 * (publish) and its import into the Library (import). Every rule is Core's; this module only
 * gathers what they read, through [AnswerDeps].
 */
import {
  downloadFailureAnswer,
  downloadFailurePlan,
  downloadJobKind,
  downloadSource,
  missingSongJob,
  missingSongLookup,
  missingSongSearch,
  missingSongTags,
  missingSongVideo,
  scanPath,
  scanPathWithin,
  soulseekCandidates,
  soulseekQuery,
  soulseekReceivedMatches,
  spotifySearchQuery,
  ytAudioRejection,
  ytAudioTrack,
  ytDownloadDestination,
  ytDownloadHas,
  ytDownloadLookup,
  ytDownloadTags,
  type DownloadDecision,
  type DownloadFailurePlan,
  type DownloadSource,
  type FoundTags,
  type IndexedTags,
  type MissingSongVideo,
  type MissingTrack,
  type SongLookup,
  type SoulseekCandidate,
  type SoulseekReceivedTags,
  type YtAlbum,
  type YtDownloadFailure,
  type YtDownloadTags,
  type YtSong,
} from "@wave/core";

import type { SoulseekSession } from "../kotlin/protocol.ts";

/** The Library's folders a download goes to, and the journal's revision of them. */
export interface DownloadPolicy {
  readonly roots: readonly { readonly path: string; readonly isDefault: boolean }[];
  readonly excludedFolders: readonly string[];
  /** What `downloads.refreshPolicy` answered for these folders. */
  readonly revision: number;
}

/** What the answers read: the Library, the settings, YT Music's pages, Soulseek and the lookups. */
export interface AnswerDeps {
  /** The folders now, sent to the journal first (`downloads.refreshPolicy`). */
  readonly policy: () => Promise<DownloadPolicy>;
  readonly ytMusicOn: () => boolean;
  /** Soulseek's session: anything but off means Download in best quality is on. */
  readonly session: () => Promise<SoulseekSession>;
  readonly soulseekSearch: (query: string) => Promise<readonly SoulseekCandidate[]>;
  readonly watchSong: (
    videoId: string,
  ) => Promise<{ readonly albumId: string | null; readonly lyricsBrowseId: string | null }>;
  readonly album: (browseId: string) => Promise<YtAlbum>;
  readonly ytLyrics: (browseId: string) => Promise<string | null>;
  /** YT Music's Songs search. */
  readonly ytSearch: (query: string) => Promise<readonly YtSong[]>;
  readonly lookUp: (song: SongLookup, has?: IndexedTags) => Promise<FoundTags | null>;
  /** The missing songs among Tracks [ids], as the Library has them now. */
  readonly missingSongs: (
    ids: readonly number[],
  ) => readonly MissingTrack[] | Promise<readonly MissingTrack[]>;
  /** Puts the file at [path] in the Library: with the video it came from, filling Track [fills]. */
  readonly importFile: (
    path: string,
    made: { readonly videoId: string | null; readonly fills: number | null },
  ) => Promise<void>;
  readonly log?: (level: "info" | "warn", message: string) => void;
  /** How long a download waits for optional metadata (an album page, lyrics); 3 s, as the phone. */
  readonly optionalMs?: number;
  /** The JVM saves Windows paths with backslashes; the Library keeps forward slashes. */
  readonly platform?: string;
}

/** A decision the journal leased: the job as `downloads.claim` answers it. */
export interface DownloadClaim {
  readonly id: string;
  readonly song: YtSong & { readonly albumId?: string | null };
  readonly generation: number;
  readonly token: string;
  readonly decision: DownloadDecision;
  readonly phase?: string;
  readonly source?: DownloadSource;
  readonly tags?: YtDownloadTags;
  readonly targetPath?: string;
  readonly video?: string;
  readonly fellBackFrom?: YtDownloadFailure;
  readonly failurePlan?: DownloadFailurePlan;
  readonly fallback?: unknown;
  readonly audio?: {
    readonly durationMs: number;
    readonly receivedTags?: SoulseekReceivedTags;
  };
  readonly receiptId?: string;
  readonly saved?: { readonly path: string };
}

/** A download failing for [reason]: the answer the journal gets says so. */
export class DownloadFailed extends Error {
  readonly reason: YtDownloadFailure;
  constructor(reason: YtDownloadFailure, cause?: unknown) {
    super(`Download failed: ${reason}`, { cause });
    this.reason = reason;
  }
}

const codeOf = (error: unknown): string | undefined => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
};

/** A JVM call's error as a download's failure, by its code, as the phone's `failure`. */
export const downloadFailure = (cause: unknown): DownloadFailed => {
  const code = codeOf(cause);
  const reason: YtDownloadFailure =
    code === "ERR_SLSK_SIGNED_OUT"
      ? "account"
      : code === "ERR_SLSK_AUTH"
        ? "accountRejected"
        : code === "ERR_SLSK_UNREACHABLE"
          ? "unreachable"
          : code === "ERR_SLSK_OFFLINE" || code === "ERR_YT_OFFLINE"
            ? "offline"
            : code === "ERR_SLSK_STORAGE" || code === "ERR_YT_STORAGE"
              ? "storage"
              : code === "ERR_SLSK_INVALID_AUDIO" ||
                  code === "ERR_SLSK_PEER" ||
                  code === "ERR_SLSK_QUEUED"
                ? "unavailable"
                : code === "ERR_YT_DISABLED"
                  ? "noSource"
                  : "failed";
  return new DownloadFailed(reason, cause);
};

const native = async <A>(call: () => Promise<A>): Promise<A> => {
  try {
    return await call();
  } catch (error) {
    throw downloadFailure(error);
  }
};

type Settled<A> =
  { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: DownloadFailed };

const settle = async <A>(call: () => Promise<A>): Promise<Settled<A>> => {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    return { ok: false, error: error instanceof DownloadFailed ? error : downloadFailure(error) };
  }
};

/** YouTube Music's fallback for a Soulseek job, as the journal keeps it. */
interface FallbackPlan {
  readonly source: "youtube";
  readonly video?: string;
  readonly prepare?: true;
  readonly targetPath: string;
  readonly failurePlan: DownloadFailurePlan;
}

export interface Answers {
  /** The payload `downloads.submit` sends for [claim]; a failure is answered, never thrown. */
  readonly answer: (claim: DownloadClaim) => Promise<object>;
}

export const createAnswers = (deps: AnswerDeps): Answers => {
  const optionalMs = deps.optionalMs ?? 3_000;
  const log = deps.log ?? (() => {});

  /** [call]'s value, or null when it fails or takes longer than metadata may. */
  const optional = async <A>(call: () => Promise<A>): Promise<A | null> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), optionalMs);
    });
    try {
      return await Promise.race([call().catch(() => null), late]);
    } finally {
      clearTimeout(timer);
    }
  };

  /** A YT Music song's tags: its album page, the lookups and, without lyrics, YT Music's. */
  const metadata = async (song: DownloadClaim["song"]): Promise<YtDownloadTags> => {
    let watchPage: ReturnType<AnswerDeps["watchSong"]> | undefined;
    const watch = () => (watchPage ??= deps.watchSong(song.videoId));
    const album = await optional(async () => {
      const albumId = song.albumId ?? (await watch()).albumId;
      return albumId === null ? null : await deps.album(albumId);
    });
    const has = ytDownloadHas(null);
    const lookup = ytDownloadLookup(song, album);
    const found = lookup === null ? null : await optional(() => deps.lookUp(lookup, has));
    const lyrics =
      found !== null && found.lyrics !== null
        ? null
        : await optional(async () => {
            const { lyricsBrowseId } = await watch();
            return lyricsBrowseId === null ? null : await deps.ytLyrics(lyricsBrowseId);
          });
    return ytDownloadTags(song, album, found, lyrics);
  };

  /** The song's audio track from a Songs search, in place of a music video; undefined keeps its own. */
  const audioTrack = async (song: YtSong): Promise<string | undefined> => {
    if (song.videoType === "MUSIC_VIDEO_TYPE_OMV") return undefined;
    const results = await deps.ytSearch(spotifySearchQuery(song)).catch(() => null);
    return ytAudioTrack(song, results) ?? undefined;
  };

  const searchSoulseek = (song: YtSong): Promise<Settled<readonly SoulseekCandidate[]>> => {
    const query = soulseekQuery(song);
    return query === ""
      ? Promise.resolve({ ok: false, error: new DownloadFailed("unavailable") })
      : settle(() => native(() => deps.soulseekSearch(query)));
  };

  const soulseekAnswer = (
    song: YtSong,
    found: Settled<readonly SoulseekCandidate[]>,
    tags: YtDownloadTags,
    { roots, excludedFolders }: DownloadPolicy,
    ytMusicOn: boolean,
    youtube: Pick<FallbackPlan, "video" | "prepare">,
  ): object => {
    const m4a = ytMusicOn ? ytDownloadDestination(roots, excludedFolders, tags, "youtube") : null;
    const failurePlan = downloadFailurePlan("soulseek", { ytMusicOn: m4a !== null });
    const fallback: { readonly fallback?: FallbackPlan } =
      m4a === null
        ? {}
        : {
            fallback: {
              source: "youtube",
              ...youtube,
              targetPath: m4a.path,
              failurePlan: downloadFailurePlan("youtube", { ytMusicOn }),
            },
          };
    if (!found.ok) return { failure: found.error.reason, tags, failurePlan, ...fallback };
    const candidates = soulseekCandidates(song, found.value);
    if (candidates.length === 0) return { failure: "unavailable", tags, failurePlan, ...fallback };
    const target = ytDownloadDestination(roots, excludedFolders, tags, "soulseek");
    if (target === null) throw new DownloadFailed("noFolder");
    return {
      source: "soulseek",
      candidates,
      tags,
      targetPath: target.path,
      failurePlan,
      ...fallback,
    };
  };

  const prepareSong = async (song: DownloadClaim["song"]): Promise<object> => {
    const policy = await deps.policy();
    if (policy.roots.length === 0) throw new DownloadFailed("noFolder");
    const ytMusicOn = deps.ytMusicOn();
    const session = await native(() => deps.session());
    const source = downloadSource({ ytMusicOn, bestQuality: session.status !== "off" });
    if (source === null) throw new DownloadFailed("noSource");
    if (source === "youtube") {
      const [tags, video] = await Promise.all([metadata(song), audioTrack(song)]);
      const target = ytDownloadDestination(policy.roots, policy.excludedFolders, tags, source);
      if (target === null) throw new DownloadFailed("noFolder");
      return {
        source,
        ...(video === undefined ? {} : { video }),
        candidates: [],
        tags,
        targetPath: target.path,
        failurePlan: downloadFailurePlan(source, { ytMusicOn }),
      };
    }
    const [found, tags] = await Promise.all([searchSoulseek(song), metadata(song)]);
    return soulseekAnswer(song, found, tags, policy, ytMusicOn, { prepare: true });
  };

  /** YouTube Music's turn on a Soulseek job it carries on: the song's audio track, now. */
  const prepareFallback = async (claim: DownloadClaim): Promise<object> => {
    if (!deps.ytMusicOn()) throw new DownloadFailed("noSource");
    const { tags, targetPath } = claim;
    if (tags === undefined || targetPath === undefined) throw new DownloadFailed("failed");
    const video =
      downloadJobKind(claim.id).kind === "song" ? await audioTrack(claim.song) : undefined;
    return {
      source: "youtube",
      ...(video === undefined ? {} : { video }),
      candidates: [],
      tags,
      targetPath,
      failurePlan: downloadFailurePlan("youtube", { ytMusicOn: true }),
    };
  };

  /** A video's album cover, read as a YT Music song's download reads its album. */
  const withCover = async (video: MissingSongVideo | null): Promise<MissingSongVideo | null> => {
    if (video === null || video.artworkUrl !== null) return video;
    const artworkUrl = await optional(async () => {
      const { albumId } = await deps.watchSong(video.videoId);
      return albumId === null ? null : (await deps.album(albumId)).artworkUrl;
    });
    return { ...video, artworkUrl };
  };

  const prepareMissingSong = async (trackId: number): Promise<object> => {
    const policy = await deps.policy();
    const track = (await deps.missingSongs([trackId]))[0];
    // Gone, or filled in since: nothing is left to download.
    if (track === undefined) throw new DownloadFailed("failed");
    if (policy.roots.length === 0) throw new DownloadFailed("noFolder");
    const job = missingSongJob(track);
    const ytMusicOn = deps.ytMusicOn();
    const session = await native(() => deps.session());
    const source = downloadSource({
      ytMusicOn,
      bestQuality: session.status !== "off",
      video: job.missing.videoId !== null,
    });
    if (source === null) throw new DownloadFailed("noSource");
    const search = missingSongSearch(job);
    const findVideo = async (): Promise<MissingSongVideo | null> => {
      if (!ytMusicOn) return null;
      if (search === null) return withCover(missingSongVideo(job, null));
      return missingSongVideo(job, await native(() => deps.ytSearch(search)));
    };
    const lookup = missingSongLookup(job);
    const findTags = () =>
      lookup === null ? Promise.resolve(null) : optional(() => deps.lookUp(lookup));
    if (source === "youtube") {
      const [video, found] = await Promise.all([findVideo(), findTags()]);
      if (video === null) throw new DownloadFailed("notFound");
      const tags = missingSongTags(job, found, video.artworkUrl);
      const target = ytDownloadDestination(policy.roots, policy.excludedFolders, tags, source);
      if (target === null) throw new DownloadFailed("noFolder");
      return {
        source,
        video: video.videoId,
        candidates: [],
        tags,
        targetPath: target.path,
        failurePlan: downloadFailurePlan(source, { ytMusicOn }),
      };
    }
    const [peers, video, found] = await Promise.all([
      searchSoulseek(job),
      findVideo().catch(() => null),
      findTags(),
    ]);
    const tags = missingSongTags(job, found, video?.artworkUrl ?? null);
    return soulseekAnswer(
      job,
      peers,
      tags,
      policy,
      ytMusicOn && video !== null,
      video === null ? {} : { video: video.videoId },
    );
  };

  const prepare = (claim: DownloadClaim): Promise<object> => {
    if (claim.fellBackFrom !== undefined && claim.source === "youtube")
      return prepareFallback(claim);
    const job = downloadJobKind(claim.id);
    if (job.kind === "missing") return prepareMissingSong(job.trackId);
    // Quality replacements and unsearched songs aren't made on the desktop.
    if (job.kind !== "song") throw new DownloadFailed("failed");
    return prepareSong(claim.song);
  };

  const confirm = (claim: DownloadClaim): object => {
    if (claim.audio === undefined) throw new DownloadFailed("failed");
    const { durationMs, receivedTags } = claim.audio;
    if (receivedTags === undefined) {
      // YouTube's M4A: the song when it plays as long.
      const rejection = ytAudioRejection(claim.song, durationMs);
      if (rejection === null) return { receiptId: claim.receiptId, acceptable: true };
      log("warn", `A YouTube download isn't the song: ${rejection}`);
      return { receiptId: claim.receiptId, acceptable: false, cause: rejection };
    }
    const acceptable = soulseekReceivedMatches(claim.song, receivedTags, durationMs);
    if (!acceptable) log("warn", "A received Soulseek file isn't the recording");
    return { receiptId: claim.receiptId, acceptable };
  };

  const publish = async (claim: DownloadClaim): Promise<object> => {
    const { roots, excludedFolders, revision } = await deps.policy();
    if (claim.tags === undefined) throw new DownloadFailed("failed");
    const target = ytDownloadDestination(
      roots,
      excludedFolders,
      claim.tags,
      claim.source ?? "soulseek",
    );
    if (target === null) throw new DownloadFailed("noFolder");
    return { targetPath: target.path, revision };
  };

  const importDownload = async (claim: DownloadClaim): Promise<object> => {
    if (claim.saved === undefined) throw new DownloadFailed("failed");
    const platform = deps.platform ?? process.platform;
    const path = scanPath(claim.saved.path, platform);
    const { roots, excludedFolders } = await deps.policy();
    if (
      !roots.some((root) => scanPathWithin(path, root.path, platform)) ||
      excludedFolders.some((folder) => scanPathWithin(path, folder, platform))
    )
      throw new DownloadFailed("noFolder");
    const job = downloadJobKind(claim.id);
    const fills = job.kind === "missing" ? job.trackId : null;
    const videoId =
      claim.source !== "youtube"
        ? null
        : (claim.video ?? (job.kind === "song" ? claim.song.videoId : null));
    await deps.importFile(path, { videoId, fills });
    // The JVM matches the answer against the path it saved.
    return { path: claim.saved.path };
  };

  const decide = async (claim: DownloadClaim): Promise<object> => {
    switch (claim.decision) {
      case "prepare":
        return prepare(claim);
      case "confirm":
        return confirm(claim);
      case "publish":
        return publish(claim);
      case "import":
        return importDownload(claim);
    }
  };

  return {
    answer: async (claim) => {
      try {
        return await decide(claim);
      } catch (error) {
        const decided = error instanceof DownloadFailed;
        if (!decided) log("warn", `The ${claim.decision} decision failed: ${String(error)}`);
        return downloadFailureAnswer(
          claim.decision,
          decided ? error.reason : "failed",
          decided ? error.cause : error,
          {
            failurePlan:
              claim.failurePlan ??
              downloadFailurePlan(claim.source ?? "soulseek", { ytMusicOn: deps.ytMusicOn() }),
            fallback: claim.fallback,
            tags: claim.tags,
          },
        );
      }
    },
  };
};
