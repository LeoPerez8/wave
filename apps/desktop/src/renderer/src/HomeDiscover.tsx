/**
 * Home's Discover section (docs/spec.md, Editable Home; story 74): one header with the icon that
 * opens Discover's settings, then its rows in the owner's order (Core's `parseHomeArrangement`,
 * read by main), each under its label: the Magic Queue's songs, Artist mixes and Genre mixes as
 * tiles. A row with nothing to show isn't drawn and a mix row shows still tiles while its first
 * mixes build. With YT Music off or offline the section is gone, with no error.
 */
import type { DiscoverRowId, MixRowId } from "@wave/core";
import { useState } from "react";

import type { DiscoverMixesView } from "../../shared/ytPages.ts";
import { MagicQueueRow, playMix, useMagicQueuePicks, useMixes } from "./Discover.tsx";
import { DiscoverSettingsButton } from "./DiscoverSettings.tsx";
import { text } from "./text.ts";
import { useOnline } from "./useOnline.ts";
import { Shelf } from "./YtLists.tsx";
import "./discover.css";

type Run = (action: Promise<unknown>) => void;

/** Still tiles in the shape of a mix row, while its first mixes build. */
function MixRowSkeleton({ row }: { readonly row: MixRowId }) {
  return (
    <section className="shelf" aria-label={text.discover.rows[row]} aria-busy="true">
      <h3>{text.discover.rows[row]}</h3>
      <div className="shelf-row" aria-hidden="true">
        {[0, 1, 2, 3].map((place) => (
          <div key={place} className="discover-skeleton" />
        ))}
      </div>
    </section>
  );
}

/**
 * A mix row: a tile per mix, named after its seed over its lead artists; a click opens the mix's
 * page, its cover's play glyph plays it.
 */
function MixRow({
  row,
  mixes,
  run,
  onMix,
}: {
  readonly row: MixRowId;
  readonly mixes: DiscoverMixesView["mixes"];
  readonly run: Run;
  readonly onMix: (id: string) => void;
}) {
  return (
    <Shelf
      title={text.discover.rows[row]}
      nested
      items={mixes.map((mix) => {
        const title = text.discover.mixTitle(mix.name);
        const line = text.discover.songs(mix.songs.total);
        const first = mix.songs.items[0];
        return {
          key: mix.id,
          title,
          caption: mix.artists || line,
          artworkUrl: mix.artworkUrl ?? first?.artworkUrl ?? null,
          artworkHash: mix.artworkUrl === null ? (first?.artworkHash ?? null) : null,
          label: [title, mix.artists, line].filter(Boolean).join(", "),
        };
      })}
      onOpen={(index) => onMix(mixes[index]!.id)}
      onPlay={(index) => playMix(run, mixes[index]!.id, 0)}
    />
  );
}

/** Mounted only with YT Music on: Home leaves it out otherwise. */
export function HomeDiscover({
  rows,
  run,
  onMix,
}: {
  readonly rows: readonly DiscoverRowId[];
  readonly run: Run;
  /** Opens mix [id]'s page. */
  readonly onMix: (id: string) => void;
}) {
  const online = useOnline();
  const [revision, setRevision] = useState(0);
  const mixes = useMixes(revision, online);
  const picks = useMagicQueuePicks();
  if (!online) return null;
  const shown = rows.filter((row) =>
    row === "magic-queue"
      ? picks.length > 0
      : mixes === undefined || mixes.mixes.some((mix) => mix.row === row),
  );
  if (shown.length === 0) return null;
  return (
    <section className="home-discover-section" aria-label={text.home.sections.discover}>
      <header className="home-discover-header">
        <h2>{text.home.sections.discover}</h2>
        <DiscoverSettingsButton onChanged={() => setRevision((value) => value + 1)} />
      </header>
      {shown.map((row) =>
        row === "magic-queue" ? (
          <MagicQueueRow key={row} picks={picks} run={run} nested />
        ) : mixes === undefined ? (
          <MixRowSkeleton key={row} row={row} />
        ) : (
          <MixRow
            key={row}
            row={row}
            mixes={mixes.mixes.filter((mix) => mix.row === row)}
            run={run}
            onMix={onMix}
          />
        ),
      )}
    </section>
  );
}
