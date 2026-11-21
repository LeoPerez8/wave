import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  catalogueOf,
  collaborationFailure,
  collaborativeMemberRows,
  collaborativeSignInAlert,
  confirmEndCollaboration,
  confirmLeavePlaylist,
  confirmMakeCollaborative,
  confirmRemoveMember,
  confirmsFirst,
  confirmPlaylistDeletion,
  inviteView,
  isDestructiveAction,
  itemActions,
  type ActionItem,
  type CollaborationMember,
  type ItemActionEntry,
} from "./index.ts";

const names = (entries: readonly ItemActionEntry[]): string[] =>
  entries.map((entry) => entry.action);

const menu = (item: ActionItem): string[] =>
  names(itemActions({ kind: "playlist", items: [item], here: "/" }));

/** The selection bar's entries for [items]. */
const bar = (items: ActionItem[]): string[] =>
  names(
    itemActions({
      kind: "playlist",
      items,
      here: "/library/playlists",
      surface: "selection",
    }),
  );

/** The entries after Share, where the collaborative ones go. */
const afterShare = (entries: readonly string[]): string[] =>
  entries.slice(entries.indexOf("share") + 1);

describe("a playlist's menu", () => {
  test("an ordinary playlist offers Make Collaborative after Share, then Delete Playlist", () => {
    assert.deepEqual(afterShare(menu({})), ["makeCollaborative", "deletePlaylist"]);
  });

  test("the owner gets Invite, Members and End Collaboration, and keeps Delete Playlist", () => {
    assert.deepEqual(afterShare(menu({ collaboration: "owner" })), [
      "invite",
      "members",
      "endCollaboration",
      "deletePlaylist",
    ]);
  });

  test("another member gets Members, and Leave Playlist in place of Delete Playlist", () => {
    const entries = menu({ collaboration: "member" });
    assert.deepEqual(afterShare(entries), ["members", "leavePlaylist"]);
    for (const ownerOnly of ["invite", "endCollaboration", "deletePlaylist", "makeCollaborative"])
      assert.ok(!entries.includes(ownerOnly), ownerOnly);
  });

  test("any member renames; the image stays each member's own", () => {
    const entries = menu({ collaboration: "member" });
    assert.ok(entries.includes("renamePlaylist"));
    assert.ok(entries.includes("changeImage"));
  });

  test("the Shazam playlist has no Make Collaborative", () => {
    assert.deepEqual(afterShare(menu({ shazam: true })), ["deletePlaylist"]);
  });

  test("Fix Songs still comes just before Delete Playlist or Leave Playlist", () => {
    const songs = [{ fixable: true }];
    const subject = (collaboration?: "owner" | "member") =>
      names(
        itemActions({
          kind: "playlist",
          items: [{ songs, ...(collaboration === undefined ? {} : { collaboration }) }],
          here: "/",
          onlineLookups: true,
        }),
      );
    assert.deepEqual(subject("owner").slice(-2), ["fixSongs", "deletePlaylist"]);
    assert.deepEqual(subject("member").slice(-2), ["fixSongs", "leavePlaylist"]);
  });

  test("selected playlists offer Delete Playlists only when none is another account's", () => {
    assert.ok(bar([{}, { collaboration: "owner" }]).includes("deletePlaylists"));
    assert.ok(!bar([{}, { collaboration: "member" }]).includes("deletePlaylists"));
    // The bar has no collaborative entries: they are a single playlist's.
    for (const entry of bar([{}, {}]))
      assert.ok(!["makeCollaborative", "invite", "members"].includes(entry), entry);
  });

  test("Leave Playlist and End Collaboration are destructive and ask first", () => {
    for (const action of ["leavePlaylist", "endCollaboration"] as const) {
      assert.ok(isDestructiveAction(action), action);
      assert.ok(confirmsFirst(action), action);
    }
    assert.ok(!isDestructiveAction("makeCollaborative"));
  });
});

describe("the labels", () => {
  test("follow the glossary in both languages", () => {
    const en = catalogueOf("en").itemActions.labels;
    const pt = catalogueOf("pt-BR").itemActions.labels;
    assert.deepEqual(
      [en.makeCollaborative, en.invite, en.members, en.endCollaboration, en.leavePlaylist],
      ["Make Collaborative", "Invite", "Members", "End Collaboration", "Leave Playlist"],
    );
    assert.deepEqual(
      [pt.makeCollaborative, pt.invite, pt.members, pt.endCollaboration, pt.leavePlaylist],
      ["Tornar Colaborativa", "Convidar", "Membros", "Encerrar Colaboração", "Sair da Playlist"],
    );
  });
});

describe("the questions", () => {
  test("Make Collaborative says what members can do and what stays with the owner", () => {
    const en = confirmMakeCollaborative("Friday Night");
    assert.equal(en.title, "Make “Friday Night” collaborative?");
    assert.match(en.message, /add, remove and reorder songs/);
    assert.match(en.message, /Only you invite/);
    assert.equal(en.action.label, "Make Collaborative");
    assert.notEqual(en.action.destructive, true);
    const pt = confirmMakeCollaborative("Rolê de sexta", "pt-BR");
    assert.equal(pt.title, "Tornar “Rolê de sexta” colaborativa?");
    assert.equal(pt.action.label, "Tornar Colaborativa");
  });

  test("signed out, Make Collaborative asks to sign in to the Wave account", () => {
    const en = collaborativeSignInAlert();
    assert.equal(en.title, "Sign in to the Wave account");
    assert.match(en.message, /Wave account/);
    assert.equal(en.action.label, "Sign In");
    assert.equal(collaborativeSignInAlert("pt-BR").title, "Inicie sessão na conta Wave");
  });

  test("Leave says the playlist goes and the member's songs stay for the others", () => {
    const en = confirmLeavePlaylist("Friday Night");
    assert.equal(en.title, "Leave “Friday Night”?");
    assert.match(en.message, /stay for the others/);
    assert.deepEqual(en.action, { label: "Leave", destructive: true });
    assert.equal(confirmLeavePlaylist("Rolê de sexta", "pt-BR").action.label, "Sair");
  });

  test("Remove says the member keeps a copy and the current link stops working", () => {
    const en = confirmRemoveMember("Ana Souza");
    assert.equal(en.title, "Remove Ana Souza?");
    assert.match(en.message, /copy of their own/);
    assert.match(en.message, /invite link stops working/);
    assert.deepEqual(en.action, { label: "Remove", destructive: true });
    assert.equal(confirmRemoveMember(null).title, "Remove this member?");
  });

  test("End Collaboration and Delete count the other members, who keep a copy", () => {
    assert.match(confirmEndCollaboration(2).message, /The 2 other members keep a copy/);
    assert.match(confirmEndCollaboration(1).message, /The other member keeps a copy/);
    assert.match(confirmEndCollaboration(0).message, /yours alone again/);
    assert.match(confirmEndCollaboration(2, "pt-BR").message, /Os 2 outros membros ficam/);
    const deleted = confirmPlaylistDeletion([{ name: "Friday Night", otherMembers: 2 }]);
    assert.equal(deleted.title, "Delete Friday Night?");
    assert.match(deleted.message, /deleted for you\. The 2 other members keep a copy/);
    // An ordinary playlist's question stays as it was.
    assert.deepEqual(
      confirmPlaylistDeletion([{ name: "Gym" }]),
      confirmPlaylistDeletion([{ name: "Gym", otherMembers: 0 }]),
    );
  });
});

const member = (fields: Partial<CollaborationMember>): CollaborationMember => ({
  accountId: "a",
  name: "Leo Perez",
  joinedAt: 0,
  owner: false,
  self: false,
  ...fields,
});

describe("Members", () => {
  const members = [
    member({ accountId: "leo", name: "Leo Perez", owner: true, self: true }),
    member({ accountId: "ana", name: "ana souza" }),
    member({ accountId: "gone", name: null }),
  ];

  test("each member has an initial and a name, the owner and you marked", () => {
    const rows = collaborativeMemberRows(members, { owned: true });
    assert.deepEqual(
      rows.map(({ initial, name, detail }) => [initial, name, detail]),
      [
        ["L", "Leo Perez", "Owner · You"],
        ["A", "ana souza", null],
        ["?", "No name", null],
      ],
    );
    assert.equal(
      collaborativeMemberRows(members, { owned: true }, "pt-BR")[0]?.detail,
      "Dono · Você",
    );
  });

  test("only the owner sees Remove, and never on themselves", () => {
    const owner = collaborativeMemberRows(members, { owned: true });
    assert.deepEqual(
      owner.map((row) => row.removable),
      [false, true, true],
    );
    const other = collaborativeMemberRows(
      [members[0]!, member({ accountId: "me", name: "Caio", self: true })].map((each) =>
        each.accountId === "leo" ? { ...each, self: false } : each,
      ),
      { owned: false },
    );
    assert.deepEqual(
      other.map((row) => [row.removable, row.detail]),
      [
        [false, "Owner"],
        [false, "You"],
      ],
    );
  });
});

describe("Invite", () => {
  const now = Date.UTC(2026, 10, 20, 12);
  const expiresAt = Date.UTC(2026, 10, 27, 12);

  test("the link this device made shows with its last day", () => {
    const view = inviteView({
      held: { url: "https://x/invite#t", expiresAt },
      active: { createdAt: now, expiresAt },
      now,
    });
    assert.equal(view.kind, "link");
    assert.equal(view.kind === "link" ? view.url : null, "https://x/invite#t");
    assert.match(view.kind === "link" ? view.lastDay : "", /Valid until Nov 27\./);
    assert.match(
      view.kind === "link" ? view.lastDay : "",
      /Anyone with the link and a Wave account/,
    );
  });

  test("a link another device made shows its last day without the address", () => {
    const view = inviteView({ held: null, active: { createdAt: now, expiresAt }, now });
    assert.equal(view.kind, "elsewhere");
    assert.match(view.kind === "elsewhere" ? view.line : "", /made on another device/);
    // The link this device holds was replaced by one made elsewhere.
    assert.equal(
      inviteView({
        held: { url: "https://x/invite#old", expiresAt: expiresAt - 1000 },
        active: { createdAt: now, expiresAt },
        now,
      }).kind,
      "elsewhere",
    );
  });

  test("with no active link, or a held one past its day, there is only Create Invite Link", () => {
    assert.equal(inviteView({ held: null, active: null, now }).kind, "none");
    assert.equal(
      inviteView({ held: { url: "https://x/invite#t", expiresAt }, active: null, now }).kind,
      "none",
    );
    assert.equal(
      inviteView({
        held: { url: "https://x/invite#t", expiresAt },
        active: undefined,
        now: expiresAt + 1,
      }).kind,
      "none",
    );
  });

  test("when the service can't be asked, the link held here shows until its day", () => {
    const view = inviteView({
      held: { url: "https://x/invite#t", expiresAt },
      active: undefined,
      now,
    });
    assert.equal(view.kind, "link");
  });

  test("the last day reads in Portuguese", () => {
    const view = inviteView({
      held: { url: "https://x/invite#t", expiresAt },
      active: { createdAt: now, expiresAt },
      now,
      language: "pt-BR",
    });
    assert.match(view.kind === "link" ? view.lastDay : "", /^Vale até 27 de nov/);
  });
});

describe("a refused or failed action", () => {
  test("says plainly why, per action", () => {
    const offline = collaborationFailure("make", { type: "offline" });
    assert.equal(offline?.title, "Couldn't make the playlist collaborative");
    assert.match(offline?.message ?? "", /offline/i);
    assert.match(
      collaborationFailure("leave", { type: "refused", refusal: "notMember" })?.message ?? "",
      /no longer collaborative/,
    );
    assert.match(
      collaborationFailure("invite", { type: "refused", refusal: "notOwner" })?.message ?? "",
      /Only the owner/,
    );
    assert.match(
      collaborationFailure("make", { type: "refused", refusal: "full", limit: "x" })?.message ?? "",
      /limit/,
    );
    assert.match(
      collaborationFailure("remove", { type: "failed", status: 500 })?.message ?? "",
      /Try again/,
    );
    assert.equal(collaborationFailure("end", { type: "done", value: null }), null);
  });

  test("reads in Portuguese", () => {
    const pt = collaborationFailure("leave", { type: "offline" }, "pt-BR");
    assert.equal(pt?.title, "Não foi possível sair da playlist");
    assert.match(pt?.message ?? "", /offline/);
  });
});
