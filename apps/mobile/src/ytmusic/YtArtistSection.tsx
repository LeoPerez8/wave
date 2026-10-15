import { joinArtists, type YtArtistAlbum, type YtArtistSectionNote } from "@wave/core";

import { AlbumTile } from "@/catalog/AlbumTile";

import { openYtAlbum } from "./routes";
import { openYtAlbumActions } from "./YtAlbumActions";

/** The quiet line under an artist's page while it shows what YouTube Music has. */
export const YT_ARTIST_NOTE: Readonly<Record<YtArtistSectionNote, string>> = {
  loading: "Looking on YouTube Music…",
  allInLibrary: "Your library already has every song of this artist.",
  noSongs: "YouTube Music lists no songs for this artist.",
  notFound: "Not found on YouTube Music.",
  offline: "You're offline. Try again when you're back online.",
  failed: "YouTube Music didn't answer. Try again in a moment.",
};

/** A tile's furniture line when YouTube Music gives no year. */
const UNDATED = { albums: "Album", singles: "Single" } as const;

const ignore = (): void => undefined;

/**
 * An artist's release on YouTube Music that the Library doesn't have, as a
 * tile among their Library albums: its year, opening the YT Music album page,
 * with the album menu (Download Album) on long-press. While the page's
 * albums and songs are being selected, it does nothing.
 */
export function YtReleaseTile({
  album,
  kind,
  size,
  selecting,
}: {
  album: YtArtistAlbum;
  kind: "albums" | "singles";
  size: number;
  selecting: boolean;
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
      onPress={selecting ? ignore : () => openYtAlbum(album.browseId, head)}
      onLongPress={
        selecting ? ignore : () => openYtAlbumActions({ browseId: album.browseId, ...head })
      }
    />
  );
}
