import {
  sortPlaylistSongs,
  SONG_SORTS,
  songSortLabelFor,
  type PlaylistSongSort,
  type ReleaseAnswer,
} from "@wave/core";
import { IconArrowsSort } from "@tabler/icons-react-native";
import { IconButton } from "@/components/IconButton";
import { EntryRow } from "@/catalog/EntryRow";
import { CardEntries } from "@/overlay/CardEntries";
import { openOverlay } from "@/overlay/overlay";
import { pressedRect } from "@/motion/pressedRect";
import { useLocalisation } from "@/localisation/localisation";
import type { PlaylistEntryRow } from "./LibraryStore";
export { playlistSongSetting } from "./playlistSongSetting";
import { playlistSongSetting } from "./playlistSongSetting";
import { releaseEntryDate, ensureReleaseNotice } from "./releaseDates";
export const orderPlaylistEntries = (
  entries: readonly PlaylistEntryRow[],
  sort: PlaylistSongSort,
  answers?: Readonly<Record<string, ReleaseAnswer>>,
  typed?: Readonly<Record<string, string>>,
) =>
  sortPlaylistSongs(
    entries.map((entry) => ({
      entry,
      title: entry.source === "library" ? entry.track.title : entry.song.title,
      artist: entry.source === "library" ? entry.track.artist : entry.song.artists.join(", "),
      album: entry.source === "library" ? entry.track.album : (entry.song.album ?? ""),
      addedAt: entry.addedAt ?? 0,
      releaseDate: releaseEntryDate(entry, answers, typed),
      ...(entry.source === "library"
        ? {
            year: entry.track.year,
            discNumber: entry.track.discNumber,
            trackNumber: entry.track.trackNumber,
          }
        : {}),
    })),
    sort,
  ).map(({ entry }) => entry);
export function PlaylistSongSortButton({ id }: { id: string }) {
  const setting = playlistSongSetting(id);
  const current = setting.useValue();
  const { strings, language } = useLocalisation();
  const choices: readonly PlaylistSongSort[] = [
    { key: "custom", descending: false },
    ...SONG_SORTS,
    { key: "releaseDate", descending: false },
    { key: "releaseDate", descending: true },
  ];
  const label = (sort: PlaylistSongSort) =>
    sort.key === "custom"
      ? strings.playlists.sorts.custom
      : sort.key === "releaseDate"
        ? sort.descending
          ? strings.playlists.releaseNewest
          : strings.playlists.releaseOldest
        : songSortLabelFor(language)({ ...sort, key: sort.key });
  return (
    <IconButton
      icon={IconArrowsSort}
      label={strings.library.sortButton(label(current))}
      opensMenu
      onPress={() =>
        openOverlay({
          label: strings.library.sortBy,
          anchor: pressedRect(),
          render: (close) => (
            <CardEntries>
              {choices.map((sort) => (
                <EntryRow
                  key={label(sort)}
                  label={label(sort)}
                  selected={sort.key === current.key && sort.descending === current.descending}
                  onPress={async () => {
                    close();
                    if (sort.key === "releaseDate") await ensureReleaseNotice();
                    setting.set(sort);
                  }}
                />
              ))}
            </CardEntries>
          ),
        })
      }
    />
  );
}
