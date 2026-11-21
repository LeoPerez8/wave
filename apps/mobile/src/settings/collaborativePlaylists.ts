import { persistedSetting } from "@/lib/persistedSetting";

/**
 * Collaborative playlists (docs/spec.md, "Collaborative playlists", Rollout), off until their
 * last ticket turns them on; Settings › Developer turns them on for testing. On, each sync keeps
 * the account's collaborative playlists and syncs each one another account owns. This phone
 * only, never synced with the Wave account.
 */
const collaborativePlaylists = persistedSetting<boolean>({
  key: "settings.collaborativePlaylists",
  synced: false,
  read: (stored) => stored === "on",
  write: (on) => (on ? "on" : null),
});

/** Whether the switch is on, read as each sync starts. */
export const collaborativePlaylistsOn = collaborativePlaylists.get;
export const setCollaborativePlaylists = collaborativePlaylists.set;
/** Whether the switch is on; re-renders when Settings changes it. */
export const useCollaborativePlaylists = collaborativePlaylists.useValue;
