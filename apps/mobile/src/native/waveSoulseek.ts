import type {
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
  ): Promise<string>;
  jobsSnapshot(): Promise<NativeDownloadJob[]>;
  resumeJobs(): Promise<void>;
  claimDecision(id: string): Promise<NativeDownloadDecision | null>;
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
  search(query: string): Promise<SoulseekCandidate[]>;
}

export const WaveSoulseek = requireNativeModule<WaveSoulseekModule>("WaveSoulseek");

/** Never includes credentials or raw native error messages in user-facing copy. */
export const soulseekErrorCode = (error: unknown): string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
};
