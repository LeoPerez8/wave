import { joinArtists, type YtArtistAlbum, type YtArtistSectionNote } from "@wave/core";

import { AlbumTile } from "@/catalog/AlbumTile";
import { AlbumCard } from "@/catalog/cards/AlbumCard";
import { selectableRow } from "@/selection/selectableRow";
import type { ListSelection } from "@/selection/useListSelection";

import { openYtAlbum } from "./routes";
import { openYtAlbumActions } from "./YtAlbumActions";

/**
 * The quiet line under an artist's page about what YouTube Music has: an
 * outcome. While it loads, skeletons show instead.
 */
export const YT_ARTIST_NOTE: Readonly<Record<Exclude<YtArtistSectionNote, "loading">, string>> = {
  allInLibrary: "Your library already has every song of this artist.",
  noSongs: "No songs online for this artist.",
  notFound: "Not found online.",
  offline: "You're offline. Tap Online to try again when you're back online.",
  failed: "No answer online. Tap Online to try again.",
};

/** A tile's furniture line when YouTube Music gives no year. */
const UNDATED = { albums: "Album", singles: "Single" } as const;

/**
 * An artist's release on YouTube Music that the Library doesn't have, as a
 * tile among their Library albums: its year, opening the YT Music album page,
 * with the album menu on long-press. Releases and songs check together.
 */
export function YtReleaseTile({
  album,
  kind,
  size,
  selection,
}: {
  album: YtArtistAlbum;
  kind: "albums" | "singles";
  size: number;
  selection: ListSelection<YtArtistAlbum>;
}) {
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
      size={size}
      detail={album.year === null ? UNDATED[kind] : String(album.year)}
      {...selectableRow(
        album,
        selection,
        () => openYtAlbum(album.browseId, head),
        (options) => openYtAlbumActions({ browseId: album.browseId, ...head }, options),
      )}
    />
  );
}

/**
 * An artist's release on YouTube Music that the Library doesn't have, as an
 * album card on the artist page's shelves: its cover and title, the artists
 * under it, opening the YT Music album page, with the album menu (Download
 * Album) on long-press. Releases and songs check together.
 */
export function YtReleaseCard({
  album,
  size,
  selection,
}: {
  album: YtArtistAlbum;
  size: number;
  selection: ListSelection<YtArtistAlbum>;
}) {
  const line = joinArtists(album.artists);
  const head = { title: album.title, line, artworkUrl: album.artworkUrl };
  return (
    <AlbumCard
      title={album.title}
      artist={line}
      artworkUri={album.artworkUrl ?? undefined}
      size={size}
      {...selectableRow(
        album,
        selection,
        () => openYtAlbum(album.browseId, head),
        (options) => openYtAlbumActions({ browseId: album.browseId, ...head }, options),
      )}
    />
  );
}
