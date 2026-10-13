import type { SoulseekCandidate, SoulseekReceivedTags } from "@wave/core";
import { NativeModule, requireNativeModule } from "expo";

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
}> {
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
