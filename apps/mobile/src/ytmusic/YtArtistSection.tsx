import {
  joinArtists,
  ytTrackId,
  type QueueContext,
  type YtArtistRelease,
  type YtArtistSectionNote,
  type YtArtistShelf,
} from "@wave/core";
import { ScrollView, Text, View } from "react-native";

import { AlbumTile } from "@/catalog/AlbumTile";
import { CatalogLine } from "@/catalog/CatalogLine";
import { CELL, grid } from "@/catalog/grid";
import { TextButton } from "@/components/TextButton";
import type { AlbumRow } from "@/library/LibraryStore";
import { openAlbum } from "@/library/routes";
import { useListScrollable } from "@/motion/heldTouch";
import { openAlbumActions } from "@/playback/ActionsMenu";
import { playYtSongs } from "@/playback/actions";
import { useCurrentTrackId } from "@/playback/hooks";

import { useYtArtistSection } from "./artistSection";
import { openYtAlbum } from "./routes";
import { openYtAlbumActions } from "./YtAlbumActions";
import { YtSongRow } from "./YtSongRow";

const NOTE: Readonly<Record<YtArtistSectionNote, string>> = {
  loading: "Looking on YouTube Music…",
  allInLibrary: "Your library already has this artist's top songs.",
  noSongs: "YouTube Music lists no top songs for this artist.",
  notFound: "Not found on YouTube Music.",
  offline: "You're offline. Try again when you're back online.",
  failed: "YouTube Music didn't answer. Try again in a moment.",
};

/** The section's head, as the artist page heads its other sections. */
const SECTION_HEAD = CELL * 6;

const ignore = (): void => undefined;

type ShelfKind = YtArtistShelf<AlbumRow>["kind"];

const SHELF_TITLE: Readonly<Record<ShelfKind, string>> = {
  albums: "Albums",
  singles: "Singles & EPs",
};

/** A tile's furniture line when YouTube Music gives no year. */
const UNDATED: Readonly<Record<ShelfKind, string>> = { albums: "Album", singles: "Single" };

/** Covers leave the next one peeking in at the right edge, like Discover's shelves. */
const SHELF_TILE = CELL * 19;

/**
 * A release as its tile shows it: In your Library when the Library has it
 * (tap opens the Library album, long-press its menu), else the year, opening
 * the YT Music album page with the album menu (Download Album) on long-press.
 */
function ReleaseTile({
  release,
  kind,
  selecting,
}: {
  release: YtArtistRelease<AlbumRow>;
  kind: ShelfKind;
  selecting: boolean;
}) {
  const { album, library } = release;
  const line = joinArtists(album.artists);
  const head = { title: album.title, line, artworkUrl: album.artworkUrl };
  return (
    <AlbumTile
      album={{
        id: album.browseId,
        title: album.title,
        albumArtist: line,
        trackCount: 0,
        durationMs: 0,
        artworkUri: album.artworkUrl ?? undefined,
      }}
      size={SHELF_TILE}
      detail={
        library !== null
          ? "In your Library"
          : album.year === null
            ? UNDATED[kind]
            : String(album.year)
      }
      onPress={
        selecting
          ? ignore
          : library !== null
            ? () => openAlbum(library.id, library)
            : () => openYtAlbum(album.browseId, head)
      }
      onLongPress={
        selecting
          ? ignore
          : library !== null
            ? () => openAlbumActions(library)
            : () => openYtAlbumActions({ browseId: album.browseId, ...head })
      }
    />
  );
}

/** A shelf of the artist's releases under its section head: covers that scroll sideways, edge to edge. */
function ReleaseShelf({
  shelf,
  selecting,
}: {
  shelf: YtArtistShelf<AlbumRow>;
  selecting: boolean;
}) {
  const scrollable = useListScrollable();
  return (
    <View>
      <View className="justify-end" style={{ height: SECTION_HEAD, paddingBottom: CELL }}>
        <CatalogLine>{SHELF_TITLE[shelf.kind]}</CatalogLine>
      </View>
      <ScrollView
        scrollEnabled={scrollable}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -grid.margin }}
        contentContainerStyle={{ paddingHorizontal: grid.margin, gap: grid.gutter }}
      >
        {shelf.releases.map((release) => (
          <ReleaseTile
            key={release.album.browseId}
            release={release}
            kind={shelf.kind}
            selecting={selecting}
          />
        ))}
      </ScrollView>
    </View>
  );
}

/**
 * The end of an artist page while YT Music is on (docs/spec.md, "YT Music"):
 * Show on YouTube Music, then the artist's top songs the Library doesn't have
 * (streamed on tap, with the YT Music song menu) or a quiet line, then their
 * Albums and Singles & EPs shelves. Nothing is asked until the button is
 * tapped; a saved answer shows for a week without it.
 */
export function YtArtistSection({
  name,
  artistId,
  albums,
  context,
  selecting,
}: {
  /** The Library artist's name. */
  name: string;
  artistId: number;
  /** The page's Library albums (filed under the artist and Appears on), to mark releases it has. */
  albums: readonly AlbumRow[];
  context: QueueContext;
  /** While the page's albums and songs are being selected, the section's songs and tiles do nothing. */
  selecting: boolean;
}) {
  const { view, shelves, show } = useYtArtistSection(name, artistId, albums);
  const currentId = useCurrentTrackId();
  if (view === null) return null;
  const { songs, note, button } = view;
  return (
    <View>
      {(songs.length > 0 || note !== null || shelves.length > 0) && (
        <View className="justify-end" style={{ height: SECTION_HEAD, paddingBottom: CELL }}>
          <CatalogLine>YT Music</CatalogLine>
        </View>
      )}
      {songs.map((song, index) => (
        <YtSongRow
          key={song.videoId}
          song={song}
          playing={ytTrackId(song.videoId) === currentId}
          onPress={selecting ? ignore : () => void playYtSongs(songs, index, context)}
          onLongPress={selecting ? ignore : undefined}
        />
      ))}
      {note !== null && (
        <View className="justify-center" style={{ minHeight: CELL * 6 }}>
          <Text className="font-sans text-footnote text-secondary">{NOTE[note]}</Text>
        </View>
      )}
      {shelves.map((shelf) => (
        <ReleaseShelf key={shelf.kind} shelf={shelf} selecting={selecting} />
      ))}
      {button && (
        <View style={{ paddingTop: note === null ? CELL * 2 : 0 }}>
          <TextButton label="Show on YouTube Music" onPress={show} />
        </View>
      )}
    </View>
  );
}
