/**
 * A collaborative playlist's menu entries on the phone (docs/spec.md, Collaborative playlists,
 * The menu): Make Collaborative, Invite, Members, End Collaboration and Leave Playlist. Core
 * decides which entries show (`itemActions`) and what they say (`collaborativeMenu.ts`); this
 * asks first, sends each request through the sync service (`@/sync/collaborations`), keeps what
 * it answers in the Library store, and shows a plain message when it is refused or offline.
 */
import type { CollaborativePlaylist } from "@wave/client/db/collaborations";
import {
  collaborationFailure,
  collaborativeMemberRows,
  collaborativeSignInAlert,
  confirmEndCollaboration,
  confirmLeavePlaylist,
  confirmMakeCollaborative,
  confirmRemoveMember,
  entryDivider,
  inviteView,
  type ActiveInvite,
  type CollaborationMember,
  type CollaborationResult,
  type CollaborativeAction,
  type CreatedInvite,
  type InviteView,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Share, Text, View } from "react-native";

import { CatalogLine } from "@/catalog/CatalogLine";
import { EntryRow } from "@/catalog/EntryRow";
import { CELL, grid } from "@/catalog/grid";
import { MemberCircle } from "@/catalog/MemberCircle";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { libraryQuery, useLibraryQuery } from "@/library/hooks";
import { LibraryStore, type LibraryStoreError } from "@/library/LibraryStore";
import { markLinkOffered } from "@/library/offeredLink";
import { playlistsChanged } from "@/library/playlists";
import { appRuntime } from "@/library/runtime";
import { currentLocalisation, useLocalisation } from "@/localisation/localisation";
import { WaveNative } from "@/native/waveNative";
import { confirmAction, showMessage } from "@/overlay/alert";
import { CardEntries } from "@/overlay/CardEntries";
import { useOverlayFlow } from "@/overlay/flow";
import { followUp, openOverlay } from "@/overlay/overlay";
import { showToast } from "@/overlay/toast";
import { collaborations } from "@/sync/collaborations";
import { openWaveAccount } from "@/sync/openWaveAccount";
import { waveSignedIn } from "@/sync/waveSignedIn";

/** The playlist a collaborative entry acts on: any `PlaylistRow` will do. */
export interface CollaborativeTarget {
  readonly id: number;
  readonly name: string;
  /** The id the service knows it by. */
  readonly syncId?: string | undefined;
}

const text = () => currentLocalisation().strings.collaborativeMenu;

const store = <A,>(
  run: (store: LibraryStore["Service"]["collaborations"]) => Effect.Effect<A, LibraryStoreError>,
): Promise<A> =>
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  appRuntime.runPromise(LibraryStore.use((library) => run(library.collaborations)));

/** The collaborative playlists here, which `readyScreens.ts` keeps for their pages (#1352). */
export const listCollaborations = libraryQuery(
  "collaborations",
  { playlists: true },
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  LibraryStore.use((library) => library.collaborations.list),
);

const NO_COLLABORATIONS: readonly CollaborativePlaylist[] = [];

/**
 * The account's collaborative playlists on this device, by local playlist id, kept current as
 * playlists change; none while [enabled] is false (a menu that doesn't need them).
 */
export const useCollaborations = (enabled: boolean): ReadonlyMap<number, CollaborativePlaylist> => {
  const rows = useLibraryQuery(enabled ? listCollaborations : null, NO_COLLABORATIONS);
  return useMemo(
    () =>
      new Map(
        rows.flatMap((row) => (row.playlistId === null ? [] : [[row.playlistId, row] as const])),
      ),
    [rows],
  );
};

/** The playlist [id]'s collaboration as the store holds it now; null when it has none. */
const collaborationNow = async (id: number): Promise<CollaborativePlaylist | null> =>
  (await store((calls) => calls.list)).find((row) => row.playlistId === id) ?? null;

/** Says why [action] didn't happen, when [result] isn't done; true when it is. */
const done = async (
  action: CollaborativeAction,
  result: CollaborationResult<unknown>,
): Promise<boolean> => {
  const failure = collaborationFailure(action, result, currentLocalisation().language);
  if (failure === null) return true;
  await showMessage(failure.title, failure.message);
  return false;
};

/** A store write that failed after the service took the action: said as that action's failure. */
const storeFailed = (action: CollaborativeAction) => (): Promise<void> =>
  done(action, { type: "failed", status: null }).then(() => {});

/** The other members of [collaboration]: those End Collaboration and Delete count. */
export const otherMembers = (collaboration: CollaborativePlaylist | undefined): number =>
  collaboration === undefined ? 0 : collaboration.members.filter((member) => !member.self).length;

// ---------------------------------------------------------------------------
// Make Collaborative

/**
 * Make Collaborative: signed out of the Wave account, it asks to sign in (Settings › Accounts);
 * signed in, it asks first, then makes the playlist collaborative, keeps the collaboration and
 * opens Invite.
 */
export const makeCollaborativeFlow = (playlist: CollaborativeTarget): Promise<void> =>
  followUp(async () => {
    const { language } = currentLocalisation();
    const { syncId } = playlist;
    if (syncId === undefined) return;
    if (!(await waveSignedIn())) {
      if (await confirmAction(collaborativeSignInAlert(language))) openWaveAccount();
      return;
    }
    if (!(await confirmAction(confirmMakeCollaborative(playlist.name, language)))) return;
    const made = await collaborations.make(syncId);
    if (made.type !== "done") return void (await done("make", made));
    try {
      await store((calls) => calls.convert(playlist.id, made.value));
    } catch {
      return storeFailed("make")();
    } finally {
      playlistsChanged([playlist.id]);
    }
    openInvite(playlist);
  });

// ---------------------------------------------------------------------------
// End Collaboration and Leave Playlist

/** End Collaboration: asks first, saying the others keep a copy, then ends it. */
export const endCollaborationFlow = (playlist: CollaborativeTarget): Promise<void> =>
  followUp(async () => {
    const { syncId } = playlist;
    if (syncId === undefined) return;
    const others = otherMembers((await collaborationNow(playlist.id)) ?? undefined);
    const question = confirmEndCollaboration(others, currentLocalisation().language);
    if (!(await confirmAction(question))) return;
    if (!(await done("end", await collaborations.end(syncId)))) return;
    await store((calls) => calls.forget(syncId))
      .catch(storeFailed("end"))
      .finally(() => playlistsChanged([playlist.id]));
  });

/**
 * Leave Playlist: asks first ([onConfirm] runs once confirmed: the selection bar ends selection
 * there), then leaves; the playlist goes from this phone at once ([onLeft]: leave its page) and
 * from the account's other phones at their next pull.
 */
export const leavePlaylistFlow = (
  playlist: CollaborativeTarget,
  onLeft?: () => void,
  onConfirm?: () => void,
): Promise<void> =>
  followUp(async () => {
    const { syncId } = playlist;
    if (syncId === undefined) return;
    const question = confirmLeavePlaylist(playlist.name, currentLocalisation().language);
    if (!(await confirmAction(question))) return;
    onConfirm?.();
    if (!(await done("leave", await collaborations.leave(syncId)))) return;
    try {
      await store((calls) => calls.leave(syncId));
      onLeft?.();
    } catch {
      await storeFailed("leave")();
    } finally {
      playlistsChanged();
    }
  });

// ---------------------------------------------------------------------------
// Invite

/** What Invite reads on opening: the link this phone made, and the service's active one. */
const readInvite = async (
  syncId: string,
): Promise<{ readonly view: InviteView; readonly problem: string | null }> => {
  const held = await store((calls) => calls.inviteLink(syncId)).catch(
    (): CreatedInvite | null => null,
  );
  const answer = await collaborations.readInvite(syncId);
  const active: ActiveInvite | null | undefined = answer.type === "done" ? answer.value : undefined;
  const { language } = currentLocalisation();
  // The service no longer has the link this phone held (turned off, or replaced elsewhere).
  if (held !== null && answer.type === "done" && active?.expiresAt !== held.expiresAt)
    void store((calls) => calls.keepInviteLink(syncId, null)).catch(() => {});
  return {
    view: inviteView({ held, active, now: Date.now(), language }),
    problem:
      answer.type === "done" || held !== null
        ? null
        : (collaborationFailure("readInvite", answer, language)?.message ?? null),
  };
};

/** Invite: the playlist's link, its last day, Share Link, Copy Link and Turn Off Link. */
export const openInvite = (playlist: CollaborativeTarget): void => {
  const { syncId } = playlist;
  if (syncId === undefined) return;
  openOverlay({
    label: text().invite,
    render: (close) => <InviteCard syncId={syncId} close={close} />,
  });
};

const copyLink = async (url: string): Promise<void> => {
  try {
    await WaveNative.writeClipboardText(text().inviteLink, url);
    // Wave's own copy isn't offered back on the next return.
    markLinkOffered(url);
    void showToast(text().linkCopied);
  } catch {
    void showToast(text().copyFailed);
  }
};

const shareLink = async (url: string): Promise<void> => {
  try {
    await Share.share({ message: url, title: text().inviteLink });
  } catch {
    void showToast(text().shareFailed);
  }
};

/** Invite once the link [made] here is the active one (null: there is none). */
const inviteViewNow = (made: CreatedInvite | null): InviteView =>
  inviteView({
    held: made,
    active: made === null ? null : { createdAt: Date.now(), expiresAt: made.expiresAt },
    now: Date.now(),
    language: currentLocalisation().language,
  });

type InviteEntry = "share" | "copy" | "turnOff" | "create";

const INVITE_ENTRIES: { readonly [K in InviteView["kind"]]: readonly InviteEntry[] } = {
  link: ["share", "copy", "turnOff"],
  elsewhere: ["create", "turnOff"],
  none: ["create"],
};

function InviteCard({ syncId, close }: { syncId: string; close: () => void }) {
  const { strings } = useLocalisation();
  const t = strings.collaborativeMenu;
  const flow = useOverlayFlow();
  const [state, setState] = useState<{
    readonly view: InviteView;
    readonly problem: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void readInvite(syncId).then((read) => {
      if (live) setState(read);
    });
    return () => {
      live = false;
    };
  }, [syncId]);

  const create = async () => {
    const made = await collaborations.createInvite(syncId);
    if (made.type !== "done") {
      close();
      return void (await done("invite", made));
    }
    await store((calls) => calls.keepInviteLink(syncId, made.value)).catch(() => {});
    setState({ view: inviteViewNow(made.value), problem: null });
  };

  const turnOff = async () => {
    const answer = await collaborations.turnOffInvite(syncId);
    if (answer.type !== "done") {
      close();
      return void (await done("turnOff", answer));
    }
    await store((calls) => calls.keepInviteLink(syncId, null)).catch(() => {});
    void showToast(t.linkTurnedOff);
    setState({ view: inviteViewNow(null), problem: null });
  };

  const run = (work: () => Promise<void>) => () => {
    if (busy) return;
    setBusy(true);
    void work().finally(() => setBusy(false));
  };

  const view = state?.view;
  const entries = view === undefined ? [] : INVITE_ENTRIES[view.kind];
  const labels: Record<InviteEntry, string> = {
    share: t.shareLink,
    copy: t.copyLink,
    turnOff: t.turnOffLink,
    create: t.createLink,
  };
  const press: Record<InviteEntry, () => void> = {
    share: () => view?.kind === "link" && void shareLink(view.url),
    copy: () => view?.kind === "link" && void copyLink(view.url),
    turnOff: run(turnOff),
    create: run(create),
  };
  const line =
    view === undefined
      ? null
      : view.kind === "link"
        ? view.lastDay
        : view.kind === "none"
          ? (state?.problem ?? t.noLink)
          : view.line;

  return (
    <>
      <View style={{ paddingTop: CELL, paddingBottom: CELL * 1.5, gap: CELL }}>
        <CatalogLine>{t.invite}</CatalogLine>
        {view?.kind === "link" && (
          <View
            className="rounded-lg bg-fill"
            style={{ paddingHorizontal: CELL * 1.5, paddingVertical: CELL }}
          >
            <Text
              numberOfLines={1}
              ellipsizeMode="middle"
              selectable
              className="font-sans text-footnote text-secondary"
            >
              {view.url}
            </Text>
          </View>
        )}
        {line !== null && (
          <Text
            accessibilityLiveRegion="polite"
            className="font-sans text-subheadline text-secondary"
          >
            {line}
          </Text>
        )}
      </View>
      <Hairline />
      <CardEntries>
        {entries.map((entry, index) => (
          <EntryRow
            key={entry}
            label={labels[entry]}
            destructive={entry === "turnOff"}
            divider={entryDivider(index, entries.length, flow)}
            onPress={press[entry]}
          />
        ))}
      </CardEntries>
    </>
  );
}

// ---------------------------------------------------------------------------
// Members

/**
 * Members: each member with an initial and the Google account name, the owner marked. The
 * owner sees Remove on the others and Invite; another member sees Leave Playlist ([onLeft]:
 * leave the playlist's page once it's gone).
 */
export const openMembers = (playlist: CollaborativeTarget, onLeft?: () => void): void => {
  const { syncId } = playlist;
  if (syncId === undefined) return;
  void followUp(async () => {
    const held = await collaborationNow(playlist.id);
    openOverlay({
      label: text().members,
      render: (close) => (
        <MembersCard playlist={{ ...playlist, syncId }} held={held} close={close} onLeft={onLeft} />
      ),
    });
  });
};

function MembersCard({
  playlist,
  held,
  close,
  onLeft,
}: {
  playlist: CollaborativeTarget & { readonly syncId: string };
  held: CollaborativePlaylist | null;
  close: () => void;
  onLeft: (() => void) | undefined;
}) {
  const { strings, language } = useLocalisation();
  const t = strings.collaborativeMenu;
  const { syncId } = playlist;
  const [members, setMembers] = useState<readonly CollaborationMember[]>(held?.members ?? []);
  const owned = held?.owned ?? members.some((member) => member.owner && member.self);

  const reload = async (): Promise<boolean> => {
    const answer = await collaborations.members(syncId);
    if (answer.type !== "done") {
      close();
      await done("members", answer);
      return false;
    }
    setMembers(answer.value.members);
    void store((calls) => calls.keepMembers(answer.value))
      .catch(() => {})
      .finally(() => playlistsChanged([playlist.id]));
    return true;
  };

  useEffect(() => {
    void reload();
    // Read once, on opening; a removal reads them again.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [syncId]);

  const remove = async (member: CollaborationMember) => {
    const question = confirmRemoveMember(member.name?.trim() || null, language);
    if (!(await confirmAction(question))) return;
    const removed = await collaborations.removeMember(syncId, member.accountId);
    if (!(await done("remove", removed))) return;
    // Removing a member ends the current link: the one this phone held goes too.
    await store((calls) => calls.keepInviteLink(syncId, null)).catch(() => {});
    await reload();
  };

  const rows = collaborativeMemberRows(members, { owned }, language);

  return (
    <>
      <CatalogLine>{t.members}</CatalogLine>
      <CardEntries>
        {rows.map((row, index) => {
          const member = members[index];
          return (
            <Fragment key={row.accountId}>
              {index > 0 && <Hairline />}
              <View
                className="flex-row items-center"
                style={{ minHeight: grid.row, gap: CELL * 1.5, paddingVertical: CELL / 2 }}
              >
                <MemberCircle initial={row.initial} photoUrl={row.photoUrl} size="sheet" />
                <View className="flex-1">
                  <Text numberOfLines={1} className="font-sans text-body text-foreground">
                    {row.name}
                  </Text>
                  {row.detail !== null && (
                    <Text numberOfLines={1} className="font-sans text-footnote text-secondary">
                      {row.detail}
                    </Text>
                  )}
                </View>
                {row.removable && member !== undefined && (
                  <TextButton
                    label={t.remove}
                    tone="destructive"
                    accessibilityLabel={`${t.remove} ${row.name}`}
                    onPress={() => void remove(member)}
                  />
                )}
              </View>
            </Fragment>
          );
        })}
      </CardEntries>
      <Hairline />
      {owned ? (
        <EntryRow
          label={t.inviteSection}
          divider={false}
          onPress={() => {
            close();
            openInvite(playlist);
          }}
        />
      ) : (
        <EntryRow
          label={strings.itemActions.labels.leavePlaylist}
          destructive
          divider={false}
          onPress={() => {
            close();
            void leavePlaylistFlow(playlist, onLeft);
          }}
        />
      )}
    </>
  );
}
