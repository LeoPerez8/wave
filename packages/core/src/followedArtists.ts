import { artistPhotoName } from "./artistPhoto.ts";

/** One follow across Library and online pages; namesakes share this name key. */
export const followArtistKey = artistPhotoName;

export type FollowLevel = "releases" | "shows";
export interface FollowedArtist {
  readonly key: string;
  readonly name: string;
  readonly level: FollowLevel;
  readonly followedAt: number;
  readonly deezerId: number | null;
  readonly ytBrowseId: string | null;
}

export interface FollowLevelEntry {
  readonly action: FollowLevel | "unfollow";
  readonly label: string;
  readonly checked: boolean;
}
/** UI renders these choices without deciding which levels are available. */
export const followLevelEntries = (level: FollowLevel | null): readonly FollowLevelEntry[] => [
  { action: "releases", label: "New releases", checked: level === "releases" },
  ...(level === null ? [] : [{ action: "unfollow" as const, label: "Unfollow", checked: false }]),
];
