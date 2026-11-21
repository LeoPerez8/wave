/**
 * Discover's DJ card (docs/spec.md, DJ): a wide panel that opens DJ, where
 * the owner picks the artists a Magic Queue starts from. Hidden with YT
 * Music off, as DJ's queue needs it.
 */
import { djCardArtists, type DjArtistTile } from "@wave/core";
import { IconPlus } from "@tabler/icons-react-native";
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";

import { ArtistImage } from "@/catalog/ArtistImage";
import { CELL } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import { djRemembered } from "@/dj/djRemembered";
import { openDj } from "@/dj/routes";
import { appRuntime } from "@/library/runtime";
import { useLocalisation } from "@/localisation/localisation";
import { usePlayedArtist } from "@/stats/PlayedEntityViews";
import { useThemeColor } from "@/theme/useThemeColor";
import type { ArtistRow } from "@wave/client";

import type { MixIndexes } from "./mixKnown";
import { recommendationSnapshot } from "./recommendationSnapshot";

/** The panel's inset, on every side. */
const PADDING = CELL * 2.5;
/** The ring of the card's colour around each face, so overlapping faces read apart. */
const RING = CELL / 2;

/**
 * Where each face sits, by its rank (the first artist is the largest), from
 * the panel's top and right edges, clipped by them: the fan of the mock's
 * "Selection" direction. They are drawn in [order], back to front.
 */
const SLOTS = [
  { size: CELL * 13, right: 0, top: CELL * 9 },
  { size: CELL * 12, right: -CELL / 2, top: CELL * 3 },
  { size: CELL * 11.5, right: -CELL * 7, top: CELL * 7.5 },
  // High enough to clear the "Pick artists" row at the panel's bottom.
  { size: CELL * 11, right: CELL * 9, top: CELL * 3.5 },
] as const;
const ORDER = [3, 1, 0, 2] as const;

/**
 * How far the lowest face (the first artist's, the largest) reaches in from
 * the panel's right edge, ring included: the "Pick artists" row keeps clear of it.
 */
const actionSpan = (faces: number): number =>
  faces === 0 ? 0 : SLOTS[0].right + SLOTS[0].size + RING;

/** How far the faces reach in from the panel's right edge, ring included: the text keeps clear of it. */
const fanSpan = (faces: number): number =>
  SLOTS.slice(0, faces).reduce((span, slot) => Math.max(span, slot.right + slot.size + RING), 0);

/**
 * The Library part of the recommendation snapshot, for the most played
 * artists: the last one read, else one read for the card; null until then,
 * or when it can't be read.
 */
const useSnapshotLibrary = (): MixIndexes | null => {
  const [read, setRead] = useState<MixIndexes | null>(null);
  const peeked = recommendationSnapshot.peek().library;
  const waiting = peeked === null && read === null;
  useEffect(() => {
    if (!waiting) return;
    let current = true;
    void appRuntime
      .runPromise(recommendationSnapshot.library)
      .then((library) => {
        if (current) setRead(library);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [waiting]);
  return peeked ?? read;
};

/** One face of the fan: the artist's image in a ring of the card's colour. */
function Face({
  tile,
  artist,
  slot,
}: {
  tile: DjArtistTile;
  artist: ArtistRow | undefined;
  slot: (typeof SLOTS)[number];
}) {
  const { image } = usePlayedArtist(
    artist ?? { id: tile.key, online: true, name: tile.name, thumbPath: null, artworkPath: null },
  );
  const outer = slot.size + RING * 2;
  return (
    <View
      className="bg-fill"
      style={{
        position: "absolute",
        right: slot.right - RING,
        top: slot.top - RING,
        width: outer,
        height: outer,
        borderRadius: outer / 2,
        padding: RING,
      }}
    >
      <ArtistImage artist={image} size={slot.size} large />
    </View>
  );
}

/**
 * The card: "DJ" in the light Headline size, its line in Footnote graphite
 * and "Pick artists" in the primary colour at its bottom-left, with up to 4
 * artist faces fanning out from its right edge (Core's `djCardArtists`: the
 * remembered DJ selection's artists, then the most played). With none, the
 * text alone, at the same height. The whole panel is one button.
 */
export function DjCard() {
  const { strings } = useLocalisation();
  const accent = useThemeColor("accent");
  const remembered = djRemembered.useValue().tiles;
  const library = useSnapshotLibrary();
  const faces = useMemo(
    () =>
      djCardArtists({
        remembered,
        played: library?.topArtists ?? [],
        artists: library?.artists ?? [],
      }),
    [remembered, library],
  );
  const artists = useMemo(
    () => new Map((library?.artists ?? []).map((artist) => [artist.id, artist])),
    [library],
  );
  const textInset = Math.max(0, fanSpan(faces.length) - PADDING);
  const actionInset = Math.max(0, actionSpan(faces.length) - PADDING);
  return (
    <TextButton
      label={strings.dj.title}
      accessibilityLabel={`${strings.dj.title}, ${strings.dj.cardDetail}`}
      onPress={openDj}
      depth={0.015}
      className="overflow-hidden bg-fill"
      style={{
        minHeight: CELL * 21,
        borderRadius: CELL * 3,
        padding: PADDING,
        justifyContent: "space-between",
        gap: CELL * 2,
      }}
    >
      <View importantForAccessibility="no-hide-descendants" style={{ ...absoluteFill }}>
        {ORDER.map((rank) => {
          const tile = faces[rank];
          return tile === undefined ? null : (
            <Face
              key={tile.key}
              tile={tile}
              artist={tile.libraryId === null ? undefined : artists.get(tile.libraryId)}
              slot={SLOTS[rank]}
            />
          );
        })}
      </View>
      <View style={{ marginRight: textInset }}>
        <Text
          className="font-sans text-large-title font-light text-foreground"
          style={{ letterSpacing: -0.6 }}
        >
          {strings.dj.title}
        </Text>
        <Text className="font-sans text-footnote text-secondary" style={{ paddingTop: CELL / 2 }}>
          {strings.dj.cardDetail}
        </Text>
      </View>
      <View
        className="flex-row items-center"
        style={{ gap: CELL * 0.75, marginRight: actionInset }}
      >
        <IconPlus size={18} color={accent} strokeWidth={2} />
        <Text className="font-sans text-subheadline font-medium text-accent">
          {strings.dj.cardAction}
        </Text>
      </View>
    </TextButton>
  );
}

const absoluteFill = { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const;
