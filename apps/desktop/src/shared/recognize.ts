/**
 * Recognize on the desktop (`window.wave.recognize`, docs/spec.md › Recognize): main runs the
 * phone's session over the JVM's Shazam client and decides what may be captured; the window
 * shows the card and captures only the session main names, sending its audio back.
 */
import type { RecognizeCardView, RecognizeSource } from "@wave/core";
import type { Invoke } from "./bridge.ts";

/**
 * How the window captures a session: the microphone, what Windows plays (a display capture's
 * loopback audio, with no picture kept) or the PulseAudio or PipeWire monitor of what Linux plays.
 */
export type RecognizeCaptureVia = "microphone" | "loopback" | "monitor";

/** The session the window captures for, until main stops naming it. */
export interface RecognizeCapture {
  readonly session: number;
  readonly via: RecognizeCaptureVia;
}

/** The card as main has it; `open` false once it's closed. */
export interface RecognizeView {
  readonly open: boolean;
  /** Bumps with each attempt: a new session, from Try Again or a source picked. */
  readonly attempt: number;
  /** The source picked; the window shows it selected. */
  readonly source: RecognizeSource;
  readonly card: RecognizeCardView;
  readonly capture: RecognizeCapture | null;
  /** Go to Album's album, for a Library song. */
  readonly album: number | null;
  /** The song's cover as a data URL, once fetched. */
  readonly cover: string | null;
}

/** The card's buttons main runs; the window closes it, listens again and opens the album. */
export const RECOGNIZE_RUN_ACTIONS = [
  "play",
  "playNext",
  "addToShazam",
  "addToPlaylist",
  "download",
  "cancelDownload",
  "retryDownload",
  "openSettings",
] as const;
export type RecognizeRunAction = (typeof RECOGNIZE_RUN_ACTIONS)[number];

/** What a button did, for the window's toast. */
export type RecognizeRunResult =
  | { readonly kind: "done" }
  | { readonly kind: "queued"; readonly count: number }
  | {
      readonly kind: "playlist";
      readonly name: string;
      readonly added: number;
      readonly alreadyIn: number;
    }
  /** Add to Shazam's line ("Added to Shazam"), from Core. */
  | { readonly kind: "shazam"; readonly message: string };

/** Why the window's capture ended before main stopped it. */
export type RecognizeCaptureEnd = "denied" | "failed";

/** One audio piece the window sends: 16 kHz mono 16-bit little-endian PCM, at most 2 s of it. */
export const MAX_RECOGNIZE_AUDIO_BYTES = 64_000;

/** Captured [samples] (-1 to 1) as 16-bit little-endian PCM, the JVM's format; clipped. */
export const pcm16 = (samples: Float32Array): Uint8Array => {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]!));
    view.setInt16(index * 2, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
  }
  return bytes;
};

export interface RecognizeContract {
  /** Opens the card listening from [source], replacing any session running. */
  readonly "recognize.start": {
    readonly args: readonly [source: RecognizeSource];
    readonly result: RecognizeView;
  };
  readonly "recognize.view": { readonly args: readonly []; readonly result: RecognizeView };
  /** Cancel, Done, Close or Esc: ends the session and closes the card. */
  readonly "recognize.close": { readonly args: readonly []; readonly result: void };
  /** The next audio [session]'s capture heard. */
  readonly "recognize.audio": {
    readonly args: readonly [session: number, pcm: Uint8Array];
    readonly result: void;
  };
  /** [session]'s capture couldn't start or stopped on its own. */
  readonly "recognize.captureEnded": {
    readonly args: readonly [session: number, why: RecognizeCaptureEnd];
    readonly result: void;
  };
  /** One of the result card's buttons, on the song it shows; Add to Playlist names the playlist. */
  readonly "recognize.run": {
    readonly args: readonly [action: RecognizeRunAction, playlistId?: number];
    readonly result: RecognizeRunResult;
  };
}

export const RECOGNIZE_CALLS = [
  "recognize.start",
  "recognize.view",
  "recognize.close",
  "recognize.audio",
  "recognize.captureEnded",
  "recognize.run",
] as const satisfies readonly (keyof RecognizeContract)[];

export const recognizeBridge = (invoke: Invoke) => ({
  start: (source: RecognizeSource) => invoke("recognize.start", source),
  view: () => invoke("recognize.view"),
  close: () => invoke("recognize.close"),
  audio: (session: number, pcm: Uint8Array) => invoke("recognize.audio", session, pcm),
  captureEnded: (session: number, why: RecognizeCaptureEnd) =>
    invoke("recognize.captureEnded", session, why),
  run: (action: RecognizeRunAction, playlistId?: number) =>
    invoke("recognize.run", action, playlistId),
});
