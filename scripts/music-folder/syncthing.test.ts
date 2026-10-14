import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { syncProblems, type FolderSync } from "./syncthing.ts";

const synced: FolderSync = {
  label: "Musicas",
  paused: false,
  state: "idle",
  needItems: 0,
  errors: 0,
  devices: [
    { name: "S24+", connected: true, completion: 100, needItems: 0 },
    { name: "Ygor", connected: false, completion: 100, needItems: 0 },
  ],
};

describe("syncProblems", () => {
  it("passes a folder that is idle and complete on every device", () => {
    assert.deepEqual(syncProblems([synced], []), []);
  });

  it("names what is out of sync", () => {
    const problems = syncProblems(
      [
        { ...synced, state: "syncing", needItems: 3, errors: 1 },
        { ...synced, label: "Músicas Ygor", paused: true },
        {
          ...synced,
          label: "Third",
          devices: [{ name: "S24+", connected: true, completion: 97.5, needItems: 12 }],
        },
      ],
      [],
    );
    assert.deepEqual(problems, [
      "Musicas: state is syncing, not idle",
      "Musicas: this PC still needs 3 items",
      "Musicas: 1 item errors",
      "Músicas Ygor: the folder is paused",
      "Third: S24+ is at 97.5% (needs 12 items)",
    ]);
  });

  it("skips the devices the owner chose to ignore", () => {
    const behind = {
      ...synced,
      devices: [{ name: "Ygor", connected: false, completion: 40, needItems: 900 }],
    };
    assert.deepEqual(syncProblems([behind], ["ygor"]), []);
  });
});
