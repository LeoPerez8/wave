import { VersionHistory } from "./VersionHistory.tsx";
import { Links } from "./Links.tsx";
import {
  checkedTableRow,
  listDuration,
  readThemeChoice,
  tableSelectionOf,
  themeFor,
  type SearchOnline,
  type TableSelection,
} from "@wave/core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { AccountView } from "../../shared/account.ts";
import type { YtAccountPanel } from "../../shared/ytAccount.ts";
import { SpotifyAccountSettings } from "./SpotifyAccountSettings.tsx";
import { PlaylistMissingSongs } from "./SpotifyImport.tsx";
import type { BrowseRow, BrowseScope } from "../../shared/browse.ts";
import type { CollectionTarget } from "../../shared/collectionActions.ts";
import type { ScanStatus } from "../../shared/library.ts";
import { PlayerBar, usePlayback } from "./PlayerBar.tsx";
import { NowPlaying } from "./NowPlaying.tsx";
import { SidePanel, useSidePanel } from "./SidePanel.tsx";
import { shownPanelTab } from "../../shared/panelTabs.ts";
import { Icon } from "./Icon.tsx";
import { Artwork, VirtualTable } from "./VirtualTable.tsx";
import { FolderSettings } from "./FolderSettings.tsx";
import { SearchOnlineSetting } from "./SearchOnlineSetting.tsx";
import { SearchPage } from "./SearchPage.tsx";
import { AccountSettings, SignInInvitation } from "./AccountSettings.tsx";
import { YtAccountSettings } from "./YtAccountSettings.tsx";
import { PlaybackSettings } from "./PlaybackSettings.tsx";
import { WindowSettings } from "./WindowSettings.tsx";
import { SystemMediaSession } from "./SystemMediaSession.tsx";
import { ListDownloadButton } from "./ListDownloadButton.tsx";
import { MISSING_SONGS_LISTS, type MissingSongsList } from "../../shared/downloads.ts";
import type { PlayStart } from "../../shared/playerView.ts";
import { DownloadSettings } from "./DownloadSettings.tsx";
import { DownloadsPage } from "./DownloadsPage.tsx";
import { downloadPercent, useDownloads } from "./useDownloads.ts";
import { useDesktopKeys } from "./keys.ts";
import { ShortcutsSheet } from "./Shortcuts.tsx";
import {
  openTableSongMenu,
  SelectionBar,
  useSongActions,
  type SongSelectionControls,
} from "./SongActions.tsx";
import { collectionActions, CollectionSelectionBar } from "./CollectionActions.tsx";
import {
  MixedSelectionBar,
  onlyCollection,
  pickCheckboxes,
  withCollection,
  withPick,
  type CollectionPicks,
} from "./MixedSelection.tsx";
import { itemMenuEvents, type MenuPoint } from "./Menu.tsx";
import { usePlaylistEdits } from "./Playlists.tsx";
import { Graveyard } from "./Graveyard.tsx";
import { applyLanguage, labels, text, useLanguage, tagTitle, artistName } from "./text.ts";
import { LanguageSettings } from "./LanguageSettings.tsx";
import { ThemeSettings } from "./ThemeSettings.tsx";
import { LyricsAndTagsSettings } from "./LyricsAndTagsSettings.tsx";
import { geniusAccess } from "./useSongGenius.ts";
import { Home } from "./Home.tsx";
import { Stats } from "./Stats.tsx";
import type { StatsRoute } from "../../shared/stats.ts";
import { isYtRoute, YtPage, type YtRoute } from "./YtPages.tsx";
import { AlbumArtistLink, ArtistPage, ArtistToggle, useArtistSection } from "./ArtistPage.tsx";
import {
  NowPlayingSongActions,
  playlistItems,
  useStreamedSong,
  useStreamedSongs,
} from "./StreamedSongMenu.tsx";

type Route =
  | BrowseScope
  | { readonly kind: "home" }
  | { readonly kind: "settings" }
  | { readonly kind: "downloads" }
  | { readonly kind: "graveyard"; readonly id: number }
  | StatsRoute
  | YtRoute;
const defaultStats: StatsRoute = { kind: "stats", period: "month" };
const sections = ["playlists", "artists", "albums", "songs", "genres", "favorites"] as const;
const collectionKinds = {
  albums: "album",
  artists: "artist",
  playlists: "playlist",
  genres: "genre",
} as const;
/** YT Music's sidebar pages; Downloads comes with its ticket. */
const ytPages = [
  ["discover", "discover"],
  ["magicQueue", "magicQueue"],
  ["downloads", "download"],
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
  const localisation = useLanguage();
  const [history, setHistory] = useState<readonly Route[]>([{ kind: "home" }]);
  const [position, setPosition] = useState(0);
  const route = history[position]!;
  const [hero, setHero] = useState<BrowseRow>();
  const [scan, setScan] = useState<ScanStatus>();
  const [account, setAccount] = useState<AccountView>();
  const [ytAccount, setYtAccount] = useState<YtAccountPanel>();
  const theme = account?.theme;
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [setting, setSetting] = useState<(typeof settings)[number]>("library");
  const [appearance, setAppearance] = useState<"system" | "light" | "dark">("system");
  const [ytMusic, setYtMusic] = useState(false);
  const [searchOnline, setSearchOnline] = useState<SearchOnline>();
  const [playlists, setPlaylists] = useState<readonly BrowseRow[]>([]);
  const [playlistOffset, setPlaylistOffset] = useState(0);
  const [playlistTotal, setPlaylistTotal] = useState(0);
  const failed = useCallback(() => setError(text.desktopLibrary.actionFailed), []);
  const playback = usePlayback(failed);
  const downloads = useDownloads();
  const percent = downloadPercent(downloads);
  const download = (run: Promise<unknown>) => void run.catch(failed);
  const [shortcuts, setShortcuts] = useState(false);
  const panel = useSidePanel();
  const [nowPlaying, setNowPlaying] = useState(false);
  const linkPlaying = useCallback(() => setNowPlaying(true), [setNowPlaying]);
  /** Selection mode, for the list it was turned on in. */
  const [selecting, setSelecting] = useState<{
    readonly list: string;
    readonly selection: TableSelection;
  }>();
  /** The albums, artists, genres and playlists checked on a page, alone or with its songs. */
  const [picked, setPicked] = useState<{
    readonly route: Route;
    readonly picks: CollectionPicks;
  }>();
  const picks = picked?.route === route ? picked.picks : undefined;
  const setPicks = (change: (picks: CollectionPicks | undefined) => CollectionPicks | undefined) =>
    setPicked((current) => {
      const next = change(current?.route === route ? current.picks : undefined);
      return next && { route, picks: next };
    });
  // Search lists songs beside collections: its checked songs act with them, under one bar.
  const searched = route.kind === "search" ? (route.query ?? "").trim() : undefined;
  const searchSongs =
    selecting !== undefined &&
    searched !== undefined &&
    [`search-songs:${searched}`, `search-lyrics:${searched}`].includes(selecting.list)
      ? { scope: { kind: "search", query: searched } as const, selection: selecting.selection }
      : undefined;
  const pickedSongs = picks && searchSongs;
  const searchBoxes =
    searched !== undefined && (pickCheckboxes(picks) || searchSongs?.selection.checkboxes === true);
  /** One collection checked through its menu's Select keeps its own bar. */
  const collectionSelection =
    pickedSongs === undefined && pickCheckboxes(picks) ? onlyCollection(picks) : undefined;
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
    void window.wave.settings.searchOnline().then(setSearchOnline).catch(failed);
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
    setSelecting(undefined);
    setHistory((previous) => [...previous.slice(0, position + 1), next]);
    setPosition(position + 1);
    setHero(undefined);
    setError(undefined);
  };
  const openGeniusSignIn = () => {
    setNowPlaying(false);
    setSetting("accounts");
    if (route.kind !== "settings") go({ kind: "settings" });
  };
  const back = useCallback(() => {
    setSelecting(undefined);
    setHero(undefined);
    setPosition((p) => Math.max(0, p - 1));
  }, []);
  const forward = useCallback(() => {
    setSelecting(undefined);
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
          // A sync may have pulled the account's language.
          const spoken = await window.wave.settings.language();
          if (current) applyLanguage(spoken);
          const view = await window.wave.account.view();
          if (current)
            setAccount((previous) =>
              JSON.stringify(previous) === JSON.stringify(view) ? previous : view,
            );
          const yt = await window.wave.ytAccount.view();
          if (current)
            setYtAccount((previous) =>
              JSON.stringify(previous) === JSON.stringify(yt) ? previous : yt,
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
      route.kind === "downloads" ||
      route.kind === "graveyard" ||
      route.kind === "stats" ||
      isYtRoute(route)
        ? { kind: "songs" }
        : route,
    [route],
  );
  const list = JSON.stringify(scope);
  const setSelection = (owner: string, selection: TableSelection | undefined) =>
    setSelecting((current) =>
      selection ? { list: owner, selection } : current?.list === owner ? undefined : current,
    );
  const actions = useSongActions({
    go,
    select: (ids) => {
      if (route.kind === "home") go({ kind: "songs" });
      setSelection(list, tableSelectionOf(ids, true));
    },
    failed: (message) => setError(message ?? text.desktopLibrary.actionFailed),
    changed: playback.refresh,
    newPlaylist: playlistEdits.newPlaylist,
  });
  const selectionFor = (owner: string): SongSelectionControls => {
    const own = selecting?.list === owner ? selecting.selection : undefined;
    return {
      selection: !searchBoxes
        ? own
        : own === undefined
          ? tableSelectionOf([], true)
          : own.checkboxes
            ? own
            : { ...own, checkboxes: true },
      onSelection: (selection) => setSelection(owner, selection),
      actions,
      ...(searched !== undefined && picks ? { bar: false as const } : {}),
    };
  };
  const table = selectionFor(list);
  // Says a download began, wherever it was asked for; a notice from before the window opened isn't news.
  const noticeSeen = useRef<number | null | undefined>(undefined);
  const notice = downloads?.notice;
  const { notify } = actions;
  useEffect(() => {
    if (downloads === undefined) return;
    const seen = noticeSeen.current;
    noticeSeen.current = notice?.id ?? null;
    if (seen !== undefined && notice && notice.id !== seen)
      notify(text.desktopLibrary.downloadStarted(notice.count));
  }, [downloads, notice, notify]);
  useDesktopKeys({
    search: () => search.current?.focus(),
    back,
    forward,
    rescan: () => void window.wave.library.refresh().catch(failed),
    shortcuts: () => setShortcuts((open) => !open),
    close: () => {
      if (actions.closeMenu()) return;
      if (shortcuts) return setShortcuts(false);
      if (nowPlaying) return setNowPlaying(false);
      if (selecting || picks) {
        setSelecting(undefined);
        return setPicked(undefined);
      }
      return false;
    },
  });
  const streamed = useStreamedSongs({
    go,
    failed: (message) => setError(message ?? text.desktopLibrary.actionFailed),
    notify,
    changed: playback.refresh,
  });
  /** A YouTube Music page's or the Queue's song menu: a streamed song's, or a Library song's. */
  const ytSongMenu = (row: BrowseRow, event: MouseEvent<HTMLElement>) =>
    row.videoId !== undefined
      ? actions.openItems(
          text.desktopLibrary.songMenu(row.title),
          streamed.items(row.videoId),
          event.currentTarget,
        )
      : actions.openMenu({ scope: { kind: "songs" }, ids: [row.id] }, row.title, {
          x: event.clientX,
          y: event.clientY,
        });
  /** The song playing's menu, from the player bar. */
  const playingMenu = (element: HTMLElement) => {
    const song = playback.view?.current;
    if (song === null || song === undefined) return;
    if (song.videoId !== undefined)
      return actions.openItems(
        text.desktopLibrary.songMenu(song.title),
        streamed.items(song.videoId, true),
        element,
      );
    const rect = element.getBoundingClientRect();
    actions.openMenu({ scope: { kind: "songs" }, ids: [song.id] }, song.title, {
      x: rect.left,
      y: rect.top,
    });
  };
  const playingSong = playback.view?.current ?? null;
  const playingStreamed = useStreamedSong(
    nowPlaying ? playingSong?.videoId : undefined,
    playback.view?.revision ?? 0,
    // Read again every two seconds while it plays, for its download's progress.
    Math.floor((playback.view?.status.positionMs ?? 0) / 2000),
  );
  /** Now Playing's Add to Playlist and Download, for a streamed song or a Library one. */
  const nowPlayingActions = playingSong && (
    <NowPlayingSongActions
      download={
        playingSong.videoId !== undefined
          ? playingStreamed?.download
          : { kind: playingSong.path === null ? "download" : "downloaded" }
      }
      onAddToPlaylist={(element) => {
        const { videoId } = playingSong;
        const target = { scope: { kind: "songs" }, ids: [playingSong.id] } as const;
        actions.openItems(
          text.playbackText.addToPlaylist,
          videoId !== undefined
            ? playlistItems((id) => void streamed.run(videoId, "addToPlaylist", "menu", id))
            : actions.itemFor(
                { action: "addToPlaylist" },
                target,
                { entries: [], count: 1, title: playingSong.title, artists: [] },
                "menu",
                () => {},
              ).open!(),
          element,
        );
      }}
      onDownload={() => {
        const { videoId } = playingSong;
        if (videoId !== undefined)
          void streamed.run(
            videoId,
            playingStreamed?.download.kind === "failed" ? "retryDownload" : "download",
          );
        else
          void window.wave.songs
            .run({ scope: { kind: "songs" }, ids: [playingSong.id] }, "download")
            .then(playback.refresh)
            .catch(() => failed());
      }}
    />
  );
  const collectionKind = collectionKinds[scope.kind as keyof typeof collectionKinds];
  const open = (row: BrowseRow, index: number) => {
    if (collectionKind) go({ kind: collectionKind, id: row.id });
    else if (row.unavailable) setError(text.desktopLibrary.driveDisconnected);
    else if (scope.kind === "artist" && scope.id !== undefined)
      // With Online, the page plays its Library songs and the ones YouTube Music adds.
      playback.run(
        window.wave.artistPage.play(scope.id, artistSection.pick, { library: index }, false),
      );
    else playback.run(window.wave.playback.start(scope, index));
  };
  /** The sidebar field holds the search on screen: empty elsewhere, its query again on Back. */
  const field = route.kind === "search" ? (route.query ?? query) : "";
  /** The page whose missing songs download together, when this is one. */
  const missingList: MissingSongsList | undefined =
    scope.id !== undefined && (MISSING_SONGS_LISTS as readonly string[]).includes(scope.kind)
      ? { kind: scope.kind as MissingSongsList["kind"], id: scope.id }
      : undefined;
  /** Play or Shuffle from the hero; says what it couldn't play, and offers the download. */
  const playList = (shuffle: boolean, target: BrowseScope = scope) => {
    const list =
      target.id !== undefined && (MISSING_SONGS_LISTS as readonly string[]).includes(target.kind)
        ? { kind: target.kind as MissingSongsList["kind"], id: target.id }
        : undefined;
    const offer =
      list === undefined
        ? undefined
        : {
            label: text.itemActions.labels.downloadMissingSongs,
            run: () => download(window.wave.downloads.missingAction("downloadAll", list)),
          };
    const said = (start: PlayStart) => {
      if (start.kind === "nothing") {
        // An empty list says nothing; the drive is named only when a listed song is on it.
        if (start.missing > 0) notify(text.desktopLibrary.nothingToPlay, undefined, offer);
        else if (start.unavailable > 0) notify(text.desktopLibrary.driveDisconnected);
      } else if (start.kind === "playing" && start.leftOut > 0)
        notify(text.desktopLibrary.leftOut(start.leftOut), undefined, offer);
    };
    // An artist's page with Online takes YouTube Music's songs too.
    const started =
      target === scope && scope.kind === "artist" && scope.id !== undefined
        ? window.wave.artistPage.play(scope.id, artistSection.pick, null, shuffle)
        : window.wave.playback.start(target, undefined, shuffle);
    playback.run(started.then(said));
  };
  const here = `/library/${scope.kind}/${scope.id ?? ""}`;
  const collections = collectionActions({
    actions,
    play: (target, shuffle) => playList(shuffle, target),
    goToArtist: (id) => go({ kind: "artist", id }),
    select: (target) => {
      if (searched === undefined) setSelecting(undefined);
      setPicks((current) => withCollection(current, target));
    },
    newPlaylist: playlistEdits.newPlaylist,
    playlistEdits: playlistEdits.playlistItems,
    changed: playback.refresh,
    failed: (message) => setError(message ?? text.desktopLibrary.actionFailed),
  });
  const openCollectionMenu = (target: CollectionTarget, title: string, at: MenuPoint) =>
    actions.openItems(
      text.desktopLibrary.songMenu(tagTitle(title, target.kind)),
      window.wave.collections
        .actions(target, { here, selectable: true })
        .then((about) => collections.itemsFor(target, about)),
      at,
    );
  const searchFor = (query: string) => {
    setSelecting(undefined);
    setQuery(query);
    if (route.kind !== "search") go({ kind: "search", query });
    else
      setHistory((previous) =>
        previous.map((r, i) => (i === position ? { kind: "search", query } : r)),
      );
  };
  /**
   * Where a streamed song's artist and album names lead (docs/spec-desktop.md, story 41): the
   * Library's artist page for a name it has, as Go to Artist does, else their YouTube Music
   * pages, over whatever shows, Now Playing included; Back comes back here.
   */
  const ytLinks = {
    onArtist: (name: string) => {
      void window.wave.streamed
        .artist(name)
        .then(async (target) => {
          if (target.kind === "library") {
            setNowPlaying(false);
            return go({ kind: "artist", id: target.artist.id });
          }
          const { browseId } = await window.wave.yt.findArtist(name);
          if (browseId === null) return setError(text.library.couldntOpenArtist);
          setNowPlaying(false);
          go({ kind: "ytArtist", id: browseId });
        })
        .catch(() => setError(text.library.couldntOpenArtist));
    },
    onAlbum: (browseId: string) => {
      setNowPlaying(false);
      go({ kind: "ytAlbum", id: browseId });
    },
  };
  /** Keeps the search in Recent searches, as the phone does on submit or opening a result. */
  const rememberSearch = () => {
    const query = route.kind === "search" ? (route.query ?? "").trim() : "";
    if (query !== "") void window.wave.search.remember(query).catch(failed);
  };
  const title =
    route.kind === "graveyard"
      ? text.playlists.graveyard
      : route.kind === "stats"
        ? route.ranking === undefined
          ? text.home.sections.stats
          : text.stats.rankings[route.ranking]
        : ((hero && tagTitle(hero.title, route.kind)) ??
          (route.kind in labels
            ? (labels[route.kind as keyof typeof labels] as string)
            : labels.library));
  const playlistId = route.kind === "playlist" ? route.id : undefined;
  const scanning = scan?.status === "scanning";
  // A playlist's image is an edit none of the three counts, and its page shows it.
  const revision =
    (scan?.revision ?? 0) +
    (playback.view?.revision ?? 0) +
    (account?.revision ?? 0) +
    playlistEdits.edits;
  const artistSection = useArtistSection(
    route.kind === "artist" ? route.id : undefined,
    ytMusic,
    revision,
    failed,
  );
  /** An artist's songs table, inside their page's shelves and YouTube Music section. */
  const artistPage = (table: ReactNode) =>
    route.kind === "artist" && route.id !== undefined ? (
      <ArtistPage
        artistId={route.id}
        revision={revision}
        section={artistSection}
        onAlbum={(id) => go({ kind: "album", id })}
        onAlbumMenu={(row, at) => openCollectionMenu({ kind: "album", id: row.id }, row.title, at)}
        onYtAlbum={(id) => go({ kind: "ytAlbum", id })}
        onPlayStreamed={(index) =>
          playback.run(
            window.wave.artistPage.play(route.id!, artistSection.pick, { streamed: index }, false),
          )
        }
        onSongMenu={ytSongMenu}
        onStatsPlay={(row) => playback.run(window.wave.stats.artistPlay(route.id!, row.key))}
        onStatsMenu={(row, at, element) =>
          row.videoId !== undefined
            ? actions.openItems(
                text.desktopLibrary.songMenu(row.title),
                streamed.items(row.videoId),
                element as HTMLElement,
              )
            : actions.openMenu({ scope: { kind: "songs" }, ids: [row.id] }, row.title, at)
        }
        onError={failed}
      >
        {table}
      </ArtistPage>
    ) : (
      table
    );
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
            value={field}
            onChange={(event) => searchFor(event.target.value)}
            onFocus={() => route.kind !== "search" && go({ kind: "search", query: field })}
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
          <button
            className="nav-item"
            aria-label={text.home.sections.stats}
            title={text.home.sections.stats}
            aria-current={route.kind === "stats" ? "page" : undefined}
            onClick={() => go(defaultStats)}
          >
            <Icon name="stats" />
            <span>{text.home.sections.stats}</span>
          </button>
          {(ytMusic || (downloads?.rows ?? 0) > 0) && (
            <>
              <p className="nav-heading">{labels.ytMusic}</p>
              {ytPages.map(([key, icon]) =>
                key === "downloads" ? (
                  <button
                    key={key}
                    className="nav-item"
                    aria-label={percent === null ? labels[key] : labels.downloadsProgress(percent)}
                    title={labels[key]}
                    aria-current={route.kind === key ? "page" : undefined}
                    data-testid="downloads-nav"
                    onClick={() => go({ kind: "downloads" })}
                  >
                    <Icon name={icon} />
                    <span>{labels[key]}</span>
                    {percent !== null && <span className="nav-count">{percent}%</span>}
                  </button>
                ) : (
                  ytMusic && (
                    <button
                      key={key}
                      className="nav-item"
                      aria-label={labels[key]}
                      title={labels[key]}
                      aria-current={route.kind === key ? "page" : undefined}
                      onClick={() => go({ kind: key })}
                    >
                      <Icon name={icon} />
                      <span>{labels[key]}</span>
                    </button>
                  )
                ),
              )}
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
              {...itemMenuEvents((at) =>
                openCollectionMenu({ kind: "playlist", id: row.id }, row.title, at),
              )}
            >
              <Icon name="playlist" />
              <span className="nav-monogram" aria-hidden="true">
                {Array.from(row.title.trim())[0]?.toLocaleUpperCase()}
              </span>
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
              kind={
                route.kind === "artist" ? "artist" : route.kind === "album" ? "album" : undefined
              }
              id={hero.id}
              artist={route.kind === "artist"}
              {...(route.kind === "playlist"
                ? { playlist: route.id, image: hero.imageKey ?? null }
                : {})}
            />
            <div className="hero-copy">
              <h1>{title}</h1>
              {hero.artist &&
                (route.kind === "album" && route.id !== undefined ? (
                  <AlbumArtistLink
                    albumId={route.id}
                    credit={artistName(hero.artist)}
                    onArtist={(id) => go({ kind: "artist", id })}
                    onChoose={(items, element) =>
                      actions.openItems(text.desktopLibrary.chooseArtist, items, element)
                    }
                  />
                ) : (
                  <p className="hero-artist">{artistName(hero.artist)}</p>
                ))}
              <p className="hero-meta">
                {[
                  labels[route.kind as "album" | "artist" | "playlist" | "genre"],
                  hero.genre,
                  hero.year,
                  labels.songCount(hero.count),
                  listDuration(hero.durationMs, text.library),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <div className="hero-actions">
                <button onClick={() => playList(false)}>
                  <Icon name="play" size={16} />
                  {labels.play}
                </button>
                <button onClick={() => playList(true)}>
                  <Icon name="shuffle" size={16} />
                  {labels.shuffle}
                </button>
                {route.kind === "artist" && <ArtistToggle section={artistSection} />}
                {missingList !== undefined && (
                  <ListDownloadButton
                    list={missingList}
                    revision={`${scan?.revision}:${account?.revision}:${downloads?.progress}:${downloads?.failed}`}
                    onError={failed}
                  />
                )}
                {playlistId !== undefined && (
                  <PlaylistMissingSongs
                    playlistId={playlistId}
                    revision={`${playback.view?.revision}:${playlistEdits.edits}`}
                  />
                )}
                {playlistId !== undefined && (
                  <button
                    aria-label={text.playlists.playlistActions}
                    title={text.playlists.playlistActions}
                    aria-haspopup="menu"
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      openCollectionMenu({ kind: "playlist", id: playlistId }, hero.title, {
                        x: rect.left,
                        y: rect.bottom + 4,
                      });
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
                <button
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    playlistEdits.importPlaylists({ x: rect.left, y: rect.bottom + 4 });
                  }}
                >
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
        {collectionSelection ? (
          <CollectionSelectionBar
            key={`${collectionSelection.kind}:${collectionSelection.id}`}
            target={collectionSelection}
            here={here}
            itemsFor={collections.itemsFor}
            openItems={actions.openItems}
            done={() => setPicked(undefined)}
            failed={failed}
          />
        ) : (
          picks && (
            <MixedSelectionBar
              picks={picks}
              songs={pickedSongs}
              revision={revision}
              actions={actions}
              changed={playback.refresh}
              failed={failed}
              done={() => {
                setPicked(undefined);
                if (pickedSongs) setSelecting(undefined);
              }}
            />
          )
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
                  <ThemeSettings
                    theme={theme ?? null}
                    appearance={appearance}
                    onChange={(stored) =>
                      setAccount((previous) => previous && { ...previous, theme: stored })
                    }
                    onError={failed}
                  />
                  <LanguageSettings view={localisation} onError={failed} />
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
                  {ytMusic && searchOnline !== undefined && (
                    <SearchOnlineSetting
                      value={searchOnline}
                      onChange={(value) => {
                        setSearchOnline(value);
                        void window.wave.settings.setSearchOnline(value).catch(failed);
                      }}
                    />
                  )}
                  <YtAccountSettings view={ytAccount} onError={failed} />
                  <SpotifyAccountSettings onError={failed} />
                </>
              ) : setting === "playback" ? (
                <PlaybackSettings onError={failed} />
              ) : setting === "window" ? (
                <WindowSettings onError={failed} />
              ) : setting === "versionHistory" ? (
                <VersionHistory />
              ) : setting === "downloads" ? (
                <DownloadSettings onError={failed} />
              ) : setting === "lyricsAndTags" ? (
                <LyricsAndTagsSettings
                  onError={failed}
                  notify={notify}
                  onGeniusChanged={(enabled) =>
                    setAccount((view) => view && { ...view, geniusInsights: enabled })
                  }
                />
              ) : (
                <p className="secondary">{labels.unavailableSection}</p>
              )}
            </section>
          </div>
        ) : route.kind === "downloads" ? (
          <DownloadsPage view={downloads} onError={failed} />
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
            ytMusic={ytMusic}
            searchOnline={searchOnline}
            onYtPlay={(videoId) => {
              rememberSearch();
              playback.run(window.wave.magicQueue.startStreamed(videoId));
            }}
            onYtDownload={(videoId) => download(window.wave.downloads.yt([videoId]))}
            onYtMenu={ytSongMenu}
            ytLinks={{
              onArtist: (name) => {
                rememberSearch();
                ytLinks.onArtist(name);
              },
              onAlbum: (browseId) => {
                rememberSearch();
                ytLinks.onAlbum(browseId);
              },
              onArtistPage: (browseId) => {
                rememberSearch();
                go({ kind: "ytArtist", id: browseId });
              },
            }}
            revision={revision}
            onOpen={(next) => {
              rememberSearch();
              go(next);
            }}
            onPlay={(index) => {
              rememberSearch();
              playback.run(window.wave.playback.start(scope, index));
            }}
            selectionFor={selectionFor}
            collectionSelection={(kind) => ({
              selection: picks?.[kind] ?? (searchBoxes ? tableSelectionOf([], true) : undefined),
              onSelection: (selection) =>
                setPicks((current) => withPick(current, kind, selection, searchBoxes)),
            })}
            onCollectionMenu={openCollectionMenu}
            onUnavailable={() => setError(text.desktopLibrary.driveDisconnected)}
            onPick={(picked) => {
              searchFor(picked);
              void window.wave.search.remember(picked).catch(failed);
            }}
            onError={failed}
          />
        ) : route.kind === "home" ? (
          <Home
            revision={revision}
            ytMusic={ytMusic}
            run={playback.run}
            go={go}
            onStats={() => go(defaultStats)}
            onError={failed}
            notify={notify}
            selectionFor={selectionFor}
            onCollectionMenu={openCollectionMenu}
            onMenu={(row, at) =>
              actions.openMenu({ scope: { kind: "songs" }, ids: [row.id] }, row.title, at)
            }
          />
        ) : route.kind === "stats" ? (
          <Stats
            route={route}
            revision={revision}
            ytMusic={ytMusic}
            onPeriod={(period) => {
              if (period !== route.period) {
                setHistory((previous) =>
                  previous.map((entry, index) =>
                    index === position ? { ...route, period } : entry,
                  ),
                );
              }
            }}
            run={playback.run}
            go={go}
            onError={failed}
            notify={notify}
            onMenu={(row, at) => {
              if (row.unavailable) return;
              if (row.videoId === undefined) {
                actions.openMenu({ scope: { kind: "songs" }, ids: [row.id] }, row.title, at);
              } else {
                actions.openItems(
                  text.desktopLibrary.songMenu(row.title),
                  streamed.items(row.videoId),
                  at,
                );
              }
            }}
          />
        ) : (
          <>
            {table.selection && (
              <SelectionBar
                scope={scope}
                selection={table.selection}
                revision={revision}
                actions={actions}
                onChange={(selection) => setSelection(list, selection)}
                onDone={() => setSelection(list, undefined)}
              />
            )}
            {artistPage(
              <VirtualTable
                key={list}
                scope={scope}
                revision={revision}
                onHero={setHero}
                onOpen={open}
                onError={failed}
                selection={collectionKind ? picks?.[collectionKind] : table.selection}
                onSelection={
                  collectionKind
                    ? (selection) =>
                        setPicks((current) => withPick(current, collectionKind, selection))
                    : table.onSelection
                }
                {...(picks
                  ? {}
                  : {
                      onMenu: (row: BrowseRow, at: MenuPoint) => {
                        if (collectionKind !== undefined)
                          return openCollectionMenu(
                            { kind: collectionKind, id: row.id },
                            row.title,
                            at,
                          );
                        if (
                          row.videoId !== undefined &&
                          !(table.selection && checkedTableRow(table.selection, row.id))
                        )
                          return actions.openItems(
                            text.desktopLibrary.songMenu(row.title),
                            streamed.items(row.videoId).then((items) => [
                              ...items,
                              {
                                key: "select",
                                label: text.itemActions.labels.select,
                                run: () => table.onSelection?.(tableSelectionOf([row.id], true)),
                              },
                            ]),
                            at,
                          );
                        openTableSongMenu(
                          table,
                          scope,
                          row,
                          at,
                          scope.kind === "playlist" && scope.id !== undefined
                            ? playlistEdits.moveItems(scope.id, row.id)
                            : [],
                        );
                      },
                    })}
              />,
            )}
          </>
        )}
      </div>
      {panel.tab && (
        <SidePanel
          tab={panel.tab}
          onTab={panel.show}
          ytMusic={ytMusic}
          onArtist={(artist) => go({ kind: "ytArtist", id: artist.browseId })}
          onSongMenu={ytSongMenu}
          view={playback.view}
          run={playback.run}
          onError={failed}
          hidden={nowPlaying}
          geniusAccess={geniusAccess(account)}
          onGeniusSignIn={openGeniusSignIn}
          onClose={() => {
            // Focus goes back to the bar's button for this tab; Related opens from Queue's.
            const opener = panel.tab === "lyrics" ? labels.lyrics : labels.queue;
            panel.show(null);
            document
              .querySelector<HTMLElement>(`.player-bar [aria-label="${CSS.escape(opener)}"]`)
              ?.focus();
          }}
        />
      )}
      {nowPlaying && (
        <NowPlaying
          view={playback.view}
          run={playback.run}
          links={ytLinks}
          onClose={() => setNowPlaying(false)}
          actions={nowPlayingActions}
          geniusAccess={geniusAccess(account)}
          onGeniusSignIn={openGeniusSignIn}
        />
      )}
      <PlayerBar
        playback={playback}
        panel={panel.tab && shownPanelTab(panel.tab, ytMusic)}
        onPanel={panel.toggle}
        onNowPlaying={() => setNowPlaying(true)}
        onMenu={playingMenu}
        links={ytLinks}
      />
      <Links
        onPlaying={linkPlaying}
        onPlaylist={(id) => go({ kind: "playlist", id })}
        onSearch={(value) => {
          setQuery(value);
          go({ kind: "search" });
        }}
        onChanged={playback.refresh}
      />
      <SystemMediaSession view={playback.view} refresh={playback.refresh} />
      {actions.overlays}
      {playlistEdits.overlays}
      {shortcuts && <ShortcutsSheet onClose={() => setShortcuts(false)} />}
    </main>
  );
}
