import type { SoulseekCandidate, SoulseekReceivedTags } from "@wave/core";
import { NativeModule, requireNativeModule } from "expo";
import type { NativeYtSong } from "./waveYtMusic";
import type { NativeSavedDownload } from "./waveYtDownloads";
import type { YtDownloadFailure } from "@wave/core";

export interface NativeDownloadJob {
  readonly id: string;
  readonly song: NativeYtSong;
  readonly aliases?: readonly NativeYtSong[];
  readonly generation: number;
  readonly policy: "mp3-320";
  readonly phase: "queued" | "preparing" | "prepared" | "transferring" | "sourceReady" | "tagging" | "awaitingPublication" | "publishing" | "completed" | "failed" | "cancelled";
  readonly received?: number;
  readonly total?: number;
  readonly queuePosition?: number | null;
  readonly reason?: YtDownloadFailure;
  readonly importFailure?: YtDownloadFailure;
  readonly acknowledged?: boolean;
  readonly saved?: NativeSavedDownload;
  readonly tags?: import("@wave/core").YtDownloadTags;
  readonly audio?: NativeSoulseekAudio;
  readonly receiptId?: string;
}

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

export interface SoulseekProgress {
  readonly videoId: string;
  readonly phase: "transferring" | "queued";
  readonly received: number;
  readonly total: number;
  readonly queuePosition?: number;
}

declare class WaveSoulseekModule extends NativeModule<{
  onDownloadProgress: (event: SoulseekProgress) => void;
  onSessionChanged: (event: SoulseekSession) => void;
  onJobsChanged: () => void;
}> {
  enqueueJob(song: NativeYtSong, recording: import("@wave/core").SoulseekRecording, equivalentId: string | null): Promise<string>;
  jobsSnapshot(): Promise<NativeDownloadJob[]>;
  resumeJobs(): Promise<void>;
  claimDecision(id: string): Promise<NativeDownloadDecision | null>;
  submitDecision(id: string, generation: number, token: string, decision: NativeDownloadDecision["decision"], payload: Readonly<Record<string, unknown>>): Promise<boolean>;
  refreshDownloadPolicy(roots: readonly string[], excluded: readonly string[]): Promise<number>;
  cancelJob(id: string): Promise<void>;
  session(): Promise<SoulseekSession>;
  connect(username: string, password: string): Promise<SoulseekSession>;
  disconnect(): Promise<SoulseekSession>;
  search(query: string): Promise<SoulseekCandidate[]>;
  downloadAudio(
    videoId: string,
    candidate: SoulseekCandidate,
    targetPath: string,
    title: string,
    expectedDurationMs: number,
  ): Promise<NativeSoulseekAudio>;
  cancelDownload(videoId: string): void;
}

export const WaveSoulseek = requireNativeModule<WaveSoulseekModule>("WaveSoulseek");

/** Never includes credentials or raw native error messages in user-facing copy. */
export const soulseekErrorCode = (error: unknown): string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
};
