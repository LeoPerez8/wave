import type { AudioStatus } from "@wave/client/playbackSession";
import type { RepeatMode, SleepTimer, UpNextPlace } from "@wave/core";

import type { BrowseRow } from "./browse.ts";

/** What the player bar shows (`window.wave.playback.view()`). */
export interface PlayerView {
  readonly status: AudioStatus;
  /** The current song, or null when the queue is empty. */
  readonly current: BrowseRow | null;
  /** The current song's place in the queue, History included. */
  readonly index: number;
  readonly length: number;
  readonly shuffle: boolean;
  readonly repeat: RepeatMode;
  /**
   * The Undo "New queue playing" offers: a number that changes with each new offer, or null
   * when there is none.
   */
  readonly undoOffer: number | null;
  /** 0 to 1; muted keeps it. */
  readonly volume: number;
  readonly muted: boolean;
  /** Changes whenever the queue or the current song's star changes. */
  readonly revision: number;
  /** The last failure behind the window's back, such as a song the engine couldn't open. */
  readonly error: string | null;
  /** The running sleep timer, or null. */
  readonly sleepTimer: SleepTimer | null;
}

/**
 * A queue row: a song with its entry's key, its place in the queue (History included), and where
 * it stands against the current one.
 */
export interface QueueRow extends BrowseRow {
  readonly key: string;
  readonly at: number;
  readonly history: boolean;
  readonly current: boolean;
}

/** The queue commands the window can send (Core's `QueueCommand`, as the window may give them). */
export type PlaybackCommand =
  | { readonly type: "next" }
  | { readonly type: "previous" }
  | { readonly type: "setShuffle"; readonly on: boolean }
  /** Shuffles Up Next again by the kind now chosen, turning shuffle on. */
  | { readonly type: "reshuffle" }
  | { readonly type: "setRepeat"; readonly mode: RepeatMode }
  | { readonly type: "jumpTo" | "remove"; readonly key: string }
  | { readonly type: "playNext"; readonly trackIds: readonly string[] }
  /** [at]: dropped in Up Next, between those neighbours. */
  | {
      readonly type: "addToQueue";
      readonly trackIds: readonly string[];
      readonly at?: UpNextPlace;
    }
  | {
      readonly type: "move";
      readonly key: string;
      readonly before: string | null;
      readonly after: string | null;
    };

/**
 * What a list's Play, Shuffle or a tap did (Core's `listPlay`): it plays, streaming [streamed]
 * missing songs and leaving [leftOut] out; nothing can play, with [missing] songs to download
 * and [unavailable] on a disconnected drive;
 * or the tapped missing song downloads, to play once it's in.
 */
export type PlayStart =
  | { readonly kind: "playing"; readonly streamed: number; readonly leftOut: number }
  | { readonly kind: "nothing"; readonly missing: number; readonly unavailable: number }
  | { readonly kind: "downloading" };

/** The transport calls main's playback and the window's bridge share. */
export interface PlaybackTransport {
  /**
   * Plays YouTube Music songs a page brought, from [index], as a new queue; with [shuffle], all
   * of them shuffled, as a list's Shuffle does.
   */
  readonly startYt: (
    videoIds: readonly string[],
    index: number,
    shuffle?: boolean,
  ) => Promise<void>;
  /** A queue command: Next, Previous, shuffle, repeat, and the Queue's edits. */
  readonly command: (command: PlaybackCommand) => Promise<void>;
  readonly play: () => Promise<void>;
  readonly pause: () => Promise<void>;
  readonly seek: (positionMs: number) => Promise<void>;
  /** Back to the queue the last `start` replaced, where it was. */
  readonly undo: () => Promise<void>;
}
