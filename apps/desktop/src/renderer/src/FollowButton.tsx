/**
 * An artist page's Follow button (docs/spec.md, Followed Artists): Follow or Following, opening
 * a card with the levels New music and New music and shows, and Unfollow once followed. Which
 * levels are offered is Core's (`followLevelEntries`). With Followed artists off in Settings the
 * button isn't there and nothing is read.
 */
import { followLevelEntries, type FollowLevel } from "@wave/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { FollowState, FollowTargetInput } from "../../shared/follows.ts";
import { text } from "./text.ts";
import "./follows.css";

/** [artist]'s follow, read again when [revision] moves (the account changed it); undefined until read. */
const useFollowState = (name: string, revision: unknown) => {
  const [read, setRead] = useState<{ name: string; state: FollowState }>();
  useEffect(() => {
    if (name.trim() === "") return;
    let current = true;
    void window.wave.follows
      .state(name)
      .then((state) => {
        if (current) setRead({ name, state });
      })
      // A button that can't be read isn't offered.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [name, revision]);
  const set = useCallback((state: FollowState) => setRead({ name, state }), [name]);
  return [read?.name === name ? read.state : undefined, set] as const;
};

/** The level card under [at]; Esc or a click outside closes it. */
function FollowCard({
  artist,
  state,
  at,
  onChoose,
  onClose,
}: {
  readonly artist: string;
  readonly state: FollowState;
  readonly at: DOMRect;
  readonly onChoose: (level: FollowLevel | null) => void;
  readonly onClose: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const options = card.current?.querySelectorAll<HTMLElement>("input, button");
    const checked = card.current?.querySelector<HTMLElement>("input:checked");
    (checked ?? options?.[0])?.focus();
  }, []);
  const entries = followLevelEntries(state.level, {
    showsAvailable: state.showsAvailable,
    country: state.country,
    strings: text,
  });
  return (
    <>
      <div className="menu-backdrop" onMouseDown={onClose} />
      <div
        ref={card}
        className="follow-card"
        role="dialog"
        aria-label={text.library.followArtist(artist)}
        style={{
          top: Math.min(at.bottom + 6, innerHeight - 220),
          left: Math.max(8, Math.min(at.left, innerWidth - 288)),
        }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <h2>{artist}</h2>
        <div role="radiogroup" aria-label={text.library.followArtist(artist)}>
          {entries.map((entry) =>
            entry.action === "unfollow" ? null : (
              <label key={entry.action} className="follow-level">
                <input
                  type="radio"
                  name="follow-level"
                  checked={entry.checked}
                  onChange={() => onChoose(entry.action as FollowLevel)}
                  onClick={() => entry.checked && onClose()}
                />
                <span>{entry.label}</span>
              </label>
            ),
          )}
        </div>
        {state.signInForShows && <p className="secondary">{text.shows.signInForShows}</p>}
        {state.level !== null && (
          <button className="destructive" onClick={() => onChoose(null)}>
            {text.library.unfollow}
          </button>
        )}
      </div>
    </>
  );
}

export function FollowButton({
  artist,
  revision,
  onError,
}: {
  readonly artist: FollowTargetInput;
  /** Moves when the account's follows may have changed. */
  readonly revision?: unknown;
  /** Shows that following or unfollowing didn't work. */
  readonly onError: (message: string) => void;
}) {
  const [state, setState] = useFollowState(artist.name, revision);
  const [at, setAt] = useState<DOMRect | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setAt(null);
    button.current?.focus();
  }, []);
  if (state === undefined || !state.enabled) return null;
  const choose = (level: FollowLevel | null) => {
    close();
    void window.wave.follows
      .set(artist, level)
      .then(setState)
      .catch(() =>
        onError(level === null ? text.library.couldntUnfollow : text.library.couldntFollow),
      );
  };
  const levelName =
    state.level === null ? null : state.level === "shows" ? text.shows.level : text.shows.releases;
  return (
    <>
      <button
        ref={button}
        className="follow-button"
        data-testid="follow-button"
        aria-label={text.library.followState(artist.name, levelName)}
        aria-haspopup="dialog"
        aria-expanded={at !== null}
        aria-pressed={state.level !== null}
        title={levelName ?? undefined}
        onClick={() => setAt(button.current!.getBoundingClientRect())}
      >
        {state.level === null ? text.library.follow : text.library.following}
      </button>
      {at !== null && (
        <FollowCard artist={artist.name} state={state} at={at} onChoose={choose} onClose={close} />
      )}
    </>
  );
}
