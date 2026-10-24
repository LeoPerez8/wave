import { homeSectionTitle, type HomeSectionId } from "@wave/core";
import { Fragment, type ReactNode } from "react";
import { Text, View, useWindowDimensions } from "react-native";

import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { SkeletonLine } from "@/catalog/SkeletonLine";
import { AlbumCardSkeleton, SkeletonGroup, TrackSkeletons } from "@/catalog/Skeletons";
import { TitledSection } from "@/catalog/TitledSection";
import { openStats } from "@/library/routes";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { StatsFactRow } from "./StatsFactRow";
import { DiscoverMixesSkeleton } from "./DiscoverMixesSkeleton";
import { homeBodyHeight } from "./homeOpening";

/** Loaded sections fit their content; only the placeholder keeps its reserved height. */
export function HomeSectionBody({
  id,
  children,
  loading = false,
}: {
  id: HomeSectionId;
  children: ReactNode;
  loading?: boolean;
}) {
  const { fontScale } = useWindowDimensions();
  return <View style={{ minHeight: homeBodyHeight(id, fontScale, loading) }}>{children}</View>;
}

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
      {...(id === "stats" ? { action: { label: "See all", onPress: openStats } } : {})}
    >
      <HomeSectionBody id={id} loading>
        {id === "discover" ? (
          <DiscoverSkeleton />
        ) : songs ? (
          <TrackSkeletons count={10} leading="card" />
        ) : id === "stats" ? (
          <SkeletonGroup label="Loading Stats">
            {Array.from({ length: 6 }, (_, index) => (
              // oxlint-disable-next-line react/no-array-index-key -- fixed placeholder rows
              <Fragment key={index}>
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
      </HomeSectionBody>
    </TitledSection>
  );
}
