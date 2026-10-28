/**
 * The Design preview's Kinds shelf (#570, #571): each kind's shared card as a
 * shelf of tiles and as list rows, then the four kinds mixed the way Search
 * and Home show them, on the synthetic library. The cards are the shared
 * components in `catalog/cards`; this only lays them out.
 */
import { useEffect, useState } from "react";
import { ScrollView, Text, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Uniwind } from "uniwind";

import { AlbumCard, AlbumCardRow } from "@/catalog/cards/AlbumCard";
import { ArtistCard, ArtistCardRow } from "@/catalog/cards/ArtistCard";
import { PlaylistCard, PlaylistCardRow } from "@/catalog/cards/PlaylistCard";
import { SongCard } from "@/catalog/cards/SongCard";
import { CatalogLine } from "@/catalog/CatalogLine";
import { COVER_ROW_TILE, CoverRow } from "@/catalog/CoverRow";
import { CELL, grid } from "@/catalog/grid";
import { SongRow as SongRowLeaf } from "@/songs/SongRow";
import { Press } from "@/motion/Press";
import { getAppearance } from "@/settings/appearance";

import { SYNTHETIC_ALBUMS, SYNTHETIC_PLAYLISTS, SYNTHETIC_TRACKS } from "./syntheticLibrary";
import { syntheticSongRow } from "./syntheticSongRow";

type Kind = "album" | "artist" | "song" | "playlist";

// ---------------------------------------------------------------------------
// Synthetic items of each kind

type Artist = { name: string; tint: string | undefined };
type Song = { title: string; artist: string; tint: string | undefined };
type Playlist = { name: string; detail: string; tints: readonly (string | undefined)[] };

const ALBUMS = SYNTHETIC_ALBUMS.slice(0, 6);

const ARTISTS: readonly Artist[] = [
  ...new Map(SYNTHETIC_ALBUMS.map((album) => [album.albumArtist, album])).values(),
]
  .slice(0, 6)
  .map((album) => ({ name: album.albumArtist, tint: album.tint }));

const SONGS: readonly Song[] = SYNTHETIC_TRACKS.filter(({ track }) => track.title.length < 24)
  .slice(0, 8)
  .map(({ track }) => ({ title: track.title, artist: track.artist, tint: track.tint }));

const PLAYLISTS: readonly Playlist[] = SYNTHETIC_PLAYLISTS.map((playlist, i) => ({
  name: playlist.name,
  detail: `${playlist.trackCount} songs`,
  tints: [0, 1, 2, 3].map((n) => SYNTHETIC_ALBUMS[i * 4 + n]?.tint),
}));

const noop = (): void => undefined;

// ---------------------------------------------------------------------------
// Each kind: its shelf of tiles, then two rows

function KindShelf({ kind }: { kind: Kind }) {
  if (kind === "album")
    return (
      <CoverRow>
        {ALBUMS.map((album) => (
          <AlbumCard
            key={album.id}
            title={album.title}
            artist={album.albumArtist}
            tint={album.tint}
            size={COVER_ROW_TILE}
            onPress={noop}
          />
        ))}
      </CoverRow>
    );
  if (kind === "artist")
    return (
      <CoverRow>
        {ARTISTS.map((artist) => (
          <ArtistCard
            key={artist.name}
            name={artist.name}
            artist={{ name: artist.name, thumbPath: null, artworkPath: null }}
            size={COVER_ROW_TILE}
            onPress={noop}
          />
        ))}
      </CoverRow>
    );
  if (kind === "song")
    return (
      <CoverRow>
        {SONGS.map((song) => (
          <SongCard
            key={song.title}
            title={song.title}
            artist={`Song · ${song.artist}`}
            tint={song.tint}
            onPress={noop}
          />
        ))}
      </CoverRow>
    );
  return (
    <CoverRow>
      {PLAYLISTS.map((playlist) => (
        <PlaylistCard
          key={playlist.name}
          name={playlist.name}
          detail={playlist.detail}
          paths={[]}
          tints={playlist.tints}
          size={COVER_ROW_TILE}
          onPress={noop}
        />
      ))}
    </CoverRow>
  );
}

/** A kind's list rows, as Search lists them: a song's is a song row with its play disc. */
function KindRows({ kind }: { kind: Kind }) {
  if (kind === "album")
    return ALBUMS.slice(0, 2).map((album) => (
      <AlbumCardRow
        key={album.id}
        title={album.title}
        artist={album.albumArtist}
        tint={album.tint}
        onPress={noop}
      />
    ));
  if (kind === "artist")
    return ARTISTS.slice(0, 2).map((artist) => (
      <ArtistCardRow
        key={artist.name}
        name={artist.name}
        artist={{ name: artist.name, thumbPath: null, artworkPath: null }}
        onPress={noop}
      />
    ));
  if (kind === "song")
    return SONGS.slice(0, 2).map((song) => <SongRow key={song.title} song={song} />);
  return PLAYLISTS.slice(0, 2).map((playlist) => (
    <PlaylistCardRow
      key={playlist.name}
      name={playlist.name}
      detail={playlist.detail}
      paths={[]}
      tints={playlist.tints}
      onPress={noop}
    />
  ));
}

function SongRow({ song }: { song: Song }) {
  const shown = syntheticSongRow(
    {
      track: { id: song.title, title: song.title, artist: song.artist, durationMs: null },
      state: undefined,
      favorite: false,
    },
    true,
  );
  return <SongRowLeaf {...shown} tint={song.tint} onPress={noop} />;
}

function KindSection({ kind }: { kind: Kind }) {
  const title = { album: "Album", artist: "Artist", song: "Song", playlist: "Playlist" }[kind];
  return (
    <View>
      <Text
        className="font-sans text-title2 font-light text-foreground"
        style={{ paddingTop: CELL * 5 }}
      >
        {title}
      </Text>
      <View style={{ paddingTop: CELL * 3 }}>
        <KindShelf kind={kind} />
      </View>
      <View style={{ paddingTop: CELL }}>
        <KindRows kind={kind} />
      </View>
    </View>
  );
}

/** Each kind as Search lists it, and a Home shelf mixing them. */
function MixedSet() {
  const [album, otherAlbum] = ALBUMS as [(typeof ALBUMS)[number], (typeof ALBUMS)[number]];
  const [artist, otherArtist] = ARTISTS as [Artist, Artist];
  const [song, otherSong] = SONGS as [Song, Song];
  const [playlist, otherPlaylist] = PLAYLISTS as [Playlist, Playlist];
  return (
    <View>
      <View style={{ paddingTop: CELL * 3, paddingBottom: CELL }}>
        <CatalogLine>Search</CatalogLine>
      </View>
      <ArtistCardRow
        name={artist.name}
        artist={{ name: artist.name, thumbPath: null, artworkPath: null }}
        onPress={noop}
      />
      <AlbumCardRow
        title={album.title}
        artist={album.albumArtist}
        tint={album.tint}
        onPress={noop}
      />
      <SongRow song={song} />
      <PlaylistCardRow
        name={playlist.name}
        detail={playlist.detail}
        paths={[]}
        tints={playlist.tints}
        onPress={noop}
      />
      <SongRow song={otherSong} />
      <AlbumCardRow
        title={otherAlbum.title}
        artist={otherAlbum.albumArtist}
        tint={otherAlbum.tint}
        onPress={noop}
      />
      <View style={{ paddingTop: CELL * 3, paddingBottom: CELL }}>
        <CatalogLine>Home · Recently played</CatalogLine>
      </View>
      <CoverRow>
        <AlbumCard
          title={otherAlbum.title}
          artist={otherAlbum.albumArtist}
          tint={otherAlbum.tint}
          size={COVER_ROW_TILE}
          onPress={noop}
        />
        <PlaylistCard
          name={otherPlaylist.name}
          detail={otherPlaylist.detail}
          paths={[]}
          tints={otherPlaylist.tints}
          size={COVER_ROW_TILE}
          onPress={noop}
        />
        <ArtistCard
          name={otherArtist.name}
          artist={{ name: otherArtist.name, thumbPath: null, artworkPath: null }}
          size={COVER_ROW_TILE}
          onPress={noop}
        />
        <SongCard
          title={song.title}
          artist={`Song · ${song.artist}`}
          tint={song.tint}
          onPress={noop}
        />
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

/** The Design preview's Kinds shelf: each kind's cards, then the kinds mixed. */
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
      <Text
        className="font-sans text-title2 font-light text-foreground"
        style={{ paddingTop: CELL * 5 }}
      >
        Mixed
      </Text>
      <View style={{ paddingTop: CELL }}>
        <MixedSet />
      </View>
    </ScrollView>
  );
}
