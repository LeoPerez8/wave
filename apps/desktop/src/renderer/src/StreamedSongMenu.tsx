/**
 * A streamed YouTube Music song's menu in the window (`window.wave.streamed`), as the phone gives
 * it: Play Next, Add to Queue, the Magic Queue, Add to Playlist, the star, Go to Album and Go to
 * Artist, Release Date, Share and its download. Now Playing's Add to Playlist and Download
 * buttons too.
 */
import type { ActionSurface, StreamedArtistTarget, UpNextPlace } from "@wave/core";
import { useCallback, useEffect, useState } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import type {
  StreamedArtist,
  StreamedEntry,
  StreamedRunAction,
  StreamedSongMenu,
} from "../../shared/streamedSongs.ts";
import { Icon } from "./Icon.tsx";
import type { MenuItem } from "./Menu.tsx";
import { songShareItems } from "./SongShare.tsx";
import { songActionToast } from "./songActionToast.ts";
import { text } from "./text.ts";

/** The pages a streamed song's menu leads to. */
export type StreamedRoute =
  | { readonly kind: "artist"; readonly id: number }
  | { readonly kind: "ytArtist" | "ytAlbum"; readonly id: string };

export interface StreamedMenuOptions {
  readonly go: (route: StreamedRoute) => void;
  /** Says an action failed, in the window's error line. */
  readonly failed: (message?: string) => void;
  /** Shows a toast; null shows none. */
  readonly notify: (message: string | null) => void;
  /** Reads the player and the rows again once an action changed them. */
  readonly changed: () => void;
  /** Opens Release Date for the song with [videoId]. */
  readonly releaseDate: (videoId: string) => void;
}

/** The playlists Add to Playlist offers: the sidebar's first page. */
const playlistRows = async () =>
  (await window.wave.library.browse({ kind: "playlists" }, 0, 200)).items.filter(
    // The desktop adds nothing to a collaborative playlist.
    (row) => !row.collaborative,
  );

/** Add to Playlist's submenu: the playlists, each adding the song with [add]. */
export const playlistItems = async (
  add: (playlistId: number) => void,
  create?: () => void,
): Promise<readonly MenuItem[]> => {
  const rows = await playlistRows();
  return [
    ...(create ? [{ key: "new-playlist", label: text.playlists.newPlaylist, run: create }] : []),
    ...(rows.length === 0
      ? [{ key: "none", label: text.desktopLibrary.noPlaylists, disabled: true }]
      : rows.map((row: BrowseRow) => ({
          key: `playlist-${row.id}`,
          label: row.title,
          run: () => add(row.id),
        }))),
  ];
};

/** Runs [action] on a streamed song and says what it did, as a Library song's menu does. */
export function useStreamedSongs({
  go,
  failed,
  notify,
  changed,
  releaseDate,
}: StreamedMenuOptions) {
  const run = useCallback(
    async (
      videoId: string,
      action: StreamedRunAction,
      surface: ActionSurface = "menu",
      playlistId?: number,
      at?: UpNextPlace,
    ) => {
      try {
        const result = await window.wave.streamed.run(videoId, action, playlistId, at);
        changed();
        switch (result.kind) {
          case "queued":
          case "favorite":
          case "playlist":
            return notify(songActionToast(result, action === "playNext", surface, 1));
          case "downloaded":
            // The window says a download started once the Downloads page hears of it.
            return;
        }
      } catch {
        failed();
      }
    },
    [changed, failed, notify],
  );

  /** Opens a YT Music artist page by its name, as Go to Artist leads there. */
  const goToArtist = useCallback(
    (target: StreamedArtistTarget<StreamedArtist>) => {
      if (target.kind === "library") return go({ kind: "artist", id: target.artist.id });
      void window.wave.yt
        .findArtist(target.name)
        .then((found) =>
          found.browseId === null ? failed() : go({ kind: "ytArtist", id: found.browseId }),
        )
        .catch(() => failed());
    },
    [go, failed],
  );

  const itemFor = useCallback(
    (videoId: string, entry: StreamedEntry): MenuItem => {
      const key = entry.action;
      switch (entry.action) {
        case "addToPlaylist":
          return {
            key,
            label: text.itemActions.labels.addToPlaylist,
            open: () => playlistItems((id) => void run(videoId, "addToPlaylist", "menu", id)),
          };
        case "magicQueue":
          return {
            key,
            label: text.itemActions.labels.magicQueue,
            run: () =>
              void window.wave.magicQueue
                .startStreamed(videoId)
                .then(changed)
                .catch(() => failed(text.playbackText.couldntStartTheMagicQueue)),
          };
        case "releaseDate":
          return {
            key,
            label: text.itemActions.labels.releaseDate,
            run: () => releaseDate(videoId),
          };
        case "share":
          return {
            key,
            label: text.itemActions.labels.share,
            submenu: text.itemActions.labels.share,
            open: () => songShareItems(videoId, notify),
          };
        case "goToAlbum": {
          const album = entry.album;
          return {
            key,
            label: text.itemActions.labels.goToAlbum,
            run: () => go({ kind: "ytAlbum", id: album }),
          };
        }
        case "goToArtist": {
          const { artists } = entry;
          const label = text.itemActions.labels.goToArtist;
          if (artists.kind === "open") return { key, label, run: () => goToArtist(artists.target) };
          return {
            key,
            label,
            submenu: text.desktopLibrary.chooseArtist,
            open: async () =>
              artists.targets.map((target, index) => ({
                key: `artist-${index}`,
                label: target.kind === "library" ? target.artist.name : target.name,
                run: () => goToArtist(target),
              })),
          };
        }
        default: {
          const action = entry.action;
          return {
            key,
            label: text.itemActions.labels[action],
            run: () => void run(videoId, action),
          };
        }
      }
    },
    [run, go, goToArtist, changed, failed, notify, releaseDate],
  );

  /** [videoId]'s menu entries; [playing] for the song playing (no Play Next). */
  const items = useCallback(
    async (videoId: string, playing = false): Promise<readonly MenuItem[]> => {
      const menu = await window.wave.streamed.menu(videoId, playing);
      return menu.entries.map((entry) => itemFor(videoId, entry));
    },
    [itemFor],
  );
  return { items, run };
}

/** A streamed song's menu facts, read again as the player changes. */
export function useStreamedSong(videoId: string | undefined, revision: number, tick: number) {
  const [read, setRead] = useState<{ readonly videoId: string; readonly menu: StreamedSongMenu }>();
  useEffect(() => {
    if (videoId === undefined) return;
    let current = true;
    void window.wave.streamed
      .menu(videoId, true)
      .then((menu) => {
        if (current) setRead({ videoId, menu });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [videoId, revision, tick]);
  return read !== undefined && read.videoId === videoId ? read.menu : undefined;
}

/**
 * Now Playing's Add to Playlist and Download buttons (story 46a): Download shows the song's
 * download as it goes (Core's `nowPlayingDownload`), and once the song is the Library's it says
 * Downloaded.
 */
export function NowPlayingSongActions({
  download,
  onAddToPlaylist,
  onDownload,
}: {
  readonly download: StreamedSongMenu["download"] | undefined;
  readonly onAddToPlaylist: (element: HTMLElement) => void;
  readonly onDownload: () => void;
}) {
  const { label, busy } =
    download === undefined
      ? { label: text.playbackText.download, busy: true }
      : download.kind === "download"
        ? { label: text.playbackText.download, busy: false }
        : download.kind === "waiting"
          ? { label: text.playbackText.waitingToDownload, busy: true }
          : download.kind === "progress"
            ? {
                label: `${text.playbackText.downloading} ${Math.round(download.fraction * 100)}%`,
                busy: true,
              }
            : download.kind === "failed"
              ? { label: text.playbackText.retryDownload, busy: false }
              : { label: text.downloads.downloaded, busy: true };
  return (
    <div className="now-playing-actions" data-testid="now-playing-actions">
      <button
        aria-haspopup="menu"
        onClick={(event) => onAddToPlaylist(event.currentTarget)}
        title={text.playbackText.addToPlaylist}
      >
        <Icon name="add" size={16} />
        {text.playbackText.addToPlaylist}
      </button>
      <button
        disabled={busy}
        aria-pressed={download?.kind === "downloaded" ? true : undefined}
        onClick={onDownload}
        title={label}
      >
        <Icon name="download" size={16} />
        {label}
      </button>
    </div>
  );
}
