/**
 * Opening a collaborative playlist's invite link on the phone (docs/spec.md › Collaborative
 * playlists, Invite link): which links are invites, what the app does first, and what each answer
 * of the service shows. The token is read here and handed to the service in a request body only.
 */
import type { Collaboration, CollaborationResult, InviteDetails } from "./collaborationRequests.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";
import type { WaveAccount, WaveSignInFailure } from "./waveAccount.ts";
import { waveAccountNotes } from "./waveAccountText.ts";

/** A title and a line, shown as a message with OK. */
export interface InviteNotice {
  readonly title: string;
  readonly message: string;
}

/** The host of the sync service at [syncUrl], whose `/invite` links Wave opens; null for none. */
export const inviteHost = (syncUrl: string): string | null =>
  /^https:\/\/([^/\s:?#]+)/iu.exec(syncUrl.trim())?.[1]?.toLowerCase() ?? null;

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * The token of the invite link in [text] (a tapped link, or a share that holds one among other
 * words): `https://<the sync service's host>/invite#<43 base64url characters>`. Null for any other
 * text, so it goes on to what Wave does with links.
 */
export const inviteToken = (text: string, syncUrl: string): string | null => {
  const host = inviteHost(syncUrl);
  if (host === null) return null;
  const link = new RegExp(
    `(?:^|\\s)https://${escaped(host)}/invite#([A-Za-z0-9_-]{43})(?=$|\\s)`,
    "iu",
  );
  return link.exec(text)?.[1] ?? null;
};

/**
 * What opening an invite does first: signed out, a prompt to sign in, after which the invite opens
 * again; signed in, the service is asked what the link names.
 */
export const inviteOpening = ({ signedIn }: { readonly signedIn: boolean }): "signIn" | "lookUp" =>
  signedIn ? "lookUp" : "signIn";

const refusalNotice = (
  result: Exclude<CollaborationResult<unknown>, { type: "done" }>,
  title: string,
  language: AppLanguage,
): InviteNotice => {
  const text = catalogueOf(language).inviteJoin;
  if (result.type === "refused" && result.refusal === "linkNotValid")
    return { title: text.notValidTitle, message: text.notValidMessage };
  if (result.type === "refused" && result.refusal === "full")
    return { title: text.fullTitle, message: text.fullMessage };
  return { title, message: result.type === "offline" ? text.offlineMessage : text.failedMessage };
};

/** What the service's answer about a link opens: the join screen, or a message. */
export type InviteLookUpOutcome =
  | { readonly kind: "join"; readonly details: InviteDetails }
  | { readonly kind: "notice"; readonly notice: InviteNotice };

export const inviteLookUpOutcome = (
  result: CollaborationResult<InviteDetails>,
  language: AppLanguage = "en",
): InviteLookUpOutcome =>
  result.type === "done"
    ? { kind: "join", details: result.value }
    : {
        kind: "notice",
        notice: refusalNotice(result, catalogueOf(language).inviteJoin.couldntOpen, language),
      };

/** The join screen's text (mock screen 7). */
export interface InviteJoinView {
  readonly invitedBy: string;
  readonly playlistName: string;
  readonly allows: string;
  readonly join: string;
  readonly cancel: string;
  /** The account signed in, the one that joins. */
  readonly joiningAs: string;
}

export const inviteJoinView = (
  details: InviteDetails,
  account: WaveAccount,
  language: AppLanguage = "en",
): InviteJoinView => {
  const text = catalogueOf(language).inviteJoin;
  return {
    invitedBy: details.ownerName === null ? text.invited : text.invitedBy(details.ownerName),
    playlistName: details.playlistName ?? text.unnamedPlaylist,
    allows: text.allows,
    join: text.join,
    cancel: text.cancel,
    joiningAs: text.joiningAs(account.name ?? account.email),
  };
};

/** What Join came to: the playlist (its sync id) that the next sync brings, or a message. */
export type InviteJoinOutcome =
  | { readonly kind: "joined"; readonly playlistId: string }
  | { readonly kind: "notice"; readonly notice: InviteNotice };

export const inviteJoinOutcome = (
  result: CollaborationResult<Collaboration>,
  language: AppLanguage = "en",
): InviteJoinOutcome =>
  result.type === "done"
    ? { kind: "joined", playlistId: result.value.playlistId }
    : {
        kind: "notice",
        notice: refusalNotice(result, catalogueOf(language).inviteJoin.couldntJoin, language),
      };

/** The sign-in prompt an invite shows signed out (mock screen 8). */
export const inviteSignInPrompt = (
  language: AppLanguage = "en",
): InviteNotice & { readonly signIn: string } => {
  const strings = catalogueOf(language);
  return {
    title: strings.inviteJoin.signInTitle,
    message: strings.inviteJoin.signInMessage,
    signIn: strings.settings.signInWithGoogle,
  };
};

/**
 * Why signing in from an invite didn't work: a service that can admit no new account is full;
 * any other failure gives Settings' reason.
 */
export const inviteSignInNotice = (
  failure: WaveSignInFailure,
  language: AppLanguage = "en",
): InviteNotice => {
  const strings = catalogueOf(language);
  if (failure === "accountsFull" || failure === "newAccountsPaused")
    return { title: strings.inviteJoin.fullTitle, message: strings.inviteJoin.fullMessage };
  return { title: strings.settings.couldntSignIn, message: waveAccountNotes(strings)[failure] };
};
