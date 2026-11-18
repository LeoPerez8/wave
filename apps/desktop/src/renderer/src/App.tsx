import { readThemeChoice, themeFor } from "@wave/core";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { AccountView } from "../../shared/account.ts";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import type { ScanStatus } from "../../shared/library.ts";
import { PlayerBar, usePlayback } from "./PlayerBar.tsx";
import { NowPlaying } from "./NowPlaying.tsx";
import { SidePanel, useSidePanel } from "./SidePanel.tsx";
import { Icon } from "./Icon.tsx";
import { Artwork, VirtualTable } from "./VirtualTable.tsx";
import { FolderSettings } from "./FolderSettings.tsx";
import { YtResults } from "./YtResults.tsx";
import { SearchPage } from "./SearchPage.tsx";
import { AccountSettings, SignInInvitation } from "./AccountSettings.tsx";
import { PlaybackSettings } from "./PlaybackSettings.tsx";
import { useDesktopKeys } from "./keys.ts";
import { ShortcutsSheet } from "./Shortcuts.tsx";
import { SelectionBar, useSongActions, type Selection } from "./SongActions.tsx";
import { usePlaylistEdits } from "./Playlists.tsx";
import { Graveyard } from "./Graveyard.tsx";
import { labels, text } from "./text.ts";
import { DiscoverSection } from "./Discover.tsx";
import { isYtRoute, streamedSongItems, YtPage, type YtRoute } from "./YtPages.tsx";

type Route =
  | BrowseScope
  | { readonly kind: "home" }
  | { readonly kind: "settings" }
  | { readonly kind: "graveyard"; readonly id: number }
  | YtRoute;
const sections = ["playlists", "artists", "albums", "songs", "genres", "favorites"] as const;
/** YT Music's sidebar pages; Downloads comes with its ticket. */
const ytPages = [
  ["discover", "home"],
  ["magicQueue", "queue"],
  ["downloads", "folder"],
] as const;
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
  const [account, setAccount] = useState<AccountView>();
  const theme = account?.theme;
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [setting, setSetting] = useState<(typeof settings)[number]>("library");
  const [appearance, setAppearance] = useState<"system" | "light" | "dark">("system");
  const [ytMusic, setYtMusic] = useState(false);
  const [playlists, setPlaylists] = useState<readonly BrowseRow[]>([]);
  const [playlistOffset, setPlaylistOffset] = useState(0);
  const [playlistTotal, setPlaylistTotal] = useState(0);
  const failed = useCallback(() => setError(text.desktopLibrary.actionFailed), []);
  const playback = usePlayback(failed);
  const [shortcuts, setShortcuts] = useState(false);
  const panel = useSidePanel();
  const [nowPlaying, setNowPlaying] = useState(false);
  /** Selection mode, for the list it was turned on in. */
  const [selecting, setSelecting] = useState<{
    readonly list: string;
    readonly selection: Selection;
  }>();
  const playlistEdits = usePlaylistEdits({
    go: (next) => go(next),
    deleted: (id) => {
      if ((route.kind === "playlist" || route.kind === "graveyard") && route.id === id)
        go({ kind: "home" });
    },
    failed: (message) => setError(message),
    changed: playback.refresh,
  });
  const search = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLElement>(null);
  useEffect(() => {
    void window.wave.settings.appearance().then(setAppearance).catch(failed);
    void window.wave.settings.ytMusic().then(setYtMusic).catch(failed);
  }, [failed]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const scheme = appearance === "system" ? (media.matches ? "dark" : "light") : appearance;
      // The Wave account's theme, the phone's choice, once the Library synced it.
      const colours = themeFor(readThemeChoice(theme ?? null))[scheme];
      for (const [key, value] of Object.entries(colours))
        shell.current?.style.setProperty(`--color-${key}`, value);
      shell.current!.style.colorScheme = scheme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance, theme]);

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
          const view = await window.wave.account.view();
          if (current)
            setAccount((previous) =>
              JSON.stringify(previous) === JSON.stringify(view) ? previous : view,
            );
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
  }, [
    scan?.revision,
    account?.revision,
    playback.view?.revision,
    playlistEdits.edits,
    playlistOffset,
    failed,
  ]);
  useEffect(() => {
    if (route.kind !== "search")
      content.current?.querySelector<HTMLElement>("[role=grid]")?.focus();
  }, [route]);
  const scope = useMemo<BrowseScope>(
    () =>
      route.kind === "home" ||
      route.kind === "settings" ||
      route.kind === "graveyard" ||
      isYtRoute(route)
        ? { kind: "songs" }
        : route,
    [route],
  );
  const list = JSON.stringify(scope);
  const selection = selecting?.list === list ? selecting.selection : undefined;
  const setSelection = (selection: Selection | undefined) =>
    setSelecting(selection && { list, selection });
  const actions = useSongActions({
    go,
    select: (ids) => setSelection({ all: false, ids: new Set(ids) }),
    failed: (message) => setError(message ?? text.desktopLibrary.actionFailed),
    changed: playback.refresh,
    newPlaylist: playlistEdits.newPlaylist,
  });
  useDesktopKeys({
    search: () => search.current?.focus(),
    back,
    forward,
    rescan: () => void window.wave.library.refresh().catch(failed),
    shortcuts: () => setShortcuts((open) => !open),
    close: () => {
      if (actions.closeMenu() || playlistEdits.closeMenu()) return;
      if (shortcuts) return setShortcuts(false);
      if (nowPlaying) return setNowPlaying(false);
      if (selection) return setSelection(undefined);
      return false;
    },
  });
  /** A YouTube Music page's song menu: a streamed song's, or a Library song's. */
  const ytSongMenu = (row: BrowseRow, event: MouseEvent<HTMLElement>) =>
    row.videoId !== undefined
      ? actions.openItems(
          text.desktopLibrary.songMenu(row.title),
          streamedSongItems(row.videoId, playback.run),
          event.currentTarget,
        )
      : actions.openMenu({ scope: { kind: "songs" }, ids: [row.id] }, row.title, {
          x: event.clientX,
          y: event.clientY,
        });
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
  const searchFor = (query: string) => {
    setQuery(query);
    if (route.kind !== "search") go({ kind: "search", query });
    else
      setHistory((previous) =>
        previous.map((r, i) => (i === position ? { kind: "search", query } : r)),
      );
  };
  /** Keeps the search in Recent searches, as the phone does on submit or opening a result. */
  const rememberSearch = () => {
    const query = route.kind === "search" ? (route.query ?? "").trim() : "";
    if (query !== "") void window.wave.search.remember(query).catch(failed);
  };
  const title =
    route.kind === "graveyard"
      ? text.playlists.graveyard
      : (hero?.title ??
        (route.kind in labels
          ? (labels[route.kind as keyof typeof labels] as string)
          : labels.library));
  const playlistId = route.kind === "playlist" ? route.id : undefined;
  const scanning = scan?.status === "scanning";
  const revision =
    (scan?.revision ?? 0) + (playback.view?.revision ?? 0) + (account?.revision ?? 0);
  return (
    <main
      ref={shell}
      className="desktop-shell"
      data-appearance={appearance}
      data-panel={panel.tab ?? undefined}
    >
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
      <aside className="sidebar" inert={nowPlaying}>
        <label className="search-field" title={labels.search}>
          <Icon name="search" />
          <input
            ref={search}
            type="search"
            aria-label={labels.search}
            placeholder={labels.search}
            value={query}
            onChange={(event) => searchFor(event.target.value)}
            onFocus={() => route.kind !== "search" && go({ kind: "search", query })}
            onKeyDown={(event) => event.key === "Enter" && rememberSearch()}
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
          {ytMusic && (
            <>
              <p className="nav-heading">{labels.ytMusic}</p>
              {ytPages.map(([key, icon]) => (
                <button
                  key={key}
                  className="nav-item"
                  aria-label={labels[key]}
                  title={labels[key]}
                  aria-current={route.kind === key ? "page" : undefined}
                  disabled={key === "downloads"}
                  onClick={() => key !== "downloads" && go({ kind: key })}
                >
                  <Icon name={icon} />
                  <span>{labels[key]}</span>
                </button>
              ))}
            </>
          )}
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
              onContextMenu={(event) => {
                event.preventDefault();
                playlistEdits.openMenu(row.id, { x: event.clientX, y: event.clientY });
              }}
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
            onClick={() => playlistEdits.newPlaylist()}
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
      <div className="content" ref={content} inert={nowPlaying}>
        {hero && route.kind !== "graveyard" ? (
          <div className="hero" data-testid="hero">
            <Artwork
              large
              hash={hero.artworkHash}
              artist={route.kind === "artist"}
              {...(route.kind === "playlist"
                ? { playlist: route.id, image: hero.imageKey ?? null }
                : {})}
            />
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
                {playlistId !== undefined && (
                  <button
                    aria-label={text.playlists.playlistActions}
                    title={text.playlists.playlistActions}
                    aria-haspopup="menu"
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      playlistEdits.openMenu(playlistId, { x: rect.left, y: rect.bottom + 4 });
                    }}
                  >
                    <Icon name="menu" size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : route.kind === "ytArtist" || route.kind === "ytAlbum" ? null : (
          <div className="page-heading">
            <h1>{title}</h1>
            {(route.kind === "home" || route.kind === "songs") && (
              <p className="secondary" data-testid="song-count">
                {labels.songCount(count)}
              </p>
            )}
            {route.kind === "playlists" && (
              <div className="hero-actions">
                <button onClick={playlistEdits.importPlaylists}>
                  <Icon name="folder" size={16} />
                  {text.playlists.importPlaylists}
                </button>
              </div>
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
        {account?.invitation && <SignInInvitation onError={failed} />}
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
              ) : setting === "accounts" ? (
                <>
                  <AccountSettings view={account} onError={failed} />
                  <h2>{labels.ytMusic}</h2>
                  <label className="setting-switch">
                    <input
                      type="checkbox"
                      checked={ytMusic}
                      onChange={(event) => {
                        const on = event.target.checked;
                        setYtMusic(on);
                        void window.wave.settings.setYtMusic(on).catch(() => {
                          setYtMusic(!on);
                          failed();
                        });
                      }}
                    />
                    <span>{text.settings.useYTMusic}</span>
                  </label>
                  <p className="secondary setting-hint">
                    {text.settings.searchAlsoFindsSongsOnYouTubeMusic}
                  </p>
                </>
              ) : setting === "playback" ? (
                <PlaybackSettings onError={failed} />
              ) : (
                <p className="secondary">{labels.unavailableSection}</p>
              )}
            </section>
          </div>
        ) : isYtRoute(route) ? (
          <YtPage
            route={route}
            run={playback.run}
            revision={playback.view?.revision ?? 0}
            go={go}
            onSongMenu={ytSongMenu}
          />
        ) : route.kind === "graveyard" ? (
          <Graveyard
            playlistId={route.id}
            revision={revision}
            changed={playback.refresh}
            failed={(message) => setError(message ?? text.desktopLibrary.actionFailed)}
          />
        ) : route.kind === "search" ? (
          <SearchPage
            query={route.query ?? ""}
            revision={revision}
            onOpen={(next) => {
              rememberSearch();
              go(next);
            }}
            onPlay={(index) => {
              rememberSearch();
              playback.run(window.wave.playback.start(scope, index));
            }}
            onMenu={(row, at) => actions.openMenu({ scope, ids: [row.id] }, row.title, at)}
            onUnavailable={() => setError(text.desktopLibrary.driveDisconnected)}
            onPick={(picked) => {
              searchFor(picked);
              void window.wave.search.remember(picked).catch(failed);
            }}
            onError={failed}
          >
            {ytMusic && (
              <YtResults
                query={route.query ?? ""}
                onPlay={(videoIds, index) => {
                  rememberSearch();
                  playback.run(window.wave.playback.startYt(videoIds, index));
                }}
              />
            )}
          </SearchPage>
        ) : (
          <>
            {route.kind === "home" && ytMusic && <DiscoverSection run={playback.run} />}
            {selection && (
              <SelectionBar
                scope={scope}
                selection={selection}
                revision={revision}
                actions={actions}
                onChange={setSelection}
                onDone={() => setSelection(undefined)}
              />
            )}
            <VirtualTable
              key={list}
              scope={scope}
              revision={revision}
              onHero={setHero}
              onOpen={open}
              onError={failed}
              selection={selection}
              onSelection={setSelection}
              onMenu={
                selection
                  ? undefined
                  : (row, at) =>
                      actions.openMenu(
                        { scope, ids: [row.id] },
                        row.title,
                        at,
                        scope.kind === "playlist" && scope.id !== undefined
                          ? playlistEdits.moveItems(scope.id, row.id)
                          : [],
                      )
              }
            />
          </>
        )}
      </div>
      {panel.tab && (
        <SidePanel
          tab={panel.tab}
          onTab={panel.show}
          view={playback.view}
          run={playback.run}
          onError={failed}
          hidden={nowPlaying}
        />
      )}
      {nowPlaying && (
        <NowPlaying view={playback.view} run={playback.run} onClose={() => setNowPlaying(false)} />
      )}
      <PlayerBar
        playback={playback}
        panel={panel.tab}
        onPanel={panel.toggle}
        onNowPlaying={() => setNowPlaying(true)}
      />
      {actions.overlays}
      {playlistEdits.overlays}
      {shortcuts && <ShortcutsSheet onClose={() => setShortcuts(false)} />}
    </main>
  );
}
