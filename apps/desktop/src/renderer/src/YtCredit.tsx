import { Fragment, type MouseEvent } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import { text } from "./text.ts";

/** Where a streamed song's artist and album names lead: their YouTube Music pages. */
export interface YtCreditLinks {
  /** Opens the YouTube Music artist named [name]. */
  readonly onArtist: (name: string) => void;
  /** Opens the YouTube Music album [browseId]. */
  readonly onAlbum: (browseId: string) => void;
}

/** A click on a name opens its page and nothing else: not the row or button it sits on. */
const only = (open: () => void) => (event: MouseEvent) => {
  event.stopPropagation();
  open();
};

/**
 * A song's artists: for a YouTube Music song with [links], each name opens that artist's page,
 * joined as Core's `joinArtists` joins them; otherwise the credit as text.
 */
export function ArtistCredit({
  row,
  links,
  className,
}: {
  readonly row: BrowseRow;
  readonly links: YtCreditLinks | undefined;
  readonly className: string;
}) {
  const names = row.artists !== undefined && row.artists.length > 0 ? row.artists : [row.artist];
  if (row.videoId === undefined || links === undefined || row.artist === "")
    return <span className={className}>{row.artist}</span>;
  return (
    <span className={className}>
      {names.map((name, index) => (
        <Fragment key={`${index}-${name}`}>
          {index > 0 && (index === names.length - 1 ? " & " : ", ")}
          <button
            className="credit-link"
            title={text.itemActions.labels.goToArtist}
            aria-label={`${text.itemActions.labels.goToArtist}, ${name}`}
            onClick={only(() => links.onArtist(name))}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {name}
          </button>
        </Fragment>
      ))}
    </span>
  );
}

/** A song's album: for a YouTube Music song with [links] and an album page, it opens that page. */
export function AlbumCredit({
  row,
  links,
  className,
}: {
  readonly row: BrowseRow;
  readonly links: YtCreditLinks | undefined;
  readonly className: string;
}) {
  const albumId = row.albumId;
  if (row.videoId === undefined || links === undefined || !albumId || row.album === "")
    return <span className={className}>{row.album}</span>;
  return (
    <span className={className}>
      <button
        className="credit-link"
        title={text.itemActions.labels.goToAlbum}
        aria-label={`${text.itemActions.labels.goToAlbum}, ${row.album}`}
        onClick={only(() => links.onAlbum(albumId))}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {row.album}
      </button>
    </span>
  );
}
