import type { LibraryCounts } from "@wave/client/db/counts";
import { catalogueOf, resolveAppLanguage } from "@wave/core";
import { useEffect, useState, type ButtonHTMLAttributes } from "react";
import type { Page } from "../../shared/bridge.ts";
import type { DesktopFolder, DesktopSong, ScanStatus } from "../../shared/library.ts";

const text = catalogueOf(resolveAppLanguage(navigator.languages), "desktop");
const PAGE_SIZE = 100;

function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="rounded-md px-3 py-2 text-sm hover:bg-fill focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
    />
  );
}

function FolderIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <path d="M3 7V5h6l2 2h10v13H3V7Z" />
      <path d="M3 10h18" />
    </svg>
  );
}

export function App() {
  const [view, setView] = useState<"home" | "library" | "settings">("home");
  const [counts, setCounts] = useState<LibraryCounts>();
  const [scan, setScan] = useState<ScanStatus>();
  const [songs, setSongs] = useState<Page<DesktopSong>>();
  const [roots, setRoots] = useState<Page<DesktopFolder>>();
  const [exclusions, setExclusions] = useState<Page<string>>();
  const [offset, setOffset] = useState(0);
  const [rootOffset, setRootOffset] = useState(0);
  const [excludedOffset, setExcludedOffset] = useState(0);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    let reading = false;
    let revision = -1;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      clearTimeout(timer);
      if (!current || reading || document.hidden || !document.hasFocus()) return;
      reading = true;
      try {
        const next = await window.wave.library.scanStatus();
        if (!current) return;
        setScan((previous) =>
          previous?.status === next.status &&
          previous.revision === next.revision &&
          previous.filesFound === next.filesFound &&
          previous.filesRead === next.filesRead &&
          previous.filesUnchanged === next.filesUnchanged
            ? previous
            : next,
        );
        if (next.revision !== revision) {
          const [nextCounts, nextSongs, nextRoots, nextExcluded] = await Promise.all([
            window.wave.library.counts(),
            view === "settings" ? undefined : window.wave.library.songs(offset, PAGE_SIZE),
            view === "settings" ? window.wave.library.roots(rootOffset, PAGE_SIZE) : undefined,
            view === "settings"
              ? window.wave.library.exclusions(excludedOffset, PAGE_SIZE)
              : undefined,
          ]);
          if (!current) return;
          revision = next.revision;
          setCounts(nextCounts);
          if (nextSongs !== undefined) setSongs(nextSongs);
          if (nextRoots !== undefined) setRoots(nextRoots);
          if (nextExcluded !== undefined) setExclusions(nextExcluded);
          if (nextSongs !== undefined && offset >= nextSongs.total && offset > 0)
            setOffset(Math.max(0, Math.ceil(nextSongs.total / PAGE_SIZE) - 1) * PAGE_SIZE);
        }
      } catch {
        if (current) setError(text.desktopLibrary.actionFailed);
      } finally {
        reading = false;
        if (current)
          timer = setTimeout(() => {
            void poll();
          }, 300);
      }
    };
    const wake = () => {
      revision = -1;
      void poll();
    };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [offset, rootOffset, excludedOffset, view]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "F5") {
        event.preventDefault();
        void window.wave.library.refresh().catch(() => setError(text.desktopLibrary.actionFailed));
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    try {
      await run();
    } catch {
      setError(text.desktopLibrary.actionFailed);
    } finally {
      setBusy(false);
    }
  };
  const play = (song: DesktopSong) => {
    if (song.unavailable) {
      setError(text.desktopLibrary.driveDisconnected);
      return;
    }
    if (song.path !== null)
      void act(async () => {
        await window.wave.player.load(song.path!);
        await window.wave.player.play();
      });
  };
  const scanning = scan?.status === "scanning";
  return (
    <main className="min-h-screen bg-background font-sans text-foreground">
      <header className="flex items-center justify-between border-b border-separator px-8 py-4">
        <nav className="flex gap-2" aria-label={text.tabs.library}>
          <Button aria-pressed={view === "home"} onClick={() => setView("home")}>
            {text.tabs.index}
          </Button>
          <Button aria-pressed={view === "library"} onClick={() => setView("library")}>
            {text.tabs.library}
          </Button>
          <Button aria-pressed={view === "settings"} onClick={() => setView("settings")}>
            {text.home.settings}
          </Button>
        </nav>
        <Button
          onClick={() => {
            void act(window.wave.library.refresh);
          }}
        >
          {text.desktopLibrary.refresh} <kbd>{text.desktopLibrary.refreshKey}</kbd>
        </Button>
      </header>
      <div className="mx-auto max-w-6xl px-8 py-8">
        <h1 className="text-3xl font-semibold">
          {view === "home"
            ? text.tabs.index
            : view === "library"
              ? text.tabs.library
              : text.home.settings}
        </h1>
        {counts !== undefined && (
          <p className="mt-1 text-secondary" data-testid="song-count">
            {text.library.songCount(counts.songs)}
          </p>
        )}
        {scanning && (
          <div className="my-5 max-w-xl" role="status" data-testid="scan-progress">
            <p className="text-sm">
              {scan.phase === "discovering"
                ? text.library.lookingForMusic
                : text.settings.indexedFiles(
                    String(scan.filesRead + scan.filesUnchanged),
                    String(scan.filesFound),
                  )}
            </p>
            <progress
              aria-label={text.settings.scanning}
              className="mt-2 w-full accent-accent"
              max={Math.max(1, scan.filesFound)}
              value={
                scan.phase === "discovering" ? undefined : scan.filesRead + scan.filesUnchanged
              }
            />
            <p className="text-sm text-secondary">
              {text.settings.foundFiles(String(scan.filesFound), scan.filesFound)}
            </p>
          </div>
        )}
        {(error !== undefined || scan?.status === "failed") && (
          <p role="alert" className="my-4 text-destructive">
            {error ?? text.settings.couldntScanYourMusic}
          </p>
        )}
        {view === "settings" ? (
          <div className="mt-8 max-w-3xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{text.settings.musicFolders}</h2>
              <Button
                disabled={busy || scanning}
                onClick={() => {
                  void act(window.wave.library.addRoot);
                }}
              >
                {text.settings.addFolder}
              </Button>
            </div>
            <ul className="divide-y divide-separator">
              {roots?.items.map((root) => (
                <li key={root.path} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="break-all text-sm">{root.path}</p>
                    <p className="text-sm text-secondary">
                      {root.available
                        ? text.library.songCount(root.trackCount)
                        : text.desktopLibrary.unavailableFolder}
                    </p>
                  </div>
                  <Button
                    aria-label={text.settings.removeFolder(root.path)}
                    disabled={busy || scanning || roots.total <= 1}
                    onClick={() => {
                      void act(() => window.wave.library.removeRoot(root.path));
                    }}
                  >
                    {text.itemActions.remove}
                  </Button>
                </li>
              ))}
            </ul>
            <Pager
              page={roots}
              previous={() => setRootOffset(Math.max(0, rootOffset - PAGE_SIZE))}
              next={() => setRootOffset(rootOffset + PAGE_SIZE)}
            />
            <div className="mt-8 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{text.settings.waveIgnores}</h2>
              <Button
                disabled={busy || scanning}
                onClick={() => {
                  void act(window.wave.library.exclude);
                }}
              >
                {text.settings.excludeFolder}
              </Button>
            </div>
            <ul className="divide-y divide-separator">
              {exclusions?.items.map((path) => (
                <li key={path} className="flex items-center justify-between gap-4 py-3">
                  <p className="min-w-0 break-all text-sm">{path}</p>
                  <Button
                    disabled={busy || scanning}
                    onClick={() => {
                      void act(() => window.wave.library.include(path));
                    }}
                  >
                    {text.settings.stopExcluding}
                  </Button>
                </li>
              ))}
            </ul>
            <Pager
              page={exclusions}
              previous={() => setExcludedOffset(Math.max(0, excludedOffset - PAGE_SIZE))}
              next={() => setExcludedOffset(excludedOffset + PAGE_SIZE)}
            />
          </div>
        ) : (
          <div className="mt-6">
            {songs?.total === 0 ? (
              <p className="py-10 text-secondary">
                {scanning ? text.library.songsAppearAsFound : text.library.sectionEmpty.songs}
              </p>
            ) : (
              <table className="w-full table-fixed text-left text-sm">
                <thead className="border-b border-separator text-secondary">
                  <tr>
                    <th className="w-1/2 py-2 font-normal">{text.desktopLibrary.titleColumn}</th>
                    <th className="font-normal">{text.desktopLibrary.artistColumn}</th>
                    <th className="hidden font-normal lg:table-cell">
                      {text.desktopLibrary.albumColumn}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {songs?.items.map((song) => (
                    <tr
                      key={song.id}
                      tabIndex={0}
                      aria-disabled={song.unavailable || song.path === null}
                      title={song.unavailable ? text.desktopLibrary.unavailableFolder : undefined}
                      onDoubleClick={() => play(song)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") play(song);
                      }}
                      className="h-10 border-b border-separator hover:bg-fill focus-visible:bg-fill focus-visible:outline-2 focus-visible:outline-accent aria-disabled:text-secondary"
                    >
                      <td className="pr-4">
                        <div className="flex items-center gap-2">
                          {song.unavailable && <FolderIcon />}
                          <span className="truncate">{song.title}</span>
                        </div>
                      </td>
                      <td className="truncate pr-4">{song.artist}</td>
                      <td className="hidden truncate lg:table-cell">{song.album}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Pager
              page={songs}
              previous={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              next={() => setOffset(offset + PAGE_SIZE)}
            />
          </div>
        )}
      </div>
    </main>
  );
}

function Pager({
  page,
  previous,
  next,
}: {
  readonly page:
    | { readonly offset: number; readonly total: number; readonly items: readonly unknown[] }
    | undefined;
  readonly previous: () => void;
  readonly next: () => void;
}) {
  if (page === undefined || page.total <= PAGE_SIZE) return null;
  return (
    <div className="mt-4 flex items-center justify-end gap-3 text-sm text-secondary">
      <Button disabled={page.offset === 0} onClick={previous}>
        {text.desktopLibrary.previous}
      </Button>
      <span className="tabular-nums">
        {text.desktopLibrary.page(page.offset + 1, page.offset + page.items.length, page.total)}
      </span>
      <Button disabled={page.offset + page.items.length >= page.total} onClick={next}>
        {text.desktopLibrary.next}
      </Button>
    </div>
  );
}
