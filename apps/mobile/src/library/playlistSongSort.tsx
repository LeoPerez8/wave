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
import { showToast } from "@/overlay/toast";
import { pressedRect } from "@/motion/pressedRect";
import { useLocalisation } from "@/localisation/localisation";
import type { PlaylistEntryRow } from "./LibraryStore";
import { playlistSongSetting, usePlaylistSongSort } from "./playlistSongSetting";
import { ensureReleaseNotice } from "./releaseDates";
import { entryReleaseSong, releaseSongDate } from "./releaseSong";

/**
 * [entries] in [sort]'s order (Core's `sortPlaylistSongs`), each read as release dates read it
 * (`entryReleaseSong`). [answers] and [typed] default to the stored ones; a memo passes the
 * values it re-renders on.
 */
export const orderPlaylistEntries = (
  entries: readonly PlaylistEntryRow[],
  sort: PlaylistSongSort,
  answers?: Readonly<Record<string, ReleaseAnswer>>,
  typed?: Readonly<Record<string, string>>,
) =>
  sortPlaylistSongs(
    entries.map((entry) => {
      const song = entryReleaseSong(entry);
      return {
        ...song,
        entry,
        album: song.album ?? "",
        addedAt: entry.addedAt ?? 0,
        releaseDate: sort.key === "releaseDate" ? releaseSongDate(song, answers, typed) : null,
      };
    }),
    sort,
  ).map(({ entry }) => entry);
export function PlaylistSongSortButton({ id }: { id: string }) {
  const setting = playlistSongSetting(id);
  const current = usePlaylistSongSort(id);
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
                    if (!setting.set(sort)) void showToast(strings.playlists.sortsFull);
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
