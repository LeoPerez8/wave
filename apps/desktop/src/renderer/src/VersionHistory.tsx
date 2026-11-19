import { useEffect, useState } from "react";
import { versionHistoryEntries } from "@wave/core";
import { VERSION_HISTORY_PAGE_SIZE, type DesktopVersionHistory } from "../../shared/bridge.ts";
import { Pager } from "./Pager.tsx";
import { language, text } from "./text.ts";

export function VersionHistory() {
  const [history, setHistory] = useState<DesktopVersionHistory>();
  const [failed, setFailed] = useState(false);
  const [request, setRequest] = useState({ offset: 0, reload: true });
  useEffect(() => {
    let active = true;
    void window.wave.settings.versionHistory(request.offset, request.reload).then(
      (answer) => {
        if (active) setHistory(answer);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [request]);
  const labels = text.versionHistory;
  const page = history?.releases;
  const entries =
    page && history?.channel
      ? versionHistoryEntries({
          releases: page.items,
          runningVersion: history.version,
          channel: history.channel,
          language,
        })
      : [];
  return (
    <>
      <h2>{text.settings.pages.versionHistory}</h2>
      {history && !history.currentListed && (
        <p>
          {history.version} <small>{labels.current}</small>
        </p>
      )}
      {failed || history?.releases === null ? (
        <>
          <p role="status">{labels.failed}</p>
          <button
            onClick={() => {
              setHistory(undefined);
              setFailed(false);
              setRequest({ offset: 0, reload: true });
            }}
          >
            {labels.tryAgain}
          </button>
        </>
      ) : history && entries.length === 0 ? (
        <p>{labels.empty}</p>
      ) : (
        entries.map((entry) => (
          <article key={entry.version}>
            <h3>
              {entry.version} {entry.current && <small>{labels.current}</small>}
            </h3>
            {entry.date && <p className="secondary">{entry.date}</p>}
            {entry.sections.map(({ title, lines }) => (
              <section key={title}>
                <h4>{title}</h4>
                <ul>
                  {lines.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              </section>
            ))}
          </article>
        ))
      )}
      {!failed && page && (
        <Pager
          page={page}
          pageSize={VERSION_HISTORY_PAGE_SIZE}
          previous={() =>
            setRequest({
              offset: Math.max(0, page.offset - VERSION_HISTORY_PAGE_SIZE),
              reload: false,
            })
          }
          next={() =>
            setRequest({
              offset: page.offset + VERSION_HISTORY_PAGE_SIZE,
              reload: false,
            })
          }
        />
      )}
    </>
  );
}
