/**
 * Downloads on the desktop, as the phone's `YtDownloads` runs them: main follows the JVM's
 * download journal (`downloads.changes`, on each `downloadsChanged` event and every few seconds
 * while songs are on their way), answers the decisions it leases ([DownloadsDeps.answer]) and
 * asks it for YT Music songs and missing songs from the source Core picks (`downloadSource`).
 * The journal works only while the computer is online ([DownloadsShape.setOnline]).
 */
import {
  applyJournalChanges,
  FAVORITES_DOWNLOAD_ORIGIN,
  downloadRunProgress,
  downloadSource,
  followDownloadRun,
  joinArtists,
  missingSongJob,
  missingSongJobId,
  missingSongTrackId,
  missingSongsDownload,
  NO_DOWNLOAD_RUN,
  readStarDownloads,
  readSyncedStars,
  soulseekRecording,
  starAskedAfter,
  STAR_ASKED_SETTING as STAR_ASKED,
  starredDownload,
  SYNCED_STARS_SETTING as SEEN_STARS,
  syncedStarDownloads,
  unstarredDownload,
  writeStarDownloads,
  writeSyncedStars,
  ytDownloadAwaitsAnswer,
  ytDownloadProgress,
  ytDownloadsFromJournal,
  ytDownloadSharedJob,
  ytDownloadUnfinished,
  type Catalogue,
  type DownloadOrigin,
  type DownloadRun,
  type DownloadSource,
  type MissingSongJob,
  type MissingSongsDownloadAction,
  type MissingTrack,
  type YtDownloadJournalJob,
  type YtSong,
  type YtDownloadStatus,
} from "@wave/core";

import type { Page } from "../../shared/bridge.ts";
import type {
  DownloadRow,
  DownloadsView,
  MissingSongsList,
  MissingSongsView,
} from "../../shared/downloads.ts";
import type { KotlinDownloadMethod, KotlinMethods, SoulseekSession } from "../kotlin/protocol.ts";
import type { DownloadClaim } from "./decisions.ts";
import { appendFileSync } from "node:fs";
const diag = (line: string) => {
  const file = process.env["TRACE_LOG"];
  if (file)
    try {
      appendFileSync(
        file,
        `${Date.now()} ${line}
`,
      );
    } catch {}
};

/** A journal call; rejects with an error carrying the JVM's `code`. */
export type DownloadCall = <M extends KotlinDownloadMethod>(
  method: M,
  params: KotlinMethods[M]["params"],
) => Promise<KotlinMethods[M]["result"]>;

export interface DownloadsDeps {
  readonly call: DownloadCall;
  /** The payload `downloads.submit` sends for a leased decision (`createAnswers`). */
  readonly answer: (claim: DownloadClaim) => Promise<object>;
  /** The Library's missing songs ([ids] only, when given). */
  readonly missingSongs: (ids?: readonly number[]) => readonly MissingTrack[];
  /**
   * A page's songs in page order (the missing ones among them download) and the source its
   * downloads group under; null for no such album, artist, genre or playlist.
   */
  readonly list: (
    list: MissingSongsList,
  ) => { readonly ids: readonly number[]; readonly origin: DownloadOrigin | null } | null;
  /** A YT Music song a search found, by its video id. */
  readonly ytSong: (videoId: string) => YtSong | undefined;
  readonly ytMusicOn: () => boolean;
  /** The lines' language. */
  readonly catalogue: Catalogue;
  /** The Library's starred songs, by Track id; none by default. */
  readonly favorites?: () => ReadonlySet<number>;
  /** Where what the stars asked for is kept on this computer, never synced. */
  readonly store?: StarStore;
  readonly now?: () => number;
  /** The re-read while songs are on their way, in case an event was missed. */
  readonly pollMs?: number;
  /** How often a decision being worked out renews its lease (the journal's is 45 s). */
  readonly renewMs?: number;
}

export interface DownloadsShape {
  /** Reads the journal and starts it when online; call once the JVM is up (and after a restart). */
  readonly start: (online: boolean) => Promise<void>;
  /** The journal changed (`downloadsChanged`): reads what changed and answers what waits. */
  readonly refresh: () => Promise<void>;
  readonly view: () => DownloadsView;
  readonly status: (trackId: number) => YtDownloadStatus | null;
  /** A YT Music song's download, by its video id. */
  readonly ytStatus: (videoId: string) => YtDownloadStatus | null;
  readonly rows: (offset: number, limit: number) => Page<DownloadRow>;
  /** A page's missing songs and their downloads; null for no such page. */
  readonly listView: (list: MissingSongsList) => MissingSongsView | null;
  /**
   * Downloads YT Music songs a search found. With [by] `star`, a star asked rather than the
   * owner, so [unstarred] takes the download back.
   */
  readonly yt: (videoIds: readonly string[], by?: "star") => Promise<void>;
  /** Downloads missing songs, each into its Track (a missing song's click, or its star with [by]). */
  readonly missing: (trackIds: readonly number[], by?: "star") => Promise<void>;
  /** The stars of the jobs [ids] came off: each download only its star asked for is taken back. */
  readonly unstarred: (ids: readonly string[]) => Promise<void>;
  /** Download All, Retry Failed or Cancel on every missing song, or [list]'s, in its order. */
  readonly missingAction: (
    action: MissingSongsDownloadAction,
    list?: MissingSongsList,
  ) => Promise<void>;
  /** Asks again for the failed songs [ids], or every failed song. */
  readonly retry: (ids?: readonly string[]) => Promise<void>;
  readonly cancel: (ids: readonly string[]) => Promise<void>;
  /** The failed songs leave the list and the journal. */
  readonly clearFailed: () => Promise<void>;
  /** Pauses the journal offline and goes on once back. */
  readonly setOnline: (online: boolean) => Promise<void>;
  /** Download in best quality: Soulseek's session is on. */
  readonly bestQuality: () => Promise<boolean>;
  readonly setBestQuality: (on: boolean) => Promise<boolean>;
  /**
   * A star means downloaded (docs/spec.md, "A star means downloaded"): each starred missing song
   * the stars haven't asked for yet joins the queue under Favorites, and a star taken off, here
   * or on another device, takes back the download only it asked for. Run after a star changed,
   * a sync pulled stars or missing songs, and once the journal starts.
   */
  readonly syncStars: () => Promise<void>;
  readonly dispose: () => void;
}

/** A small key-value store on this computer. */
export interface StarStore {
  readonly read: (key: string) => string | null;
  /** Null forgets [key]. */
  readonly write: (key: string, value: string | null) => void;
}

/** A job as the journal hands it over: Core's journal job, with the YT Music song it was asked as. */
type Job = YtDownloadJournalJob<YtSong>;

interface JobRequest {
  readonly song: YtSong;
  readonly recording: object;
  readonly equivalentId: string | null;
  readonly source: DownloadSource | null;
  readonly origin: DownloadOrigin | null;
}

/** What the journal holds of missing song [job]: a YT Music song named after its Track. */
const journalSong = (job: MissingSongJob): YtSong & { readonly albumId: null } => ({
  videoId: job.videoId,
  title: job.title,
  artists: job.artists,
  album: job.album,
  durationMs: job.durationMs,
  artworkUrl: null,
  explicit: false,
  albumId: null,
});

export const createDownloads = (deps: DownloadsDeps): DownloadsShape => {
  const now = deps.now ?? Date.now;
  const pollMs = deps.pollMs ?? 5_000;
  const renewMs = deps.renewMs ?? 20_000;

  let followed: readonly Job[] = [];
  let revision = 0;
  let notice: DownloadsView["notice"] = null;
  let noticeId = 0;
  let statuses = new Map<string, YtDownloadStatus>();
  let run: DownloadRun = NO_DOWNLOAD_RUN;
  let online = true;
  let started = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  let disposed = false;
  const answering = new Set<string>();

  /** Claims and answers [id]'s decision, renewing its lease meanwhile; a lost lease is offered again. */
  const answerJob = async (id: string): Promise<void> => {
    if (answering.has(id)) return;
    answering.add(id);
    let renewing: ReturnType<typeof setInterval> | undefined;
    try {
      const claim = (await deps.call("downloads.claim", { id })) as DownloadClaim | null;
      if (claim === null || typeof claim !== "object") return;
      renewing = setInterval(() => {
        deps
          .call("downloads.renew", {
            id: claim.id,
            generation: claim.generation,
            token: claim.token,
          })
          .catch(() => {});
      }, renewMs);
      const payload = await deps.answer(claim);
      clearInterval(renewing);
      await deps.call("downloads.submit", {
        id: claim.id,
        generation: claim.generation,
        token: claim.token,
        decision: claim.decision,
        payload,
      });
    } catch {
      // The JVM went away mid-answer: its lease expires and the decision is offered again.
    } finally {
      clearInterval(renewing);
      answering.delete(id);
    }
  };

  let refreshing: Promise<void> | undefined;
  let again = false;
  const readJournal = async () => {
    do {
      diag(`journal read again=${again}`);
      again = false;
      const changes = await deps.call("downloads.changes", { revision });
      followed = applyJournalChanges(followed, {
        revision: changes.revision,
        jobs: (changes.jobs ?? []) as readonly Job[],
        ids: changes.ids ?? null,
      });
      revision = changes.revision;
      statuses = new Map(
        ytDownloadsFromJournal(followed).jobs.map((job) => [job.song.videoId, job.status]),
      );
      run = followDownloadRun(run, followed, now());
      for (const job of followed) if (ytDownloadAwaitsAnswer(job)) void answerJob(job.id);
      const active = followed.some(ytDownloadUnfinished);
      if (active && poll === undefined && !disposed)
        poll = setInterval(() => void refresh().catch(() => {}), pollMs);
      if (!active && poll !== undefined) {
        clearInterval(poll);
        poll = undefined;
      }
    } while (again);
  };
  /** Coalesces overlapping reads: one more read follows the one running. */
  const refresh = (): Promise<void> => {
    if (refreshing !== undefined) {
      again = true;
      return refreshing;
    }
    refreshing = readJournal().finally(() => {
      refreshing = undefined;
    });
    return refreshing;
  };

  const session = async (): Promise<SoulseekSession> => {
    try {
      return await deps.call("soulseek.session", {});
    } catch {
      return { status: "off", username: null };
    }
  };
  const sourceFor = (current: SoulseekSession, video = false) =>
    downloadSource({
      ytMusicOn: deps.ytMusicOn(),
      bestQuality: current.status !== "off",
      video,
    });

  const missingSongRequest = (
    job: MissingSongJob,
    current: SoulseekSession,
    origin: DownloadOrigin | null = null,
  ): JobRequest => ({
    song: journalSong(job),
    recording: soulseekRecording(job),
    equivalentId: null,
    source: sourceFor(current, job.missing.videoId !== null),
    origin,
  });

  /** One request at a time, so a second click sees the first one's job. */
  let requests: Promise<unknown> = Promise.resolve();
  const queued = <A>(work: () => Promise<A>): Promise<A> => {
    const next = requests.then(work);
    requests = next.catch(() => {});
    return next;
  };
  /** [told]: the window says the downloads started; a star's say nothing, the star is the toast. */
  const enqueue = async (asked: readonly JobRequest[], told = true) => {
    if (asked.length === 0) return;
    const active = new Set(followed.filter(ytDownloadUnfinished).map((job) => job.id));
    const count = asked.filter((request) => !active.has(request.song.videoId)).length;
    await deps.call("downloads.enqueueAll", { requests: asked });
    if (count > 0 && told) notice = { id: ++noticeId, count };
    if (online) await deps.call("downloads.start", {}).catch(() => null);
    await refresh();
  };
  const missingJobs = (ids?: readonly number[]): MissingSongJob[] => {
    const found = deps.missingSongs(ids).map(missingSongJob);
    if (ids === undefined) return found;
    const byTrack = new Map(found.map((job) => [job.missing.trackId, job]));
    return ids.flatMap((id) => byTrack.get(id) ?? []);
  };

  const store: StarStore = deps.store ?? { read: () => null, write: () => {} };
  /** The owner asked for [ids] themselves: they carry on whatever happens to the stars. */
  const ownerAsked = (ids: readonly string[]) => {
    const asked = readStarDownloads(store.read(STAR_ASKED));
    const after = starAskedAfter(asked, { kind: "ownerAsked", ids });
    if (after !== asked) store.write(STAR_ASKED, writeStarDownloads(after));
  };

  /** A star asked for [ids], or with no [by] the owner did. */
  const askedBy = (by: "star" | undefined, ids: readonly string[]) => {
    if (by === undefined) return ownerAsked(ids);
    const asked = readStarDownloads(store.read(STAR_ASKED));
    const after = starAskedAfter(asked, { kind: "starred", queued: ids });
    if (after !== asked) store.write(STAR_ASKED, writeStarDownloads(after));
  };

  const failedJobs = () =>
    followed.filter(
      (job) =>
        job.phase === "failed" || (job.importFailure !== undefined && job.phase !== "cancelled"),
    );

  const missingView = (missing: readonly MissingSongJob[]): MissingSongsView => {
    const download = missingSongsDownload(missing, followed, deps.catalogue);
    return {
      count: missing.length,
      line: download.line,
      actions: download.actions,
      notFound: download.summary?.line ?? null,
    };
  };

  /** The rows: songs on their way and failed ones, in the journal's order. */
  const shownRows = (): DownloadRow[] =>
    ytDownloadsFromJournal(followed)
      .jobs.filter((job) => job.status.kind !== "done")
      .map(({ song, status }) => ({
        id: song.videoId,
        title: song.title,
        artist: joinArtists(song.artists),
        album: song.album ?? "",
        artworkUrl: song.artworkUrl,
        status,
      }));

  const progress = (): number | null => {
    const overall = downloadRunProgress(run).overall;
    if (overall === null || overall.total === 0) return null;
    const kept = followed.filter((job) => job.phase !== "cancelled");
    const statuses = new Map(
      ytDownloadsFromJournal(kept).jobs.map((job, index) => [kept[index]!.id, job.status]),
    );
    let arriving = 0;
    for (const [id, member] of run.members)
      if (member.outcome === "left") arriving += ytDownloadProgress(statuses.get(id) ?? null) ?? 0;
    return Math.min(1, (overall.done + overall.failed + arriving) / overall.total);
  };

  const setOnline = async (isOnline: boolean) => {
    if (isOnline === online && started) return;
    online = isOnline;
    started = true;
    await deps.call(online ? "downloads.start" : "downloads.stop", {}).catch(() => null);
  };

  return {
    start: async (isOnline) => {
      started = false;
      await setOnline(isOnline);
      await refresh();
    },
    refresh,
    status: (trackId) => statuses.get(missingSongJobId(trackId)) ?? null,
    ytStatus: (videoId) => statuses.get(videoId) ?? null,
    view: () => {
      const overall = downloadRunProgress(run).overall;
      return {
        online,
        notice,
        progress: progress(),
        run: overall,
        rows: shownRows().length,
        failed: failedJobs().length,
        missing: missingView(missingJobs()),
      };
    },
    rows: (offset, limit) => {
      const items = shownRows();
      return { items: items.slice(offset, offset + limit), offset, total: items.length };
    },
    listView: (list) => {
      const found = deps.list(list);
      return found === null ? null : missingView(missingJobs(found.ids));
    },
    yt: (videoIds, by) => {
      diag(`yt asked ${videoIds.join(",")}`);
      return queued(async () => {
        diag(`yt turn`);
        const current = await session();
        askedBy(by, videoIds);
        const asked = videoIds.flatMap((videoId): JobRequest[] => {
          const song = deps.ytSong(videoId);
          return song === undefined
            ? []
            : [
                {
                  song,
                  recording: soulseekRecording(song),
                  equivalentId: ytDownloadSharedJob(followed, song),
                  source: sourceFor(current),
                  origin: null,
                },
              ];
        });
        await enqueue(asked);
        diag(`yt done`);
      });
    },
    missing: (trackIds, by) =>
      queued(async () => {
        const current = await session();
        askedBy(by, trackIds.map(missingSongJobId));
        await enqueue(missingJobs(trackIds).map((job) => missingSongRequest(job, current)));
      }),
    missingAction: (action, list) =>
      queued(async () => {
        const found = list === undefined ? null : deps.list(list);
        if (list !== undefined && found === null) return;
        const missing = missingJobs(found?.ids);
        const download = missingSongsDownload(missing, followed, deps.catalogue);
        const origin = found?.origin ?? null;
        if (action === "cancel") {
          for (const id of download.toCancel) await deps.call("downloads.cancel", { id });
          await refresh();
          return;
        }
        const current = await session();
        const songs = action === "downloadAll" ? download.toDownload : download.toRetry;
        if (action === "downloadAll") ownerAsked(missing.map((job) => job.videoId));
        await enqueue(songs.map((job) => missingSongRequest(job, current, origin)));
      }),
    retry: (ids) =>
      queued(async () => {
        const failed = failedJobs().filter((job) => ids === undefined || ids.includes(job.id));
        const current = await session();
        const trackIds = failed.flatMap((job) => {
          const trackId = missingSongTrackId(job.id);
          return trackId === null ? [] : [trackId];
        });
        const missing = new Map(missingJobs(trackIds).map((job) => [job.videoId as string, job]));
        const asked = failed.flatMap((job): JobRequest[] => {
          if (missingSongTrackId(job.id) === null)
            return [
              {
                song: job.song,
                recording: soulseekRecording(job.song),
                equivalentId: null,
                source: sourceFor(current),
                // Asked with no origin, the job keeps the one it was first asked from.
                origin: null,
              },
            ];
          // A missing song filled in since stays as it is.
          const found = missing.get(job.id);
          return found === undefined ? [] : [missingSongRequest(found, current)];
        });
        await enqueue(asked);
      }),
    cancel: (ids) =>
      queued(async () => {
        for (const id of ids) await deps.call("downloads.cancel", { id });
        // Cancelled by the owner: no star has a download left to take back.
        ownerAsked(ids);
        await refresh();
      }),
    unstarred: (ids) =>
      queued(async () => {
        const asked = readStarDownloads(store.read(STAR_ASKED));
        const theirs = ids.filter((id) => asked.has(id));
        if (theirs.length === 0) return;
        await refresh();
        for (const id of theirs)
          if (unstarredDownload(statuses.get(id) ?? null, { starAsked: true }) === "cancel")
            await deps.call("downloads.cancel", { id });
        store.write(
          STAR_ASKED,
          writeStarDownloads(starAskedAfter(asked, { kind: "unstarred", ids: theirs })),
        );
        await refresh();
      }),
    clearFailed: () =>
      queued(async () => {
        for (const job of failedJobs()) await deps.call("downloads.cancel", { id: job.id });
        await refresh();
      }),
    setOnline: async (isOnline) => {
      await setOnline(isOnline);
      if (isOnline) await refresh();
    },
    bestQuality: async () => (await session()).status !== "off",
    setBestQuality: async (on) =>
      (await deps.call(on ? "soulseek.turnOn" : "soulseek.turnOff", {})).status !== "off",
    syncStars: () =>
      queued(async () => {
        if (deps.favorites === undefined) return;
        await refresh();
        const starred = deps.favorites();
        const missing = deps.missingSongs().map((track) => track.id);
        const { download, cancel, seen } = syncedStarDownloads(
          { starred, missing },
          readSyncedStars(store.read(SEEN_STARS)),
        );
        let asked = readStarDownloads(store.read(STAR_ASKED));
        const cancelled = cancel.map(missingSongJobId);
        for (const id of cancelled)
          if (
            unstarredDownload(statuses.get(id) ?? null, { starAsked: asked.has(id) }) === "cancel"
          )
            await deps.call("downloads.cancel", { id });
        const current = await session();
        const requests: JobRequest[] = [];
        const queuedIds: string[] = [];
        for (const job of missingJobs(download)) {
          const step = starredDownload(statuses.get(job.videoId) ?? null);
          if (step === "keep") continue;
          requests.push(
            missingSongRequest(job, current, step === "queue" ? FAVORITES_DOWNLOAD_ORIGIN : null),
          );
          if (step === "queue") queuedIds.push(job.videoId);
        }
        asked = starAskedAfter(asked, { kind: "unstarred", ids: cancelled });
        asked = starAskedAfter(asked, { kind: "starred", queued: queuedIds });
        store.write(STAR_ASKED, writeStarDownloads(asked));
        store.write(SEEN_STARS, writeSyncedStars(seen));
        if (requests.length > 0) await enqueue(requests, false);
        else if (cancelled.length > 0) await refresh();
      }),
    dispose: () => {
      disposed = true;
      clearInterval(poll);
      poll = undefined;
    },
  };
};
