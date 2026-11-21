import { useState } from "react";
import { text } from "./text.ts";

/** Where Bring your music imports from. */
export type MusicSource = "spotify" | "ytMusic";

const SOURCES: readonly MusicSource[] = ["spotify", "ytMusic"];

/**
 * First run's Bring your music card, after the invitation to sign in: From Spotify and From YT
 * Music, or Turn On YT Music while it is off. Not Now, Continue and Escape answer it for good
 * on this computer; closing Wave without answering shows it again on the next start.
 */
export function BringYourMusic({
  ytMusic,
  importing,
  onImport,
  onTurnOnYtMusic,
  onError,
}: {
  readonly ytMusic: boolean;
  /** The sources an import started from in this launch. */
  readonly importing: ReadonlySet<MusicSource>;
  readonly onImport: (source: MusicSource) => void;
  readonly onTurnOnYtMusic: () => void;
  readonly onError: () => void;
}) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const card = text.settings.bringYourMusic;
  const answer = () => {
    setOpen(false);
    void window.wave.account.answerBringYourMusic().catch(onError);
  };
  return (
    <aside
      className="invitation"
      aria-labelledby="bring-your-music-title"
      data-testid="bring-your-music"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        answer();
      }}
    >
      <h2 id="bring-your-music-title">{card.title}</h2>
      <p className="secondary">{card.line}</p>
      {ytMusic ? (
        <ul className="bring-your-music-sources">
          {SOURCES.map((source) => (
            <li key={source}>
              <button onClick={() => onImport(source)}>
                {source === "spotify" ? text.imports.fromSpotify : text.imports.fromYtMusic}
              </button>
              {importing.has(source) && (
                <span className="secondary" role="status" data-testid={`importing-${source}`}>
                  {text.settings.importing}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p className="secondary">{card.needsYtMusic}</p>
          <div className="account-actions">
            <button onClick={onTurnOnYtMusic}>{card.turnOnYtMusic}</button>
          </div>
        </>
      )}
      <div className="account-actions">
        <button onClick={answer}>{text.settings.signInInvitation.notNow}</button>
        {importing.size > 0 && <button onClick={answer}>{text.imports.continue}</button>}
      </div>
    </aside>
  );
}
