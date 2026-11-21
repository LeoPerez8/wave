import { useEffect, useState, type MouseEvent } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import type { MixRowId } from "@wave/core";
import type { DiscoverMixesView } from "../../shared/ytPages.ts";
import { albumName, artistName, text } from "./text.ts";
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

/** Starts a Magic Queue from a playlist's YT Music entry, streamed. */
const startFromStreamed = (run: Run, videoId: string) =>
  run(window.wave.magicQueue.startStreamed(videoId));

/** Nine songs at random, Library songs and the playlists' YT Music entries, drawn each time the row shows. */
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
        key: row.videoId ?? String(row.id),
        title: row.title,
        caption: artistName(row.artist),
        artworkHash: row.artworkHash,
        artworkUrl: row.artworkUrl,
        label: text.discover.startMagicQueue(
          row.title,
          artistName(row.artist),
          albumName(row.album) || null,
        ),
      }))}
      onOpen={(index) => {
        const row = picks[index]!;
        return row.videoId === undefined
          ? startFrom(run, row.id)
          : startFromStreamed(run, row.videoId);
      }}
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

/** Plays mix [id] from its song [index], or its songs shuffled with [shuffle]. */
export const playMix = (run: Run, id: string, index: number, shuffle?: boolean) =>
  run(
    window.wave.discover.playMix(id, index, shuffle).then((played) => {
      // A mix rebuilt for a new day under the window's feet.
      if (!played) throw new Error(text.discover.goneTitle);
    }),
  );

const MIX_ROWS: readonly MixRowId[] = ["artist-mixes", "genre-mixes"];

/**
 * Discover's page: the Magic Queue row, then each Artist and Genre mix as a list of its songs,
 * under a heading that opens the mix's page.
 */
export function DiscoverPage({
  run,
  onSongMenu,
  onMix,
}: {
  readonly run: Run;
  readonly onSongMenu: (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;
  /** Opens mix [id]'s page. */
  readonly onMix: (id: string) => void;
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
                        <button className="yt-mix-title" onClick={() => onMix(mix.id)}>
                          {text.discover.mixTitle(mix.name)}
                        </button>
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
