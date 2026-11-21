import { artistInitial, spotifySignInFailureLines, type SpotifyAccount } from "@wave/core";
import { useEffect, useState } from "react";
import type { SpotifyAccountPanel } from "../../shared/spotifyAccount.ts";
import { text } from "./text.ts";

/** Settings › Accounts › Spotify. The account and its status come from main. */
export function SpotifyAccountSettings({ onError }: { readonly onError: () => void }) {
  const [view, setView] = useState<SpotifyAccountPanel>();
  const bridge = window.wave.spotifyAccount;
  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = () =>
      void bridge.check().catch(() => {
        if (current) onError();
      });
    const poll = async () => {
      try {
        if (!document.hidden) {
          const next = await bridge.view();
          if (current)
            setView((previous) =>
              JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
            );
        }
      } catch {
        if (current) onError();
      } finally {
        if (current) timer = setTimeout(() => void poll(), 400);
      }
    };
    check();
    void poll();
    window.addEventListener("focus", check);
    return () => {
      current = false;
      clearTimeout(timer);
      window.removeEventListener("focus", check);
    };
  }, [bridge, onError]);

  const run = (call: () => Promise<void>) => void call().catch(onError);
  const account = view?.account;
  return (
    <section className="account-settings" aria-labelledby="spotify-account-heading">
      <h2 id="spotify-account-heading">{text.settings.songLinkServices.spotify}</h2>
      {view === undefined || account === undefined ? null : !view.configured ? (
        <p className="secondary">{text.desktopAccount.spotifyUnavailable}</p>
      ) : account.kind === "account" ? (
        <>
          <div
            className="account-profile"
            aria-label={text.settings.spotifySignedIn(account.account.name)}
          >
            <SpotifyPhoto key={account.account.photoUrl} account={account.account} />
            <span className="account-profile-name">{account.account.name}</span>
          </div>
          <div className="account-actions">
            <button onClick={() => run(bridge.signOut)}>{text.settings.signOut}</button>
          </div>
        </>
      ) : account.action === "signingIn" ? (
        <>
          <div className="account-actions">
            <button disabled>{text.settings.signingIn}</button>
            <button onClick={() => run(bridge.cancelSignIn)}>{text.alert.cancel}</button>
          </div>
          <p className="secondary">{text.desktopAccount.finishInBrowser}</p>
        </>
      ) : (
        <>
          <div className="account-actions">
            <button onClick={() => run(bridge.signIn)}>
              {account.action === "signInAgain" ? text.settings.signInAgain : text.settings.signIn}
            </button>
          </div>
          <p className="secondary">
            {account.note === "optional"
              ? text.desktopAccount.spotifyNote
              : account.note === "expired"
                ? text.settings.spotifyEndedYourSessionSoWaveIs
                : spotifySignInFailureLines(text)[account.note]}
          </p>
        </>
      )}
      {view?.keyringMissing && <p className="secondary">{text.desktopAccount.keyringMissing}</p>}
    </section>
  );
}

function SpotifyPhoto({ account }: { readonly account: SpotifyAccount }) {
  const [image, setImage] = useState<string | null>(null);
  const photoUrl = account.photoUrl;
  useEffect(() => {
    if (photoUrl === null) return;
    let current = true;
    void window.wave.spotifyAccount
      .photo()
      .then((value) => {
        if (current) setImage(value);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [photoUrl]);
  return (
    <span className="account-profile-photo">
      <span className="artwork artist-image" aria-hidden>
        {image === null ? (
          artistInitial(account.name)
        ) : (
          <img src={image} alt="" onError={() => setImage(null)} />
        )}
      </span>
    </span>
  );
}
