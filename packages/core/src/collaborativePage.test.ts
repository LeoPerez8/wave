import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  COLLABORATIVE_PAGE_PULL_MS,
  collaborativePagePull,
  collaborativePageMembers,
  entryAdder,
  catalogueOf,
  type CollaborationMember,
  type SyncClock,
} from "./index.ts";

const member = (
  accountId: string,
  name: string | null,
  owner = false,
  self = false,
  photoUrl: string | null = null,
): CollaborationMember => ({ accountId, name, photoUrl, joinedAt: 1, owner, self });

const ANA_PHOTO = "https://lh3.googleusercontent.com/a/ana=s96-c";

const LEO = member("leo", "Leo Perez", true, true);
const ANA = member("ana", "Ana Souza", false, false, ANA_PHOTO);
const CAIO = member("caio", "caio lima");

describe("collaborativePageMembers", () => {
  test("gives each member's initial and first name, the owner first as the record keeps them", () => {
    assert.deepEqual(collaborativePageMembers([LEO, ANA, CAIO]), {
      initials: ["L", "A", "C"],
      photoUrls: [null, ANA_PHOTO, null],
      firstNames: ["Leo", "Ana", "caio"],
    });
  });

  test("leaves out a member the service has no name for", () => {
    const unnamed = member("x", null, false, false, ANA_PHOTO);
    assert.deepEqual(collaborativePageMembers([LEO, unnamed, member("y", "   ")]), {
      initials: ["L"],
      photoUrls: [null],
      firstNames: ["Leo"],
    });
  });

  test("an initial is one whole letter, an accented or a surrogate pair one too", () => {
    const { initials } = collaborativePageMembers([
      member("a", "élise"),
      member("b", "𝒜lex"),
      member("c", "  ômar  "),
    ]);
    assert.deepEqual(initials, ["É", "𝒜", "Ô"]);
  });
});

describe("entryAdder", () => {
  test("names the member who added the entry, with their initial and photo", () => {
    assert.deepEqual(entryAdder("ana", [LEO, ANA]), {
      initial: "A",
      name: "Ana Souza",
      photoUrl: ANA_PHOTO,
    });
  });

  test("an adder without a photo has none, so the row shows the initial", () => {
    assert.deepEqual(entryAdder("leo", [LEO, ANA]), {
      initial: "L",
      name: "Leo Perez",
      photoUrl: null,
    });
  });

  test("a photo without a name shows no one", () => {
    assert.equal(entryAdder("x", [member("x", " ", false, false, ANA_PHOTO)]), null);
  });

  test("shows no one for an entry of a deleted account, an unknown one or none", () => {
    assert.equal(entryAdder("gone", [LEO, ANA]), null);
    assert.equal(entryAdder(null, [LEO, ANA]), null);
    assert.equal(entryAdder(undefined, [LEO, ANA]), null);
    assert.equal(entryAdder("x", [member("x", null)]), null);
  });
});

describe("the catalogue's collaborative page", () => {
  test("names up to three members, then counts the rest", () => {
    const en = catalogueOf("en").collaborativePage;
    const pt = catalogueOf("pt-BR").collaborativePage;
    assert.equal(en.memberNames(["Leo"]), "Leo");
    assert.equal(en.memberNames(["Leo", "Ana"]), "Leo and Ana");
    assert.equal(en.memberNames(["Leo", "Ana", "Caio"]), "Leo, Ana and Caio");
    assert.equal(en.memberNames(["Leo", "Ana", "Caio", "Bia", "Rui"]), "Leo, Ana, Caio and 2 more");
    assert.equal(pt.memberNames(["Leo", "Ana", "Caio"]), "Leo, Ana e Caio");
    assert.equal(pt.memberNames(["Leo", "Ana", "Caio", "Bia"]), "Leo, Ana, Caio e mais 1");
  });
});

/** A clock moved by hand, as `syncTriggers`' tests move theirs. */
const handClock = () => {
  let now = 0;
  let timers: { at: number; run: () => void }[] = [];
  const clock: SyncClock = {
    now: () => now,
    after: (ms, run) => {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((each) => each !== timer);
      };
    },
  };
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = timers.filter((each) => each.at <= until).toSorted((a, b) => a.at - b.at)[0];
      if (next === undefined) break;
      timers = timers.filter((each) => each !== next);
      now = next.at;
      next.run();
      await settled();
    }
    now = until;
  };
  return { clock, advance };
};

const settled = () => new Promise((resolve) => setImmediate(resolve));

describe("collaborativePagePull", () => {
  test("pulls when the page shows, then every 15 seconds while it stays in sight", async () => {
    const { clock, advance } = handClock();
    const pulls: number[] = [];
    const pull = collaborativePagePull({
      clock,
      pull: async () => void pulls.push(clock.now()),
    });
    pull.visible(true);
    await settled();
    assert.deepEqual(pulls, [0]);
    await advance(COLLABORATIVE_PAGE_PULL_MS * 3);
    assert.deepEqual(pulls, [0, 15_000, 30_000, 45_000]);
  });

  test("pulls nothing while the page is covered or the app is in the background", async () => {
    const { clock, advance } = handClock();
    const pulls: number[] = [];
    const pull = collaborativePagePull({ clock, pull: async () => void pulls.push(clock.now()) });
    pull.visible(true);
    await settled();
    await advance(5_000);
    pull.visible(false);
    await advance(60_000);
    assert.deepEqual(pulls, [0]);
  });

  test("back in sight, it pulls once the last pull is 15 seconds old", async () => {
    const { clock, advance } = handClock();
    const pulls: number[] = [];
    const pull = collaborativePagePull({ clock, pull: async () => void pulls.push(clock.now()) });
    pull.visible(true);
    await settled();
    await advance(5_000);
    pull.visible(false);
    await advance(4_000);
    pull.visible(true);
    await settled();
    assert.deepEqual(pulls, [0], "9 seconds after the last pull it waits");
    await advance(6_000);
    assert.deepEqual(pulls, [0, 15_000]);
    pull.visible(false);
    await advance(40_000);
    pull.visible(true);
    await settled();
    assert.deepEqual(pulls, [0, 15_000, 55_000], "long out of sight, it pulls at once");
  });

  test("never runs two pulls at once, and the next waits 15 seconds after one ends", async () => {
    const { clock, advance } = handClock();
    const started: number[] = [];
    let finish: () => void = () => {};
    const pull = collaborativePagePull({
      clock,
      pull: () => {
        started.push(clock.now());
        return new Promise<void>((resolve) => (finish = resolve));
      },
    });
    pull.visible(true);
    await advance(40_000);
    pull.visible(false);
    pull.visible(true);
    assert.deepEqual(started, [0], "the first pull hasn't ended");
    finish();
    await settled();
    await advance(15_000);
    assert.deepEqual(started, [0, 55_000]);
  });

  test("a failed pull waits its 15 seconds as any other", async () => {
    const { clock, advance } = handClock();
    const pulls: number[] = [];
    const pull = collaborativePagePull({
      clock,
      pull: async () => {
        pulls.push(clock.now());
        throw new Error("offline");
      },
    });
    pull.visible(true);
    await settled();
    await advance(15_000);
    assert.deepEqual(pulls, [0, 15_000]);
  });

  test("stopped, it pulls no more", async () => {
    const { clock, advance } = handClock();
    const pulls: number[] = [];
    const pull = collaborativePagePull({ clock, pull: async () => void pulls.push(clock.now()) });
    pull.visible(true);
    await settled();
    pull.stop();
    pull.visible(true);
    await advance(60_000);
    assert.deepEqual(pulls, [0]);
  });
});
