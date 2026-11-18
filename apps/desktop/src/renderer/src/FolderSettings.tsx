import { useEffect, useState, type ButtonHTMLAttributes } from "react";
import type { Page } from "../../shared/bridge.ts";
import type { DesktopFolder } from "../../shared/library.ts";
import { text } from "./text.ts";
const PAGE_SIZE = 100;
function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} />;
}
export function FolderSettings({
  revision,
  scanning,
  onError,
}: {
  readonly revision: number;
  readonly scanning: boolean;
  readonly onError: () => void;
}) {
  const [roots, setRoots] = useState<Page<DesktopFolder>>();
  const [exclusions, setExclusions] = useState<Page<string>>();
  const [rootOffset, setRootOffset] = useState(0);
  const [excludedOffset, setExcludedOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(0);
  useEffect(() => {
    let live = true;
    void Promise.all([
      window.wave.library.roots(rootOffset, PAGE_SIZE),
      window.wave.library.exclusions(excludedOffset, PAGE_SIZE),
    ])
      .then(([r, e]) => {
        if (live) {
          setRoots(r);
          setExclusions(e);
        }
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [revision, rootOffset, excludedOffset, updated, onError]);
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
      setUpdated((n) => n + 1);
    } catch {
      onError();
    } finally {
      setBusy(false);
    }
  };
  return (
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
