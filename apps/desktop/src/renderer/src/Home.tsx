import { homeSectionTitle, statsFacts, tableSelectionOf } from "@wave/core";
import { useEffect, useMemo, useState } from "react";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import type { HomeSectionView, HomeView } from "../../shared/home.ts";
import type { CollectionTarget } from "../../shared/collectionActions.ts";
import type { MenuPoint } from "./Menu.tsx";
import { HomeDiscover } from "./HomeDiscover.tsx";
import { HomeEditButton } from "./HomeEditor.tsx";
import { HomeNewReleases, HomeUpcomingShows, useHomeFollow } from "./HomeFollow.tsx";
import { Shelf } from "./YtLists.tsx";
import type { YtRoute } from "./YtPages.tsx";
import { VirtualTable } from "./VirtualTable.tsx";
import { openTableSongMenu, SelectionBar, type SongSelectionControls } from "./SongActions.tsx";
import { text, labels, tagTitle, artistName, language } from "./text.ts";
import "./home.css";

const SONGS: BrowseScope = { kind: "songs" };

function MostPlayed({
  section,
  onPlay,
  onError,
  controls,
  revision,
}: {
  readonly section: HomeSectionView;
  readonly onPlay: (index: number) => void;
  readonly onError: () => void;
  readonly controls: SongSelectionControls;
  readonly revision: number;
}) {
  // The current language's text, so the labels follow a change of language.
  const strings = text;
  const preview = useMemo(
    () => ({
      id: "home-most-played",
      label: strings.home.sections["most-played"],
      page: section.rows,
      trailing: (row: BrowseRow) =>
        strings.stats.plays(section.rows.items.find((r) => r.id === row.id)?.playCount ?? 0),
      trailingHeading: strings.stats.facts.plays,
    }),
    [section, strings],
  );
  const selectAll = () =>
    tableSelectionOf(
      section.rows.items.map((row) => row.id),
      controls.selection?.checkboxes,
    );
  return (
    <>
      {controls.selection && (
        <SelectionBar
          scope={SONGS}
          selection={controls.selection}
          revision={revision}
          actions={controls.actions}
          onChange={(selection) => controls.onSelection?.(selection)}
          onDone={() => controls.onSelection?.(undefined)}
          selectAll={selectAll}
        />
      )}
      <div className="home-table" style={{ height: section.rows.total * 40 + 30 }}>
        <VirtualTable
          scope={SONGS}
          revision={0}
          preview={preview}
          onOpen={(_, index) => onPlay(index)}
          onError={onError}
          onMenu={(row, at) => openTableSongMenu(controls, SONGS, row, at)}
          selection={controls.selection}
          onSelection={controls.onSelection}
          selectAll={selectAll}
        />
      </div>
    </>
  );
}

/** Mounted only while Home is visible. Scan, stars and account pulls renew its bounded read. */
export function Home({
  revision,
  ytMusic,
  run,
  go,
  onStats,
  onError,
  onMenu,
  selectionFor,
  notify,
  onCollectionMenu,
}: {
  readonly revision: number;
  readonly ytMusic: boolean;
  readonly notify: (message: string) => void;
  readonly run: (action: Promise<unknown>) => void;
  readonly go: (scope: BrowseScope | YtRoute) => void;
  readonly onStats: () => void;
  readonly onError: () => void;
  readonly onMenu: (row: BrowseRow, at: { readonly x: number; readonly y: number }) => void;
  readonly selectionFor: (owner: string) => SongSelectionControls;
  readonly onCollectionMenu: (target: CollectionTarget, title: string, at: MenuPoint) => void;
}) {
  const [view, setView] = useState<HomeView>();
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const follow = useHomeFollow(revision);
  useEffect(() => {
    let current = true;
    void window.wave.home
      .view()
      .then((view) => {
        if (current) {
          setView(view);
          setReadFailed(false);
        }
      })
      .catch(() => {
        if (current) setReadFailed(true);
      });
    return () => {
      current = false;
    };
  }, [revision, attempt]);
  const open = (section: HomeSectionView, index: number) => {
    const row = section.rows.items[index]!;
    if (section.kind === "album" || section.kind === "artist")
      go({ kind: section.kind, id: row.id });
    else if (section.id === "favorites" || section.id === "most-played")
      run(window.wave.home.play(section.id, index));
  };
  return (
    <div className="home-page" data-testid="home">
      <HomeEditButton
        revision={revision}
        onChanged={() => setAttempt((value) => value + 1)}
        onError={onError}
      />
      {readFailed && (
        <div className="home-retry" role="alert">
          <p>{text.desktopLibrary.actionFailed}</p>
          <button
            onClick={() => {
              setReadFailed(false);
              setAttempt((value) => value + 1);
            }}
          >
            {text.playbackText.tryAgain}
          </button>
        </div>
      )}
      {view === undefined ? (
        !readFailed && (
          <p className="secondary" role="status">
            {labels.loading}
          </p>
        )
      ) : (
        <>
          {view.hint === "empty" && (
            <div className="home-empty">
              <h2>{text.home.emptyTitle}</h2>
              <p className="secondary">{text.home.emptyMessage}</p>
            </div>
          )}
          {view.hint === "play" && <p className="home-hint secondary">{text.home.playHint}</p>}
          {view.hint === "none" && <p className="home-hint secondary">{text.home.noSections}</p>}
          {view.items.map((section) =>
            section.id === "discover" ? (
              ytMusic && <HomeDiscover key={section.id} rows={view.discoverRows} run={run} />
            ) : section.id === "new-releases" ? (
              <HomeNewReleases key={section.id} cards={follow.releases} go={go} notify={notify} />
            ) : section.id === "upcoming-shows" ? (
              <HomeUpcomingShows key={section.id} cards={follow.shows} />
            ) : section.id === "stats" ? (
              view.stats && <HomeStats key={section.id} stats={view.stats} onOpen={onStats} />
            ) : (
              <div key={section.id} data-section={section.id}>
                {section.id === "most-played" ? (
                  <section aria-label={homeSectionTitle(section.id, text)}>
                    <h2>{homeSectionTitle(section.id, text)}</h2>
                    <MostPlayed
                      section={section}
                      onPlay={(index) => open(section, index)}
                      onError={onError}
                      controls={selectionFor("home-most-played")}
                      revision={revision}
                    />
                  </section>
                ) : (
                  <Shelf
                    title={homeSectionTitle(section.id, text)}
                    artists={section.kind === "artist"}
                    items={section.rows.items.map((row) => ({
                      key: String(row.id),
                      title: tagTitle(row.title, section.kind),
                      artworkHash: row.artworkHash,
                      artworkKind:
                        section.kind === "artist"
                          ? "artist"
                          : section.kind === "album"
                            ? "album"
                            : section.kind === "song"
                              ? "song"
                              : undefined,
                      artworkId: row.id,
                      caption:
                        row.playCount === undefined
                          ? artistName(row.artist)
                          : text.stats.plays(row.playCount),
                      label: [tagTitle(row.title, section.kind), artistName(row.artist)]
                        .filter(Boolean)
                        .join(", "),
                      ...(section.kind === "song" ? { song: row } : {}),
                    }))}
                    onOpen={(index) => open(section, index)}
                    onMenu={(index, at) => {
                      const row = section.rows.items[index]!;
                      if (section.kind === "song") onMenu(row, at);
                      else if (section.kind === "album" || section.kind === "artist")
                        onCollectionMenu({ kind: section.kind, id: row.id }, row.title, at);
                    }}
                  />
                )}
              </div>
            ),
          )}
        </>
      )}
    </div>
  );
}

function HomeStats({
  stats,
  onOpen,
}: {
  readonly stats: NonNullable<HomeView["stats"]>;
  readonly onOpen: () => void;
}) {
  return (
    <section className="home-stats" data-section="stats" aria-labelledby="home-stats-title">
      <div className="stats-section-heading">
        <h2 id="home-stats-title">{text.home.sections.stats}</h2>
        <button onClick={onOpen}>{text.home.seeAll}</button>
      </div>
      <dl>
        {statsFacts(stats.library, stats.listening, language).map(({ label, value }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="secondary">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
