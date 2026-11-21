/**
 * What a collaborative playlist's menu opens on the phone (docs/spec.md, Collaborative
 * playlists, The menu): the questions Make Collaborative, Leave Playlist, Remove and End
 * Collaboration ask, what Invite shows of the link, the Members list, and the plain message
 * an action that the service refused, or that couldn't reach it, shows. Which entries the
 * menu offers is `itemActions`'.
 */
import type { AlertSpec } from "./alert.ts";
import type {
  ActiveInvite,
  CollaborationMember,
  CollaborationResult,
  CreatedInvite,
} from "./collaborationRequests.ts";
import { formatDate } from "./formatting.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";

/** An alert that asks first: Cancel and its action. */
export type CollaborativeConfirmation = AlertSpec & {
  readonly action: NonNullable<AlertSpec["action"]>;
};

const text = (language: AppLanguage) => catalogueOf(language).collaborativeMenu;

/** Make Collaborative's question: what members can do, and what stays with the owner. */
export const confirmMakeCollaborative = (
  name: string,
  language: AppLanguage = "en",
): CollaborativeConfirmation => {
  const t = text(language);
  return { title: t.makeTitle(name), message: t.makeMessage, action: { label: t.makeAction } };
};

/** Make Collaborative while signed out of the Wave account: it asks to sign in first. */
export const collaborativeSignInAlert = (
  language: AppLanguage = "en",
): CollaborativeConfirmation => {
  const t = text(language);
  return { title: t.signInTitle, message: t.signInMessage, action: { label: t.signIn } };
};

/** Leave Playlist's question: it goes from the member's Library, their songs stay. */
export const confirmLeavePlaylist = (
  name: string,
  language: AppLanguage = "en",
): CollaborativeConfirmation => {
  const t = text(language);
  return {
    title: t.leaveTitle(name),
    message: t.leaveMessage,
    action: { label: t.leave, destructive: true },
  };
};

/** Remove's question for the member [name] (null: the service keeps none). */
export const confirmRemoveMember = (
  name: string | null,
  language: AppLanguage = "en",
): CollaborativeConfirmation => {
  const t = text(language);
  return {
    title: t.removeTitle(name),
    message: t.removeMessage,
    action: { label: t.remove, destructive: true },
  };
};

/** End Collaboration's question: the [otherMembers] others keep a copy. */
export const confirmEndCollaboration = (
  otherMembers: number,
  language: AppLanguage = "en",
): CollaborativeConfirmation => {
  const t = text(language);
  return {
    title: t.endTitle,
    message: t.endMessage(otherMembers),
    action: { label: t.end, destructive: true },
  };
};

/** One row of Members. */
export interface CollaborativeMemberRow {
  readonly accountId: string;
  /** The name's first letter, upper case; "?" without a name. */
  readonly initial: string;
  readonly name: string;
  /** Owner, You, both, or nothing. */
  readonly detail: string | null;
  /** The owner sees Remove on every other member. */
  readonly removable: boolean;
}

const initialOf = (name: string | null): string => {
  const first = name?.trim()[Symbol.iterator]().next().value;
  return first === undefined ? "?" : first.toLocaleUpperCase();
};

/**
 * Members as the list shows them, in the service's order (the owner first): an initial and
 * the Google account name, the owner and the account signed in marked, and Remove on the
 * others while that account [owned] the playlist.
 */
export const collaborativeMemberRows = (
  members: readonly CollaborationMember[],
  { owned }: { readonly owned: boolean },
  language: AppLanguage = "en",
): CollaborativeMemberRow[] => {
  const t = text(language);
  return members.map((member) => {
    const name = member.name?.trim() || null;
    return {
      accountId: member.accountId,
      initial: initialOf(name),
      name: name ?? t.noName,
      detail:
        member.owner && member.self
          ? t.ownerAndYou
          : member.owner
            ? t.owner
            : member.self
              ? t.you
              : null,
      removable: owned && !member.owner && !member.self,
    };
  });
};

/** What Invite shows. */
export type InviteView =
  /** The link this device made: its address, Share Link, Copy Link and Turn Off Link. */
  | { readonly kind: "link"; readonly url: string; readonly lastDay: string }
  /**
   * A link another device of the owner made: its last day without the address (the service
   * keeps only a hash of it), Create Invite Link and Turn Off Link.
   */
  | { readonly kind: "elsewhere"; readonly line: string }
  /** No active link: only Create Invite Link. */
  | { readonly kind: "none"; readonly line: string };

const lastDayOf = (expiresAt: number, language: AppLanguage): string =>
  formatDate(language, expiresAt, { month: "short", day: "numeric" });

/**
 * Invite from what this device [held] (the link it created, if any) and the service's
 * [active] link: null when there is none, undefined when it couldn't be asked (offline), in
 * which case the held link shows until its day.
 */
export const inviteView = ({
  held,
  active,
  now,
  language = "en",
}: {
  readonly held: CreatedInvite | null;
  readonly active: ActiveInvite | null | undefined;
  readonly now: number;
  readonly language?: AppLanguage;
}): InviteView => {
  const t = text(language);
  const shown =
    active === undefined
      ? held !== null && held.expiresAt > now
        ? held
        : null
      : held !== null && active !== null && held.expiresAt === active.expiresAt
        ? held
        : null;
  if (shown !== null)
    return {
      kind: "link",
      url: shown.url,
      lastDay: t.validUntil(lastDayOf(shown.expiresAt, language)),
    };
  if (active != null && active.expiresAt > now)
    return { kind: "elsewhere", line: t.madeElsewhere(lastDayOf(active.expiresAt, language)) };
  return { kind: "none", line: t.noLink };
};

/** The actions that call the service, each with a title for when it fails. */
export type CollaborativeAction =
  "make" | "invite" | "readInvite" | "turnOff" | "members" | "remove" | "end" | "leave";

/**
 * The message [action] shows when [result] isn't done: what the service refused, or that the
 * phone is offline, or that it went wrong. Null once done.
 */
export const collaborationFailure = (
  action: CollaborativeAction,
  result: CollaborationResult<unknown>,
  language: AppLanguage = "en",
): { readonly title: string; readonly message: string } | null => {
  if (result.type === "done") return null;
  const t = text(language);
  const why =
    result.type === "offline"
      ? t.why.offline
      : result.type === "refused"
        ? t.why[result.refusal]
        : t.why.failed;
  return { title: t.failed[action], message: why };
};
