/**
 * YouTube Music's pages, Discover and the Magic Queue as the window sees them
 * (`window.wave.yt`, `window.wave.discover`, `window.wave.magicQueue`). Each read says how it
 * went (`YtStatus`): offline, YT Music off or a failure leave nothing, and the window shows its
 * quiet line. Songs come as rows (`ytRow`), with `videoId` and no Library id.
 */
import type { YtArtistAlbum, YtArtistCandidate } from "@wave/core";

import type { Page } from "./bridge.ts";
import type { BrowseRow } from "./browse.ts";
import type { YtStatus } from "./yt.ts";

export type { YtArtistAlbum, YtArtistCandidate };

/** A YouTube Music artist page. */
export interface YtArtistView {
  readonly status: YtStatus;
  readonly page: {
    readonly name: string;
    readonly artworkUrl: string | null;
    readonly songs: Page<BrowseRow>;
    readonly albums: readonly YtArtistAlbum[];
    readonly singles: readonly YtArtistAlbum[];
    readonly similar: readonly YtArtistCandidate[];
  } | null;
}

/** A YouTube Music album page. */
export interface YtAlbumView {
  readonly status: YtStatus;
  readonly album: {
    readonly title: string;
    readonly artists: readonly string[];
    readonly year: number | null;
    readonly artworkUrl: string | null;
    readonly songs: Page<BrowseRow>;
  } | null;
}

/** The Related tab of the song playing: songs and artists like it. */
export interface YtRelatedView {
  readonly status: YtStatus;
  readonly songs: Page<BrowseRow>;
  readonly artists: readonly YtArtistCandidate[];
}

/** Discover's Artist mixes: today's, each named after its seed artist. */
export interface DiscoverMixesView {
  readonly status: YtStatus;
  readonly mixes: readonly {
    readonly id: string;
    readonly name: string;
    readonly songs: Page<BrowseRow>;
  }[];
}

/** How the Magic Queue's next batch is going. */
export type MagicQueueStatus = "idle" | "loading" | "offline" | "failed" | "empty";

export interface MagicQueueView {
  /** The seed's name ("Magic Queue · from …"), or null while no Magic Queue plays. */
  readonly title: string | null;
  readonly status: MagicQueueStatus;
}
