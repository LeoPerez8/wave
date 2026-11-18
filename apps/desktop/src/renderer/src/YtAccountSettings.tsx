import { artistInitial, ytAccountNotes, ytMusicPlaylistUrl } from "@wave/core";
import { useCallback, useEffect, useState } from "react";
import type { YtAccountPanel, YtAccountPlaylists } from "../../shared/ytAccount.ts";
import { openLink } from "./copyLink.ts";
import { language, text } from "./text.ts";
import { Artwork } from "./VirtualTable.tsx";

/**
 * Settings › Accounts › YT Music's account: Sign In, waiting on the browser window, or the
 * signed-in account with Sign Out and its YouTube Music playlists.
 */
export function YtAccountSettings({
  view,
  onError,
}: {
  readonly view: YtAccountPanel | undefined;
  readonly onError: () => void;
}) {
  const run = (call: () => Promise<void>) => void call().catch(onError);
  const account = view?.account;
  if (view === undefined || account === undefined || account === null) return null;
  return (
    <div className="account-settings" data-testid="yt-account-settings">
      {account.kind === "account" ? (
        <>
          <div
            className="yt-account"
            data-testid="yt-account-name"
            aria-label={text.settings.signedIn(account.account.name, account.account.email)}
          >
            <span className="yt-account-photo">
              {account.account.photoUrl !== null ? (
                <Artwork url={account.account.photoUrl} artist />
              ) : (
                <span className="artwork artist-image" aria-hidden>
                  {artistInitial(account.account.name)}
                </span>
              )}
            </span>
            <span className="yt-account-names">
              <span>{account.account.name}</span>
              {account.account.email !== null && (
                <span className="secondary">{account.account.email}</span>
              )}
            </span>
          </div>
          <div className="account-actions">
            <button onClick={() => run(window.wave.ytAccount.signOut)}>
              {text.settings.signOut}
            </button>
          </div>
          <p className="secondary">{text.settings.searchPlaybackAndHomesMixesUseThis}</p>
        </>
      ) : account.action === "signingIn" ? (
        <>
          <div className="account-actions">
            <button disabled>{text.settings.signingIn}</button>
            <button onClick={() => run(window.wave.ytAccount.cancelSignIn)}>
              {text.alert.cancel}
            </button>
          </div>
          <p className="secondary" data-testid="yt-close-browser">
            {text.desktopAccount.closeBrowserWhenDone}
          </p>
        </>
      ) : (
        <>
          <div className="account-actions">
            <button onClick={() => run(window.wave.ytAccount.signIn)}>
              {account.action === "signInAgain" ? text.settings.signInAgain : text.settings.signIn}
            </button>
          </div>
          {view.noBrowser ? (
            <p className="secondary" data-testid="yt-no-browser">
              {text.desktopAccount.noBrowser}
            </p>
          ) : (
            <p className="secondary">{ytAccountNotes(text)[account.note]}</p>
          )}
        </>
      )}
      {view.keyringMissing && (
        <p className="secondary" data-testid="yt-keyring-missing">
          {text.desktopAccount.keyringMissing}
        </p>
      )}
      {account.kind === "account" && <YtAccountPlaylistList onError={onError} />}
    </div>
  );
}

/** The account's YouTube Music playlists, Liked Songs first; one opens its import card. */
function YtAccountPlaylistList({ onError }: { readonly onError: () => void }) {
  const [read, setRead] = useState<YtAccountPlaylists>();
  const [attempt, setAttempt] = useState(0);
  const again = useCallback(() => {
    setRead(undefined);
    setAttempt((value) => value + 1);
  }, []);
  useEffect(() => {
    let current = true;
    void window.wave.ytAccount
      .playlists(language)
      .then((next) => {
        if (current) setRead(next);
      })
      .catch(() => {
        if (current)
          setRead({ status: "failed", line: text.desktopLibrary.actionFailed, action: "tryAgain" });
      });
    return () => {
      current = false;
    };
  }, [attempt]);
  if (read === undefined) return null;
  return (
    <section aria-labelledby="yt-account-playlists">
      <h3 id="yt-account-playlists">{text.imports.fromYtMusic}</h3>
      {read.status === "failed" ? (
        <>
          <p className="secondary">{read.line}</p>
          {read.action !== null && (
            <div className="account-actions">
              <button
                onClick={() =>
                  read.action === "tryAgain"
                    ? again()
                    : void window.wave.ytAccount.signIn().catch(onError)
                }
              >
                {read.action === "tryAgain" ? text.imports.tryAgain : text.imports.signInAgain}
              </button>
            </div>
          )}
        </>
      ) : (
        <ul className="yt-account-playlists" data-testid="yt-account-playlists">
          {read.playlists.map((playlist) => (
            <li key={playlist.playlistId}>
              <button onClick={() => openLink(ytMusicPlaylistUrl(playlist.playlistId))}>
                <span className="yt-account-cover">
                  <Artwork url={playlist.artworkUrl} />
                </span>
                <span className="yt-account-names">
                  <span>{playlist.title}</span>
                  {playlist.line !== null && <span className="secondary">{playlist.line}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
