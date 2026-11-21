import {
  homeSectionTitle,
  recapTitle,
  statsFacts,
  tableSelectionOf,
  type RecapPeriod,
  type TableSelection,
} from "@wave/core";
import { useEffect, useMemo, useState } from "react";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import type { HomeRow, HomeSectionView, HomeView } from "../../shared/home.ts";
import type { StatsRoute } from "../../shared/stats.ts";
import type { CollectionTarget } from "../../shared/collectionActions.ts";
import type { MenuPoint } from "./Menu.tsx";
import { HomeDiscover } from "./HomeDiscover.tsx";
import { HomeEditButton } from "./HomeEditor.tsx";
import type { HomeSeeAllRoute } from "./HomeSeeAll.tsx";
import { HomeNewReleases, HomeUpcomingShows, useHomeFollow } from "./HomeFollow.tsx";
import { recapColour } from "./RecapViewer.tsx";
import { Shelf } from "./YtLists.tsx";
import type { YtRoute } from "./YtPages.tsx";
import { VirtualTable } from "./VirtualTable.tsx";
import { openTableSongMenu, SelectionBar, type SongSelectionControls } from "./SongActions.tsx";
import { text, labels, tagTitle, artistName, language } from "./text.ts";
import { useKeptScroll } from "./useKeptScroll.ts";
import "./home.css";

const SONGS: BrowseScope = { kind: "songs" };

/** A streamed song has no Library id: its row takes a negative one of its own, out of selections. */
const rowsOf = (section: HomeSectionView) =>
  section.rows.items.map((row, index) =>
    row.videoId === undefined ? row : { ...row, id: -(index + 1) },
  );
/** Most played lists at most this many songs: their negative ids, unchecked under Select All. */
const STREAMED_IDS = Array.from({ length: 10 }, (_, index) => -(index + 1));
/** Song actions take Library songs: a streamed row never stays checked. */
const librarySongs = (selection: TableSelection): TableSelection => {
  const ids = [...selection.ids].filter((id) => id > 0);
  return { ...selection, ids: new Set(selection.all ? [...ids, ...STREAMED_IDS] : ids) };
};

function MostPlayed({
  section,
  onPlay,
  onError,
  controls,
  onStreamedMenu,
  revision,
}: {
  readonly section: HomeSectionView;
  readonly onPlay: (index: number) => void;
  readonly onError: () => void;
  readonly controls: SongSelectionControls;
  readonly onStreamedMenu: (row: BrowseRow, at: MenuPoint) => void;
  readonly revision: number;
}) {
  // The current language's text, so the labels follow a change of language.
  const strings = text;
  const preview = useMemo(
    () => ({
      id: "home-most-played",
      label: strings.home.sections["most-played"],
      page: { ...section.rows, items: rowsOf(section) },
      trailing: (row: BrowseRow) => strings.stats.plays((row as HomeRow).playCount ?? 0),
      trailingHeading: strings.stats.facts.plays,
    }),
    [section, strings],
  );
  const selectAll = () =>
    tableSelectionOf(
      section.rows.items.flatMap((row) => (row.videoId === undefined ? [row.id] : [])),
      controls.selection?.checkboxes,
    );
  const select = (selection: TableSelection | undefined) =>
    controls.onSelection?.(selection && librarySongs(selection));
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
          onOpen={(row, index) => {
            if (row.videoId === undefined || !row.unavailable) onPlay(index);
          }}
          onError={onError}
          onMenu={(row, at) => {
            if (row.videoId === undefined) openTableSongMenu(controls, SONGS, row, at);
            else if (!row.unavailable) onStreamedMenu(row, at);
          }}
          selection={controls.selection}
          onSelection={select}
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
  onRecap,
  recapsOpened,
  onError,
  onMenu,
  selectionFor,
  notify,
  onCollectionMenu,
  onStreamedMenu,
  entry,
}: {
  readonly revision: number;
  /** The history entry showing Home: Back to it returns to where Home was scrolled. */
  readonly entry: object;
  /** Opens a Recap's stories. */
  readonly onRecap: (period: RecapPeriod) => void;
  /** Changes when a Recap was opened: its card leaves Home. */
  readonly recapsOpened: number;
  readonly ytMusic: boolean;
  readonly notify: (message: string) => void;
  readonly run: (action: Promise<unknown>) => void;
  readonly go: (scope: BrowseScope | YtRoute | StatsRoute | HomeSeeAllRoute) => void;
  readonly onStats: () => void;
  readonly onError: () => void;
  readonly onMenu: (row: BrowseRow, at: { readonly x: number; readonly y: number }) => void;
  readonly selectionFor: (owner: string) => SongSelectionControls;
  readonly onCollectionMenu: (target: CollectionTarget, title: string, at: MenuPoint) => void;
  /** A streamed Most played song's menu. */
  readonly onStreamedMenu: (row: BrowseRow, at: MenuPoint) => void;
}) {
  const [view, setView] = useState<HomeView>();
  const page = useKeptScroll<HTMLDivElement>(entry, view !== undefined);
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
  }, [revision, attempt, recapsOpened]);
  const open = (section: HomeSectionView, index: number) => {
    const row = section.rows.items[index]!;
    if (section.kind === "album" || section.kind === "artist")
      go({ kind: section.kind, id: row.id });
    else if (section.id === "favorites" || section.id === "most-played")
      run(window.wave.home.play(section.id, index));
  };
  /** Each shelf's See all: the phone's page for it, or the desktop's own table. */
  const seeAll = (id: HomeSectionView["id"]) => {
    if (id === "most-played-albums" || id === "most-played-artists")
      go({
        kind: "stats",
        period: "all",
        ranking: id === "most-played-albums" ? "albums" : "artists",
      });
    else if (id === "favorites") go({ kind: "favorites" });
    else if (id === "recently-added" || id === "recently-played")
      go({ kind: "homeSeeAll", section: id });
  };
  return (
    <div ref={page} className="home-page" data-testid="home">
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
          {view.recap && (
            <button
              className="recap-home-card"
              style={{ backgroundColor: `var(--color-recap-${recapColour(view.recap)})` }}
              onClick={() => onRecap(view.recap!)}
            >
              <span>{text.recap.ready[view.recap.kind]}</span>
              <strong>{recapTitle(view.recap, text)}</strong>
              <span>{text.recap.tapToWatch}</span>
            </button>
          )}
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
              ytMusic && (
                <HomeDiscover
                  key={section.id}
                  rows={view.discoverRows}
                  run={run}
                  onMix={(id) => go({ kind: "discoverMix", id })}
                />
              )
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
                      onStreamedMenu={onStreamedMenu}
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
                    onSeeAll={() => seeAll(section.id)}
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
