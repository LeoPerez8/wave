import type {
  ActionItem,
  LibraryArtistRef,
  StreamedArtists,
  YtSongActionOptions,
} from "./itemActions.ts";
import { streamedArtistLink, type StreamedArtistLink } from "./streamedArtist.ts";
import { isDetailPath } from "./navigation.ts";
import {
  DEFAULT_SWIPE_SETTINGS,
  type RowMenuAction,
  type RowSwipeActions,
  type SwipeChoice,
  type SwipeSettings,
} from "./swipeActions.ts";
import type { YtDownloadStatus } from "./ytDownloads.ts";

/** Facts already available to one row's menu; no selection-bar or collection planning. */
export type SongRowSwipeFacts<A extends LibraryArtistRef = LibraryArtistRef> =
  | {
      readonly kind: "track";
      readonly item: ActionItem;
      readonly here: string;
      readonly onlineLookups?: boolean;
      readonly ytMusic?: boolean;
      /** As in the menu subject: the mini player's song, not a list's playing indicator. */
      readonly playing?: boolean;
      readonly streamedArtists?: StreamedArtists<A>;
    }
  | {
      readonly kind: "ytMusic";
      readonly options: YtSongActionOptions;
      readonly artists?: StreamedArtistLink<A> | undefined;
      readonly download?: YtDownloadStatus | null;
      readonly inLibrary?: boolean;
    }
  | { readonly kind: "unavailable" };

const downloadAction = (
  status: YtDownloadStatus | null | undefined,
  inLibrary: boolean,
): RowMenuAction | null => {
  switch (status?.kind) {
    case undefined:
      return "download";
    case "failed":
      return "retryDownload";
    case "done":
      return inLibrary ? null : "download";
    default:
      return null;
  }
};

const trackDirection = <A extends LibraryArtistRef>(
  facts: Extract<SongRowSwipeFacts<A>, { kind: "track" }>,
  choice: SwipeChoice,
): RowMenuAction | null => {
  const { item, here } = facts;
  const missing = item.missing === true;
  const file = !missing && item.streamed !== true;
  switch (choice) {
    case "playNext":
    case "addToQueue":
      return !missing && facts.playing !== true ? choice : null;
    case "magicQueue":
      return file && facts.ytMusic !== false ? choice : null;
    case "addToPlaylist":
    case "share":
      return choice;
    case "favorite":
      return item.unsearched === true ? null : item.favorite ? "unfavorite" : "favorite";
    case "remove":
      return item.inPlaylist
        ? "removeFromPlaylist"
        : file
          ? "delete"
          : missing
            ? "removeFromLibrary"
            : null;
    case "download":
      return missing ? downloadAction(item.download, false) : null;
    case "goToAlbum":
      return item.albumId !== undefined && !isDetailPath(here, "album", item.albumId)
        ? choice
        : null;
    case "goToArtist": {
      if (item.streamed !== true)
        return item.artistIds?.some((id) => !isDetailPath(here, "artist", id)) ? choice : null;
      const context = facts.streamedArtists;
      if (context === undefined) return null;
      const link = streamedArtistLink(item.artistNames ?? [], { ...context, here });
      return link !== undefined && link.kind !== "here" ? choice : null;
    }
    case "fixSong":
      return file && item.fixable === true && facts.onlineLookups === true ? choice : null;
  }
};

const direction = <A extends LibraryArtistRef>(
  facts: SongRowSwipeFacts<A>,
  choice: SwipeChoice,
): RowMenuAction | null => {
  if (facts.kind === "track") return trackDirection(facts, choice);
  if (facts.kind === "unavailable") return choice === "remove" ? "removeFromPlaylist" : null;
  const { options } = facts;
  switch (choice) {
    case "playNext":
    case "addToQueue":
      return options.playing === true ? null : choice;
    case "addToPlaylist":
    case "share":
      return choice;
    case "favorite":
      return options.favorite === undefined ? null : options.favorite ? "unfavorite" : "favorite";
    case "remove":
      return options.inPlaylist === true ? "removeFromPlaylist" : null;
    case "download":
      return downloadAction(facts.download, facts.inLibrary === true);
    case "goToAlbum":
      return options.ytMusic === true &&
        options.album !== undefined &&
        options.album !== null &&
        options.album !== "" &&
        options.album !== options.ytAlbumHere
        ? choice
        : null;
    case "goToArtist":
      return facts.artists !== undefined && facts.artists.kind !== "here" ? choice : null;
    case "magicQueue":
    case "fixSong":
      return null;
  }
};

/** The row's configured directions from menu facts, without allocating the menu. */
export const songRowSwipeDirections = <A extends LibraryArtistRef>(
  facts: SongRowSwipeFacts<A>,
  settings: SwipeSettings = DEFAULT_SWIPE_SETTINGS,
): RowSwipeActions =>
  settings.enabled
    ? { right: direction(facts, settings.right), left: direction(facts, settings.left) }
    : { right: null, left: null };
