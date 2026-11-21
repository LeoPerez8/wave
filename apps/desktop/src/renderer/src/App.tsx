import { VersionHistory } from "./VersionHistory.tsx";
import { Links } from "./Links.tsx";
import { FindField, findableList } from "./FindField.tsx";
import {
  DESKTOP_PLAYLIST_LAYOUTS,
  PLAYLIST_SORTS,
  checkedTableRow,
  hasFindQuery,
  homeSectionTitle,
  listDuration,
  readThemeChoice,
  recapId,
  tableSelectionOf,
  themeFor,
  type RecapPeriod,
  type SearchOnline,
  type TableSelection,
  type UpNextPlace,
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
import { PlaylistSuggestionsPage } from "./PlaylistSuggestions.tsx";
import type { BrowsePage, BrowseRow, BrowseScope } from "../../shared/browse.ts";
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
import { BringYourMusic, type MusicSource } from "./BringYourMusic.tsx";
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
  selectionWithPicks,
  type CollectionPicks,
} from "./MixedSelection.tsx";
import { useSongDrop, type DraggedSongs } from "./songDrag.ts";
import { songActionToast } from "./songActionToast.ts";
import { itemMenuEvents, type MenuItem, type MenuPoint } from "./Menu.tsx";
import { shuffleMenuEvents } from "./ShuffleKinds.tsx";
import { usePlaylistEdits } from "./Playlists.tsx";
import { PlaylistGrid } from "./PlaylistGrid.tsx";
import type { PlaylistListView } from "../../shared/playlists.ts";
import { Graveyard } from "./Graveyard.tsx";
import { applyLanguage, labels, text, useLanguage, tagTitle, artistName } from "./text.ts";
import { LanguageSettings } from "./LanguageSettings.tsx";
import { ThemeSettings } from "./ThemeSettings.tsx";
import { LyricsAndTagsSettings } from "./LyricsAndTagsSettings.tsx";
import { FollowButton } from "./FollowButton.tsx";
import { FollowedArtistsSettings } from "./FollowedArtistsSettings.tsx";
import { geniusAccess } from "./useSongGenius.ts";
import { Home } from "./Home.tsx";
import { HomeSettings } from "./HomeEditor.tsx";
import { HomeSeeAll, type HomeSeeAllRoute } from "./HomeSeeAll.tsx";
import { Stats } from "./Stats.tsx";
import { RecapViewer } from "./RecapViewer.tsx";
import type { DesktopRecap, StatsRoute } from "../../shared/stats.ts";
import { ListeningHistory } from "./ListeningHistory.tsx";
import type { HistoryRoute } from "../../shared/history.ts";
import { isYtRoute, YtPage, type YtRoute } from "./YtPages.tsx";
import { Recognize } from "./Recognize.tsx";
import { AlbumArtistLink, ArtistPage, ArtistToggle, useArtistSection } from "./ArtistPage.tsx";
import { AlbumPage, useAlbumSection } from "./AlbumSection.tsx";
import { YtListDownloadButton } from "./YtListDownloadButton.tsx";
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
  | HistoryRoute
  | HomeSeeAllRoute
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
  "home",
  "window",
  "playback",
  "lyricsAndTags",
  "followedArtists",
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
  /** The order the page's table shows: a playlist offers Move Up and Move Down only in Custom. */
  const [shownSort, setShownSort] = useState<BrowsePage["sort"]>();
  const [scan, setScan] = useState<ScanStatus>();
  const [account, setAccount] = useState<AccountView>();
  const [ytAccount, setYtAccount] = useState<YtAccountPanel>();
  const theme = account?.theme;
  const [counts, setCounts] = useState<{ songs: number; favorites: number }>({
    songs: 0,
    favorites: 0,
  });
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [setting, setSetting] = useState<(typeof settings)[number]>("library");
  const [appearance, setAppearance] = useState<"system" | "light" | "dark">("system");
  const [ytMusic, setYtMusic] = useState(false);
  const [searchOnline, setSearchOnline] = useState<SearchOnline>();
  const [playlists, setPlaylists] = useState<readonly BrowseRow[]>([]);
  const [playlistOffset, setPlaylistOffset] = useState(0);
  const [playlistTotal, setPlaylistTotal] = useState(0);
  /** How the Playlists list shows and orders playlists, its page and the sidebar alike. */
  const [playlistList, setPlaylistList] = useState<PlaylistListView>();
  const failed = useCallback(() => setError(text.desktopLibrary.actionFailed), []);
  const playback = usePlayback(failed);
  const downloads = useDownloads();
  const percent = downloadPercent(downloads);
  const download = (run: Promise<unknown>) => void run.catch(failed);
  const [shortcuts, setShortcuts] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const panel = useSidePanel();
  const [nowPlaying, setNowPlaying] = useState(false);
  const linkPlaying = useCallback(() => setNowPlaying(true), [setNowPlaying]);
  /** Selection mode, for the list it was turned on in. */
  const [selecting, setSelecting] = useState<{
    readonly list: string;
    readonly selection: TableSelection;
  }>();
  /** What the page's Find field holds, for the page it was typed on. */
  const [finding, setFinding] = useState<{ readonly route: Route; readonly text: string }>();
  const findList = findableList(route.kind);
  const findText = finding?.route === route ? finding.text : "";
  // The table reads again once typing pauses, as Listening History's Find does.
  const [found, setFound] = useState(finding);
  useEffect(() => {
    const timer = setTimeout(() => setFound(finding), finding?.text === "" ? 0 : 200);
    return () => clearTimeout(timer);
  }, [finding]);
  const foundText = found?.route === route ? found.text : "";
  /** The Find the page's table, Play, Shuffle and Select All go by, when it finds by anything. */
  const activeFind = findList !== undefined && hasFindQuery(foundText) ? foundText : undefined;
  /** The albums, artists, genres and playlists checked on a page, alone or with its songs. */
  const [picked, setPicked] = useState<{
    readonly route: Route;
    readonly find: string | undefined;
    readonly picks: CollectionPicks;
  }>();
  // A new Find lists other rows: what was checked under the last one is let go.
  const picks = picked?.route === route && picked.find === activeFind ? picked.picks : undefined;
  const setPicks = (change: (picks: CollectionPicks | undefined) => CollectionPicks | undefined) =>
    setPicked((current) => {
      const next = change(
        current?.route === route && current.find === activeFind ? current.picks : undefined,
      );
      return next && { route, find: activeFind, picks: next };
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
  /** The sources Bring your music started an import from; the marks last for this launch. */
  const [bringing, setBringing] = useState<ReadonlySet<MusicSource>>(new Set());
  const playlistEdits = usePlaylistEdits({
    go: (next) => go(next),
    deleted: (id) => {
      if ((route.kind === "playlist" || route.kind === "graveyard") && route.id === id)
        go({ kind: "home" });
    },
    failed: (message) => setError(message),
    changed: playback.refresh,
    importStarted: (source) => setBringing((previous) => new Set(previous).add(source)),
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
  const turnOnYtMusic = () => {
    setYtMusic(true);
    void window.wave.settings.setYtMusic(true).catch(() => {
      setYtMusic(false);
      failed();
    });
  };
  /**
   * From YT Music on Bring your music. The desktop has no YT Music playlist picker yet: what
   * exists is YouTube's sign-in and the account's playlists in Settings › Accounts, so this
   * opens them, signing in first when signed out. Nothing here starts an import, so the source
   * never reads as importing. The picker, once there is one, replaces this body and says its
   * import started with `setBringing`, as From Spotify does through `importStarted`.
   */
  const importFromYtMusic = () => {
    setSetting("accounts");
    if (route.kind !== "settings") go({ kind: "settings" });
    // Read now: the polled view is still empty right after Turn On YT Music.
    void window.wave.ytAccount
      .view()
      .then(({ account }) =>
        account?.kind === "signedOut" && account.action !== "signingIn"
          ? window.wave.ytAccount.signIn()
          : undefined,
      )
      .catch(failed);
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
          if (current)
            setCounts((previous) =>
              previous.songs === counts.songs && previous.favorites === counts.favorites
                ? previous
                : { songs: counts.songs, favorites: counts.favorites },
            );
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
    let current = true;
    void window.wave.playlists
      .listView()
      .then((view) => {
        if (current) setPlaylistList(view);
      })
      .catch(failed);
    return () => {
      current = false;
    };
  }, [scan?.revision, account?.revision, playback.view?.revision, playlistEdits.edits, failed]);
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
      route.kind === "history" ||
      route.kind === "homeSeeAll" ||
      isYtRoute(route)
        ? { kind: "songs" }
        : activeFind === undefined
          ? route
          : { ...route, find: activeFind },
    [route, activeFind],
  );
  const focusList = () => content.current?.querySelector<HTMLElement>("[role=grid]")?.focus();
  // Esc in the Find field gives the focus to the list, and again to the one the cleared Find lists.
  const leftFind = useRef(false);
  useEffect(() => {
    if (!leftFind.current) return;
    leftFind.current = false;
    focusList();
  }, [scope]);
  /** How many rows the page's table lists, for the list it read them for. */
  const [listed, setListed] = useState<{ readonly scope: BrowseScope; readonly total: number }>();
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
      ...(searched !== undefined && picks
        ? { bar: false as const, picks: (songs) => selectionWithPicks(picks, songs) }
        : {}),
    };
  };
  const table = selectionFor(list);
  /** Songs and Favorites count the rows the Find finds while it narrows them. */
  const songCount =
    route.kind !== "songs" && route.kind !== "favorites"
      ? counts.songs
      : activeFind === undefined
        ? counts[route.kind]
        : listed?.scope === scope
          ? listed.total
          : undefined;
  const findField = findList !== undefined && (
    <FindField
      list={findList}
      value={findText}
      onChange={(text) => setFinding({ route, text })}
      onLeave={() => {
        leftFind.current = true;
        focusList();
      }}
    />
  );
  // Says a download began, wherever it was asked for; a notice from before the window opened isn't news.
  const noticeSeen = useRef<number | null | undefined>(undefined);
  const notice = downloads?.notice;
  const { notify } = actions;
  /** The Recap whose stories fill the window, and how many were opened (Home and Stats read again). */
  const [recap, setRecap] = useState<DesktopRecap>();
  const [recapsOpened, setRecapsOpened] = useState(0);
  const openRecap = (period: RecapPeriod) => {
    void window.wave.stats
      .recap(recapId(period))
      .then((opened) => {
        if (opened === null) notify(text.recap.unavailable);
        else setRecap(opened);
      })
      .catch(failed);
  };
  const closeRecap = () => {
    setRecap(undefined);
    setRecapsOpened((count) => count + 1);
    // The queue comes back as it was before the Recap's music, and the player bar shows it.
    playback.run(window.wave.stats.recapClosed());
  };
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
    releaseDate: actions.openReleaseDate,
  });
  /** A YouTube Music page's or the Queue's song menu: a streamed song's, or a Library song's. */
  const ytSongMenu = (row: BrowseRow, event: MouseEvent<HTMLElement>) =>
    // A file outside the Library has none of a song's actions.
    row.outside
      ? undefined
      : row.videoId !== undefined
        ? actions.openItems(
            text.desktopLibrary.songMenu(row.title),
            streamed.items(row.videoId),
            event.currentTarget,
          )
        : actions.openMenu({ scope: { kind: "songs" }, ids: [row.id] }, row.title, {
            x: event.clientX,
            y: event.clientY,
          });
  /** A shuffle control's menu of kinds: the player bar's and a hero's Shuffle. */
  const shuffleMenu = shuffleMenuEvents(actions.openItems, playback.run);
  /** The song playing's menu, from the player bar. */
  const playingMenu = (element: HTMLElement) => {
    const song = playback.view?.current;
    // A file outside the Library has none of a song's actions.
    if (song === null || song === undefined || song.outside) return;
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
  /**
   * Songs dragged from a list and dropped onto a sidebar playlist, or the Queue: [at] in Up
   * Next, or none for the end, as Add to Playlist and Add to Queue run with their toasts.
   */
  const dropSongs = (
    songs: DraggedSongs,
    on: { readonly playlist: number } | { readonly queue: UpNextPlace | undefined },
  ) => {
    const playlist = "playlist" in on ? on.playlist : undefined;
    const at = "queue" in on ? on.queue : undefined;
    const action = playlist === undefined ? "addToQueue" : "addToPlaylist";
    if (songs.kind === "songs") return void actions.run(songs.target, action, "menu", playlist, at);
    if (songs.kind === "streamed")
      return void streamed.run(songs.videoId, action, "menu", playlist, at);
    void window.wave.collections
      .runSelection(songs.target, action, playlist, at)
      .then((result) => {
        playback.refresh();
        if (result.kind === "queued" || result.kind === "playlist")
          notify(
            songActionToast(
              result,
              false,
              "selection",
              result.kind === "queued" ? result.count : 0,
            ),
          );
      })
      .catch(() => failed());
  };
  const playlistDrop = useSongDrop<number>();
  const playingSong = playback.view?.current ?? null;
  const playingStreamed = useStreamedSong(
    nowPlaying ? playingSong?.videoId : undefined,
    playback.view?.revision ?? 0,
    // Read again every two seconds while it plays, for its download's progress.
    Math.floor((playback.view?.status.positionMs ?? 0) / 2000),
  );
  /** Now Playing's Add to Playlist and Download, for a streamed song or a Library one. */
  const nowPlayingActions = playingSong && !playingSong.outside && (
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
    else if (scope.kind === "artist" && scope.id !== undefined && scope.find === undefined)
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
    // An artist's page with Online takes YouTube Music's songs too, and an album's its release's.
    const started =
      // With a Find, the page plays the Library songs it finds.
      target === scope && scope.kind === "artist" && scope.id !== undefined && !scope.find
        ? window.wave.artistPage.play(scope.id, artistSection.pick, null, shuffle)
        : target === scope && scope.kind === "album" && scope.id !== undefined && albumTracklist
          ? window.wave.artistPage.albumPlay(scope.id, albumSection.pick, null, shuffle)
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
  const openCollectionMenu = (
    target: CollectionTarget,
    title: string,
    at: MenuPoint,
    extra: readonly MenuItem[] = [],
  ) =>
    actions.openItems(
      text.desktopLibrary.songMenu(tagTitle(title, target.kind)),
      window.wave.collections
        .actions(target, { here, selectable: true })
        .then((about) => collections.itemsFor(target, about))
        .then((items) => [...items, ...extra]),
      at,
    );
  /** Sorts or arranges the Playlists list, then reads the window again. */
  const arrangePlaylists = (change: Promise<unknown>) =>
    void change.then(playback.refresh).catch(failed);
  /**
   * A playlist's Move Up and Move Down where the Playlists list shows it: in Custom only, and not
   * while a Find hides some of its neighbours.
   */
  const playlistMoves = (playlistId: number): readonly MenuItem[] => {
    const ids = playlistList?.sort === "custom" && activeFind === undefined ? playlistList.ids : [];
    const at = ids.indexOf(playlistId);
    if (at === -1) return [];
    // From the list as it is when chosen, not as the menu found it.
    const step = (by: number) => () =>
      arrangePlaylists(
        window.wave.playlists
          .listView()
          .then((view) =>
            window.wave.playlists.moveInList(playlistId, view.ids.indexOf(playlistId) + by),
          ),
      );
    return [
      ...(at > 0 ? [{ key: "move-up", label: text.playlists.moveUp, run: step(-1) }] : []),
      ...(at < ids.length - 1
        ? [{ key: "move-down", label: text.playlists.moveDown, run: step(1) }]
        : []),
    ];
  };
  /**
   * The Playlists page's rows drag into place in Custom, and not while playlists are checked or a
   * Find narrows the list (a place among the rows found isn't one in the whole list).
   */
  const reorderPlaylists =
    route.kind === "playlists" &&
    playlistList?.sort === "custom" &&
    picks === undefined &&
    activeFind === undefined
      ? (row: BrowseRow, to: number) =>
          arrangePlaylists(window.wave.playlists.moveInList(row.id, to))
      : undefined;
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
        : route.kind === "history"
          ? text.settings.pages.history
          : route.kind === "homeSeeAll"
            ? homeSectionTitle(route.section, text)
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
  /** A songs table in its page: a playlist's, with its Recommended songs below, or an artist's. */
  const listPage = (table: ReactNode) =>
    playlistId !== undefined && ytMusic ? (
      <PlaylistSuggestionsPage
        playlistId={playlistId}
        songs={hero?.count ?? 0}
        sources={`${scan?.revision}:${account?.revision}:${playlistEdits.edits}`}
        onError={failed}
      >
        {table}
      </PlaylistSuggestionsPage>
    ) : (
      artistPage(table)
    );
  const albumSection = useAlbumSection(
    route.kind === "album" ? route.id : undefined,
    ytMusic,
    revision,
    failed,
  );
  /** With Online, the album's whole tracklist, its release's other songs among the Library's. */
  const albumTracklist = albumSection.view?.toggle === "online" ? albumSection.view.tracks : null;
  /** The album's release, once read with Online: its Download in the hero. */
  const albumRelease = albumTracklist === null ? null : (albumSection.view?.release ?? null);
  /** An artist's songs table, inside their page's shelves and YouTube Music section. */
  const artistPage = (table: ReactNode) =>
    route.kind === "album" && route.id !== undefined && albumSection.view !== null ? (
      <AlbumPage
        section={albumSection}
        onPlay={(index) =>
          playback.run(window.wave.artistPage.albumPlay(route.id!, albumSection.pick, index, false))
        }
        onSongMenu={ytSongMenu}
      >
        {table}
      </AlbumPage>
    ) : route.kind === "artist" && route.id !== undefined ? (
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
          {field === "" && (
            <button
              className="search-recognize"
              aria-label={text.playbackText.recognizeSong}
              title={text.playbackText.recognizeSong}
              onClick={(event) => {
                event.preventDefault();
                setRecognizing(true);
              }}
            >
              <Icon name="microphone" size={16} />
            </button>
          )}
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
          <button
            className="nav-item"
            aria-label={text.settings.pages.history}
            title={text.settings.pages.history}
            aria-current={route.kind === "history" ? "page" : undefined}
            onClick={() => go({ kind: "history" })}
          >
            <Icon name="history" />
            <span>{text.settings.pages.history}</span>
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
              className={`nav-item ${playlistDrop.over === row.id ? "drop-over" : ""}`}
              aria-label={
                row.collaborative
                  ? `${row.title}, ${text.collaborativePage.libraryDetail(labels.songCount(row.count))}`
                  : row.title
              }
              title={row.title}
              aria-current={route.kind === "playlist" && route.id === row.id ? "page" : undefined}
              onClick={() => go({ kind: "playlist", id: row.id })}
              // The desktop adds nothing to a collaborative playlist, so it takes no drop.
              {...(row.collaborative
                ? {}
                : playlistDrop.props(row.id, (songs) => dropSongs(songs, { playlist: row.id })))}
              {...itemMenuEvents((at) =>
                openCollectionMenu(
                  { kind: "playlist", id: row.id },
                  row.title,
                  at,
                  playlistMoves(row.id),
                ),
              )}
            >
              <Icon name={row.collaborative ? "collaborative" : "playlist"} />
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
                  hero.collaborative
                    ? text.collaborativePage.libraryDetail(labels.songCount(hero.count))
                    : labels.songCount(albumTracklist?.length ?? hero.count),
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
                <button onClick={() => playList(true)} {...shuffleMenu}>
                  <Icon name="shuffle" size={16} />
                  {labels.shuffle}
                </button>
                {route.kind === "artist" && <ArtistToggle section={artistSection} />}
                {route.kind === "album" && <ArtistToggle section={albumSection} />}
                {route.kind === "artist" && (
                  <FollowButton
                    artist={{ name: hero.title }}
                    revision={account?.revision}
                    onError={setError}
                  />
                )}
                {albumRelease !== null && (
                  <YtListDownloadButton
                    list={{ kind: "album", id: albumRelease }}
                    onError={failed}
                  />
                )}
                {missingList !== undefined && albumRelease === null && (
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
              {findField}
            </div>
          </div>
        ) : route.kind === "ytArtist" ||
          route.kind === "ytAlbum" ||
          route.kind === "discoverMix" ? null : (
          <div className="page-heading">
            <h1>{title}</h1>
            {(route.kind === "home" || route.kind === "songs" || route.kind === "favorites") && (
              <p className="secondary" data-testid="song-count">
                {songCount !== undefined && labels.songCount(songCount)}
              </p>
            )}
            {/* Main plays the list as its table is sorted and found (browseTrackIds). */}
            {(route.kind === "songs" || route.kind === "favorites") && (songCount ?? 0) > 0 && (
              <div className="hero-actions">
                <button onClick={() => playList(false)}>
                  <Icon name="play" size={16} />
                  {labels.play}
                </button>
                <button onClick={() => playList(true)} {...shuffleMenu}>
                  <Icon name="shuffle" size={16} />
                  {labels.shuffle}
                </button>
              </div>
            )}
            {route.kind === "playlists" && (
              <p className="secondary" data-testid="playlist-count">
                {text.playlists.playlistCount(
                  activeFind === undefined
                    ? playlistTotal
                    : listed?.scope === scope
                      ? listed.total
                      : 0,
                )}
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
                <label className="playlist-sort">
                  <span className="secondary">{text.playlists.sortBy}</span>
                  <select
                    value={playlistList?.sort ?? "name"}
                    onChange={(event) =>
                      arrangePlaylists(
                        window.wave.playlists.sortList(
                          event.target.value as PlaylistListView["sort"],
                        ),
                      )
                    }
                  >
                    {PLAYLIST_SORTS.map(({ sort }) => (
                      <option key={sort} value={sort}>
                        {text.playlists.sorts[sort]}
                      </option>
                    ))}
                  </select>
                </label>
                <div
                  className="search-online-toggle artist-toggle"
                  role="group"
                  aria-label={text.playlists.showAs}
                >
                  {DESKTOP_PLAYLIST_LAYOUTS.map((layout) => (
                    <button
                      key={layout}
                      aria-pressed={(playlistList?.layout ?? "list") === layout}
                      onClick={() => {
                        setPlaylistList((view) => view && { ...view, layout });
                        arrangePlaylists(window.wave.playlists.showListAs(layout));
                      }}
                    >
                      <Icon name={layout === "list" ? "playlists" : "grid"} size={16} />
                      {text.playlists.layouts[layout]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {findField}
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
        {account?.bringYourMusic && (
          <BringYourMusic
            ytMusic={ytMusic}
            importing={bringing}
            onImport={(source) =>
              source === "spotify" ? playlistEdits.importFromSpotify() : importFromYtMusic()
            }
            onTurnOnYtMusic={turnOnYtMusic}
            onError={failed}
          />
        )}
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
              find={activeFind}
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
                  {key === "appearance"
                    ? text.settings.appearance
                    : key === "followedArtists"
                      ? text.settings.followedArtists
                      : labels[key]}
                </button>
              ))}
              <button onClick={() => go({ kind: "history" })}>{text.settings.pages.history}</button>
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
              ) : setting === "home" ? (
                <HomeSettings revision={revision} onError={failed} />
              ) : setting === "downloads" ? (
                <DownloadSettings onError={failed} />
              ) : setting === "followedArtists" ? (
                <FollowedArtistsSettings
                  revision={account?.revision}
                  notify={notify}
                  onError={(message) => setError(message ?? text.desktopLibrary.actionFailed)}
                  online={ytMusic}
                  onOpen={(artist) =>
                    artist.artistId !== null
                      ? go({ kind: "artist", id: artist.artistId })
                      : artist.ytBrowseId !== null
                        ? go({ kind: "ytArtist", id: artist.ytBrowseId })
                        : ytLinks.onArtist(artist.name)
                  }
                />
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
            onLibraryAlbum={(id) => go({ kind: "album", id })}
            onSongMenu={ytSongMenu}
            onError={setError}
          />
        ) : route.kind === "graveyard" ? (
          <Graveyard
            playlistId={route.id}
            revision={revision}
            changed={playback.refresh}
            failed={(message) => setError(message ?? text.desktopLibrary.actionFailed)}
            onPlay={(row) =>
              row.unavailable
                ? setError(text.desktopLibrary.driveDisconnected)
                : playback.run(window.wave.playlists.playGraveyard(route.id, row.itemId))
            }
            onMenu={(row, at, extra) =>
              row.videoId !== undefined
                ? actions.openItems(
                    text.desktopLibrary.songMenu(row.title),
                    streamed.items(row.videoId).then((items) => [...items, ...extra]),
                    at,
                  )
                : // Its own menu, without Select: the Graveyard selects nothing.
                  actions.openMenu(
                    { scope: { kind: "songs" }, ids: [row.id] },
                    row.title,
                    at,
                    extra,
                    {
                      done: () => {},
                    },
                  )
            }
          />
        ) : route.kind === "search" ? (
          <SearchPage
            query={route.query ?? ""}
            ytMusic={ytMusic}
            searchOnline={searchOnline}
            onlineLyrics={{
              access: geniusAccess(account),
              onSignIn: openGeniusSignIn,
              onOpen: rememberSearch,
            }}
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
            onRecap={openRecap}
            recapsOpened={recapsOpened}
            onError={failed}
            notify={notify}
            selectionFor={selectionFor}
            onCollectionMenu={openCollectionMenu}
            onMenu={(row, at) =>
              actions.openMenu({ scope: { kind: "songs" }, ids: [row.id] }, row.title, at)
            }
            onStreamedMenu={(row, at) =>
              actions.openItems(
                text.desktopLibrary.songMenu(row.title),
                streamed.items(row.videoId!),
                at,
              )
            }
            entry={route}
          />
        ) : route.kind === "homeSeeAll" ? (
          <HomeSeeAll route={route} revision={revision} go={go} onError={failed} />
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
            onRecap={openRecap}
            recapsOpened={recapsOpened}
            onMenu={(row, at) => {
              if (row.unavailable || row.outside) return;
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
        ) : route.kind === "history" ? (
          <ListeningHistory
            route={route}
            revision={revision}
            ytMusic={ytMusic}
            go={go}
            run={playback.run}
            onMenu={(row, at, extra) => {
              if (row.id > 0)
                actions.openMenu({ scope: { kind: "songs" }, ids: [row.id] }, row.title, at, extra);
              else if (row.videoId !== undefined || extra.length > 0)
                actions.openItems(
                  text.desktopLibrary.songMenu(row.title),
                  row.videoId === undefined
                    ? extra
                    : streamed.items(row.videoId).then((items) => [...items, ...extra]),
                  at,
                );
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
            {route.kind === "playlists" && playlistList?.layout === "grid" && !picks ? (
              <PlaylistGrid
                revision={revision}
                scope={scope}
                onTotal={setListed}
                onOpen={(row) => go({ kind: "playlist", id: row.id })}
                onMenu={(row, at) =>
                  openCollectionMenu(
                    { kind: "playlist", id: row.id },
                    row.title,
                    at,
                    playlistMoves(row.id),
                  )
                }
                onReorder={reorderPlaylists}
                onError={failed}
              />
            ) : (
              listPage(
                <VirtualTable
                  key={list}
                  scope={scope}
                  revision={revision}
                  onHero={setHero}
                  onSort={setShownSort}
                  onTotal={setListed}
                  // A playlist's rows drag to a new place only where it shows its own order.
                  onPlace={
                    !picks &&
                    scope.kind === "playlist" &&
                    scope.id !== undefined &&
                    shownSort?.key === "custom" &&
                    // A collaborative playlist's order is the members' to change, on a phone.
                    !hero?.collaborative
                      ? (target, before) => playlistEdits.place(scope.id!, target, before)
                      : undefined
                  }
                  onReorder={reorderPlaylists}
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
                              collectionKind === "playlist" ? playlistMoves(row.id) : [],
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
                            // Move Up and Move Down only where the playlist shows its own order.
                            // A collaborative playlist's order is the members' to change, on a phone.
                            scope.kind === "playlist" &&
                              scope.id !== undefined &&
                              shownSort?.key === "custom" &&
                              !hero?.collaborative
                              ? playlistEdits.moveItems(scope.id, row.id)
                              : [],
                          );
                        },
                      })}
                />,
              )
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
          onSongDrop={(songs, at) => dropSongs(songs, { queue: at })}
          shuffleMenu={shuffleMenu}
          notify={notify}
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
          notify={notify}
        />
      )}
      <PlayerBar
        playback={playback}
        panel={panel.tab && shownPanelTab(panel.tab, ytMusic)}
        onPanel={panel.toggle}
        onNowPlaying={() => setNowPlaying(true)}
        onMenu={playingMenu}
        shuffleMenu={shuffleMenu}
        links={ytLinks}
        onSongDrop={(songs) => dropSongs(songs, { queue: undefined })}
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
      {recognizing && (
        <Recognize
          onClose={() => setRecognizing(false)}
          onAlbum={(id) => {
            setNowPlaying(false);
            go({ kind: "album", id });
          }}
          onChanged={playback.refresh}
        />
      )}
      {recap && <RecapViewer recap={recap} onClose={closeRecap} notify={notify} />}
    </main>
  );
}
