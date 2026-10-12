import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { confirmSongDeletion, songDeletionFailure } from "./index.ts";

describe("confirmSongDeletion", () => {
  test("names the one song and says the file leaves the phone, in destructive style", () => {
    assert.deepEqual(confirmSongDeletion([{ title: "Hey Jude" }]), {
      title: "Delete “Hey Jude”?",
      message: "The file is removed from your phone.",
      action: { label: "Delete", destructive: true },
    });
  });

  test("counts several songs", () => {
    assert.deepEqual(confirmSongDeletion([{ title: "A" }, { title: "B" }, { title: "C" }]), {
      title: "Delete 3 songs?",
      message: "Their files are removed from your phone.",
      action: { label: "Delete", destructive: true },
    });
  });
});

describe("songDeletionFailure", () => {
  test("nothing failed: no error to show", () => {
    assert.equal(songDeletionFailure([], 2), null);
  });

  test("one song that couldn't be deleted says why, and that it stays", () => {
    assert.deepEqual(songDeletionFailure([{ title: "Hey Jude", reason: "missing" }], 1), {
      title: "Couldn't delete “Hey Jude”",
      message: "The file is already gone. The song stays in your library.",
    });
    assert.equal(
      songDeletionFailure([{ title: "X", reason: "denied" }], 1)?.message,
      "Wave isn't allowed to delete it. The song stays in your library.",
    );
    assert.equal(
      songDeletionFailure([{ title: "X", reason: "readOnly" }], 1)?.message,
      "Its storage is read-only. The song stays in your library.",
    );
    assert.equal(
      songDeletionFailure([{ title: "X", reason: "failed" }], 1)?.message,
      "The file couldn't be deleted. The song stays in your library.",
    );
  });

  test("some of several: counts them and names each with its reason, up to three", () => {
    const failures = [
      { title: "A", reason: "missing" },
      { title: "B", reason: "denied" },
      { title: "C", reason: "readOnly" },
      { title: "D", reason: "failed" },
      { title: "E", reason: "failed" },
    ] as const;
    assert.deepEqual(songDeletionFailure(failures, 9), {
      title: "Couldn't delete 5 of 9 songs",
      message:
        "They stay in your library.\n" +
        "“A”: the file is already gone.\n" +
        "“B”: Wave isn't allowed to delete it.\n" +
        "“C”: its storage is read-only.\n" +
        "And 2 more.",
    });
  });
});
