/**
 * What a collaborative playlist shows of its members on the phone (docs/spec.md,
 * "Collaborative playlists", What it shows and Refreshing): each member's photo (else initial)
 * and first name under the playlist's name, the initial and full name of who added each entry, and the
 * page's own pull while it is in sight.
 */
import type { CollaborationMember } from "./collaborationRequests.ts";
import type { SyncClock } from "./syncTriggers.ts";

/** While a collaborative playlist's page is in sight, it is pulled this often. */
export const COLLABORATIVE_PAGE_PULL_MS = 15_000;

/** The name a member goes by, trimmed; null when the service has none. */
const nameOf = (name: string | null): string | null => {
  const trimmed = name?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

/** A name's first letter, a whole code point, in capitals. */
const initialOf = (name: string): string => (Array.from(name)[0] ?? "").toLocaleUpperCase();

/** A name's first word. */
const firstNameOf = (name: string): string => name.split(/\s+/)[0] ?? name;

/** The members a playlist's page names under its name. */
export interface CollaborativePageMembers {
  /** One per named member, in the record's order (the owner first). */
  readonly initials: readonly string[];
  /** Each initial's member's photo, at the same place; null where the initial shows. */
  readonly photoUrls: readonly (string | null)[];
  readonly firstNames: readonly string[];
}

/**
 * The initials, photos and first names of [members] (the owner first, then the others in the
 * order they joined). A member the service has no name for shows none of them.
 */
export const collaborativePageMembers = (
  members: readonly CollaborationMember[],
): CollaborativePageMembers => {
  const named = members.flatMap((member) => {
    const name = nameOf(member.name);
    return name === null ? [] : [{ name, photoUrl: member.photoUrl }];
  });
  return {
    initials: named.map(({ name }) => initialOf(name)),
    photoUrls: named.map(({ photoUrl }) => photoUrl),
    firstNames: named.map(({ name }) => firstNameOf(name)),
  };
};

/** Who added an entry: their initial for the row, their full name for the song's menu. */
export interface EntryAdder {
  readonly initial: string;
  readonly name: string;
}

/**
 * The member who added an entry ([addedBy], the account the service recorded), or null: an
 * entry of a deleted account, of an account no longer in the playlist, of one without a
 * name, or one from before collaboration shows no one.
 */
export const entryAdder = (
  addedBy: string | null | undefined,
  members: readonly CollaborationMember[],
): EntryAdder | null => {
  if (addedBy == null) return null;
  const member = members.find((each) => each.accountId === addedBy);
  const name = member === undefined ? null : nameOf(member.name);
  return name === null ? null : { initial: initialOf(name), name };
};

export interface CollaborativePagePullInput {
  readonly clock: SyncClock;
  /** Pulls the playlist; a failure only waits for the next turn. */
  readonly pull: () => Promise<unknown>;
}

export interface CollaborativePagePull {
  /** The page came into sight ([shown] true) or went out of it (covered, the app in the background). */
  readonly visible: (shown: boolean) => void;
  /** The page closed: nothing more is pulled. */
  readonly stop: () => void;
}

/**
 * Pulls a collaborative playlist while its page is in sight: at once when it shows, unless the
 * last pull started less than [COLLABORATIVE_PAGE_PULL_MS] ago (then once that much has passed),
 * and again that long after each pull ends. Out of sight nothing is pulled, and one pull
 * runs at a time.
 */
export const collaborativePagePull = ({
  clock,
  pull,
}: CollaborativePagePullInput): CollaborativePagePull => {
  let shown = false;
  let stopped = false;
  let running = false;
  /** When the last pull started, if one did. */
  let lastStart: number | null = null;
  let cancel: (() => void) | null = null;

  const clear = (): void => {
    cancel?.();
    cancel = null;
  };

  const start = (): void => {
    clear();
    if (!shown || stopped || running) return;
    running = true;
    lastStart = clock.now();
    void pull()
      .catch(() => {})
      .then(() => {
        running = false;
        if (shown && !stopped) cancel = clock.after(COLLABORATIVE_PAGE_PULL_MS, start);
      });
  };

  return {
    visible: (now) => {
      if (stopped || now === shown) return;
      shown = now;
      clear();
      // The pull on its way sets the next one when it ends.
      if (!shown || running) return;
      const since = lastStart === null ? Infinity : clock.now() - lastStart;
      if (since >= COLLABORATIVE_PAGE_PULL_MS) start();
      else cancel = clock.after(COLLABORATIVE_PAGE_PULL_MS - since, start);
    },
    stop: () => {
      stopped = true;
      shown = false;
      clear();
    },
  };
};
