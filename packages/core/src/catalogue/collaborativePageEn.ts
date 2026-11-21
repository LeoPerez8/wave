/**
 * A collaborative playlist in the Library and on its page (docs/spec.md, "Collaborative
 * playlists", What it shows): its mark, the members, who added a song and the private copy's
 * notice.
 */
export const collaborativePageEn = {
  /** A collaborative playlist's line in the Library, before its song count ("42 songs"). */
  libraryDetail: (count: string) => `Collaborative · ${count}`,
  /** The changed dot, for screen readers. */
  changed: "Changed on another device",
  /** The members' first names under the playlist's name: three, then how many more. */
  memberNames: (names: readonly string[]): string => {
    const shown = names.slice(0, 3);
    const more = names.length - shown.length;
    if (more > 0) return `${shown.join(", ")} and ${more} more`;
    if (shown.length <= 1) return shown[0] ?? "";
    return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  },
  /** The members' line, for screen readers. */
  membersLabel: (names: string) => `Members: ${names}`,
  /** The song's menu: who added it to the playlist. */
  addedBy: (name: string) => `Added by ${name}`,
  /** Said once on the page of a playlist that became the member's own copy. */
  privateCopyTitle: "This playlist is no longer collaborative",
  privateCopyBody: "It's now your own copy. What you change here doesn't reach the others.",
  ok: "OK",
};
