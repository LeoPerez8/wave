import { IconStar } from "@tabler/icons-react-native";
import { sortSongs } from "@wave/core";
import { useMemo } from "react";
import { View } from "react-native";

import { grid } from "@/catalog/grid";
import { EmptyState } from "@/components/EmptyState";

import { useFavoriteSongs } from "./hooks";
import { SongSortButton } from "./SongSortButton";
import { useSongSort } from "./songSort";
import { ListIntro, songCount, TrackList } from "./TrackList";

/** Tapping a favorite plays the Favorites list from it. */
const FAVORITES_CONTEXT = { kind: "favorites", id: null } as const;

/** Library › Favorites: every starred song in the sort you chose (most recently starred first until then). */
export function FavoritesList({ empty }: { empty: string }) {
  const starred = useFavoriteSongs();
  const sort = useSongSort("favorites");
  // Play, Shuffle and rows all play this displayed order.
  const songs = useMemo(
    () => (starred === undefined ? undefined : sortSongs(starred, sort)),
    [starred, sort],
  );
  if (songs === undefined) return null;

  if (songs.length === 0) {
    return (
      <View style={{ paddingHorizontal: grid.margin }}>
        <EmptyState icon={IconStar} title="No favorites yet" message={empty} />
      </View>
    );
  }

  return (
    <TrackList
      songs={songs}
      context={FAVORITES_CONTEXT}
      sort={sort}
      header={
        <ListIntro
          line={songCount(songs.length)}
          songs={songs}
          context={FAVORITES_CONTEXT}
          sortControl={<SongSortButton kind="favorites" />}
        />
      }
    />
  );
}
