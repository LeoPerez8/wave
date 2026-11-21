/** Opening an invite link on the phone (docs/spec.md › Collaborative playlists, Invite link). */
export const inviteJoinEn = {
  invitedBy: (owner: string) => `${owner} invited you to`,
  invited: "You're invited to",
  unnamedPlaylist: "A collaborative playlist",
  allows: "You'll be able to add, remove and reorder songs with the other members.",
  join: "Join",
  cancel: "Cancel",
  joiningAs: (account: string) => `You join as ${account}`,
  signInTitle: "Sign in to join",
  signInMessage:
    "Collaborative playlists use the Wave account. After you sign in, the invite opens again.",
  fullTitle: "The service is full",
  fullMessage: "Wave can't take new accounts right now, so you can't join this playlist.",
  notValidTitle: "This invite is no longer valid",
  notValidMessage: "Ask whoever invited you for a new link.",
  couldntOpen: "Couldn't open the invite",
  couldntJoin: "Couldn't join the playlist",
  offlineMessage: "Connect to the internet, then tap the link again.",
  failedMessage: "Try again in a moment.",
  joined: (playlist: string) => `You joined ${playlist}. It shows in your Library after the sync.`,
};
