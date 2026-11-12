import type { ComponentProps } from "react";

import { AlbumCard, AlbumCardRow } from "@/catalog/cards/AlbumCard";
import { useListDownloadProgress } from "@/ytmusic/listDownloadProgress";

type Album = { albumId: number };

/**
 * A Library album's card where the Library lists albums: while the album
 * downloads, "Downloading · N of M" takes the place of its artist, with the
 * album page head's counts (`useListDownloadProgress`).
 */
export function LibraryAlbumCard({ albumId, ...card }: ComponentProps<typeof AlbumCard> & Album) {
  return <AlbumCard {...card} line={useListDownloadProgress("album", albumId)} />;
}

/** `LibraryAlbumCard` as a row: the progress line takes the place of "Album · <artist>". */
export function LibraryAlbumCardRow({
  albumId,
  ...card
}: ComponentProps<typeof AlbumCardRow> & Album) {
  return <AlbumCardRow {...card} line={useListDownloadProgress("album", albumId)} />;
}
