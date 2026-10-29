import { persistedSetting } from "@/lib/persistedSetting";
const followedArtists = persistedSetting<boolean>({
  key: "settings.followedArtists",
  read: (stored) => stored !== "off",
  write: (on) => (on ? null : "off"),
});
export const followedArtistsEnabled = followedArtists.get;
export const setFollowedArtistsEnabled = followedArtists.set;
export const useFollowedArtistsEnabled = followedArtists.useValue;
