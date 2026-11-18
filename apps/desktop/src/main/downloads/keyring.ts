/**
 * What the JVM asks main to seal and unseal: the Soulseek account it keeps (`HostCipher`), sealed
 * by the system's keyring through Electron's `safeStorage`. Bytes travel as base64 both ways.
 */
import { NO_KEYRING, type SecretBox } from "../account/sessionStore.ts";
import type { HostMethods } from "../kotlin/protocol.ts";

const noKeyring = () =>
  Object.assign(new Error("This computer has no keyring to keep the account in."), {
    code: "ERR_NO_KEYRING",
  });

const dataOf = (params: unknown): string => {
  const data = (params as { data?: unknown } | null)?.data;
  if (typeof data !== "string") throw new Error("Expected { data: base64 }");
  return data;
};

export const keyringHost = (box: SecretBox, platform: string = process.platform): HostMethods => {
  // Asked on each call: safeStorage answers only once the app is ready.
  const usable = () =>
    box.isEncryptionAvailable() &&
    !(platform === "linux" && NO_KEYRING.has(box.getSelectedStorageBackend?.() ?? "unknown"));
  return {
    seal: async (params) => {
      if (!usable()) throw noKeyring();
      return { data: box.encryptString(dataOf(params)).toString("base64") };
    },
    unseal: async (params) => {
      if (!usable()) throw noKeyring();
      return { data: box.decryptString(Buffer.from(dataOf(params), "base64")) };
    },
  };
};
