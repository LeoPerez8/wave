import { sharedTextImport, confirmImportReplace } from "@wave/core";
import { useCallback, useEffect, useState } from "react";
import type { OpenLinkResult, CopyLinkResult } from "../../shared/links.ts";
import { ConfirmDialog, Toast, trapTab } from "./SongActions.tsx";
import { language, text } from "./text.ts";

import { COPIED, OPENED } from "./copyLink.ts";

const editing = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])") !==
    null;

/** Paste and drag are window commands; text fields keep their ordinary editing behavior. */
export function Links({
  onPlaying,
  onPlaylist,
  onSearch,
  onChanged,
}: {
  readonly onPlaying: () => void;
  readonly onPlaylist: (id: number) => void;
  readonly onSearch: (query: string) => void;
  readonly onChanged: () => void;
}) {
  const [opened, setOpened] = useState<Exclude<OpenLinkResult, { kind: "ignored" | "playing" }>>();
  const [toast, setToast] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState<{ token: string; name: string }>();
  const close = useCallback(() => setOpened(undefined), []);
  const hideToast = useCallback(() => setToast(undefined), []);
  useEffect(() => {
    let active = true;
    let request = 0;
    const open = (value: string) => {
      if (sharedTextImport(value, { ytMusic: true }).kind === "notice") return false;
      const serial = ++request;
      setOpened(undefined);
      setBusy(true);
      setToast(text.imports.findingSong);
      void window.wave.links
        .open(value)
        .then((result) => {
          if (!active || serial !== request) return;
          if (result.kind === "playing") onPlaying();
          else if (result.kind !== "ignored") setOpened(result);
        })
        .catch(() => {
          if (active && serial === request)
            setOpened({
              kind: "notice",
              notice: {
                title: text.imports.cantOpen,
                message: text.desktopLibrary.actionFailed,
              },
            });
        })
        .finally(() => {
          if (active && serial === request) {
            setBusy(false);
            setToast(undefined);
          }
        });
      return true;
    };
    const paste = (event: ClipboardEvent) => {
      if (editing(event.target) || editing(document.activeElement)) return;
      if (open(event.clipboardData?.getData("text/plain") ?? "")) event.preventDefault();
    };
    const drag = (event: DragEvent) => {
      if (editing(event.target)) return;
      if (
        event.dataTransfer?.types.some((type) => type === "text/uri-list" || type === "text/plain")
      )
        event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      // A drop a list already took (reordering the Queue) is not a link.
      if (event.defaultPrevented || editing(event.target)) return;
      event.preventDefault();
      const uri = event.dataTransfer
        ?.getData("text/uri-list")
        .split(/\r?\n/)
        .find((line) => line.trim() !== "" && !line.startsWith("#"));
      open(uri ?? event.dataTransfer?.getData("text/plain") ?? "");
    };
    const copied = (event: Event) => {
      const result = (event as CustomEvent<CopyLinkResult>).detail;
      if (result.kind === "copied") setToast(result.message);
      else setOpened({ kind: "notice", notice: result.notice });
    };
    document.addEventListener("paste", paste);
    document.addEventListener("dragover", drag);
    document.addEventListener("drop", drop);
    const asked = (event: Event) => void open((event as CustomEvent<string>).detail);
    document.addEventListener(COPIED, copied);
    document.addEventListener(OPENED, asked);
    return () => {
      active = false;
      document.removeEventListener("paste", paste);
      document.removeEventListener("dragover", drag);
      document.removeEventListener("drop", drop);
      document.removeEventListener(COPIED, copied);
      document.removeEventListener(OPENED, asked);
    };
  }, [onPlaying]);
  const save = async (token: string, replace: boolean) => {
    setBusy(true);
    try {
      const saved = await window.wave.links.importPlaylist(token, replace);
      close();
      onChanged();
      onPlaylist(saved.playlistId);
    } catch {
      setOpened({
        kind: "notice",
        notice: {
          title: text.imports.couldntImportPlaylist,
          message: text.desktopLibrary.actionFailed,
        },
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {toast && <Toast message={toast} onDone={hideToast} />}
      {opened?.kind === "notice" && <ConfirmDialog spec={opened.notice} onChoose={close} />}
      {opened?.kind === "notFound" && (
        <ConfirmDialog
          spec={{
            title: opened.song.heading,
            message: `${opened.song.title} · ${opened.song.artists}`,
            dismissLabel: text.imports.cancel,
            action: { label: text.tabs.search },
          }}
          onChoose={(yes) => {
            if (yes && opened.song.searchQuery) onSearch(opened.song.searchQuery);
            close();
          }}
        />
      )}
      {opened?.kind === "playlist" && (
        <div className="dialog-backdrop" onClick={close}>
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={text.imports.importPlaylist}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                close();
              } else trapTab(event);
            }}
          >
            <h2>{opened.view.name ?? text.imports.importPlaylist}</h2>
            <p>{opened.view.line}</p>
            {opened.view.source && <p className="secondary">{opened.view.source}</p>}
            {opened.view.note && <p className="secondary">{opened.view.note}</p>}
            <div className="dialog-buttons">
              <button autoFocus onClick={close}>
                {text.imports.cancel}
              </button>
              <button
                className="accent"
                disabled={busy || !opened.view.canImport}
                onClick={() => {
                  void window.wave.library.browse({ kind: "playlists" }, 0, 200).then((page) => {
                    // A collaborative playlist is never replaced: the import keeps both.
                    const clash = page.items.find(
                      (row) =>
                        !row.collaborative &&
                        row.title.toLocaleLowerCase() === opened.view.name?.toLocaleLowerCase(),
                    );
                    if (clash) setReplace({ token: opened.token, name: clash.title });
                    else void save(opened.token, false);
                  });
                }}
              >
                {text.imports.import}
              </button>
            </div>
          </div>
        </div>
      )}
      {replace && (
        <ConfirmDialog
          spec={confirmImportReplace(replace.name, language)}
          onChoose={(yes) => {
            const token = replace.token;
            setReplace(undefined);
            void save(token, yes);
          }}
        />
      )}
    </>
  );
}
