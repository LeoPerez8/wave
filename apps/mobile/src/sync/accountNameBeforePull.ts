import type { AccountFields, WaveSession } from "@wave/core";

/**
 * Repairs a legacy account's name and photo before its first account pull can read collaboration
 * members: an app that signed in before the service kept them sends what its account holds, in
 * one request. Each field goes only when the account has it, nothing goes when it has neither,
 * and the pull runs whether the send fails or not.
 */
export const accountNameBeforePull = async (
  session: WaveSession,
  send: (fields: AccountFields) => Promise<unknown>,
  pull: () => void,
): Promise<void> => {
  const account = session.status === "signedIn" ? session.account : null;
  const name = account?.name?.trim();
  const photoUrl = account?.photoUrl;
  if (name || photoUrl)
    await send({ ...(name ? { name } : {}), ...(photoUrl ? { photoUrl } : {}) }).catch(() => {});
  pull();
};
