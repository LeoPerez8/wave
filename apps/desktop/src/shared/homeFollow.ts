/** Home's two sections for followed artists, as the window draws them. */
import type { ReleaseType } from "@wave/core";
import type { YtAlbumView } from "./ytPages.ts";

/** A new release of a followed artist. Its cover comes by `home.releaseArtwork`. */
export interface HomeReleaseCard {
  readonly key: string;
  readonly title: string;
  readonly artist: string;
  readonly type: ReleaseType;
  /** The release's day, `YYYY-MM-DD`. */
  readonly releaseDate: string;
  readonly hasArtwork: boolean;
}

/** An upcoming show of a followed artist in the owner's country. */
export interface HomeShowCard {
  readonly id: string;
  readonly artist: string;
  readonly startsAt: string;
  readonly city: string;
  readonly venue: string;
  readonly ticketUrl: string;
}

/** Both sections' cards; an empty list is a section Home leaves out. */
export interface HomeFollowView {
  readonly releases: readonly HomeReleaseCard[];
  readonly shows: readonly HomeShowCard[];
}

/** Where a release card opens, or why it can't. */
export type HomeReleaseOpening =
  | { readonly kind: "album"; readonly id: number }
  /** [album]: the page as read on the tap, for the album's page to show without asking again. */
  | { readonly kind: "ytAlbum"; readonly browseId: string; readonly album?: YtAlbumView }
  | { readonly kind: "ytMusicOff" | "noAnswer" | "notFound" };
