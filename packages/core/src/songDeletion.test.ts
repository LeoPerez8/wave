import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  catalogueOf,
  confirmSongDeletion,
  confirmSongRemoval,
  songDeletionFailure,
} from "./index.ts";

const pt = catalogueOf("pt-BR");

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
      message: "The files are removed from your phone.",
      action: { label: "Delete", destructive: true },
    });
  });

  test("a large selection's count is grouped", () => {
    const songs = Array.from({ length: 1200 }, (_, i) => ({ title: `Song ${i}` }));
    assert.equal(confirmSongDeletion(songs).title, "Delete 1,200 songs?");
  });

  test("signed in to a Wave account, says the songs leave the account too", () => {
    assert.equal(
      confirmSongDeletion([{ title: "Hey Jude" }], { signedIn: true }).message,
      "The file is removed from your phone, and the song from your Wave account.",
    );
    assert.equal(
      confirmSongDeletion([{ title: "A" }, { title: "B" }], { signedIn: true }).message,
      "The files are removed from your phone, and the songs from your Wave account.",
    );
  });
});

describe("confirmSongRemoval", () => {
  test("names the one missing song and says it leaves the account, but not a phone with its file", () => {
    assert.deepEqual(confirmSongRemoval([{ title: "Hey Jude" }]), {
      title: "Remove “Hey Jude” from your Library?",
      message:
        "It leaves your Wave account too. Your other phones lose it at their next sync, unless they have its file.",
      action: { label: "Remove", destructive: true },
    });
  });

  test("counts several", () => {
    assert.deepEqual(confirmSongRemoval([{ title: "A" }, { title: "B" }]), {
      title: "Remove 2 songs from your Library?",
      message:
        "They leave your Wave account too. Your other phones lose them at their next sync, unless they have their files.",
      action: { label: "Remove", destructive: true },
    });
  });
});

describe("songDeletionFailure", () => {
  test("a large selection's counts are grouped", () => {
    const failures = Array.from({ length: 1001 }, () => ({
      title: "X",
      reason: "denied" as const,
    }));
    assert.equal(
      songDeletionFailure(failures, 1500)?.title,
      "Couldn't delete 1,001 of 1,500 songs",
    );
  });

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

describe("in Portuguese", () => {
  test("the confirmations count and name songs, with the glossary's Apagar and Remover", () => {
    const songs = Array.from({ length: 1200 }, (_, i) => ({ title: `Song ${i}` }));
    assert.deepEqual(confirmSongDeletion(songs, { signedIn: true }, pt), {
      title: "Apagar 1.200 músicas?",
      message: "Os arquivos são removidos do seu celular, e as músicas, da sua Conta Wave.",
      action: { label: "Apagar", destructive: true },
    });
    assert.deepEqual(confirmSongRemoval([{ title: "Hey Jude" }], pt), {
      title: "Remover “Hey Jude” da sua Biblioteca?",
      message:
        "Ela também sai da sua Conta Wave. Seus outros celulares a perdem na próxima sincronização, a menos que tenham o arquivo dela.",
      action: { label: "Remover", destructive: true },
    });
  });

  test("a failed delete says why in Portuguese", () => {
    assert.deepEqual(songDeletionFailure([{ title: "Hey Jude", reason: "denied" }], 1, pt), {
      title: "Não foi possível apagar “Hey Jude”",
      message: "O Wave não tem permissão para apagá-lo. A música continua na sua biblioteca.",
    });
    const failures = ["A", "B", "C", "D"].map((title) => ({ title, reason: "missing" as const }));
    assert.deepEqual(songDeletionFailure(failures, 5, pt), {
      title: "Não foi possível apagar 4 de 5 músicas",
      message: [
        "Elas continuam na sua biblioteca.",
        "“A”: o arquivo já não existe.",
        "“B”: o arquivo já não existe.",
        "“C”: o arquivo já não existe.",
        "E mais 1.",
      ].join("\n"),
    });
  });
});
