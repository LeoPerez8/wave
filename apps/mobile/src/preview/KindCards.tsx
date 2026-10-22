/**
 * PROTOTYPE (#570). Card shapes for each kind of item (album, artist, song,
 * playlist), two or three variants each, on the synthetic library, for the
 * owner to pick one per kind. Delete once the screens adopt the chosen shapes
 * (#571–#574).
 */
import { IconPlayerPlay } from "@tabler/icons-react-native";
import { type ReactNode, useEffect, useState } from "react";
import { ScrollView, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Uniwind } from "uniwind";

import type { AlbumSummary } from "@/catalog/AlbumTile";
import { furnitureLine } from "@/catalog/AlbumTile";
import { Artwork } from "@/catalog/Artwork";
import { CatalogLine } from "@/catalog/CatalogLine";
import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { CELL, grid } from "@/catalog/grid";
import { Press } from "@/motion/Press";
import { getAppearance } from "@/settings/appearance";
import { useThemeColor } from "@/theme/useThemeColor";

import { SYNTHETIC_ALBUMS, SYNTHETIC_PLAYLISTS, SYNTHETIC_TRACKS } from "./syntheticLibrary";

type Variant = "A" | "B" | "C";
const VARIANTS: readonly Variant[] = ["A", "B", "C"];

type Kind = "album" | "artist" | "song" | "playlist";

/** What each variant is, as the preview's notes say it. */
const NOTES: Readonly<Record<Kind, Readonly<Record<Variant, string>>>> = {
  album: {
    A: "Today's tile: square cover, artist in caps over a two-line title, furniture line.",
    B: "Cover rounded 6dp, title then artist, one line each.",
    C: "Cover rounded 4dp, two-line title, a caps line with the kind and year.",
  },
  artist: {
    A: "Round photo, the name centred under it.",
    B: "Round photo, the name centred over an ARTIST caps line.",
    C: "Round photo inset to 84% of the tile, the name and song count centred.",
  },
  song: {
    A: "Compact row, 4dp thumb, outline play at the end; shelves stack 4 rows a column.",
    B: "A smaller tile (13 cells), a play button on the cover, title and artist.",
    C: "Row with play on its 48dp thumb; shelves stack 3 rows a column.",
  },
  playlist: {
    A: "Mosaic rounded 6dp with a stacked edge above it, name and count.",
    B: "Mosaic rounded 6dp, the name over a PLAYLIST caps line.",
    C: "Mosaic inside a surface card (12dp corners, 8dp padding), name and count inside.",
  },
};

// ---------------------------------------------------------------------------
// Synthetic items of each kind

type Artist = { name: string; detail: string; tint: string | undefined };
type Song = { title: string; artist: string; length: string; tint: string | undefined };
type Playlist = { name: string; detail: string; tints: readonly (string | undefined)[] };

const ALBUMS = SYNTHETIC_ALBUMS.slice(0, 6);

const ARTISTS: readonly Artist[] = [
  ...new Map(SYNTHETIC_ALBUMS.map((album) => [album.albumArtist, album])).values(),
]
  .slice(0, 6)
  .map((album) => ({
    name: album.albumArtist,
    detail: `${album.trackCount} songs`,
    tint: album.tint,
  }));

const clock = (ms: number | null): string => {
  const seconds = Math.round((ms ?? 0) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const SONGS: readonly Song[] = SYNTHETIC_TRACKS.filter(({ track }) => track.title.length < 24)
  .slice(0, 8)
  .map(({ track }) => ({
    title: track.title,
    artist: track.artist,
    length: clock(track.durationMs),
    tint: track.tint,
  }));

const PLAYLISTS: readonly Playlist[] = SYNTHETIC_PLAYLISTS.map((playlist, i) => ({
  name: playlist.name,
  detail: `${playlist.trackCount} songs`,
  tints: [0, 1, 2, 3].map((n) => SYNTHETIC_ALBUMS[i * 4 + n]?.tint),
}));

// ---------------------------------------------------------------------------
// Pieces

const THUMB = CELL * 5;
const SONG_TILE = CELL * 13;

const noop = (): void => undefined;

function Title({ children, lines = 1 }: { children: string; lines?: 1 | 2 }) {
  return (
    <Text
      numberOfLines={lines}
      className="font-sans text-body font-medium text-foreground"
      style={lines === 2 ? { minHeight: CELL * 5.5 } : undefined}
    >
      {children}
    </Text>
  );
}

function Detail({ children, size = "footnote" }: { children: string; size?: "footnote" | "body" }) {
  return (
    <Text
      numberOfLines={1}
      className={`font-sans text-secondary ${size === "body" ? "text-body" : "text-footnote"}`}
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {children}
    </Text>
  );
}

function Circle({ tint, size }: { tint: string | undefined; size: number }) {
  return (
    <View
      className="bg-fill"
      style={[
        { width: size, height: size, borderRadius: size / 2 },
        tint !== undefined && { backgroundColor: tint },
      ]}
    />
  );
}

/** A playlist's mosaic of four covers, butted together, rounded as a whole. */
function TintMosaic({
  tints,
  size,
  radius,
}: {
  tints: readonly (string | undefined)[];
  size: number;
  radius: number;
}) {
  return (
    <View
      className="flex-row flex-wrap overflow-hidden"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {tints.map((tint, i) => (
        // oxlint-disable-next-line react/no-array-index-key -- a fixed 2×2 grid
        <Artwork key={i} tint={tint} size={size / 2} />
      ))}
    </View>
  );
}

/**
 * The mosaic with two sleeves behind it, showing as edges above: the nearer
 * one 88% of its width, the farther 76%, each a tone quieter.
 */
function StackedMosaic({
  tints,
  size,
  radius,
}: {
  tints: readonly (string | undefined)[];
  size: number;
  radius: number;
}) {
  const dark = useColorScheme() === "dark";
  const small = size < CELL * 8;
  const edge = small ? 2 : 3;
  const gap = small ? 1 : 2;
  const sleeve = (width: number, top: number, quiet: boolean) => (
    <View
      className={dark ? (quiet ? "bg-tone-8" : "bg-tone-7") : quiet ? "bg-tone-3" : "bg-tone-4"}
      style={{
        position: "absolute",
        top,
        left: (size - width) / 2,
        width,
        height: edge,
        borderTopLeftRadius: edge,
        borderTopRightRadius: edge,
      }}
    />
  );
  return (
    <View style={{ paddingTop: (edge + gap) * 2 }}>
      {sleeve(size * 0.76, 0, true)}
      {sleeve(size * 0.88, edge + gap, false)}
      <TintMosaic tints={tints} size={size} radius={radius} />
    </View>
  );
}

/** A play button sitting on a cover: a disc of the ground, most of the way opaque. */
function PlayDisc({ size, place }: { size: number; place: object }) {
  const foreground = useThemeColor("foreground");
  return (
    <View
      className="items-center justify-center"
      style={[{ position: "absolute", width: size, height: size }, place]}
    >
      <View
        className="bg-background"
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          opacity: 0.82,
        }}
      />
      <IconPlayerPlay size={size / 2} color={foreground} strokeWidth={1.5} />
    </View>
  );
}

function CoverWithPlay({
  tint,
  size,
  disc,
  place,
}: {
  tint: string | undefined;
  size: number;
  disc: number;
  place: object;
}) {
  return (
    <View style={{ width: size, height: size }}>
      <Artwork tint={tint} size={size} radius={CELL / 2} />
      <PlayDisc size={disc} place={place} />
    </View>
  );
}

const centred = (cover: number, disc: number) => ({
  left: (cover - disc) / 2,
  top: (cover - disc) / 2,
});

/** A list row: what leads it, a title over a detail line, and what ends it. */
function Row({
  lead,
  title,
  detail,
  trail,
  height = grid.row,
}: {
  lead: ReactNode;
  title: string;
  detail: string;
  trail?: ReactNode;
  height?: number;
}) {
  return (
    <Press accessibilityRole="button" accessibilityLabel={`${title}, ${detail}`} onPress={noop}>
      <View className="flex-row items-center" style={{ height, gap: CELL * 1.5 }}>
        {lead}
        <View className="flex-1">
          <Title>{title}</Title>
          <Detail size="body">{detail}</Detail>
        </View>
        {trail}
      </View>
    </Press>
  );
}

function Tile({ width, label, children }: { width: number; label: string; children: ReactNode }) {
  return (
    <Press
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={noop}
      depth={0.02}
      style={{ width }}
    >
      {children}
    </Press>
  );
}

// ---------------------------------------------------------------------------
// Each kind's variants: a tile (shelves), a row (lists, Search)

function AlbumTileVariant({ album, variant }: { album: AlbumSummary; variant: Variant }) {
  const size = COVER_ROW_TILE;
  const label = `${album.title}, album by ${album.albumArtist}`;
  if (variant === "A") {
    return (
      <Tile width={size} label={label}>
        <Artwork tint={album.tint} size={size} />
        <View style={{ paddingTop: CELL * 1.5, gap: CELL / 4 }}>
          <CatalogLine>{album.albumArtist}</CatalogLine>
          <Title lines={2}>{album.title}</Title>
          <Detail>{furnitureLine(album)}</Detail>
        </View>
      </Tile>
    );
  }
  if (variant === "B") {
    return (
      <Tile width={size} label={label}>
        <Artwork tint={album.tint} size={size} radius={CELL * 0.75} />
        <View style={{ paddingTop: CELL }}>
          <Title>{album.title}</Title>
          <Detail>{album.albumArtist}</Detail>
        </View>
      </Tile>
    );
  }
  return (
    <Tile width={size} label={label}>
      <Artwork tint={album.tint} size={size} radius={CELL / 2} />
      <View style={{ paddingTop: CELL, gap: CELL / 4 }}>
        <Title lines={2}>{album.title}</Title>
        <CatalogLine>{`Album · ${album.year ?? ""}`}</CatalogLine>
      </View>
    </Tile>
  );
}

function AlbumRowVariant({ album, variant }: { album: AlbumSummary; variant: Variant }) {
  return (
    <Row
      lead={<Artwork tint={album.tint} size={THUMB} radius={variant === "A" ? 0 : CELL / 2} />}
      title={album.title}
      detail={
        variant === "C"
          ? `${album.albumArtist} · ${album.year ?? ""}`
          : `Album · ${album.albumArtist}`
      }
    />
  );
}

function ArtistTileVariant({ artist, variant }: { artist: Artist; variant: Variant }) {
  const size = COVER_ROW_TILE;
  const inset = variant === "C" ? size * 0.84 : size;
  return (
    <Tile width={size} label={`${artist.name}, artist`}>
      <View className="items-center" style={{ paddingVertical: (size - inset) / 2 }}>
        <Circle tint={artist.tint} size={inset} />
      </View>
      <View className="items-center" style={{ paddingTop: variant === "C" ? 0 : CELL }}>
        <Title>{artist.name}</Title>
        {variant === "B" && <CatalogLine>Artist</CatalogLine>}
        {variant === "C" && <Detail>{artist.detail}</Detail>}
      </View>
    </Tile>
  );
}

function ArtistRowVariant({ artist, variant }: { artist: Artist; variant: Variant }) {
  const detail = { A: "Artist", B: `Artist · ${artist.detail}`, C: artist.detail }[variant];
  return (
    <Row lead={<Circle tint={artist.tint} size={THUMB} />} title={artist.name} detail={detail} />
  );
}

function SongRowVariant({ song, variant }: { song: Song; variant: Variant }) {
  const secondary = useThemeColor("secondary");
  if (variant === "A") {
    return (
      <Row
        lead={<Artwork tint={song.tint} size={THUMB} radius={CELL / 2} />}
        title={song.title}
        detail={`Song · ${song.artist}`}
        trail={<IconPlayerPlay size={CELL * 2.5} color={secondary} strokeWidth={1.5} />}
      />
    );
  }
  return (
    <Row
      lead={
        <CoverWithPlay
          tint={song.tint}
          size={THUMB}
          disc={CELL * 2.5}
          place={
            variant === "B" ? { right: -CELL / 2, bottom: -CELL / 2 } : centred(THUMB, CELL * 2.5)
          }
        />
      }
      title={song.title}
      detail={`Song · ${song.artist}`}
    />
  );
}

/** A song as a tile: variant B's own, and how A and C show on a shelf that mixes kinds. */
function SongTileVariant({ song, variant }: { song: Song; variant: Variant }) {
  const size = variant === "B" ? SONG_TILE : COVER_ROW_TILE;
  const disc = variant === "B" ? CELL * 3.5 : CELL * 4;
  return (
    <Tile width={size} label={`${song.title}, song by ${song.artist}`}>
      <CoverWithPlay
        tint={song.tint}
        size={size}
        disc={disc}
        place={{ right: CELL, bottom: CELL }}
      />
      <View style={{ paddingTop: CELL }}>
        <Title>{song.title}</Title>
        <Detail>{variant === "B" ? song.artist : `Song · ${song.artist}`}</Detail>
      </View>
    </Tile>
  );
}

/** Songs on a shelf of their own: B's tiles, or A's and C's rows stacked in columns. */
function SongShelf({ variant }: { variant: Variant }) {
  const { width } = useWindowDimensions();
  if (variant === "B") {
    return (
      <CoverRow>
        {SONGS.map((song) => (
          <SongTileVariant key={song.title} song={song} variant="B" />
        ))}
      </CoverRow>
    );
  }
  const perColumn = variant === "A" ? 4 : 3;
  const columnWidth = width - grid.margin * 2 - CELL * 4;
  const columns = [SONGS.slice(0, perColumn), SONGS.slice(perColumn, perColumn * 2)];
  const thumb = CELL * 6;
  return (
    <CoverRow>
      {columns.map((column) => (
        <View key={column[0]?.title} style={{ width: columnWidth }}>
          {column.map((song) =>
            variant === "A" ? (
              <SongRowVariant key={song.title} song={song} variant="A" />
            ) : (
              <Row
                key={song.title}
                height={CELL * 8}
                lead={
                  <CoverWithPlay
                    tint={song.tint}
                    size={thumb}
                    disc={CELL * 3}
                    place={centred(thumb, CELL * 3)}
                  />
                }
                title={song.title}
                detail={`${song.artist} · ${song.length}`}
              />
            ),
          )}
        </View>
      ))}
    </CoverRow>
  );
}

function PlaylistTileVariant({ playlist, variant }: { playlist: Playlist; variant: Variant }) {
  const size = COVER_ROW_TILE;
  const label = `${playlist.name}, playlist, ${playlist.detail}`;
  if (variant === "C") {
    const pad = CELL;
    return (
      <Tile width={size} label={label}>
        <View className="bg-surface" style={{ borderRadius: CELL * 1.5, padding: pad }}>
          <TintMosaic tints={playlist.tints} size={size - pad * 2} radius={CELL * 0.75} />
          <View style={{ paddingTop: CELL }}>
            <Title>{playlist.name}</Title>
            <Detail>{playlist.detail}</Detail>
          </View>
        </View>
      </Tile>
    );
  }
  return (
    <Tile width={size} label={label}>
      {variant === "A" ? (
        <StackedMosaic tints={playlist.tints} size={size} radius={CELL * 0.75} />
      ) : (
        <TintMosaic tints={playlist.tints} size={size} radius={CELL * 0.75} />
      )}
      <View style={{ paddingTop: CELL }}>
        <Title>{playlist.name}</Title>
        {variant === "A" ? <Detail>{playlist.detail}</Detail> : <CatalogLine>Playlist</CatalogLine>}
      </View>
    </Tile>
  );
}

function PlaylistRowVariant({ playlist, variant }: { playlist: Playlist; variant: Variant }) {
  const lead =
    variant === "A" ? (
      <StackedMosaic tints={playlist.tints} size={THUMB} radius={CELL * 0.375} />
    ) : (
      <TintMosaic
        tints={playlist.tints}
        size={THUMB}
        radius={variant === "B" ? CELL / 2 : CELL * 0.75}
      />
    );
  return <Row lead={lead} title={playlist.name} detail={`Playlist · ${playlist.detail}`} />;
}

// ---------------------------------------------------------------------------
// The shelf

function VariantHead({ variant, note }: { variant: Variant; note: string }) {
  return (
    <View className="flex-row" style={{ gap: CELL, paddingTop: CELL * 3, paddingBottom: CELL }}>
      <View
        className="bg-accent"
        style={{ borderRadius: CELL / 2, paddingHorizontal: CELL * 0.75 }}
      >
        <Text className="font-sans text-footnote font-bold text-on-accent">{variant}</Text>
      </View>
      <Text className="flex-1 font-sans text-footnote text-secondary">{note}</Text>
    </View>
  );
}

function KindHead({ children }: { children: string }) {
  return (
    <Text
      className="font-sans text-title2 font-light text-foreground"
      style={{ paddingTop: CELL * 5 }}
    >
      {children}
    </Text>
  );
}

function KindSection({ kind }: { kind: Kind }) {
  const title = { album: "Album", artist: "Artist", song: "Song", playlist: "Playlist" }[kind];
  return (
    <View>
      <KindHead>{title}</KindHead>
      {VARIANTS.map((variant) => (
        <View key={variant}>
          <VariantHead variant={variant} note={NOTES[kind][variant]} />
          {kind === "song" ? (
            <SongShelf variant={variant} />
          ) : (
            <CoverRow>
              {kind === "album" &&
                ALBUMS.map((album) => (
                  <AlbumTileVariant key={album.id} album={album} variant={variant} />
                ))}
              {kind === "artist" &&
                ARTISTS.map((artist) => (
                  <ArtistTileVariant key={artist.name} artist={artist} variant={variant} />
                ))}
              {kind === "playlist" &&
                PLAYLISTS.map((playlist) => (
                  <PlaylistTileVariant key={playlist.name} playlist={playlist} variant={variant} />
                ))}
            </CoverRow>
          )}
          <View style={{ paddingTop: CELL }}>
            {kind === "album" &&
              ALBUMS.slice(0, 2).map((album) => (
                <AlbumRowVariant key={album.id} album={album} variant={variant} />
              ))}
            {kind === "artist" &&
              ARTISTS.slice(0, 2).map((artist) => (
                <ArtistRowVariant key={artist.name} artist={artist} variant={variant} />
              ))}
            {kind === "song" &&
              SONGS.slice(0, 2).map((song) => (
                <SongRowVariant key={song.title} song={song} variant={variant} />
              ))}
            {kind === "playlist" &&
              PLAYLISTS.slice(0, 2).map((playlist) => (
                <PlaylistRowVariant key={playlist.name} playlist={playlist} variant={variant} />
              ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Each set's four kinds together: Search's results, then a Home shelf. */
function MixedSet({ variant }: { variant: Variant }) {
  const [album, otherAlbum] = ALBUMS as [AlbumSummary, AlbumSummary];
  const [artist, otherArtist] = ARTISTS as [Artist, Artist];
  const [song, otherSong] = SONGS as [Song, Song];
  const [playlist, otherPlaylist] = PLAYLISTS as [Playlist, Playlist];
  return (
    <View>
      <View style={{ paddingTop: CELL * 3, paddingBottom: CELL }}>
        <CatalogLine>{`Search · set ${variant}`}</CatalogLine>
      </View>
      <ArtistRowVariant artist={artist} variant={variant} />
      <AlbumRowVariant album={album} variant={variant} />
      <SongRowVariant song={song} variant={variant} />
      <PlaylistRowVariant playlist={playlist} variant={variant} />
      <SongRowVariant song={otherSong} variant={variant} />
      <AlbumRowVariant album={otherAlbum} variant={variant} />
      <View style={{ paddingTop: CELL * 3, paddingBottom: CELL }}>
        <CatalogLine>{`Home · Recently played · set ${variant}`}</CatalogLine>
      </View>
      <CoverRow>
        <AlbumTileVariant album={otherAlbum} variant={variant} />
        <PlaylistTileVariant playlist={otherPlaylist} variant={variant} />
        <ArtistTileVariant artist={otherArtist} variant={variant} />
        <SongTileVariant song={song} variant={variant} />
      </CoverRow>
    </View>
  );
}

const SCHEMES = ["light", "dark"] as const;

/**
 * Light and dark, switched here for the whole app while the shelf shows, and
 * given back to the owner's appearance as it goes.
 */
function SchemeSwitch() {
  const scheme = useColorScheme();
  const [chosen, setChosen] = useState<"light" | "dark" | undefined>(undefined);
  useEffect(() => () => Uniwind.setTheme(getAppearance()), []);
  const showing = chosen ?? (scheme === "dark" ? "dark" : "light");
  return (
    <View className="flex-row" style={{ gap: CELL * 3 }}>
      {SCHEMES.map((option) => (
        <Press
          key={option}
          accessibilityRole="radio"
          accessibilityState={{ selected: showing === option }}
          onPress={() => {
            setChosen(option);
            Uniwind.setTheme(option);
          }}
          haptic="selection"
          style={{ minHeight: 48, justifyContent: "center" }}
        >
          <Text
            className={`font-sans text-footnote ${
              showing === option ? "font-semibold text-accent" : "text-secondary"
            }`}
          >
            {option === "light" ? "Light" : "Dark"}
          </Text>
        </Press>
      ))}
    </View>
  );
}

/** The Design preview's Kinds shelf: each kind's variants, then the kinds mixed. */
export function KindCards() {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: grid.margin, paddingBottom: insets.bottom + 48 }}
    >
      <SchemeSwitch />
      <KindSection kind="album" />
      <KindSection kind="artist" />
      <KindSection kind="song" />
      <KindSection kind="playlist" />
      <KindHead>Mixed</KindHead>
      <Text className="font-sans text-footnote text-secondary" style={{ paddingTop: CELL }}>
        Each set&apos;s four kinds together. A shelf mixing kinds shows a song as a cover with play,
        whichever set; pick per kind all the same.
      </Text>
      {VARIANTS.map((variant) => (
        <MixedSet key={variant} variant={variant} />
      ))}
    </ScrollView>
  );
}
