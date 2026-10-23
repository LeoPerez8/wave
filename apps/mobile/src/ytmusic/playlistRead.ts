import {
  readYtPlaylist,
  type YtPlaylistFirstPage,
  type YtPlaylistPage,
  type YtPlaylistReadOptions,
  type YtSong,
} from "@wave/core";

export interface PlaylistReadOptions<S extends YtSong> extends YtPlaylistReadOptions<S> {
  /** Deferred artist consent/connectivity, checked before each native page. */
  readonly canSend?: () => boolean;
}

export const readYtPlaylistGuarded = <S extends YtSong>(
  first: () => Promise<YtPlaylistFirstPage<S>>,
  more: (continuation: string) => Promise<YtPlaylistPage<S>>,
  options: PlaylistReadOptions<S> = {},
) => {
  const check = () => {
    if (options.canSend?.() === false) throw { code: "ERR_YT_OFFLINE" };
  };
  return readYtPlaylist(
    () => {
      check();
      return first();
    },
    (continuation) => {
      check();
      return more(continuation);
    },
    options,
  );
};
