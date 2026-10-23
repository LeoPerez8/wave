import { discoverTrackId, type MixedSong } from "@wave/core";

import { SwipeTrackRow } from "@/library/SwipeTrackRow";
import { useFavoriteIds } from "@/library/favorites";
import type { SongRow } from "@/library/LibraryStore";
import { toTrackSummary } from "@/library/TrackList";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { openTrackActions } from "@/playback/ActionsMenu";
import { useCurrentPlayingIds } from "@/playback/hooks";
import { listedTrackItem, type TrackItem } from "@/playback/actionTargets";
import { selectableRow } from "@/selection/selectableRow";
import type { ListSelection } from "@/selection/useListSelection";

import { openYtSongActions } from "./YtSongActions";
import { SwipeYtSongRow } from "./YtSongRow";

type Song = MixedSong<NativeYtSong, SongRow>;

/**
 * A YT Music song as a Songs-list row: the Library track (its star, its
 * menu) when the Library has it, else the YT Music song, streamed. In a list
 * that can select ([selection]), either kind checks.
 */
export function DiscoverSongRow({
  song,
  onPress,
  trackNumber,
  selection,
}: {
  song: Song;
  onPress: () => void;
  /** Leads with this number instead of the cover (an album's tracklist). */
  trackNumber?: number | undefined;
  selection?: ListSelection<TrackItem> | undefined;
}) {
  const currentIds = useCurrentPlayingIds();
  const favorites = useFavoriteIds();
  const playing = currentIds.has(discoverTrackId(song));
  const row = selectableRow(listedTrackItem(song), selection, onPress, (options) =>
    song.source === "library"
      ? openTrackActions(song.track, options)
      : openYtSongActions(song.song, options),
  );
  if (song.source === "stream")
    return <SwipeYtSongRow song={song.song} playing={playing} trackNumber={trackNumber} {...row} />;
  return (
    <SwipeTrackRow
      song={song.track}
      track={{ ...toTrackSummary(song.track), trackNumber }}
      state={playing ? "playing" : undefined}
      favorite={favorites.has(song.track.id)}
      leading={trackNumber === undefined ? "artwork" : "number"}
      {...row}
    />
  );
}
