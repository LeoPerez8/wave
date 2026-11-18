import type { ScanFolder } from "@wave/core";

export interface ScanStatus {
  readonly status: "idle" | "scanning" | "done" | "failed";
  readonly phase: "discovering" | "reading";
  readonly filesFound: number;
  readonly filesRead: number;
  readonly filesUnchanged: number;
  readonly revision: number;
  readonly error?: string;
}

export interface DesktopFolder extends ScanFolder {
  readonly isDefault: boolean;
  readonly trackCount: number;
}

export interface DesktopSong {
  readonly id: number;
  readonly path: string | null;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly unavailable: boolean;
}
