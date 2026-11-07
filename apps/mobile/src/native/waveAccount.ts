import type { WaveSession } from "@wave/core";
import { NativeModule, requireNativeModule } from "expo";

/** The sync service's answer to a request the native module sent with the session. */
interface WaveServiceResponse {
  readonly status: number;
  /** The response body as text (JSON from the service). */
  readonly body: string;
}

/**
 * The Wave account's native module. It holds the sync service's session token
 * (in no-backup storage, encrypted) and never hands it to JS. Failures reject
 * with an `ERR_WAVE_*` code (see `waveAccountErrorCode`).
 */
declare class WaveAccountModule extends NativeModule<{
  /** Signed in, signed out, deleted, or ended by the service (a 401 to any request). */
  onSessionChanged: (session: WaveSession) => void;
}> {
  session(): Promise<WaveSession>;
  /**
   * Opens Google's account picker for an ID token for [webClientId], and
   * trades it for a session with the service at [serviceUrl]. Null when the
   * owner backs out: nothing was sent. Offline, rejects before the picker opens.
   */
  signIn(serviceUrl: string, webClientId: string): Promise<WaveSession | null>;
  /** Ends the session on the service when it can, and forgets it on the phone either way. */
  signOut(): Promise<WaveSession>;
  /**
   * Ends every session of the account on the service, this phone's too,
   * then signs out: resolves signed out, or ended when the service had
   * already ended the session.
   */
  signOutEverywhere(): Promise<WaveSession>;
  /**
   * Opens Google's account picker for a fresh ID token for [webClientId]
   * (the service needs it besides the session), then deletes the account and
   * everything the service has of it and signs out: resolves signed out, or
   * ended when the service had already ended the session. Null when the
   * owner backs out of the picker: nothing was sent. Signed out or offline,
   * rejects before the picker opens; an ID token the service didn't take as
   * this account's rejects with `ERR_WAVE_GOOGLE_NOT_CONFIRMED`.
   */
  deleteAccount(webClientId: string): Promise<WaveSession | null>;
  /**
   * Sends `POST /v1/push` or `GET /v1/pull?since=…` with the session; any
   * other route rejects with `ERR_WAVE_FORBIDDEN_REQUEST`. Signed out, rejects
   * with `ERR_WAVE_SIGNED_OUT` and sends nothing; a 401 ends the session and
   * rejects with `ERR_WAVE_SESSION_ENDED`.
   */
  request(
    method: "GET" | "POST",
    path: string,
    /** JSON, or null for none. */
    body: string | null,
  ): Promise<WaveServiceResponse>;
}

export const WaveAccount = requireNativeModule<WaveAccountModule>("WaveAccount");

export type WaveAccountErrorCode =
  | "ERR_WAVE_OFFLINE"
  | "ERR_WAVE_UNREACHABLE"
  | "ERR_WAVE_REJECTED"
  | "ERR_WAVE_NOT_ALLOWED"
  | "ERR_WAVE_SIGNED_OUT"
  | "ERR_WAVE_SESSION_ENDED"
  | "ERR_WAVE_FORBIDDEN_REQUEST"
  | "ERR_WAVE_NO_GOOGLE_ACCOUNT"
  | "ERR_WAVE_GOOGLE"
  | "ERR_WAVE_GOOGLE_NOT_CONFIRMED";

/** The `ERR_WAVE_*` code a native call rejected with, if any. */
export const waveAccountErrorCode = (error: unknown): WaveAccountErrorCode | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && code.startsWith("ERR_WAVE_")
    ? (code as WaveAccountErrorCode)
    : null;
};
