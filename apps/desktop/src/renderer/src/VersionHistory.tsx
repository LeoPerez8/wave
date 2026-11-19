import { useEffect, useState } from "react";
import { versionHistoryEntries } from "@wave/core";
import type { DesktopVersionHistory } from "../../shared/bridge.ts";
import { language, text } from "./text.ts";

export function VersionHistory() {
  const [history, setHistory] = useState<DesktopVersionHistory>();
  const [failed, setFailed] = useState(false);
  const [attempt, retry] = useState(0);
  useEffect(() => {
    let active = true;
    void window.wave.settings.versionHistory().then(
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
  }, [attempt]);
  const labels = text.versionHistory;
  const entries =
    history?.releases && history.channel
      ? versionHistoryEntries({
          releases: history.releases,
          runningVersion: history.version,
          channel: history.channel,
          language,
        })
      : [];
  return (
    <>
      <h2>{text.settings.pages.versionHistory}</h2>
      {history && !entries.some((entry) => entry.current) && (
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
              retry(attempt + 1);
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
    </>
  );
}
