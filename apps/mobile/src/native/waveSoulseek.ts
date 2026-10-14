import type {
  SoulseekCandidate,
  SoulseekReceivedTags,
  SoulseekRecording,
  YtDownloadJournalJob,
  YtDownloadTags,
} from "@wave/core";
import { NativeModule, requireNativeModule } from "expo";

import type { NativeSavedDownload } from "./waveYtDownloads";
import type { NativeYtSong } from "./waveYtMusic";

/** A job in the native download journal (`DurableDownloads`), as its snapshot reports it. */
export interface NativeDownloadJob extends YtDownloadJournalJob<NativeYtSong> {
  readonly generation: number;
  readonly policy: "mp3-320";
  readonly saved?: NativeSavedDownload;
  readonly tags?: YtDownloadTags;
  readonly audio?: NativeSoulseekAudio;
  readonly receiptId?: string;
}

/** A decision the journal leased to JS; answered with `submitDecision` before [leaseUntil]. */
export interface NativeDownloadDecision extends NativeDownloadJob {
  readonly token: string;
  readonly decision: "prepare" | "confirm" | "publish" | "import";
  readonly leaseUntil: number;
  readonly deadline: number;
}

export interface SoulseekSession {
  readonly status: "signedOut" | "disconnected" | "connected";
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

declare class WaveSoulseekModule extends NativeModule<{
  onSessionChanged: (event: SoulseekSession) => void;
  onJobsChanged: () => void;
}> {
  enqueueJob(
    song: NativeYtSong,
    recording: SoulseekRecording,
    equivalentId: string | null,
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
  connect(username: string, password: string): Promise<SoulseekSession>;
  disconnect(): Promise<SoulseekSession>;
  search(query: string): Promise<SoulseekCandidate[]>;
}

export const WaveSoulseek = requireNativeModule<WaveSoulseekModule>("WaveSoulseek");

/** Never includes credentials or raw native error messages in user-facing copy. */
export const soulseekErrorCode = (error: unknown): string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
};
