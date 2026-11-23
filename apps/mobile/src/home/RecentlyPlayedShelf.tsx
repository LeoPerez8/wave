import { Effect } from "effect";
import { mixReplayContext, SONG_PLAY_CONTEXT, type PlayContext } from "@wave/core";
import { artworkUri } from "@wave/client/artworkUri";
import type { RecentlyPlayedEntry, RecentSong } from "@wave/client/db/recentlyPlayed";

import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { PlaylistCard } from "@/catalog/cards/PlaylistCard";
import { SongCard } from "@/catalog/cards/SongCard";
import { LibraryStore } from "@/library/LibraryStore";
import { openPlaylist } from "@/library/routes";
import { appRuntime } from "@/library/runtime";
import { songCount } from "@/library/TrackList";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { showError } from "@/overlay/alert";
import { MenuChoices } from "@/overlay/MenuChoices";
import { openOverlay } from "@/overlay/overlay";
import { playPlaylist } from "@/playback/actions";
import { openAlbumActions, openPlaylistActions, openTrackActions } from "@/playback/ActionsMenu";
import {
  albumItem,
  onlineAlbumItem,
  playlistItem,
  trackItem,
  ytTrackItem,
  type MixedItem,
} from "@/playback/mixedItems";
import { type HomeSelection, useHomeTiles } from "@/selection/useHomeSelection";
import { PlayedAlbumCard, PlayedArtistCard } from "@/stats/PlayedEntityViews";
import { openYtPlaylist, type YtListHead } from "@/ytmusic/routes";
import { openYtSongActions } from "@/ytmusic/YtSongActions";
import { keptYtPlaylistHead } from "@/ytmusic/ytPlaylistHeads";

const NO_COVERS: readonly string[] = [];

const streamed = (song: RecentSong): song is Extract<RecentSong, { videoId: string }> =>
  "videoId" in song;

const songArtist = (song: RecentSong): string =>
  streamed(song) ? song.artists.join(", ") : song.artist;

const songCover = (song: RecentSong | null): string | undefined =>
  song === null
    ? undefined
    : streamed(song)
      ? (song.artworkUrl ?? undefined)
      : artworkUri(song, "medium");

const songItem = (song: RecentSong): MixedItem =>
  streamed(song) ? ytTrackItem(song as NativeYtSong) : trackItem(song);

/** Plays [songs] from the top under [context], a streamed one streaming, a missing one left out. */
const playRecent = (songs: readonly RecentSong[], context: PlayContext): Promise<unknown> =>
  playPlaylist(
    songs.map((song) =>
      streamed(song) ? { source: "stream", song } : { source: "library", track: song },
    ),
    0,
    context,
  );

/** Plays the mix [context] again: the songs played in it, under its replay context. */
const playMixAgain = async (context: PlayContext): Promise<void> => {
  try {
    const songs = await appRuntime.runPromise(
      Effect.flatMap(LibraryStore, (store) => store.contextSongs(context)),
    );
    if (songs.length > 0) await playRecent(songs, mixReplayContext(context));
  } catch (error) {
    await showError(currentLocalisation().strings.home.recentlyPlayed.playAgainFailed, error);
  }
};

/** The head a YouTube Music playlist's card shows and opens with: as its page was last read, or its word and latest song's cover. */
const ytPlaylistHead = (id: string, song: RecentSong | null, fallback: string): YtListHead =>
  keptYtPlaylistHead(id) ?? { title: fallback, line: "", artworkUrl: songCover(song) ?? null };

/** What a card can be selected as, if anything (an artist or a mix can't). */
const entryItem = (entry: RecentlyPlayedEntry, fallback: string): MixedItem | undefined => {
  switch (entry.kind) {
    case "playlist":
      return playlistItem(entry.playlist);
    case "ytPlaylist": {
      const id = entry.context.id ?? "";
      const head = ytPlaylistHead(id, entry.song, fallback);
      return {
        kind: "ytPlaylist",
        item: { playlistId: id, title: head.title, author: head.line, artworkUrl: head.artworkUrl },
      };
    }
    case "album":
      return "online" in entry.album ? onlineAlbumItem(entry.album) : albumItem(entry.album);
    case "song":
      return songItem(entry.song);
    default:
      return undefined;
  }
};

const entryKey = (entry: RecentlyPlayedEntry): string =>
  `${entry.context.kind}:${entry.context.id ?? ""}`;

const openSelectOnlyMenu = (title: string, label: string, onSelect: () => void): void => {
  openOverlay({
    label: title,
    render: (close) => (
      <MenuChoices
        cards={[]}
        entries={[
          {
            action: "select",
            label,
            onPress: () => {
              close();
              onSelect();
            },
          },
        ]}
      />
    ),
  });
};

/**
 * Recently played: one card per place played from, the latest first (Core's
 * `recentlyPlayedContexts`), in a row that scrolls sideways. A playlist,
 * album or artist card opens its page; a song's card plays the song; a mix's
 * plays it again. Each long-press opens the menu its kind has elsewhere.
 */
export function RecentlyPlayedShelf({
  entries,
  selection,
}: {
  entries: readonly RecentlyPlayedEntry[];
  selection?: HomeSelection | undefined;
}) {
  const { strings } = useLocalisation();
  const words = strings.home.recentlyPlayed;
  const active = selection?.enabled ? selection : undefined;
  const selecting = active?.selecting ?? false;
  const items = entries.map((entry) => entryItem(entry, words.playlist));
  useHomeTiles(
    active,
    items.filter((item) => item !== undefined),
  );
  const checked = (item: MixedItem | undefined): boolean | undefined =>
    selecting && item !== undefined ? active!.isChecked(item) : undefined;
  const press = (item: MixedItem | undefined, open: () => void) => () => {
    if (!selecting) open();
    else if (item !== undefined) active!.toggle(item);
  };
  const select = (item: MixedItem | undefined): (() => void) | undefined =>
    active === undefined || item === undefined ? undefined : () => active.start(item);
  return (
    <CoverRow staged>
      {entries.map((entry, place) => {
        const item = items[place];
        const key = entryKey(entry);
        switch (entry.kind) {
          case "playlist": {
            const { playlist } = entry;
            return (
              <PlaylistCard
                key={key}
                name={playlist.name}
                detail={songCount(playlist.trackCount, strings)}
                paths={playlist.thumbPaths}
                size={COVER_ROW_TILE}
                checked={checked(item)}
                onPress={press(item, () => openPlaylist(playlist.id, playlist))}
                onLongPress={
                  selecting
                    ? undefined
                    : () => openPlaylistActions(playlist, { onSelect: select(item) })
                }
              />
            );
          }
          case "ytPlaylist": {
            const id = entry.context.id ?? "";
            const head = ytPlaylistHead(id, entry.song, words.playlist);
            const onSelect = select(item);
            return (
              <PlaylistCard
                key={key}
                name={head.title}
                detail={head.line}
                label={head.line === "" ? head.title : undefined}
                paths={head.artworkUrl === null ? NO_COVERS : [head.artworkUrl]}
                size={COVER_ROW_TILE}
                checked={checked(item)}
                onPress={press(item, () => openYtPlaylist(id, head, { read: false }))}
                onLongPress={
                  selecting || onSelect === undefined
                    ? undefined
                    : () =>
                        openSelectOnlyMenu(head.title, strings.itemActions.labels.select, onSelect)
                }
              />
            );
          }
          case "album": {
            const { album } = entry;
            const onSelect = select(item);
            return (
              <PlayedAlbumCard
                key={key}
                album={album}
                size={COVER_ROW_TILE}
                selecting={selecting}
                checked={checked(item)}
                onPress={selecting ? press(item, () => undefined) : undefined}
                onLongPress={
                  selecting
                    ? undefined
                    : "online" in album
                      ? onSelect === undefined
                        ? undefined
                        : () =>
                            openSelectOnlyMenu(
                              album.title,
                              strings.itemActions.labels.select,
                              onSelect,
                            )
                      : () => openAlbumActions(album, { onSelect })
                }
              />
            );
          }
          case "artist":
            return (
              <PlayedArtistCard
                key={key}
                artist={entry.artist}
                size={COVER_ROW_TILE}
                selecting={selecting}
              />
            );
          case "song": {
            const { song } = entry;
            const context: PlayContext = { kind: SONG_PLAY_CONTEXT, id: entry.context.id };
            return (
              <SongCard
                key={key}
                title={song.title}
                artist={songArtist(song)}
                artworkUri={songCover(song)}
                size={COVER_ROW_TILE}
                checked={checked(item)}
                onPress={press(item, () => void playRecent([song], context))}
                onLongPress={
                  selecting
                    ? undefined
                    : streamed(song)
                      ? () => openYtSongActions(song as NativeYtSong, { onSelect: select(item) })
                      : () => openTrackActions(song, { onSelect: select(item) })
                }
              />
            );
          }
          case "mix": {
            const name = words.mixes[entry.context.kind] ?? words.mixes.mix!;
            return (
              <SongCard
                key={key}
                title={name}
                artist={entry.song === null ? "" : entry.song.title}
                artworkUri={songCover(entry.song)}
                size={COVER_ROW_TILE}
                label={words.playAgain(name)}
                unavailable={selecting}
                onPress={() => {
                  if (!selecting) void playMixAgain(entry.context);
                }}
              />
            );
          }
        }
      })}
    </CoverRow>
  );
}
