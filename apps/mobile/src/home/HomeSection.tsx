import {
  discoverMixCaption,
  homeSectionTitle,
  type BlendedDiscoverMix,
  type HomeSectionId,
} from "@wave/core";
import { router } from "expo-router";
import type { ComponentType } from "react";
import { View } from "react-native";

import { AlbumTile } from "@/catalog/AlbumTile";
import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL } from "@/catalog/grid";
import { Hairline } from "@/catalog/Hairline";
import { TitledSection } from "@/catalog/TitledSection";
import type { HomeSections, MostPlayedRow } from "@/library/db/playHistory";
import { openStats, openStatsSeeAll } from "@/library/routes";
import { Crossfade } from "@/motion/Crossfade";
import type { Ranked } from "@/stats/Stats";
import { playCount } from "@/stats/StatsViews";
import { openDiscoverMix } from "@/ytmusic/routes";

import { useDiscoverMixes } from "./discoverMixes";
import { openDiscoverMixActions } from "./DiscoverMixActions";
import { DiscoverMixLevelButton } from "./DiscoverMixLevelButton";
import { DiscoverMixesSkeleton } from "./DiscoverMixesSkeleton";
import { useMostPlayedOfAllTime } from "./mostPlayedOfAllTime";

import { AlbumShelf, ArtistShelf, SongRows } from "./HomeSections";
import { ListeningOverview } from "./ListeningOverview";

/** Songs played from Home's lists are queued from the section they were in. */
const MOST_PLAYED_CONTEXT = { kind: "home", id: "most-played" } as const;
const FAVORITES_CONTEXT = { kind: "home", id: "favorites" } as const;

const countedPlays = (entry: { readonly countedPlays: number }): string =>
  playCount(entry.countedPlays);

/** A ranking's entries with their counted plays, as the rows Home's sections take. */
const withPlays = <A,>(ranking: readonly Ranked<A>[] | undefined) =>
  (ranking ?? []).map((entry) => ({ ...entry.item, countedPlays: entry.countedPlays }));

/** The counted plays Most Played is ranked by, shown in each row's trailing cell. */
const plays = (song: MostPlayedRow): number => song.playCount;

type SectionProps = {
  /** Home's lists (`useHome`), read once for every section that shows them. */
  home: HomeSections;
  /** The section's title in Core's catalogue. */
  title: string;
};

function MostPlayedAlbums({ title }: SectionProps) {
  const albums = withPlays(useMostPlayedOfAllTime()?.albums);
  if (albums.length === 0) return null;
  return (
    <TitledSection
      title={title}
      action={{ label: "See all", onPress: () => openStatsSeeAll("albums", "all") }}
    >
      <AlbumShelf albums={albums} detail={countedPlays} />
    </TitledSection>
  );
}

/** The header's quiet line while a section's mixes rebuild over the saved ones. */
const MIXES_UPDATING = "Updating…";

/**
 * The mixes as covers, each opening its page; placeholder tiles while the
 * first ones build; nothing with YT Music off (Core's `discoverMixesSection`).
 * The header's control sets how much of every mix is new, and says
 * "Updating…" while a rebuild runs.
 */
function DiscoverMixes({ home, title }: SectionProps) {
  const section = useDiscoverMixes(home.mostPlayed.length > 0);
  if (section.kind === "hidden") return null;
  return (
    <TitledSection
      title={title}
      control={<DiscoverMixLevelButton />}
      status={section.kind === "mixes" && section.updating ? MIXES_UPDATING : undefined}
    >
      {section.kind === "skeleton" ? (
        <DiscoverMixesSkeleton />
      ) : (
        <DiscoverMixRow mixes={section.mixes} />
      )}
    </TitledSection>
  );
}

/**
 * A mixes section's row of covers (Artist mixes, Genre mixes). Each place in
 * the row crossfades its tile when what it shows changes: the level
 * re-blending the mix, or a rebuild saving new mixes (a plain swap with
 * reduce motion). Keyed by place, not by mix, so a new set fades over the
 * old one tile by tile.
 */
function DiscoverMixRow({ mixes }: { mixes: readonly BlendedDiscoverMix[] }) {
  return (
    <CoverRow>
      {mixes.map((mix, place) => {
        const caption = discoverMixCaption(mix);
        const shows = [mix.id, caption.artworkUrl, caption.title, caption.artists, caption.line];
        return (
          // oxlint-disable-next-line react/no-array-index-key -- a place crossfades from the mix it had to the one it has now
          <Crossfade key={place} swapKey={shows.join("\n")}>
            <AlbumTile
              album={{
                id: mix.id,
                title: caption.title,
                albumArtist: caption.artists,
                trackCount: mix.songs.length,
                durationMs: 0,
                artworkUri: caption.artworkUrl ?? undefined,
              }}
              size={COVER_ROW_TILE}
              detail={caption.line}
              onPress={() => openDiscoverMix(mix.id)}
              onLongPress={() => openDiscoverMixActions(mix)}
            />
          </Crossfade>
        );
      })}
    </CoverRow>
  );
}

function MostPlayedArtists({ title }: SectionProps) {
  const artists = withPlays(useMostPlayedOfAllTime()?.artists);
  if (artists.length === 0) return null;
  return (
    <TitledSection
      title={title}
      action={{ label: "See all", onPress: () => openStatsSeeAll("artists", "all") }}
    >
      <ArtistShelf artists={artists} detail={countedPlays} />
    </TitledSection>
  );
}

/**
 * How each section of Core's catalogue (`HOME_SECTIONS`) is drawn: nothing
 * when it has nothing to show. A section added to the catalogue needs its
 * entry here (the type insists).
 */
const SECTIONS: Record<HomeSectionId, ComponentType<SectionProps>> = {
  "recently-added": ({ home, title }) =>
    home.recentlyAdded.length > 0 && (
      <TitledSection title={title}>
        <AlbumShelf albums={home.recentlyAdded} />
      </TitledSection>
    ),
  "recently-played": ({ home, title }) =>
    home.recentlyPlayed.length > 0 && (
      <TitledSection title={title}>
        <AlbumShelf albums={home.recentlyPlayed} />
      </TitledSection>
    ),
  "most-played": ({ home, title }) =>
    home.mostPlayed.length > 0 && (
      <TitledSection title={title}>
        <SongRows songs={home.mostPlayed} context={MOST_PLAYED_CONTEXT} plays={plays} />
      </TitledSection>
    ),
  "most-played-albums": MostPlayedAlbums,
  "most-played-artists": MostPlayedArtists,
  "artist-mixes": DiscoverMixes,
  favorites: ({ home, title }) =>
    home.favorites.length > 0 && (
      <TitledSection
        title={title}
        action={{ label: "See all", onPress: () => router.push("/library/favorites") }}
      >
        <SongRows songs={home.favorites} context={FAVORITES_CONTEXT} />
      </TitledSection>
    ),
  stats: ({ title }) => (
    <View style={{ marginTop: CELL * 5 }}>
      <Hairline />
      <EntryRow label={title} onPress={openStats} />
    </View>
  ),
  "listening-overview": ListeningOverview,
};

/** Space above every section but the first on a screen: what `TitledSection` puts there. */
export const SECTION_GAP = CELL * 5;

/**
 * The section [id] of Home's catalogue with its data, or nothing when it has
 * nothing to show. Every section leaves `SECTION_GAP` above itself, so it can
 * sit under any screen's content (Home, or the Library under its rows).
 * [home] is `useHome`'s answer.
 */
export function HomeSection({ id, home }: { id: HomeSectionId; home: HomeSections }) {
  const Section = SECTIONS[id];
  return <Section home={home} title={homeSectionTitle(id)} />;
}
