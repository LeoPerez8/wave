import type {
  DownloadFailurePlan,
  DownloadOrigin,
  DownloadSource,
  SoulseekCandidate,
  SoulseekReceivedTags,
  SoulseekRecording,
  YtDownloadFailure,
  YtDownloadJournalJob,
  YtDownloadTags,
} from "@wave/core";
import { NativeModule, requireNativeModule } from "expo";

import type { NativeSavedDownload } from "./waveYtDownloads";
import type { NativeYtSong } from "./waveYtMusic";

/** A job in the native download journal (`DurableDownloads`), as its snapshot reports it. */
export interface NativeDownloadJob extends YtDownloadJournalJob<NativeYtSong> {
  readonly generation: number;
  /** What the job saves: Soulseek's original MP3 320, or YouTube's M4A as served. */
  readonly policy: "mp3-320" | "youtube-m4a";
  readonly saved?: NativeSavedDownload;
  readonly tags?: YtDownloadTags;
  /** What arrived, once validated natively: Soulseek's MP3 or YouTube's M4A (by the job's source). */
  readonly audio?: NativeSoulseekAudio | NativeYoutubeAudio;
  readonly receiptId?: string;
  /** The Soulseek failure a job carrying on from YouTube Music fell back from. */
  readonly fellBackFrom?: YtDownloadFailure;
  /**
   * The YouTube Music video a job not named after one downloads (a missing
   * song's, `missing:<id>`), once its prepare answer or fallback named it.
   */
  readonly video?: string;
  /** Where the job's file goes, as the last prepare answer (or its fallback) placed it. */
  readonly targetPath?: string;
  /** What the journal does when the job's source fails, as the last prepare answer planned it. */
  readonly failurePlan?: DownloadFailurePlan;
  /** YouTube Music's fallback for a Soulseek job, as the last prepare answer planned it. */
  readonly fallback?: unknown;
}

/** A decision the journal leased to JS; answered with `submitDecision` before [leaseUntil]. */
export interface NativeDownloadDecision extends NativeDownloadJob {
  readonly token: string;
  readonly decision: "prepare" | "confirm" | "publish" | "import";
  readonly leaseUntil: number;
  readonly deadline: number;
}

export interface SoulseekSession {
  /** "off" while Download in best quality is off; the phone keeps its account then. */
  readonly status: "off" | "disconnected" | "connected";
  readonly username: string | null;
}

/** Full native validation has completed. Provenance cannot be inferred from peer labels. */
export interface NativeSoulseekAudio {
  readonly partPath: string;
  readonly bytes: number;
  readonly bitrate: 320000;
  readonly mimeType: "audio/mpeg";
  readonly durationMs: number;
  readonly sampleRate: number;
  readonly provenance: "unknown";
  readonly receivedTags: SoulseekReceivedTags;
}

/** YouTube's M4A as it was served, complete (the announced length), with its length as played. */
export interface NativeYoutubeAudio {
  readonly partPath: string;
  readonly bytes: number;
  readonly mimeType: string;
  readonly itag: number;
  readonly bitrate: number;
  readonly durationMs: number;
  /** The video asked for, and what YouTube's answer said: its video, client, type and length. */
  readonly requested?: string;
  readonly resolved?: string | null;
  readonly client?: string | null;
  readonly videoType?: string | null;
  readonly announcedMs?: number | null;
}

declare class WaveSoulseekModule extends NativeModule<{
  onSessionChanged: (event: SoulseekSession) => void;
  onJobsChanged: () => void;
}> {
  enqueueJob(
    song: NativeYtSong,
    recording: SoulseekRecording,
    equivalentId: string | null,
    /** Core's `downloadSource`; null fails the job as `noSource` when it's prepared. */
    source: DownloadSource | null,
    /**
     * The playlist, album or Discover mix whose Download asks, null for a song asked for on its
     * own. A job keeps the first one it was asked from.
     */
    origin: DownloadOrigin | null,
  ): Promise<string>;
  jobsSnapshot(): Promise<NativeDownloadJob[]>;
  /** Forgets an imported job Core found absent from the Library, if it hasn't been retried since. */
  forgetCompletedJob(id: string, generation: number): Promise<boolean>;
  resumeJobs(): Promise<void>;
  claimDecision(id: string): Promise<NativeDownloadDecision | null>;
  /**
   * Keeps a claimed decision's lease while JS still works on it (waiting for the search
   * allowance, say), up to the job's deadline; false once it ran out or was claimed again.
   */
  renewDecision(id: string, generation: number, token: string): Promise<boolean>;
  submitDecision(
    id: string,
    generation: number,
    token: string,
    decision: NativeDownloadDecision["decision"],
    /** The answer as JSON: the bridge can't pass a null nested in an object. */
    payload: string,
  ): Promise<boolean>;
  refreshDownloadPolicy(roots: readonly string[], excluded: readonly string[]): Promise<number>;
  cancelJob(id: string): Promise<void>;
  session(): Promise<SoulseekSession>;
  /** Download in best quality: connects the phone's Soulseek account, making one when it has none. */
  turnOn(): Promise<SoulseekSession>;
  /** Download in best quality off: downloads stop using Soulseek and the account stays. */
  turnOff(): Promise<SoulseekSession>;
  /**
   * At sign-in and each pull while signed in: the phone switches to the Wave
   * account's Soulseek account when it has one (forgetting its own), or sends
   * its own up when it has none. The native module asks the sync service with
   * the session it holds, so the credentials never reach JS. Signed out, does
   * nothing. Rejects with an `ERR_WAVE_*` code when the service can't be asked.
   */
  followWaveAccount(): Promise<SoulseekSession>;
  search(query: string): Promise<SoulseekCandidate[]>;
}

export const WaveSoulseek = requireNativeModule<WaveSoulseekModule>("WaveSoulseek");

/** Never includes credentials or raw native error messages in user-facing copy. */
export const soulseekErrorCode = (error: unknown): string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
};
