import { useLocalisation } from "@/localisation/localisation";
import {
  STATS_FACT_LABELS,
  discoverRowTitle,
  homeSectionTitle,
  type HomeSectionId,
} from "@wave/core";
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
import { useHomeArrangement } from "./homeArrangement";
import { homePlaceholderHeight } from "./homeOpening";

function DiscoverSkeleton() {
const localisation = useLocalisation();

  const enabled = useYtMusicEnabled();
  const { discoverRows } = useHomeArrangement();
  return (
    <View style={{ gap: CELL * 3 }}>
      {enabled &&
        discoverRows
          .filter((id) => id !== "magic-queue")
          .map((id) => (
            <View key={id} style={{ gap: CELL }}>
              <Text className="font-sans text-footnote font-medium text-secondary">
                {discoverRowTitle(id, localisation.strings)}
              </Text>
              <DiscoverMixesSkeleton />
            </View>
          ))}
    </View>
  );
}

/** A still, labelled placeholder in the section's own shape, including its heading. */
export function HomeSectionSkeleton({ id }: { id: HomeSectionId }) {
  const { strings } = useLocalisation();
  const { fontScale } = useWindowDimensions();
  const songs = id === "most-played" || id === "favorites";
  const artists = id === "most-played-artists";
  return (
    <TitledSection
      title={homeSectionTitle(id, strings)}
      {...(id === "stats" ? { action: statsSeeAllAction } : {})}
    >
      <View style={{ minHeight: homePlaceholderHeight(id, fontScale) }}>
        {id === "discover" ? (
          <DiscoverSkeleton />
        ) : songs ? (
          <TrackSkeletons count={10} leading="card" />
        ) : id === "stats" ? (
          <SkeletonGroup label={localisation.strings.home.loadingStats}>
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
          <SkeletonGroup label={artists ? localisation.strings.home.loadingArtists : localisation.strings.home.loadingAlbums}>
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
