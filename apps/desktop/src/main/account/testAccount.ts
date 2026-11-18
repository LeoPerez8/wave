/** The desktop's Wave account over the sync Worker's test harness, for the account and sync tests. */
import assert from "node:assert/strict";
import { harness, type Harness, type HarnessOptions } from "../../../../sync/src/testing.ts";
import { createWaveAccount, type WaveAccountDeps } from "./account.ts";
import type { BrowserIdentity } from "./browserSignIn.ts";
import { sessionStore, type SecretBox, type SessionFiles } from "./sessionStore.ts";

export const SYNC_URL = "https://sync.wave.test";
export const DESKTOP_CLIENT = "wave-desktop-client.apps.googleusercontent.com";

export const keyring: SecretBox = {
  isEncryptionAvailable: () => true,
  encryptString: (text) => Buffer.from([...Buffer.from(text, "utf8")].reverse()),
  decryptString: (bytes) => Buffer.from([...bytes].reverse()).toString("utf8"),
};

/** `fetch` as the desktop sends it, answered by the harness's service. */
const viaService =
  (service: Harness): typeof fetch =>
  async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, SYNC_URL);
    const headers = Object.fromEntries(new Headers(init?.headers));
    const body = typeof init?.body === "string" ? init.body : undefined;
    return service.request(init?.method ?? "GET", url.pathname + url.search, {
      headers,
      ...(body === undefined ? {} : { body }),
    });
  };

/** The desktop app over a fresh service, with a browser that signs in as [claims] says. */
export const desktop = async (options: HarnessOptions = {}) => {
  const service = await harness({ googleDesktopClientId: DESKTOP_CLIENT, ...options });
  const disk = new Map<string, Buffer>();
  const files: SessionFiles = {
    read: (path) => disk.get(path),
    write: (path, bytes) => void disk.set(path, bytes),
    remove: (path) => void disk.delete(path),
  };
  let browser = async (_signal: AbortSignal): Promise<BrowserIdentity> => ({
    idToken: await service.google.idToken({ aud: DESKTOP_CLIENT, name: "Ana" }),
    email: "ana@example.com",
    name: "Ana",
    photoUrl: null,
  });
  let online = true;
  let fetch = viaService(service);
  const open = (overrides: Partial<WaveAccountDeps> = {}) =>
    createWaveAccount({
      store: sessionStore({ box: keyring, file: "session.bin", files, platform: "win32" }),
      syncUrl: SYNC_URL,
      signInWithBrowser: (signal) => browser(signal),
      fetch: (input, init) => fetch(input, init),
      online: () => online,
      ...overrides,
    });
  return {
    service,
    disk,
    open,
    browser: (next: (signal: AbortSignal) => Promise<BrowserIdentity>) => void (browser = next),
    offline: () => {
      online = false;
      fetch = async () => {
        throw new TypeError("fetch failed");
      };
    },
  };
};
