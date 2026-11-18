import {
  UPDATE_PASS_HEADER,
  UPDATE_PASS_PLACEHOLDER,
  WAVE_UPDATES_ORIGIN,
  readUpdatePass,
  updatePassHeaders,
  updatePassNeedsRenewal,
  updateRequestHeaders,
  type UpdatePass,
} from "@wave/core";

interface KeptPass {
  readonly account: string;
  readonly pass: UpdatePass;
}

interface UpdatePassRunnerOptions {
  readonly now: () => number;
  readonly requestPass: () => Promise<unknown>;
  readonly kept: {
    readonly get: () => KeptPass | null;
    readonly set: (value: KeptPass | null) => void;
  };
  readonly channel: string | null;
  readonly setExpoHeaders: (headers: Readonly<Record<string, string>> | null) => void;
  readonly warn: (message: string) => void;
}

export const createUpdatePassRunner = ({
  now,
  requestPass,
  kept,
  channel,
  setExpoHeaders,
  warn,
}: UpdatePassRunnerOptions) => {
  let account: string | null | undefined;
  let pass: UpdatePass | null = null;
  let lastAttemptAt: number | null = null;
  let pending: Promise<void> | undefined;
  let canOverride: boolean | undefined;
  let overrideOwner: symbol | undefined;

  const setOverride = (headers: Readonly<Record<string, string>> | null): boolean => {
    try {
      setExpoHeaders(headers);
      return true;
    } catch {
      // Expo can include the complete header map in the exception.
      warn("Could not set Expo update request headers");
      return false;
    }
  };

  const clearOverride = (): void => {
    overrideOwner = undefined;
    setOverride(null);
  };

  const accountChanged = (next: string | null): void => {
    const stored = account === undefined && next !== null ? kept.get() : null;
    account = next;
    pending = undefined;
    lastAttemptAt = null;
    clearOverride();
    pass = stored?.account === next && stored.pass.expiresAt > now() ? stored.pass : null;
    if (pass === null) kept.set(null);
  };

  const refresh = async (): Promise<void> => {
    const owner = account;
    if (owner == null) return;
    const at = now();
    if (pass !== null && pass.expiresAt <= at) {
      pass = null;
      kept.set(null);
    }
    if (pending !== undefined) return pending;
    if (!updatePassNeedsRenewal({ kept: pass, lastAttemptAt, now: at })) return;
    lastAttemptAt = at;

    const ask = async () => {
      try {
        return readUpdatePass(await requestPass());
      } catch {
        return null;
      }
    };
    const current = ask().then((answer) => {
      if (pending !== current) return;
      pending = undefined;
      if (answer === null || answer.expiresAt <= Math.max(now(), pass?.expiresAt ?? 0)) return;
      pass = answer;
      lastAttemptAt = null;
      kept.set({ account: owner, pass: answer });
    });
    pending = current;
    return current;
  };

  const headersFor = (url: string): Readonly<Record<string, string>> => {
    if (
      !url.startsWith(`${WAVE_UPDATES_ORIGIN}/v1/apk?`) &&
      !url.startsWith(`${WAVE_UPDATES_ORIGIN}/v1/notes?`)
    ) {
      return {};
    }
    return updatePassHeaders(pass, now());
  };

  const withExpoHeaders = async <T>(request: () => Promise<T>): Promise<T> => {
    const headers = updateRequestHeaders({ channel, kept: pass, now: now() });
    if (headers === null) return request();
    // Probe with the placeholder so an older APK never receives the pass in an invalid override.
    canOverride ??= setOverride({ ...headers, [UPDATE_PASS_HEADER]: UPDATE_PASS_PLACEHOLDER });
    if (!canOverride) return request();
    if (!setOverride(headers)) {
      clearOverride();
      return request();
    }
    const owner = Symbol();
    overrideOwner = owner;
    try {
      return await request();
    } catch {
      throw new Error("Expo update request failed");
    } finally {
      if (overrideOwner === owner) clearOverride();
    }
  };

  const hasPass = (): boolean => pass !== null && pass.expiresAt > now();

  return { accountChanged, refresh, hasPass, headersFor, withExpoHeaders };
};
