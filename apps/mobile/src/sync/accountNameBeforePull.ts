import type { WaveSession } from "@wave/core";

/** Where the account's Google name and photo go: the sync service's account routes. */
export interface AccountSends {
  readonly name: (name: string) => Promise<unknown>;
  readonly photo: (photoUrl: string) => Promise<unknown>;
}

/**
 * Repairs a legacy account's name and photo before its first account pull can read collaboration
 * members: an app that signed in before the service kept them sends what its account holds. Each
 * goes only when there is one, and the pull runs whether either send fails.
 */
export const accountNameBeforePull = async (
  session: WaveSession,
  send: AccountSends,
  pull: () => void,
): Promise<void> => {
  const account = session.status === "signedIn" ? session.account : null;
  const name = account?.name?.trim();
  const photoUrl = account?.photoUrl;
  await Promise.all([
    name ? send.name(name).catch(() => {}) : null,
    photoUrl ? send.photo(photoUrl).catch(() => {}) : null,
  ]);
  pull();
};
