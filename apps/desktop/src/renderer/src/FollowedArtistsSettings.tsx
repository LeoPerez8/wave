/**
 * Settings › Followed artists (docs/spec.md, Followed Artists): the account's switch, the country
 * shows are looked up in, Find artists to follow, and the artists followed A to Z with their
 * level and Unfollow. A level changes at once; Unfollow shows a toast with Undo.
 */
import { SHOW_COUNTRY_CODES, followLevelEntries, followSearchLine } from "@wave/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  FollowLevels,
  FollowSearchResult,
  FollowSearchView,
  FollowTargetInput,
  FollowedArtistRow,
  FollowedArtistsView,
} from "../../shared/follows.ts";
import { text, useLanguage } from "./text.ts";
import "./follows.css";

/** How long typing rests before Deezer is asked, as on the phone. */
const SEARCH_PAUSE_MS = 350;

/** An artist a row names, for opening their page. */
export type FollowedArtistPage = Pick<FollowedArtistRow, "name" | "artistId" | "ytBrowseId">;

/** Every country named in the app's language, sorted by that name. */
const useCountries = () => {
  const { language } = useLanguage();
  return useMemo(() => {
    const names = new Intl.DisplayNames([language], { type: "region" });
    return SHOW_COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
      a.name.localeCompare(b.name, language),
    );
  }, [language]);
};

/** One artist: their name (a link to their page when [onOpen] is given), level and Unfollow. */
function ArtistRow({
  artist,
  level,
  levels,
  onOpen,
  onLevel,
  onUnfollow,
}: {
  readonly artist: FollowedArtistPage;
  readonly level: FollowedArtistRow["level"] | null;
  readonly levels: FollowLevels;
  readonly onOpen: (() => void) | undefined;
  readonly onLevel: (level: FollowedArtistRow["level"]) => void;
  readonly onUnfollow: (() => void) | undefined;
}) {
  // Off, a follow is listed and nothing about it can change.
  const off = !levels.enabled;
  const entries = followLevelEntries(level, {
    showsAvailable: levels.showsAvailable,
    country: levels.country,
    strings: text,
  }).filter((entry) => entry.action !== "unfollow");
  return (
    <li className="follow-row">
      {onOpen === undefined ? (
        <span className="follow-name truncate">{artist.name}</span>
      ) : (
        <button
          className="follow-name truncate"
          aria-label={text.library.artistLabel(artist.name)}
          onClick={onOpen}
        >
          {artist.name}
        </button>
      )}
      <select
        aria-label={text.library.followArtist(artist.name)}
        value={level ?? ""}
        disabled={off}
        onChange={(event) => onLevel(event.target.value as FollowedArtistRow["level"])}
      >
        {level === null && <option value="">{text.library.follow}</option>}
        {entries.map((entry) => (
          <option key={entry.action} value={entry.action}>
            {entry.label}
          </option>
        ))}
      </select>
      {onUnfollow !== undefined && (
        <button
          className="destructive"
          aria-label={text.shows.iconFor(text.library.unfollow, artist.name)}
          onClick={onUnfollow}
        >
          {text.library.unfollow}
        </button>
      )}
    </li>
  );
}

export function FollowedArtistsSettings({
  revision,
  notify,
  onError,
  onOpen,
  online,
}: {
  /** Moves when the account's follows or switch may have changed. */
  readonly revision: unknown;
  /** Shows the window's toast, with Undo. */
  readonly notify: (message: string, undo?: () => void) => void;
  readonly onError: (message?: string) => void;
  readonly onOpen: (artist: FollowedArtistPage) => void;
  /** Whether an artist the Library lacks has a page to open (YT Music is on). */
  readonly online: boolean;
}) {
  const [view, setView] = useState<FollowedArtistsView>();
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<{ query: string; found: FollowSearchView }>();
  /** Goes up with every follow change, so the search's rows read their levels again. */
  const [changes, setChanges] = useState(0);
  /** The search last answered: asked again after a follow change, it doesn't wait. */
  const answered = useRef<string>(undefined);
  const countries = useCountries();
  const read = useCallback(
    () =>
      window.wave.follows
        .view()
        .then(setView)
        .catch(() => onError(text.library.couldntReadFollows)),
    [onError],
  );
  useEffect(() => {
    void read();
  }, [read, revision]);

  const searched = query.trim();
  const enabled = view?.enabled ?? false;
  useEffect(() => {
    if (searched === "" || !enabled) return;
    let current = true;
    const pause = setTimeout(
      () =>
        void window.wave.follows
          .search(searched)
          .catch((): FollowSearchView => ({ results: [], answered: false }))
          .then((found) => {
            if (!current) return;
            answered.current = searched;
            setAnswer({ query: searched, found });
          }),
      answered.current === searched ? 0 : SEARCH_PAUSE_MS,
    );
    return () => {
      current = false;
      clearTimeout(pause);
    };
  }, [searched, enabled, changes]);

  if (view === undefined) return null;
  const changed = () => {
    setChanges((n) => n + 1);
    void read();
  };
  const follow = (artist: FollowTargetInput, level: FollowedArtistRow["level"]) =>
    void window.wave.follows
      .set(artist, level)
      .then(changed)
      .catch(() => onError(text.library.couldntFollow));
  const unfollow = (artist: FollowedArtistRow) =>
    void window.wave.follows
      .set({ name: artist.name }, null)
      .then(() => {
        changed();
        notify(text.shows.unfollowed(artist.name), () => {
          void window.wave.follows
            .restore(artist.key)
            .then(changed)
            .catch(() => onError(text.library.couldntFollow));
        });
      })
      .catch(() => onError(text.library.couldntUnfollow));
  const opens = (artist: FollowedArtistPage) =>
    artist.artistId !== null || online ? () => onOpen(artist) : undefined;

  const found = enabled && answer?.query === searched ? answer.found : undefined;
  const results: readonly FollowSearchResult[] = found?.results ?? [];
  const searchLine = enabled
    ? followSearchLine(
        {
          query,
          pending: found === undefined,
          failed: found?.answered === false,
          results: results.length,
        },
        text.followArtistSearch,
      )
    : null;

  return (
    <div className="followed-artists" data-testid="followed-artists-settings">
      <h2>{text.settings.followedArtists}</h2>
      <label className="setting-switch">
        <input
          type="checkbox"
          role="switch"
          checked={view.enabled}
          onChange={(event) => {
            const on = event.target.checked;
            setView({ ...view, enabled: on });
            void window.wave.follows
              .setEnabled(on)
              .then(setView)
              .catch(() => {
                onError();
                void read();
              });
          }}
        />
        <span>{text.settings.followedArtists}</span>
      </label>
      {view.showsConfigured && (
        <label className="follow-country">
          <span>{text.shows.country}</span>
          <select
            value={view.countryChoice ?? ""}
            onChange={(event) =>
              void window.wave.follows
                .setCountry(event.target.value === "" ? null : event.target.value)
                .then(setView)
                .catch(() => onError())
            }
          >
            <option value="">{text.shows.phoneRegion}</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {view.signInForShows && <p className="secondary setting-hint">{text.shows.signInForShows}</p>}
      <input
        type="search"
        className="follow-search"
        value={query}
        disabled={!view.enabled}
        placeholder={text.followArtistSearch.placeholder}
        aria-label={text.followArtistSearch.placeholder}
        onChange={(event) => setQuery(event.target.value)}
      />
      {searched !== "" && view.enabled ? (
        <>
          {results.length > 0 && (
            <ul className="follow-list" data-testid="follow-search-results">
              {results.map((artist) => (
                <ArtistRow
                  key={artist.key}
                  artist={{ name: artist.name, artistId: artist.artistId, ytBrowseId: null }}
                  level={artist.level}
                  levels={view}
                  onOpen={opens({ name: artist.name, artistId: artist.artistId, ytBrowseId: null })}
                  onLevel={(level) =>
                    follow(
                      {
                        name: artist.name,
                        ...(artist.deezerId === null ? {} : { deezerId: artist.deezerId }),
                      },
                      level,
                    )
                  }
                  onUnfollow={undefined}
                />
              ))}
            </ul>
          )}
          {searchLine !== null && (
            <p className="secondary follow-line" role="status">
              {searchLine}
            </p>
          )}
        </>
      ) : view.follows.length === 0 ? (
        <p className="secondary follow-line">{text.settings.youArentFollowingAnyArtistsYet}</p>
      ) : (
        <ul className="follow-list" data-testid="followed-artists">
          {view.follows.map((artist) => (
            <ArtistRow
              key={artist.key}
              artist={artist}
              level={artist.level}
              levels={view}
              onOpen={opens(artist)}
              onLevel={(level) => follow({ name: artist.name }, level)}
              onUnfollow={view.enabled ? () => unfollow(artist) : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
