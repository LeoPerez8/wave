import { homeSectionTitle } from "@wave/core";
import { useEffect, useMemo, useState } from "react";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import type { HomeSectionView, HomeView } from "../../shared/home.ts";
import { DiscoverSection } from "./Discover.tsx";
import { Shelf } from "./YtLists.tsx";
import { VirtualTable } from "./VirtualTable.tsx";
import { text, labels, tagTitle, artistName } from "./text.ts";
import "./home.css";

const SONGS: BrowseScope = { kind: "favorites" };

function MostPlayed({
  section,
  onPlay,
  onError,
  onMenu,
}: {
  readonly section: HomeSectionView;
  readonly onPlay: (index: number) => void;
  readonly onError: () => void;
  readonly onMenu: (row: BrowseRow, at: { readonly x: number; readonly y: number }) => void;
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
  return (
    <div className="home-table" style={{ height: section.rows.total * 40 + 30 }}>
      <VirtualTable
        scope={SONGS}
        revision={0}
        preview={preview}
        onOpen={(_, index) => onPlay(index)}
        onError={onError}
        onMenu={onMenu}
      />
    </div>
  );
}

/** Mounted only while Home is visible. Scan, stars and account pulls renew its bounded read. */
export function Home({
  revision,
  ytMusic,
  run,
  go,
  onError,
  onMenu,
}: {
  readonly revision: number;
  readonly ytMusic: boolean;
  readonly run: (action: Promise<unknown>) => void;
  readonly go: (scope: BrowseScope) => void;
  readonly onError: () => void;
  readonly onMenu: (row: BrowseRow, at: { readonly x: number; readonly y: number }) => void;
}) {
  const [view, setView] = useState<HomeView>();
  const [readFailed, setReadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
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
              ytMusic && <DiscoverSection key={section.id} run={run} />
            ) : (
              <div key={section.id} data-section={section.id}>
                {section.id === "most-played" ? (
                  <section aria-label={homeSectionTitle(section.id, text)}>
                    <h2>{homeSectionTitle(section.id, text)}</h2>
                    <MostPlayed
                      section={section}
                      onPlay={(index) => open(section, index)}
                      onError={onError}
                      onMenu={onMenu}
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
                      missing:
                        section.kind === "song" && row.path === null && row.videoId === undefined,
                    }))}
                    onOpen={(index) => open(section, index)}
                    onMenu={
                      section.kind === "song"
                        ? (index, at) => onMenu(section.rows.items[index]!, at)
                        : undefined
                    }
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
