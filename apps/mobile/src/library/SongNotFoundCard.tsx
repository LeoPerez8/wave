/**
 * The Couldn't find card (docs/spec.md, "Opening a song link"): a song a link
 * named that plays from neither the Library nor YouTube Music. It shows the
 * song as its service described it and offers Search with it typed in (Core's
 * `songLinkNotFound`). Any service's song link uses it.
 */
import { songLinkNotFound, type LinkedSong } from "@wave/core";
import { Text, View } from "react-native";

import { Artwork } from "@/catalog/Artwork";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { openOverlay } from "@/overlay/overlay";
import { openSearch } from "@/search/queryRequest";
import { useTabBar } from "@/settings/tabBar";

const COVER = CELL * 9;

/** Opens the Couldn't find card for [song]. Nothing plays; Close dismisses it. */
export const openSongNotFound = (song: LinkedSong): void => {
  openOverlay({
    label: currentLocalisation().strings.imports.songNotFound,
    render: (close) => <SongNotFoundCard song={song} close={close} />,
  });
};

function SongNotFoundCard({ song, close }: { song: LinkedSong; close: () => void }) {
  const { language, strings } = useLocalisation();
  const search = useTabBar().includes("search");
  const card = songLinkNotFound(song, { search }, language);
  const query = card.searchQuery;
  return (
    <>
      <View style={{ paddingTop: CELL, paddingBottom: CELL * 2, gap: CELL * 1.5 }}>
        <CatalogLine>{card.heading}</CatalogLine>
        <View className="flex-row items-center" style={{ gap: CELL * 1.5 }}>
          <Artwork uri={card.artworkUrl ?? undefined} size={COVER} radius={CELL / 2} />
          <View className="flex-1" style={{ gap: CELL / 2 }}>
            <Text numberOfLines={2} className="font-sans text-title3 font-normal text-foreground">
              {card.title}
            </Text>
            <Text numberOfLines={2} className="font-sans text-subheadline text-secondary">
              {card.artists}
            </Text>
          </View>
        </View>
      </View>
      <View className="flex-row items-center justify-end" style={{ gap: CELL * 3 }}>
        <TextButton label={strings.playbackText.close} onPress={close} />
        {query !== null && (
          <TextButton
            label={strings.playbackText.search}
            onPress={() => {
              close();
              openSearch(query);
            }}
          />
        )}
      </View>
    </>
  );
}
