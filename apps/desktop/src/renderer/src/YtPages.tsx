import type { MouseEvent } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import { DiscoverPage } from "./Discover.tsx";
import { MagicQueuePage } from "./MagicQueuePage.tsx";
import { YtAlbumPage, YtArtistPage } from "./YtArtist.tsx";

/** YouTube Music's pages: Discover, the Magic Queue, and an artist's or album's page. */
export type YtRoute =
  | { readonly kind: "discover" }
  | { readonly kind: "magicQueue" }
  | { readonly kind: "ytArtist"; readonly id: string }
  | { readonly kind: "ytAlbum"; readonly id: string };

const KINDS: ReadonlySet<string> = new Set<YtRoute["kind"]>([
  "discover",
  "magicQueue",
  "ytArtist",
  "ytAlbum",
]);

export const isYtRoute = (route: { readonly kind: string }): route is YtRoute =>
  KINDS.has(route.kind);

type Run = (action: Promise<unknown>) => void;

export function YtPage({
  route,
  run,
  revision,
  go,
  onSongMenu,
}: {
  readonly route: YtRoute;
  readonly run: Run;
  /** The player's revision, so the Magic Queue page follows the queue. */
  readonly revision: number;
  readonly go: (route: YtRoute) => void;
  readonly onSongMenu: (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;
}) {
  switch (route.kind) {
    case "discover":
      return <DiscoverPage run={run} onSongMenu={onSongMenu} />;
    case "magicQueue":
      return <MagicQueuePage run={run} revision={revision} onSongMenu={onSongMenu} />;
    case "ytArtist":
      return (
        <YtArtistPage
          key={route.id}
          id={route.id}
          run={run}
          onSongMenu={onSongMenu}
          onAlbum={(id) => go({ kind: "ytAlbum", id })}
          onArtist={(id) => go({ kind: "ytArtist", id })}
        />
      );
    case "ytAlbum":
      return <YtAlbumPage key={route.id} id={route.id} run={run} onSongMenu={onSongMenu} />;
  }
}
