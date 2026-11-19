import {
  confirmWaveAccountDeletion,
  waveAccountActionNotes,
  waveAccountNotes,
} from "@wave/core";
import { useState } from "react";
import type { AccountView } from "../../shared/account.ts";
import { text } from "./text.ts";

/** Sign In, waiting on the browser, or the signed-in account with its sign-outs and Delete Account. */
export function AccountSettings({
  view,
  onError,
}: {
  readonly view: AccountView | undefined;
  readonly onError: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const run = (call: () => Promise<void>) => void call().catch(onError);
  const account = view?.account;
  return (
    <div className="account-settings" data-testid="account-settings">
      <h2>{text.settings.waveAccount}</h2>
      {account === undefined ? null : account.kind === "unavailable" ? (
        <p className="secondary">{text.settings.waveAccountsArentSetUpOnThis}</p>
      ) : account.kind === "signedOut" ? (
        <>
          {account.action === "signingIn" ? (
            <>
              <div className="account-actions">
                <button disabled>{text.settings.signingIn}</button>
                <button onClick={() => run(window.wave.account.cancelSignIn)}>
                  {text.alert.cancel}
                </button>
              </div>
              <p className="secondary">{text.desktopAccount.finishInBrowser}</p>
            </>
          ) : (
            <>
              <div className="account-actions">
                <button onClick={() => run(window.wave.account.signIn)}>
                  {account.action === "signInAgain"
                    ? text.settings.signInAgain
                    : text.settings.signInWithGoogle}
                </button>
              </div>
              <p className="secondary">{waveAccountNotes(text)[account.note]}</p>
            </>
          )}
        </>
      ) : (
        <>
          <p data-testid="account-name">
            {text.settings.signedIn(
              account.account.name ?? account.account.email,
              account.account.name === null ? null : account.account.email,
            )}
          </p>
          {account.busy === "deleting" ? (
            <div className="account-actions">
              <button disabled>{text.settings.deleting}</button>
              <button onClick={() => run(window.wave.account.cancelSignIn)}>
                {text.alert.cancel}
              </button>
            </div>
          ) : confirmingDeletion ? (
            <DeletionConfirmation
              onCancel={() => setConfirmingDeletion(false)}
              onConfirm={() => {
                setConfirmingDeletion(false);
                run(window.wave.account.deleteAccount);
              }}
            />
          ) : confirming ? (
            <div className="account-confirm" role="alertdialog" aria-labelledby="sign-out-all">
              <h3 id="sign-out-all">{text.settings.signOutEverywhere.title}</h3>
              <p className="secondary">{text.settings.signOutEverywhere.message}</p>
              <div className="account-actions">
                <button
                  className="destructive"
                  onClick={() => {
                    setConfirming(false);
                    run(window.wave.account.signOutEverywhere);
                  }}
                >
                  {text.settings.signOutEverywhere.action}
                </button>
                <button onClick={() => setConfirming(false)}>{text.alert.cancel}</button>
              </div>
            </div>
          ) : (
            <div className="account-actions">
              <button
                disabled={account.busy !== null}
                onClick={() => run(window.wave.account.signOut)}
              >
                {account.busy === "signingOut" ? text.settings.signingOut : text.settings.signOut}
              </button>
              <button disabled={account.busy !== null} onClick={() => setConfirming(true)}>
                {text.settings.signOutOnAllPhones}
              </button>
              <button
                className="destructive"
                disabled={account.busy !== null}
                onClick={() => setConfirmingDeletion(true)}
              >
                {text.settings.deleteAccount}
              </button>
            </div>
          )}
          <p className="secondary" data-testid="account-note">
            {account.busy === "deleting"
              ? text.desktopAccount.confirmDeletionInBrowser
              : account.note === null
              ? text.settings.waveAccountSignOutNote
              : waveAccountActionNotes(text)[account.note]}
          </p>
        </>
      )}
      {view?.keyringMissing && account?.kind !== "unavailable" && (
        <p className="secondary" data-testid="keyring-missing">
          {text.desktopAccount.keyringMissing}
        </p>
      )}
    </div>
  );
}

/** Delete Account asks first, with the phone's confirmation (Core's `confirmWaveAccountDeletion`). */
function DeletionConfirmation({
  onConfirm,
  onCancel,
}: {
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  const confirmation = confirmWaveAccountDeletion(text);
  return (
    <div className="account-confirm" role="alertdialog" aria-labelledby="delete-account">
      <h3 id="delete-account">{confirmation.title}</h3>
      <p className="secondary">{confirmation.message}</p>
      <div className="account-actions">
        <button className="destructive" onClick={onConfirm}>
          {confirmation.action.label}
        </button>
        <button onClick={onCancel}>{text.alert.cancel}</button>
      </div>
    </div>
  );
}

/** After the first scan, while signed out: what the account adds, with Sign In and Not Now. */
export function SignInInvitation({ onError }: { readonly onError: () => void }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const invitation = text.settings.signInInvitation;
  const answer = (call: () => Promise<void>) => {
    setOpen(false);
    void call().catch(onError);
  };
  return (
    <aside className="invitation" aria-labelledby="invitation-title" data-testid="invitation">
      <h2 id="invitation-title">{invitation.title}</h2>
      <h3>{invitation.libraryTitle}</h3>
      <p className="secondary">{invitation.library}</p>
      <p className="secondary">{invitation.note}</p>
      <div className="account-actions">
        <button onClick={() => answer(window.wave.account.signIn)}>
          {text.settings.signInWithGoogle}
        </button>
        <button onClick={() => answer(window.wave.account.answerInvitation)}>
          {invitation.notNow}
        </button>
      </div>
    </aside>
  );
}
