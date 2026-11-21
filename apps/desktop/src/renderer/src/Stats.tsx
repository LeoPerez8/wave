import {
  recapId,
  recapTitle,
  STATS_RANKINGS,
  statsGenrePodium,
  statsPeriods,
  type RecapGenre,
  type RecapPeriod,
  type StatsPeriod,
  type StatsRanking,
} from "@wave/core";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Page } from "../../shared/bridge.ts";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import type { StatsOverview, StatsRoute, StatsRow } from "../../shared/stats.ts";
import { recapColour } from "./RecapViewer.tsx";
import { text } from "./text.ts";
import { VirtualTable } from "./VirtualTable.tsx";
import type { YtRoute } from "./YtPages.tsx";
import "./stats.css";

type SongMenu = (row: BrowseRow, at: { readonly x: number; readonly y: number }) => void;

function PeriodTabs({
  period,
  onChange,
}: {
  readonly period: StatsPeriod;
  readonly onChange: (period: StatsPeriod) => void;
}) {
  const options = statsPeriods(text);
  return (
    <div className="stats-tabs" role="tablist" aria-label={text.home.sections.stats}>
      {options.map(({ id, label }, index) => (
        <button
          key={id}
          id={`stats-period-${id}`}
          role="tab"
          aria-selected={id === period}
          aria-controls="stats-period-panel"
          tabIndex={id === period ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={(event) => {
            const next = {
              ArrowLeft: (index + options.length - 1) % options.length,
              ArrowRight: (index + 1) % options.length,
              Home: 0,
              End: options.length - 1,
            }[event.key];
            if (next === undefined || event.altKey || event.ctrlKey || event.metaKey) return;
            event.preventDefault();
            event.currentTarget.parentElement?.querySelectorAll("button")[next]?.focus();
            onChange(options[next]!.id);
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function GenrePodium({ genres }: { readonly genres: readonly RecapGenre[] }) {
  const chart = useRef<HTMLDivElement>(null);
  const [theme, setTheme] = useState<{ accent: string; background: string }>();
  useLayoutEffect(() => {
    const element = chart.current!;
    const shell = element.closest(".desktop-shell");
    const read = () => {
      const style = getComputedStyle(element);
      setTheme({
        accent: style.getPropertyValue("--color-accent"),
        background: style.getPropertyValue("--color-background"),
      });
    };
    read();
    if (shell === null) return;
    const observer = new MutationObserver(read);
    observer.observe(shell, { attributeFilter: ["style"] });
    return () => observer.disconnect();
  }, []);

  const width = 358;
  const bars = theme === undefined ? [] : statsGenrePodium(genres, width, 38, theme);
  const percent = (value: number) => `${(value / width) * 100}%`;
  const summary = genres
    .map(({ family, share }, index) =>
      text.stats.genreBarLabel(index + 1, family.name, text.stats.genrePercent(share)),
    )
    .join("; ");
  return (
    <section>
      <h2>{text.stats.genres}</h2>
      <div ref={chart} className="stats-podium" role="img" aria-label={summary}>
        <div
          className="stats-bars"
          style={{ height: Math.max(0, ...bars.map((bar) => bar.height)) }}
        >
          {bars.map((bar) => (
            <div
              key={bar.family.key}
              className="stats-bar"
              style={{
                left: percent(bar.left),
                width: percent(bar.width),
                height: bar.height,
                zIndex: bar.layer,
                backgroundColor: bar.fill,
                color: bar.ink,
              }}
            >
              <span
                style={{
                  left: `${((bar.visibleLeft - bar.left) / bar.width) * 100}%`,
                  width: `${(bar.visibleWidth / bar.width) * 100}%`,
                }}
              >
                {bar.rank}
              </span>
            </div>
          ))}
        </div>
        <div className="stats-genre-labels">
          {bars.map((bar) => (
            <div key={bar.family.key} style={{ width: percent(bar.visibleWidth) }}>
              <strong>{bar.family.name}</strong>
              <span className="secondary">{text.stats.genrePercent(bar.share)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function RankingTable({
  ranking,
  page,
  full,
  onOpen,
  onError,
  onMenu,
}: {
  readonly ranking: StatsRanking;
  readonly page: Page<StatsRow>;
  readonly full: boolean;
  readonly onOpen: (row: StatsRow) => void;
  readonly onError: () => void;
  readonly onMenu: SongMenu;
}) {
  const strings = text;
  const { items, total } = page;
  const scope = useMemo<BrowseScope>(() => ({ kind: ranking }), [ranking]);
  const preview = useMemo(
    () => ({
      id: `stats-${ranking}`,
      label: strings.stats.rankings[ranking],
      page: { items, total, offset: 0 },
      ranked: true,
      trailing: (row: BrowseRow) => strings.stats.plays((row as StatsRow).countedPlays),
      trailingHeading: strings.stats.facts.plays,
    }),
    [items, total, ranking, strings],
  );
  return (
    <div className="stats-table" style={full ? undefined : { height: page.total * 40 + 30 }}>
      <VirtualTable
        scope={scope}
        revision={0}
        preview={preview}
        onOpen={(row) => {
          if (!row.unavailable) onOpen(row as StatsRow);
        }}
        onError={onError}
        {...(ranking === "songs" ? { onMenu } : {})}
      />
    </div>
  );
}

export function Stats({
  route,
  revision,
  ytMusic,
  onPeriod,
  go,
  run,
  onError,
  onMenu,
  notify,
  onRecap,
  recapsOpened,
}: {
  /** Opens a Recap's stories. */
  readonly onRecap: (period: RecapPeriod) => void;
  /** Changes when a Recap was opened; the row reads its Recaps again. */
  readonly recapsOpened: number;
  readonly route: StatsRoute;
  readonly revision: number;
  readonly ytMusic: boolean;
  readonly onPeriod: (period: StatsPeriod) => void;
  readonly go: (route: BrowseScope | StatsRoute | YtRoute) => void;
  readonly run: (action: Promise<unknown>) => void;
  readonly onError: () => void;
  readonly onMenu: SongMenu;
  readonly notify: (message: string) => void;
}) {
  const { period, ranking } = route;
  const request = `${period}:${ranking ?? ""}`;
  const [result, setResult] = useState<{
    readonly request: string;
    readonly view: StatsOverview | Page<StatsRow> | null;
  }>();
  const [attempt, setAttempt] = useState(0);
  const [recaps, setRecaps] = useState<readonly RecapPeriod[]>([]);
  useEffect(() => {
    let current = true;
    void window.wave.stats
      .recaps()
      .then((page) => {
        if (current) setRecaps(page.items);
      })
      // The row is hidden while there's none to show.
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [revision, recapsOpened]);
  const pendingOpen = useRef(0);
  useEffect(() => {
    let current = true;
    const read =
      ranking === undefined
        ? window.wave.stats.overview(period)
        : window.wave.stats.ranking(ranking, period);
    void read
      .then((view) => {
        if (current) setResult({ request, view });
      })
      .catch(() => {
        if (current) setResult({ request, view: null });
      });
    return () => {
      current = false;
    };
  }, [period, ranking, request, revision, ytMusic, attempt]);
  useLayoutEffect(
    () => () => {
      pendingOpen.current++;
    },
    [period, ranking],
  );

  const open = (kind: StatsRanking, row: StatsRow) => {
    const full = ranking !== undefined;
    if (kind === "songs") {
      run(window.wave.stats.play(period, row.key, full));
    } else if (row.id !== 0) {
      go({ kind: kind === "albums" ? "album" : "artist", id: row.id });
    } else {
      const opening = ++pendingOpen.current;
      void window.wave.stats
        .open(kind, period, row.key, full)
        .then((id) => {
          if (opening !== pendingOpen.current) return;
          if (id !== null) go({ kind: kind === "albums" ? "ytAlbum" : "ytArtist", id });
          else if (kind === "albums") notify(text.stats.albumNotFound);
        })
        .catch(() => {
          if (opening === pendingOpen.current) onError();
        });
    }
  };
  const table = (kind: StatsRanking, page: Page<StatsRow>, full: boolean) => (
    <RankingTable
      key={`${period}-${kind}`}
      ranking={kind}
      page={page}
      full={full}
      onOpen={(row) => open(kind, row)}
      onError={onError}
      onMenu={onMenu}
    />
  );
  const view = result?.request === request ? result.view : undefined;
  const status =
    view === undefined ? (
      <p className="secondary" role="status">
        {ranking === undefined ? text.stats.loadingListeningStats : text.stats.loadingRanking}
      </p>
    ) : view === null ? (
      <div className="home-retry" role="alert">
        <p>{text.desktopLibrary.actionFailed}</p>
        <button
          onClick={() => {
            setResult(undefined);
            setAttempt((value) => value + 1);
          }}
        >
          {text.playbackText.tryAgain}
        </button>
      </div>
    ) : ("hasPlays" in view ? !view.hasPlays : view.total === 0) ? (
      <p className="secondary" role="status">
        {text.stats.noPlays[period]}
      </p>
    ) : null;

  if (ranking !== undefined) {
    return (
      <div className="stats-full">
        <p className="secondary">{text.stats.periods[period].label}</p>
        {status ?? (view && "items" in view && table(ranking, view, true))}
      </div>
    );
  }
  return (
    <div className="stats-page">
      {recaps.length > 0 && (
        <section className="stats-recaps" aria-labelledby="stats-recaps-heading">
          <div className="stats-section-heading">
            <h2 id="stats-recaps-heading">{text.stats.recaps}</h2>
          </div>
          <div className="recap-tiles">
            {recaps.map((recap) => (
              <button
                key={recapId(recap)}
                className="recap-tile"
                style={{ backgroundColor: `var(--color-recap-${recapColour(recap)})` }}
                aria-label={text.recap.tileLabel(recap)}
                onClick={() => onRecap(recap)}
              >
                <span>{text.recap.kinds[recap.kind]}</span>
                <strong>{recapTitle(recap, text)}</strong>
              </button>
            ))}
          </div>
        </section>
      )}
      <PeriodTabs period={period} onChange={onPeriod} />
      <div
        className="stats-period-panel"
        id="stats-period-panel"
        role="tabpanel"
        aria-labelledby={`stats-period-${period}`}
      >
        {status ??
          (view && "genres" in view && (
            <>
              {STATS_RANKINGS.map(({ id }) => {
                const items = view[id];
                if (items.length === 0) return null;
                return (
                  <section key={id} aria-labelledby={`stats-heading-${id}`}>
                    <div className="stats-section-heading">
                      <h2 id={`stats-heading-${id}`}>{text.stats.rankings[id]}</h2>
                      <button onClick={() => go({ kind: "stats", period, ranking: id })}>
                        {text.home.seeAll}
                      </button>
                    </div>
                    {table(id, { items, offset: 0, total: items.length }, false)}
                  </section>
                );
              })}
              {view.genres.length > 0 && <GenrePodium genres={view.genres} />}
            </>
          ))}
      </div>
    </div>
  );
}
