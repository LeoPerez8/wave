import { DEFAULT_THEME_CHOICE, themeFor } from "@wave/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import type { ScanStatus } from "../../shared/library.ts";
import { PlayerBar, usePlayback } from "./PlayerBar.tsx";
import { Icon } from "./Icon.tsx";
import { Artwork, VirtualTable } from "./VirtualTable.tsx";
import { FolderSettings } from "./FolderSettings.tsx";
import { labels, text } from "./text.ts";

type Route = BrowseScope | { readonly kind: "home" } | { readonly kind: "settings" };
const sections = ["playlists", "artists", "albums", "songs", "genres", "favorites"] as const;
const settings = [
  "library",
  "appearance",
  "window",
  "playback",
  "lyricsAndTags",
  "downloads",
  "accounts",
  "versionHistory",
] as const;
function IconButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  readonly icon: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
}) {
  return (
    <button
      className="icon-button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}
export function App() {
  const [history, setHistory] = useState<readonly Route[]>([{ kind: "home" }]);
  const [position, setPosition] = useState(0);
  const route = history[position]!;
  const [hero, setHero] = useState<BrowseRow>();
  const [scan, setScan] = useState<ScanStatus>();
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [setting, setSetting] = useState<(typeof settings)[number]>("library");
  const [appearance, setAppearance] = useState<"system" | "light" | "dark">("system");
  const [playlists, setPlaylists] = useState<readonly BrowseRow[]>([]);
  const [playlistOffset, setPlaylistOffset] = useState(0);
  const [playlistTotal, setPlaylistTotal] = useState(0);
  const failed = useCallback(() => setError(text.desktopLibrary.actionFailed), []);
  const playback = usePlayback(failed);
  const search = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLElement>(null);
  useEffect(() => {
    void window.wave.settings.appearance().then(setAppearance).catch(failed);
  }, [failed]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const scheme = appearance === "system" ? (media.matches ? "dark" : "light") : appearance;
      const colours = themeFor(DEFAULT_THEME_CHOICE)[scheme];
      for (const [key, value] of Object.entries(colours))
        shell.current?.style.setProperty(`--color-${key}`, value);
      shell.current!.style.colorScheme = scheme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance]);

  const go = (next: Route) => {
    setHistory((previous) => [...previous.slice(0, position + 1), next]);
    setPosition(position + 1);
    setHero(undefined);
    setError(undefined);
  };
  const back = useCallback(() => {
    setHero(undefined);
    setPosition((p) => Math.max(0, p - 1));
  }, []);
  const forward = useCallback(() => {
    setHero(undefined);
    setPosition((p) => Math.min(history.length - 1, p + 1));
  }, [history.length]);
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (!document.hidden) {
          const next = await window.wave.library.scanStatus();
          if (!current) return;
          setScan((previous) =>
            JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
          );
          const counts = await window.wave.library.counts();
          if (current) setCount(counts.songs);
        }
      } catch {
        if (current) failed();
      } finally {
        if (current) timer = setTimeout(() => void poll(), 400);
      }
    };
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [failed]);
  useEffect(() => {
    let current = true;
    void window.wave.library
      .browse({ kind: "playlists" }, playlistOffset, 50)
      .then((page) => {
        if (current) {
          setPlaylists(page.items);
          setPlaylistTotal(page.total);
        }
      })
      .catch(failed);
    return () => {
      current = false;
    };
  }, [scan?.revision, playlistOffset, failed]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "F5") {
        event.preventDefault();
        void window.wave.library.refresh().catch(failed);
      }
      if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        search.current?.focus();
      }
      if (event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        back();
      }
      if (event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        forward();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [back, forward, failed]);
  useEffect(() => {
    if (route.kind !== "search")
      content.current?.querySelector<HTMLElement>("[role=grid]")?.focus();
  }, [route]);
  const scope = useMemo<BrowseScope>(
    () => (route.kind === "home" || route.kind === "settings" ? { kind: "songs" } : route),
    [route],
  );
  const open = (row: BrowseRow, index: number) => {
    const detail = {
      albums: "album",
      artists: "artist",
      playlists: "playlist",
      genres: "genre",
    } as const;
    if (scope.kind in detail) go({ kind: detail[scope.kind as keyof typeof detail], id: row.id });
    else if (row.unavailable) setError(text.desktopLibrary.driveDisconnected);
    else playback.run(window.wave.playback.start(scope, index));
  };
  const title =
    hero?.title ??
    (route.kind in labels ? (labels[route.kind as keyof typeof labels] as string) : labels.library);
  const scanning = scan?.status === "scanning";
  return (
    <main ref={shell} className="desktop-shell" data-appearance={appearance}>
      <header className="titlebar">
        <div className="brand">{labels.brand}</div>
        <div className="history-buttons">
          <IconButton icon="back" label={labels.back} disabled={position === 0} onClick={back} />
          <IconButton
            icon="forward"
            label={labels.forward}
            disabled={position === history.length - 1}
            onClick={forward}
          />
        </div>
      </header>
      <aside className="sidebar">
        <label className="search-field" title={labels.search}>
          <Icon name="search" />
          <input
            ref={search}
            type="search"
            aria-label={labels.search}
            placeholder={labels.search}
            value={query}
            onChange={(event) => {
              const query = event.target.value;
              setQuery(query);
              if (route.kind !== "search") go({ kind: "search", query });
              else
                setHistory((previous) =>
                  previous.map((r, i) => (i === position ? { kind: "search", query } : r)),
                );
            }}
          />
        </label>
        <nav aria-label={labels.library}>
          <button
            className="nav-item"
            aria-label={labels.home}
            aria-current={route.kind === "home" ? "page" : undefined}
            onClick={() => go({ kind: "home" })}
          >
            <Icon name="home" />
            <span>{labels.home}</span>
          </button>
          <p className="nav-heading">{labels.library}</p>
          {sections.map((kind) => (
            <button
              key={kind}
              className="nav-item"
              aria-label={labels[kind]}
              title={labels[kind]}
              aria-current={route.kind === kind ? "page" : undefined}
              onClick={() => go({ kind })}
            >
              <Icon name={kind} />
              <span>{labels[kind]}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-playlists">
          <p className="nav-heading">{labels.playlists}</p>
          {playlists.map((row) => (
            <button
              key={row.id}
              className="nav-item"
              aria-label={row.title}
              title={row.title}
              aria-current={route.kind === "playlist" && route.id === row.id ? "page" : undefined}
              onClick={() => go({ kind: "playlist", id: row.id })}
            >
              <Icon name="playlists" />
              <span className="truncate">{row.title}</span>
            </button>
          ))}
          {playlistTotal > 50 && (
            <div className="playlist-pager">
              <IconButton
                icon="back"
                label={text.desktopLibrary.previous}
                disabled={!playlistOffset}
                onClick={() => setPlaylistOffset((n) => n - 50)}
              />
              <IconButton
                icon="forward"
                label={text.desktopLibrary.next}
                disabled={playlistOffset + 50 >= playlistTotal}
                onClick={() => setPlaylistOffset((n) => n + 50)}
              />
            </div>
          )}
          <button
            className="nav-item"
            aria-label={labels.newPlaylist}
            title={labels.newPlaylist}
            disabled
          >
            <Icon name="add" />
            <span>{labels.newPlaylist}</span>
          </button>
        </div>
        <button
          className="nav-item settings-link"
          aria-label={labels.settings}
          title={labels.settings}
          aria-current={route.kind === "settings" ? "page" : undefined}
          onClick={() => go({ kind: "settings" })}
        >
          <Icon name="settings" />
          <span>{labels.settings}</span>
        </button>
      </aside>
      <div className="content" ref={content}>
        {hero ? (
          <div className="hero" data-testid="hero">
            <Artwork large hash={hero.artworkHash} artist={route.kind === "artist"} />
            <div className="hero-copy">
              <h1>{title}</h1>
              {hero.artist && <p className="hero-artist">{hero.artist}</p>}
              <p className="hero-meta">
                {[
                  labels[route.kind as "album" | "artist" | "playlist" | "genre"],
                  hero.genre,
                  hero.year,
                  labels.songCount(hero.count),
                  labels.minutes(Math.round(hero.durationMs / 60000)),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="hero-actions">
                <button onClick={() => playback.run(window.wave.playback.start(scope, 0, false))}>
                  <Icon name="play" size={16} />
                  {labels.play}
                </button>
                <button
                  onClick={() => playback.run(window.wave.playback.start(scope, undefined, true))}
                >
                  <Icon name="shuffle" size={16} />
                  {labels.shuffle}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="page-heading">
            <h1>{title}</h1>
            {(route.kind === "home" || route.kind === "songs") && (
              <p className="secondary" data-testid="song-count">
                {labels.songCount(count)}
              </p>
            )}
          </div>
        )}
        {scanning && (
          <div className="scan-progress" role="status" data-testid="scan-progress">
            <span>
              {scan.phase === "discovering"
                ? text.library.lookingForMusic
                : text.settings.indexedFiles(
                    String(scan.filesRead + scan.filesUnchanged),
                    String(scan.filesFound),
                  )}
            </span>
            <progress
              aria-label={text.settings.scanning}
              max={Math.max(1, scan.filesFound)}
              value={
                scan.phase === "discovering" ? undefined : scan.filesRead + scan.filesUnchanged
              }
            />
          </div>
        )}
        {(error || scan?.status === "failed") && (
          <p className="error" role="alert">
            {error ?? text.settings.couldntScanYourMusic}
          </p>
        )}
        {route.kind === "settings" ? (
          <div className="settings-page">
            <nav aria-label={labels.settings}>
              {settings.map((key) => (
                <button
                  key={key}
                  aria-current={setting === key ? "page" : undefined}
                  onClick={() => setSetting(key)}
                >
                  {key === "appearance" ? text.settings.appearance : labels[key]}
                </button>
              ))}
            </nav>
            <section className="settings-body">
              {setting === "library" ? (
                <FolderSettings
                  revision={scan?.revision ?? 0}
                  scanning={scanning}
                  onError={failed}
                />
              ) : setting === "appearance" ? (
                <>
                  <h2>{text.settings.appearance}</h2>
                  <select
                    aria-label={text.settings.appearance}
                    value={appearance}
                    onChange={(event) => {
                      const mode = event.target.value as typeof appearance;
                      void window.wave.settings
                        .setAppearance(mode)
                        .then(() => setAppearance(mode))
                        .catch(failed);
                    }}
                  >
                    {(["system", "light", "dark"] as const).map((key) => (
                      <option key={key} value={key}>
                        {text.settings.appearances[key]}
                      </option>
                    ))}
                  </select>
                </>
              ) : (
                <p className="secondary">{labels.unavailableSection}</p>
              )}
            </section>
          </div>
        ) : (
          <VirtualTable
            key={JSON.stringify(scope)}
            scope={scope}
            revision={(scan?.revision ?? 0) + (playback.view?.revision ?? 0)}
            onHero={setHero}
            onOpen={open}
            onError={failed}
          />
        )}
      </div>
      <PlayerBar playback={playback} />
    </main>
  );
}
