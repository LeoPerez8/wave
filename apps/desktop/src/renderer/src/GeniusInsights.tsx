import { geniusSection, type GeniusReferent } from "@wave/core";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { text } from "./text.ts";
import type { useSongGenius } from "./useSongGenius.ts";

type GeniusState = ReturnType<typeof useSongGenius>["state"];

export function GeniusAbout({
  state,
  onRetry,
  onSignIn,
}: {
  readonly state: GeniusState;
  readonly onRetry: () => void;
  readonly onSignIn: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const description = useId();
  const words = text.playbackText;
  switch (state.kind) {
    case "hidden":
      return null;
    case "loading":
      return state.showNote ? (
        <div className="genius-note" role="status">
          <span className="genius-spinner" aria-hidden="true" />
          {words.loadingGeniusInsights}
        </div>
      ) : null;
    case "miss":
      return (
        <p className="genius-note" role="status">
          {words.geniusHasNoInsightsForThisSong}
        </p>
      );
    case "failed":
      return (
        <div className="genius-note" role="status">
          <span>{words.couldntLoadGeniusInsights}</span>
          <button className="text-button" onClick={onRetry}>
            {words.tryAgain}
          </button>
        </div>
      );
    case "signIn":
      return (
        <div className="genius-note">
          <span>{words.signInToSeeWhatGeniusSaysAboutThisSong}</span>
          <button className="text-button" onClick={onSignIn}>
            {text.settings.signIn}
          </button>
        </div>
      );
    case "answer":
      return state.about === null ? null : (
        <button
          className="genius-about"
          aria-label={words.aboutGenius}
          aria-expanded={expanded}
          aria-controls={description}
          onClick={() => setExpanded(!expanded)}
        >
          <span className="genius-card-heading">{words.aboutGenius}</span>
          <span id={description} className={`genius-copy${expanded ? "" : " genius-clamped"}`}>
            {state.about}
          </span>
        </button>
      );
  }
}

const explained = (fragment: string): string =>
  geniusSection(fragment) ?? `“${fragment.trim().replace(/\s*\n\s*/g, " / ")}”`;

export function MoreInsights({
  referents,
  onOpen,
}: {
  readonly referents: readonly GeniusReferent[];
  readonly onOpen: (id: number) => void;
}) {
  if (referents.length === 0) return null;
  return (
    <section className="genius-more">
      <h2>{text.playbackText.moreInsights}</h2>
      {referents.map(({ id, fragment, annotations }) => (
        <button key={id} onClick={() => onOpen(id)}>
          <span className="genius-card-heading">{explained(fragment)}</span>
          <span className="genius-copy genius-clamped">{annotations[0]?.text}</span>
        </button>
      ))}
    </section>
  );
}

export function GeniusAnnotations({
  referents,
  onClose,
}: {
  readonly referents: readonly GeniusReferent[];
  readonly onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  const words = text.playbackText;
  return (
    <dialog
      ref={dialog}
      className="dialog genius-annotations"
      aria-label={words.annotationOn(
        referents.map(({ fragment }) => explained(fragment)).join(", "),
      )}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <h2>{text.settings.geniusInsights}</h2>
      <div className="genius-annotation-content">
        {referents.map(({ id, fragment, annotations }) => (
          <section key={id}>
            <h3>{explained(fragment)}</h3>
            {annotations.map((annotation, index) => (
              <div key={index}>
                {annotation.state === "pending" && <p className="secondary">{words.unreviewed}</p>}
                <p className="genius-copy">{annotation.text}</p>
                {annotation.authors.length > 0 && (
                  <p className="secondary">{words.byAuthors(annotation.authors)}</p>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
      <div className="dialog-buttons">
        <button onClick={onClose}>{words.done}</button>
      </div>
    </dialog>
  );
}
