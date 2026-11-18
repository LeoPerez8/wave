import { useEffect, useState, type MouseEvent } from "react";
import type { BrowseRow } from "../../shared/browse.ts";
import type { DiscoverMixesView } from "../../shared/ytPages.ts";
import { albumName, artistName, text } from "./text.ts";
import { Shelf, YtQuiet, YtSongList } from "./YtLists.tsx";

/**
 * Discover (docs/spec.md, Discover; story 29a): the Magic Queue row's songs, each starting a
 * Magic Queue, and today's Artist mixes. Offline, the mixes become the quiet line.
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
export function MagicQueueRow({ run }: { readonly run: Run }) {
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
  return (
    <Shelf
      title={text.discover.rows["magic-queue"]}
      items={picks.map((row) => ({
        key: String(row.id),
        title: row.title,
        caption: artistName(row.artist),
        artworkHash: row.artworkHash,
        label: text.discover.startMagicQueue(
          row.title,
          artistName(row.artist),
          albumName(row.album) || null,
        ),
      }))}
      onOpen={(index) => startFrom(run, picks[index]!.id)}
    />
  );
}

/** Today's Artist mixes, read once the page opens; undefined while they're built. */
const useMixes = () => {
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
  }, []);
  return mixes;
};

const playMix = (run: Run, id: string, index: number) =>
  run(
    window.wave.discover.playMix(id, index).then((played) => {
      // A mix rebuilt for a new day under the window's feet.
      if (!played) throw new Error(text.discover.goneTitle);
    }),
  );

/** Discover's page: the Magic Queue row, then each Artist mix as a list of its songs. */
export function DiscoverPage({
  run,
  onSongMenu,
}: {
  readonly run: Run;
  readonly onSongMenu: (row: BrowseRow, event: MouseEvent<HTMLElement>) => void;
}) {
  const mixes = useMixes();
  return (
    <div className="yt-page" data-testid="discover">
      <MagicQueueRow run={run} />
      <h2>{text.discover.rows["artist-mixes"]}</h2>
      {mixes === undefined ? (
        <p className="yt-quiet secondary" role="status">
          {text.discover.buildingMixes}
        </p>
      ) : (
        <>
          <YtQuiet status={mixes.status} />
          {mixes.mixes.map((mix) => (
            <section key={mix.id} className="yt-mix" aria-label={text.discover.mixTitle(mix.name)}>
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
        </>
      )}
    </div>
  );
}

/** Home's Discover section: the Magic Queue row and a tile per mix, which plays it. */
export function DiscoverSection({ run }: { readonly run: Run }) {
  const mixes = useMixes();
  return (
    <section className="home-discover" aria-label={text.desktopLayout.discover}>
      <MagicQueueRow run={run} />
      {mixes !== undefined && <YtQuiet status={mixes.status} />}
      {mixes !== undefined && (
        <Shelf
          title={text.discover.rows["artist-mixes"]}
          items={mixes.mixes.map((mix) => ({
            key: mix.id,
            title: text.discover.mixTitle(mix.name),
            caption: text.discover.songs(mix.songs.total),
            artworkUrl: mix.songs.items[0]?.artworkUrl ?? null,
          }))}
          onOpen={(index) => playMix(run, mixes.mixes[index]!.id, 0)}
        />
      )}
    </section>
  );
}
