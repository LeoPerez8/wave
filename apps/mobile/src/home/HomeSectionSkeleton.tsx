import { STATS_FACT_LABELS, homeSectionTitle, type HomeSectionId } from "@wave/core";
import { Fragment } from "react";
import { Text, View, useWindowDimensions } from "react-native";

import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { SkeletonLine } from "@/catalog/SkeletonLine";
import { AlbumCardSkeleton, SkeletonGroup, TrackSkeletons } from "@/catalog/Skeletons";
import { TitledSection } from "@/catalog/TitledSection";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { StatsFactRow } from "./StatsFactRow";
import { statsSeeAllAction } from "./statsSeeAllAction";
import { DiscoverMixesSkeleton } from "./DiscoverMixesSkeleton";
import { homePlaceholderHeight } from "./homeOpening";

function DiscoverSkeleton() {
  const enabled = useYtMusicEnabled();
  return (
    <View style={{ gap: CELL * 3 }}>
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
  const songs = id === "most-played" || id === "favorites";
  const artists = id === "most-played-artists";
  return (
    <TitledSection
      title={homeSectionTitle(id)}
      {...(id === "stats" ? { action: statsSeeAllAction } : {})}
    >
      <View style={{ minHeight: homePlaceholderHeight(id, fontScale) }}>
        {id === "discover" ? (
          <DiscoverSkeleton />
        ) : songs ? (
          <TrackSkeletons count={10} leading="card" />
        ) : id === "stats" ? (
          <SkeletonGroup label="Loading Stats">
            {STATS_FACT_LABELS.map((label, index) => (
              <Fragment key={label}>
                {index > 0 && <Hairline />}
                <StatsFactRow>
                  <View style={{ width: "45%" }}>
                    <SkeletonLine lineHeight={22 * Math.max(1, fontScale)} width="100%" />
                  </View>
                  <View style={{ width: "25%" }}>
                    <SkeletonLine lineHeight={22 * Math.max(1, fontScale)} width="100%" />
                  </View>
                </StatsFactRow>
              </Fragment>
            ))}
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
      </View>
    </TitledSection>
  );
}
