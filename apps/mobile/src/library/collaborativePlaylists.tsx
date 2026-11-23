/**
 * A collaborative playlist on the phone (docs/spec.md, "Collaborative playlists", What it shows
 * and Refreshing): which playlists are collaborative and changed elsewhere, the members under a
 * page's name, the page's pull every 15 seconds while it is in sight, and the notice a private
 * copy's page gives once.
 */
import type { CollaborativePlaylist } from "@wave/client/db/collaborations";
import { collaborativePageMembers, collaborativePagePull, SYSTEM_SYNC_CLOCK } from "@wave/core";
import type * as Effect from "effect/Effect";
import { useEffect, useMemo } from "react";
import { Text, View } from "react-native";

import { CELL } from "@/catalog/grid";
import { MemberCircle } from "@/catalog/MemberCircle";
import { useCollaborations } from "@/collaboration/collaborativePlaylists";
import { TextButton } from "@/components/TextButton";
import { useScreenSight } from "@/lib/screenSight";
import { useLocalisation } from "@/localisation/localisation";
import { syncCollaborativePage } from "@/sync/startSync";

import { LibraryStore, type LibraryStoreError } from "./LibraryStore";
import { playlistsChanged } from "./playlists";
import { appRuntime } from "./runtime";
import { libraryQuery, useLibraryQuery } from "./sharedQueries";

// oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
const readNotices = LibraryStore.use((store) => store.privateCopyNotices);

/** A pull that brings a change, or a membership change, is a playlists change. */
/** The private copies owing their notice, which `readyScreens.ts` keeps for playlist pages (#1352). */
export const noticesQuery = libraryQuery("privateCopyNotices", { playlists: true }, readNotices);

const NO_NOTICES: readonly number[] = [];
const EMPTY = new Map<number, CollaborativePlaylist>();

/**
 * Each playlist's members as last shown, by sync id: a read that brings the same members
 * keeps the same array, so a page's rows aren't told of a change that isn't one. Holds one
 * entry per collaborative playlist here.
 */
const shownMembers = new Map<string, { readonly key: string; readonly members: Members }>();
type Members = CollaborativePlaylist["members"];

const keptMembers = (held: readonly CollaborativePlaylist[]): CollaborativePlaylist[] => {
  const ids = new Set(held.map((each) => each.syncId));
  for (const syncId of shownMembers.keys()) if (!ids.has(syncId)) shownMembers.delete(syncId);
  return held.map((each) => {
    const key = JSON.stringify(each.members);
    const shown = shownMembers.get(each.syncId);
    if (shown?.key === key) return { ...each, members: shown.members };
    shownMembers.set(each.syncId, { key, members: each.members });
    return each;
  });
};

/**
 * The collaborative playlists here, by local id (the menu's `useCollaborations`), each one's
 * members kept as they were shown while they don't change.
 */
export const useShownCollaborations = (): ReadonlyMap<number, CollaborativePlaylist> => {
  const held = useCollaborations(true);
  return useMemo(() => {
    if (held.size === 0) return EMPTY;
    const byId = new Map<number, CollaborativePlaylist>();
    for (const each of keptMembers([...held.values()])) {
      if (each.playlistId !== null) byId.set(each.playlistId, each);
    }
    return byId;
  }, [held]);
};

/** Runs a write of this device's own marks on [playlistId], then has its queries read again. */
const run = (
  playlistId: number,
  effect: Effect.Effect<void, LibraryStoreError, LibraryStore>,
): void => {
  appRuntime.runPromise(effect).then(
    () => playlistsChanged([playlistId]),
    (error: unknown) => console.warn("[wave] Couldn't update a collaborative playlist", error),
  );
};

/**
 * The page of [playlistId] while it shows: its changed mark goes (and goes again when a pull
 * brings a change while the page is in sight), and while the playlist is collaborative it is
 * pulled at once and every 15 seconds in sight (Core's `collaborativePagePull`). Covered by
 * another screen or Now Playing, or with the app in the background, nothing is pulled.
 */
export const useCollaborativePage = (
  playlistId: number,
  collaboration: CollaborativePlaylist | undefined,
): void => {
  const sight = useScreenSight();
  const collaborative = collaboration !== undefined;
  const unseen = collaboration?.unseen === true;
  useEffect(() => {
    if (unseen)
      run(
        playlistId,
        // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
        LibraryStore.use((store) => store.markCollaborationSeen(playlistId)),
      );
  }, [unseen, playlistId]);
  useEffect(() => {
    if (!collaborative) return;
    const pull = collaborativePagePull({
      clock: SYSTEM_SYNC_CLOCK,
      pull: () => syncCollaborativePage(playlistId),
    });
    pull.visible(sight.visible());
    const stopSight = sight.subscribe(pull.visible);
    return () => {
      stopSight();
      pull.stop();
    };
  }, [collaborative, playlistId, sight]);
};

/**
 * The members under a collaborative playlist's name: their photos (else initials) overlapping,
 * then their first names ("Leo, Ana and Caio").
 */
export function CollaborativeMembers({ collaboration }: { collaboration: CollaborativePlaylist }) {
  const { strings } = useLocalisation();
  const { initials, photoUrls, firstNames } = useMemo(
    () => collaborativePageMembers(collaboration.members),
    [collaboration.members],
  );
  if (firstNames.length === 0) return null;
  const names = strings.collaborativePage.memberNames(firstNames);
  return (
    <View
      accessible
      accessibilityLabel={strings.collaborativePage.membersLabel(names)}
      className="flex-row items-center"
      style={{ gap: CELL }}
    >
      <View className="flex-row">
        {initials.slice(0, 3).map((initial, index) => (
          <MemberCircle
            key={index}
            initial={initial}
            photoUrl={photoUrls[index]}
            stacked={index > 0}
          />
        ))}
      </View>
      <Text numberOfLines={1} className="flex-1 font-sans text-footnote text-secondary">
        {names}
      </Text>
    </View>
  );
}

/** Whether the page of [playlistId] still owes its private copy's notice. */
export const usePrivateCopyNotice = (playlistId: number): boolean => {
  return useLibraryQuery(noticesQuery, NO_NOTICES).includes(playlistId);
};

/**
 * Said once on the page of a playlist that became the member's own copy: it is no longer
 * collaborative and what changes here reaches no one. OK dismisses it for good, on this device.
 */
export function PrivateCopyNotice({ playlistId }: { playlistId: number }) {
  const { strings } = useLocalisation();
  const page = strings.collaborativePage;
  return (
    <View className="rounded-2xl bg-surface" style={{ padding: CELL * 1.75, gap: CELL / 2 }}>
      <Text className="font-sans text-body font-semibold text-foreground">
        {page.privateCopyTitle}
      </Text>
      <Text className="font-sans text-footnote text-secondary">{page.privateCopyBody}</Text>
      <View className="flex-row justify-end">
        <TextButton
          label={page.ok}
          onPress={() =>
            run(
              playlistId,
              // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
              LibraryStore.use((store) => store.dismissPrivateCopyNotice(playlistId)),
            )
          }
        />
      </View>
    </View>
  );
}
