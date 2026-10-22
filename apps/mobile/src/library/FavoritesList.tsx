import { useScreenContent } from "@/lib/screenTiming";
import { IconStar } from "@tabler/icons-react-native";
import { View } from "react-native";

import { grid } from "@/catalog/grid";
import { EmptyState } from "@/components/EmptyState";

import { useFavoriteSongs } from "./hooks";
import { SongSortButton } from "./SongSortButton";
import { useSortedSongs } from "./songSort";
import { ListIntro, songCount, TrackList } from "./TrackList";

/** Tapping a favorite plays the Favorites list from it. */
const FAVORITES_CONTEXT = { kind: "favorites", id: null } as const;

/** Library › Favorites: every starred song in the sort you chose (most recently starred first until then). */
export function FavoritesList({ empty }: { empty: string }) {
  const starred = useFavoriteSongs();
  const { sort, songs } = useSortedSongs("favorites", starred);
  useScreenContent(songs !== undefined);
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
      findable
      songCards
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
