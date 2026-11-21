import { formatNumber } from "../formatting.ts";
import { plural } from "../plural.ts";

const n = (count: number): string => formatNumber("en", count);

/** What the other members keep when the owner ends or deletes the playlist ([count]: them). */
const othersKeepACopy = (count: number): string =>
  plural("en", count, {
    one: "The other member keeps a copy.",
    other: `The ${n(count)} other members keep a copy.`,
  });

/**
 * A collaborative playlist's menu and what it opens (docs/spec.md, Collaborative playlists,
 * The menu): Make Collaborative, Invite, Members and their questions and failures. The menu
 * entries' labels are `itemActions.labels`.
 */
export const collaborativeMenuEn = {
  makeTitle: (name: string): string => `Make “${name}” collaborative?`,
  makeMessage:
    "People who join through your invite can add, remove and reorder songs and rename it. Only you invite, remove members and delete the playlist.",
  makeAction: "Make Collaborative",
  signInTitle: "Sign in to the Wave account",
  signInMessage:
    "Collaborative playlists use the Wave account. Sign in, then make the playlist collaborative.",
  signIn: "Sign In",

  leaveTitle: (name: string): string => `Leave “${name}”?`,
  leaveMessage: "The playlist leaves your Library. The songs you added stay for the others.",
  leave: "Leave",
  removeTitle: (name: string | null): string =>
    name === null ? "Remove this member?" : `Remove ${name}?`,
  removeMessage: "They keep a copy of their own, and the current invite link stops working.",
  remove: "Remove",
  endTitle: "End the collaboration?",
  endMessage: (others: number): string =>
    others === 0
      ? "The playlist is yours alone again."
      : `The playlist is yours alone again. ${othersKeepACopy(others)}`,
  end: "End",
  deleteMessage: (others: number): string => `It's deleted for you. ${othersKeepACopy(others)}`,

  invite: "Invite",
  /** Under the link: its last day ([date], short) and who can use it. */
  validUntil: (date: string): string =>
    `Valid until ${date}. Anyone with the link and a Wave account can join the playlist.`,
  /** A link another device of the account made: this one never holds its address. */
  madeElsewhere: (date: string): string =>
    `An invite link made on another device is valid until ${date}. Create a new one to share it from here; the current one stops working.`,
  noLink: "There's no active invite link. Create one to invite people to the playlist.",
  shareLink: "Share Link",
  copyLink: "Copy Link",
  turnOffLink: "Turn Off Link",
  createLink: "Create Invite Link",
  /** The share sheet's title and the clipboard's label. */
  inviteLink: "Invite link",
  linkCopied: "Link copied",
  linkTurnedOff: "Invite link turned off",
  copyFailed: "Couldn't copy the link",
  shareFailed: "Couldn't share the link",

  members: "Members",
  owner: "Owner",
  you: "You",
  ownerAndYou: "Owner · You",
  /** A member the service keeps no name for. */
  noName: "No name",
  inviteSection: "Invite",

  /** A failed action's title, by action (`collaborationFailure`). */
  failed: {
    make: "Couldn't make the playlist collaborative",
    invite: "Couldn't create the invite link",
    readInvite: "Couldn't read the invite link",
    turnOff: "Couldn't turn off the invite link",
    members: "Couldn't load the members",
    remove: "Couldn't remove the member",
    end: "Couldn't end the collaboration",
    leave: "Couldn't leave the playlist",
  },
  /** Why, by what the service said or the phone found. */
  why: {
    offline: "You're offline. Try again when you're online.",
    notMember: "This playlist is no longer collaborative, or you're no longer in it.",
    notOwner: "Only the owner can do that.",
    ownerCannotLeave: "The owner can't leave the playlist. End the collaboration instead.",
    deleted: "The owner deleted this playlist.",
    notFound: "The playlist or the member is no longer there.",
    taken: "This playlist can't be made collaborative.",
    linkNotValid: "This invite link is no longer valid.",
    full: "The Wave account has reached a limit for collaborative playlists.",
    failed: "Something went wrong. Try again later.",
  },
};
