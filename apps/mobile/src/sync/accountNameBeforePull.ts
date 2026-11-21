import type { WaveSession } from "@wave/core";

/** Repairs a legacy account name before its first account pull can read collaboration members. */
export const accountNameBeforePull = async (
  session: WaveSession,
  saveName: (name: string) => Promise<unknown>,
  pull: () => void,
): Promise<void> => {
  const name = session.status === "signedIn" ? session.account.name?.trim() : undefined;
  if (name) await saveName(name).catch(() => {});
  pull();
};
