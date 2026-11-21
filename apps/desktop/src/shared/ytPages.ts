/**
 * YouTube Music's pages, Discover and the Magic Queue as the window sees them
 * (`window.wave.yt`, `window.wave.discover`, `window.wave.magicQueue`). Each read says how it
 * went (`YtStatus`): offline, YT Music off or a failure leave nothing, and the window shows its
 * quiet line. Songs come as rows (`ytRow`), with `videoId` and no Library id.
 */
import type {
  DiscoverMixLevel,
  MixSliders,
  MixRowId,
  YtArtistAlbum,
  YtArtistCandidate,
} from "@wave/core";

import type { Page } from "./bridge.ts";
import type { BrowseRow } from "./browse.ts";
import type { YtStatus } from "./yt.ts";

export type { YtArtistAlbum, YtArtistCandidate };

/** A release on a YT Music artist's shelf, with the Library album it already is, if any. */
export interface YtArtistRelease extends YtArtistAlbum {
  /** The Library album's id (Core's `libraryAlbumFinder`): a click opens it. Null without one. */
  readonly libraryId: number | null;
}

/** A YouTube Music artist page. */
export interface YtArtistView {
  readonly status: YtStatus;
  readonly page: {
    readonly name: string;
    readonly artworkUrl: string | null;
    readonly songs: Page<BrowseRow>;
    readonly albums: readonly YtArtistRelease[];
    readonly singles: readonly YtArtistRelease[];
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

export interface DiscoverSettings extends MixSliders {
  readonly level: DiscoverMixLevel;
}

/** Discover's Artist and Genre mixes: today's, each named after its seed artist or genre. */
export interface DiscoverMixesView {
  readonly status: YtStatus;
  readonly mixes: readonly {
    readonly id: string;
    readonly name: string;
    readonly row: MixRowId;
    /** The first three artists it plays, its seed's first for a genre's mix. */
    readonly artists: string;
    /** Its tile's cover, from YouTube Music; null leaves the tile to its first song's. */
    readonly artworkUrl: string | null;
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
