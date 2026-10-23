import { homeSectionTitle, type HomeSectionId } from "@wave/core";
import type { ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";

import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { SkeletonLine } from "@/catalog/SkeletonLine";
import {
  AlbumCardSkeleton,
  SongCardSkeleton,
  SkeletonGroup,
  TrackSkeletons,
} from "@/catalog/Skeletons";
import { TitledSection } from "@/catalog/TitledSection";
import { openStats } from "@/library/routes";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { DiscoverMixesSkeleton } from "./DiscoverMixesSkeleton";
import { homeBodyHeight, magicQueueGrid } from "./homeOpening";

/** The same reservation surrounds the placeholder and the answered section. */
export function HomeSectionBody({ id, children }: { id: HomeSectionId; children: ReactNode }) {
  const { fontScale } = useWindowDimensions();
  return <View style={{ minHeight: homeBodyHeight(id, fontScale) }}>{children}</View>;
}

/** Nine song tiles at the same responsive sizes as the Magic Queue's real grid. */
export function MagicQueueSkeleton() {
  const { width, fontScale } = useWindowDimensions();
  const { available, size, height } = magicQueueGrid(width - CELL * 6, fontScale);
  return (
    <SkeletonGroup label="Loading songs">
      <View
        style={{
          width: available,
          minHeight: height,
          flexDirection: "row",
          flexWrap: "wrap",
          gap: CELL,
        }}
      >
        {Array.from({ length: 9 }, (_, index) => (
          <SongCardSkeleton key={index} size={size} fontScale={fontScale} />
        ))}
      </View>
    </SkeletonGroup>
  );
}

function DiscoverSkeleton() {
  const enabled = useYtMusicEnabled();
  return (
    <View style={{ gap: CELL * 3 }}>
      <View style={{ gap: CELL }}>
        <Text className="font-sans text-footnote font-medium text-secondary">Magic Queue</Text>
        <MagicQueueSkeleton />
      </View>
      {enabled &&
        ["Artist mixes", "Genre mixes"].map((label) => (
          <View key={label} style={{ gap: CELL }}>
            <Text className="font-sans text-footnote font-medium text-secondary">{label}</Text>
            <DiscoverMixesSkeleton />
          </View>
        ))}
    </View>
  );
}

/** A still, labelled placeholder in the section's own shape, including its heading. */
export function HomeSectionSkeleton({ id }: { id: HomeSectionId }) {
  const { fontScale } = useWindowDimensions();
  if (id === "stats")
    return (
      <View style={{ marginTop: CELL * 5 }}>
        <Hairline />
        <EntryRow label="Stats" onPress={openStats} />
      </View>
    );
  const songs = id === "most-played" || id === "favorites";
  const artists = id === "most-played-artists";
  return (
    <TitledSection title={homeSectionTitle(id)}>
      <HomeSectionBody id={id}>
        {id === "discover" ? (
          <DiscoverSkeleton />
        ) : songs ? (
          <TrackSkeletons count={10} leading="card" />
        ) : id === "listening-overview" ? (
          <SkeletonGroup label="Loading listening overview">
            <View style={{ gap: CELL / 2 }}>
              <SkeletonLine lineHeight={20 * Math.max(1, fontScale)} width="85%" />
              <SkeletonLine lineHeight={20 * Math.max(1, fontScale)} width="75%" />
            </View>
          </SkeletonGroup>
        ) : (
          <SkeletonGroup label={artists ? "Loading artists" : "Loading albums"}>
            <CoverRow>
              {Array.from({ length: 3 }, (_, index) =>
                artists ? (
                  <View key={index} style={{ width: COVER_ROW_TILE }}>
                    <View
                      className="bg-fill"
                      style={{
                        width: COVER_ROW_TILE,
                        height: COVER_ROW_TILE,
                        borderRadius: COVER_ROW_TILE / 2,
                      }}
                    />
                    <View style={{ paddingTop: CELL }}>
                      <SkeletonLine lineHeight={22 * Math.max(1, fontScale)} width="85%" />
                    </View>
                  </View>
                ) : (
                  <AlbumCardSkeleton key={index} size={COVER_ROW_TILE} fontScale={fontScale} />
                ),
              )}
            </CoverRow>
          </SkeletonGroup>
        )}
      </HomeSectionBody>
    </TitledSection>
  );
}
