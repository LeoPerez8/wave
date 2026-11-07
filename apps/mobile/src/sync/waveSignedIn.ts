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

/** Calls [listener] whenever whether a Wave account is signed in changes; gives the function that stops it. */
export const subscribeWaveSignedIn = (listener: () => void): (() => void) => {
  listen();
  return signedIn.subscribe(listener);
};

/**
 * Whether a Wave account is signed in, live: a sign-in, a sign-out and the
 * service ending the session all change it. Null until the native module has
 * answered. The session token itself stays in the native module.
 */
export const useWaveSignedIn = (): boolean | null =>
  useSyncExternalStore(subscribeWaveSignedIn, signedIn.get);

/** Whether a Wave account is signed in now, outside React; null until the native module has said. */
export const waveSignedInNow = (): boolean | null => {
  listen();
  return signedIn.get();
};

/**
 * Whether a Wave account is signed in, once the native module has said
 * (outside React, for work that can wait for it); false when it can't say.
 */
export const waveSignedIn = async (): Promise<boolean> => {
  const known = waveSignedInNow();
  if (known !== null) return known;
  return WaveAccount.session().then(
    (session) => session.status === "signedIn",
    () => false,
  );
};
