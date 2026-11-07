import type { WaveSession } from "@wave/core";
import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { WaveAccount } from "@/native/waveAccount";

/** Whether a Wave account is signed in; null until the native module has said. */
const signedIn = makeExternalStore<boolean | null>(null);

let listening = false;

/** Starts following the native module's session, the first time anything asks. */
const listen = (): void => {
  if (listening) return;
  listening = true;
  let heard = false;
  const changed = (session: WaveSession): void => {
    heard = true;
    signedIn.set(session.status === "signedIn");
  };
  WaveAccount.addListener("onSessionChanged", changed);
  // A change heard meanwhile is newer than this answer.
  void WaveAccount.session().then(
    (session) => {
      if (!heard) changed(session);
    },
    () => {},
  );
};

const subscribe = (listener: () => void): (() => void) => {
  listen();
  return signedIn.subscribe(listener);
};

/**
 * Whether a Wave account is signed in, live: a sign-in, a sign-out and the
 * service ending the session all change it. Null until the native module has
 * answered. The session token itself stays in the native module.
 */
export const useWaveSignedIn = (): boolean | null => useSyncExternalStore(subscribe, signedIn.get);

/** Whether a Wave account is signed in now, outside React; null until the native module has said. */
export const waveSignedInNow = (): boolean | null => {
  listen();
  return signedIn.get();
};

/** Calls [listener] whenever `waveSignedInNow` changes; gives the function that stops it. */
export const onWaveSignedInChange = (listener: () => void): (() => void) => subscribe(listener);
