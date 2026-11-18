import { useEffect, useState, type MouseEvent } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import type { MixRowId } from "@wave/core";
import type { DiscoverMixesView } from "../../shared/ytPages.ts";
import { text } from "./text.ts";
import { Shelf, YtQuiet, YtSongList } from "./YtLists.tsx";

/**
 * Discover (docs/spec.md, Discover; story 29a): the Magic Queue row's songs, each starting a
 * Magic Queue, and today's Artist and Genre mixes. Offline, the mixes become the quiet line.
 * Home's Discover section is `HomeDiscover`.
 */

type Run = (action: Promise<unknown>) => void;

/** Starts a Magic Queue from a Library song; a song that can't start one says it failed. */
const startFrom = (run: Run, id: number) =>
  run(
    window.wave.magicQueue.start({ scope: { kind: "songs" }, ids: [id] }).then((started) => {
      if (!started) throw new Error(text.playbackText.couldntStartTheMagicQueue);
    }),
  );

/** Nine Library songs at random, drawn again each time the row shows. */
export const useMagicQueuePicks = () => {
  const [picks, setPicks] = useState<readonly BrowseRow[]>([]);
  useEffect(() => {
    let current = true;
    void window.wave.discover
      .picks()
      .then((page) => {
        if (current) setPicks(page.items);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
  return picks;
};

export function MagicQueueRow({
  picks,
  run,
  nested,
}: {
  readonly picks: readonly BrowseRow[];
  readonly run: Run;
  readonly nested?: boolean;
}) {
  return (
    <Shelf
      title={text.discover.rows["magic-queue"]}
      nested={nested}
      items={picks.map((row) => ({
        key: String(row.id),
        title: row.title,
        caption: row.artist,
        artworkHash: row.artworkHash,
        label: text.discover.startMagicQueue(row.title, row.artist, row.album || null),
      }))}
      onOpen={(index) => startFrom(run, picks[index]!.id)}
    />
  );
}

/**
 * Today's mixes, read again when [revision] changes or the window comes back [online]; undefined
 * while they're first built.
 */
export const useMixes = (revision = 0, online = true) => {
  const [mixes, setMixes] = useState<DiscoverMixesView>();
  useEffect(() => {
    let current = true;
    void window.wave.discover
      .mixes()
      .catch((): DiscoverMixesView => ({ status: "failed", mixes: [] }))
      .then((view) => {
        if (current) setMixes(view);
      });
    return () => {
      current = false;
    };
  }, [revision, online]);
  return mixes;
};

export const playMix = (run: Run, id: string, index: number) =>
  run(
    window.wave.discover.playMix(id, index).then((played) => {
      // A mix rebuilt for a new day under the window's feet.
      if (!played) throw new Error(text.discover.goneTitle);
    }),
  );

const MIX_ROWS: readonly MixRowId[] = ["artist-mixes", "genre-mixes"];

/** Discover's page: the Magic Queue row, then each Artist and Genre mix as a list of its songs. */
export function DiscoverPage({
  run,
  onSongMenu,
}: {
  readonly run: Run;
  readonly onSongMenu: (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;
}) {
  const mixes = useMixes();
  const picks = useMagicQueuePicks();
  return (
    <div className="yt-page" data-testid="discover">
      <MagicQueueRow picks={picks} run={run} />
      {mixes === undefined ? (
        <p className="yt-quiet secondary" role="status">
          {text.discover.buildingMixes}
        </p>
      ) : (
        <>
          <YtQuiet status={mixes.status} />
          {MIX_ROWS.map((row) => {
            const shown = mixes.mixes.filter((mix) => mix.row === row);
            return (
              shown.length > 0 && (
                <section key={row} aria-label={text.discover.rows[row]}>
                  <h2>{text.discover.rows[row]}</h2>
                  {shown.map((mix) => (
                    <section
                      key={mix.id}
                      className="yt-mix"
                      aria-label={text.discover.mixTitle(mix.name)}
                    >
                      <h3>
                        {text.discover.mixTitle(mix.name)}
                        <span className="secondary"> · {text.discover.songs(mix.songs.total)}</span>
                      </h3>
                      <YtSongList
                        songs={mix.songs.items}
                        label={text.discover.mixTitle(mix.name)}
                        onPlay={(index) => playMix(run, mix.id, index)}
                        onMenu={onSongMenu}
                      />
                    </section>
                  ))}
                </section>
              )
            );
          })}
        </>
      )}
    </div>
  );
}
