import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { digestOf } from "../../../scripts/ci/release-gate.ts";
import { type StoredUpdate, UPDATES_ORIGIN, latestKey, updateKey } from "./layout.ts";
import { promoteUpdate } from "./promote.ts";
import { publishEarlierNotes, publishLatestApk, publishNotes, publishUpdate } from "./publish.ts";
import { createUpdateService } from "./service.ts";
import { memoryStorage } from "./testing.ts";

const ORIGIN = "https://updates.test";

// Throwaway pairs made for the test run. Nothing here is Wave's key.
const pem = () =>
  generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
const shipped = pem();
const another = pem();

const askFor = (
  storage: ReturnType<typeof memoryStorage>,
  headers: Record<string, string> = {},
): Promise<Response> =>
  createUpdateService(storage).fetch(
    new Request(`${ORIGIN}/v1/manifest`, {
      headers: {
        "expo-protocol-version": "1",
        "expo-platform": "android",
        "expo-channel-name": "ti",
        "expo-runtime-version": "native-a",
        ...headers,
      },
    }),
  );

// `expo export`'s output for one bundle and one image, with the app config CI adds beside it
// (scripts/ci/export-update.sh) when there's one.
const exported = (bundle: string, image = "image", config?: Record<string, unknown>): string => {
  const dir = mkdtempSync(join(tmpdir(), "wave-update-"));
  if (config) writeFileSync(join(dir, "expo-config.json"), JSON.stringify(config));
  mkdirSync(join(dir, "_expo/static/js/android"), { recursive: true });
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "_expo/static/js/android/index.hbc"), bundle);
  writeFileSync(join(dir, "assets/abc"), image);
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      version: 0,
      bundler: "metro",
      fileMetadata: {
        android: {
          bundle: "_expo/static/js/android/index.hbc",
          assets: [{ path: "assets/abc", ext: "png" }],
        },
      },
    }),
  );
  return dir;
};

let clock = Date.parse("2026-10-31T12:00:00.000Z");
let ids = 0;

const publish = (
  storage: ReturnType<typeof memoryStorage>,
  overrides: Partial<Parameters<typeof publishUpdate>[0]> = {},
) =>
  publishUpdate({
    dir: exported("bundle"),
    channel: "ti",
    runtimeVersion: "native-a",
    appConfig: { name: "Wave", version: "1.2.3-ti", extra: { syncUrl: "https://sync.test" } },
    origin: ORIGIN,
    signingKey: shipped.privateKey,
    put: storage.put,
    read: storage.read,
    remove: storage.remove,
    now: () => (clock += 1000),
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    ...overrides,
  });

// The sealed records of each storage's releases, by channel and version, as their GitHub
// Releases carry them (docs/release-provenance.md).
const records = new WeakMap<object, Map<string, Record<string, unknown>>>();
const recordOf = (storage: object, channel: string, version: string) =>
  records.get(storage)?.get(`${channel} ${version}`);

/** What the release gate records for an exported update, with its seal. */
const sealedRecord = (input: {
  version: string;
  channel: string;
  runtimeVersion: string;
  dir: string;
}) => ({
  schema: "wave-release-provenance/1",
  source: "b".repeat(40),
  releaseTag: `v${input.version}`,
  run: { repository: "o/r", id: 1, attempt: 1, event: "push", ref: "refs/heads/main" },
  artifact: {
    build: "full",
    runtimeVersion: input.runtimeVersion,
    updateChannel: input.channel,
    // The gate's own digest, independent of what the update service computes.
    updateSha256: digestOf(input.dir),
    signedSha256: "5".repeat(64),
  },
});

// A release of that version: CI's export carries it in the app config, and the release gate
// recorded the export.
const release = async (
  storage: ReturnType<typeof memoryStorage>,
  version: string,
  overrides: Partial<Parameters<typeof publishUpdate>[0]> = {},
) => {
  const appConfig = { name: "Wave", version };
  const dir = exported(`bundle of ${version}`, `image of ${version}`, appConfig);
  const { channel = "ti", runtimeVersion = "native-a" } = overrides;
  const kept = records.get(storage) ?? new Map();
  records.set(storage, kept);
  kept.set(`${channel} ${version}`, sealedRecord({ version, channel, runtimeVersion, dir }));
  return publish(storage, { dir, appConfig, ...overrides });
};

const promote = (
  storage: ReturnType<typeof memoryStorage>,
  version: string,
  overrides: Partial<Parameters<typeof promoteUpdate>[0]> = {},
) =>
  promoteUpdate({
    channel: "ti",
    version,
    provenance: recordOf(storage, overrides.channel ?? "ti", version),
    origin: ORIGIN,
    signingKey: shipped.privateKey,
    put: storage.put,
    read: storage.read,
    remove: storage.remove,
    now: () => (clock += 1000),
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    ...overrides,
  });

// The `manifest` part of a multipart/mixed answer, as expo-updates reads it.
const manifestOf = async (response: Response) => {
  const boundary = /boundary=(\S+)/.exec(response.headers.get("content-type") ?? "")?.[1];
  assert.ok(boundary, "the answer is multipart");
  const parts = (await response.text()).split(`--${boundary}`);
  const part = parts.find((text) => /name="manifest"/.test(text));
  assert.ok(part, "the answer has a manifest part");
  return JSON.parse(part.slice(part.indexOf("\r\n\r\n") + 4).trim());
};

// The `manifest` part as expo-updates' signature check sees it: its exact body and its header.
const signedPart = async (response: Response) => {
  const boundary = /boundary=(\S+)/.exec(response.headers.get("content-type") ?? "")?.[1];
  const part = (await response.text())
    .split(`--${boundary}`)
    .find((text) => /name="manifest"/.test(text));
  assert.ok(part, "the answer has a manifest part");
  const headerEnd = part.indexOf("\r\n\r\n");
  const header = /^expo-signature: (.*)$/im.exec(part.slice(0, headerEnd))?.[1]?.trim();
  assert.ok(header, "the manifest part has an expo-signature header");
  return { header, body: part.slice(headerEnd + 4, part.lastIndexOf("\r\n")) };
};

// What expo-updates' CodeSigningConfiguration does: SHA256withRSA over the body's UTF-8 bytes.
const accepts = (publicKey: string, part: { header: string; body: string }) => {
  const signature = /(?:^|, )sig="([^"]+)"/.exec(part.header)?.[1];
  assert.ok(signature, "the header's sig is a quoted string");
  return createVerify("RSA-SHA256")
    .update(Buffer.from(part.body, "utf8"))
    .verify(publicKey, signature, "base64");
};

const base64urlSha256 = (text: string) => createHash("sha256").update(text).digest("base64url");

describe("GET /v1/manifest", () => {
  it("answers a published update in the expo-updates protocol", async () => {
    const storage = memoryStorage();
    const id = await publish(storage, { dir: exported("the bundle", "the image") });

    const response = await askFor(storage);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("expo-protocol-version"), "1");
    assert.equal(response.headers.get("expo-sfv-version"), "0");
    assert.match(response.headers.get("cache-control") ?? "", /max-age=0/);
    const manifest = await manifestOf(response);
    assert.equal(manifest.id, id);
    assert.equal(manifest.runtimeVersion, "native-a");
    assert.equal(manifest.launchAsset.hash, base64urlSha256("the bundle"));
    assert.equal(manifest.launchAsset.contentType, "application/javascript");
    assert.equal(manifest.assets.length, 1);
    assert.equal(manifest.assets[0].hash, base64urlSha256("the image"));
    assert.equal(manifest.assets[0].fileExtension, ".png");
    assert.equal(manifest.assets[0].contentType, "image/png");
    assert.ok(manifest.assets[0].url.startsWith(`${ORIGIN}/v1/assets/`));
  });

  it("carries the app config, which Constants.expoConfig reads under an update", async () => {
    const storage = memoryStorage();
    await publish(storage);
    const { extra } = await manifestOf(await askFor(storage));
    assert.equal(extra.expoClient.version, "1.2.3-ti");
    assert.equal(extra.expoClient.extra.syncUrl, "https://sync.test");
  });

  it("answers the newest of a channel's updates", async () => {
    const storage = memoryStorage();
    await publish(storage);
    const newest = await publish(storage);
    assert.equal((await manifestOf(await askFor(storage))).id, newest);
  });

  it("answers 204 when nothing was published", async () => {
    const response = await askFor(memoryStorage());
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("expo-protocol-version"), "1");
  });

  it("answers 204 to a phone already running the newest update", async () => {
    const storage = memoryStorage();
    const id = await publish(storage);
    const response = await askFor(storage, { "expo-current-update-id": id });
    assert.equal(response.status, 204);
  });

  it("never gives one channel the other's update", async () => {
    const storage = memoryStorage();
    const ti = await publish(storage, { channel: "ti" });
    assert.equal((await askFor(storage, { "expo-channel-name": "main" })).status, 204);
    const main = await publish(storage, { channel: "main" });
    const mainAnswer = await askFor(storage, { "expo-channel-name": "main" });
    assert.equal((await manifestOf(mainAnswer)).id, main);
    assert.equal((await manifestOf(await askFor(storage))).id, ti);
  });

  it("never gives a runtime version another's update", async () => {
    const storage = memoryStorage();
    const older = await publish(storage, { runtimeVersion: "native-a" });
    // A native change: the new update reaches only the APKs built with it.
    const newer = await publish(storage, { runtimeVersion: "native-b" });
    assert.equal((await manifestOf(await askFor(storage))).id, older);
    const answer = await askFor(storage, { "expo-runtime-version": "native-b" });
    assert.equal((await manifestOf(answer)).id, newer);
    assert.equal((await askFor(storage, { "expo-runtime-version": "native-c" })).status, 204);
  });

  it("gives a build with no channel nothing", async () => {
    const storage = memoryStorage();
    await publish(storage);
    assert.equal((await askFor(storage, { "expo-channel-name": "none" })).status, 400);
  });

  for (const [header, value] of [
    ["expo-platform", "ios"],
    ["expo-protocol-version", "0"],
    ["expo-runtime-version", ""],
  ] as const) {
    it(`refuses ${header}: "${value}"`, async () => {
      assert.equal((await askFor(memoryStorage(), { [header]: value })).status, 400);
    });
  }
});

describe("a signed update", () => {
  it("is accepted by a phone holding the matching certificate", async () => {
    const storage = memoryStorage();
    await publish(storage);
    const part = await signedPart(await askFor(storage, { "expo-expect-signature": "sig" }));
    assert.equal(accepts(shipped.publicKey, part), true);
    assert.match(part.header, /keyid="main"/);
    assert.match(part.header, /alg="rsa-v1_5-sha256"/);
  });

  it("is rejected by a phone holding another key's certificate", async () => {
    const storage = memoryStorage();
    await publish(storage);
    assert.equal(accepts(another.publicKey, await signedPart(await askFor(storage))), false);
  });

  it("stays valid with non-ASCII text in the app config", async () => {
    const storage = memoryStorage();
    await publish(storage, { appConfig: { name: "Wavê ♪" } });
    assert.equal(accepts(shipped.publicKey, await signedPart(await askFor(storage))), true);
  });

  it("names its files at the origin it was signed for, whatever host was asked", async () => {
    const storage = memoryStorage();
    await publish(storage);
    const response = await createUpdateService(storage).fetch(
      new Request("https://elsewhere.test/v1/manifest", {
        headers: {
          "expo-protocol-version": "1",
          "expo-platform": "android",
          "expo-channel-name": "ti",
          "expo-runtime-version": "native-a",
        },
      }),
    );
    const part = await signedPart(response);
    assert.equal(accepts(shipped.publicKey, part), true);
    assert.ok(JSON.parse(part.body).launchAsset.url.startsWith(`${ORIGIN}/v1/assets/`));
  });

  it("is signed for the URL the app asks", () => {
    const appConfig = new URL("../../mobile/app.config.ts", import.meta.url);
    assert.ok(readFileSync(appConfig, "utf8").includes(`url: "${UPDATES_ORIGIN}/v1/manifest"`));
  });
});

describe("GET /v1/assets/<key>", () => {
  it("serves an update's files by the URLs its manifest gives", async () => {
    const storage = memoryStorage();
    await publish(storage, { dir: exported("the bundle", "the image") });
    const manifest = await manifestOf(await askFor(storage));
    const service = createUpdateService(storage);

    const bundle = await service.fetch(new Request(manifest.launchAsset.url));
    assert.equal(bundle.status, 200);
    assert.equal(await bundle.text(), "the bundle");
    assert.match(bundle.headers.get("cache-control") ?? "", /immutable/);

    const image = await service.fetch(new Request(manifest.assets[0].url));
    assert.equal(image.headers.get("content-type"), "image/png");
    assert.equal(await image.text(), "the image");
  });

  it("answers 404 for an asset it doesn't have, or a key that isn't one", async () => {
    const service = createUpdateService(memoryStorage());
    for (const key of ["0".repeat(64), "..%2Fsecret", "updates"]) {
      const response = await service.fetch(new Request(`${ORIGIN}/v1/assets/${key}`));
      assert.equal(response.status, 404);
    }
  });
});

describe("GET /v1/notes", () => {
  const notes = (word: string) => ({
    en: { new: [`${word} in English`], fixes: [] },
    "pt-BR": { new: [`${word} em português`], fixes: [] },
  });

  const release = (
    storage: ReturnType<typeof memoryStorage>,
    version: string,
    channel: "ti" | "main" = "ti",
    now?: Date,
  ) =>
    publishNotes({
      channel,
      version,
      notes: notes(version),
      put: storage.put,
      read: storage.read,
      ...(now === undefined ? {} : { now: () => now }),
    });

  const askForNotes = (storage: ReturnType<typeof memoryStorage>, query: string) =>
    createUpdateService(storage).fetch(new Request(`${ORIGIN}/v1/notes?${query}`));

  const versions = async (response: Response) =>
    ((await response.json()) as { releases: { version: string }[] }).releases.map(
      (it) => it.version,
    );

  it("answers each release's notes per language, newest first", async () => {
    const storage = memoryStorage({ clock: () => new Date("2026-11-01T09:30:00.000Z") });
    await release(storage, "1.2.3-ti");
    await release(storage, "1.2.4-ti");

    const response = await askForNotes(storage, "channel=ti&from=1.2.2-ti&to=1.2.4-ti");

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await response.json(), {
      releases: [
        { version: "1.2.4-ti", date: "2026-11-01T09:30:00.000Z", notes: notes("1.2.4-ti") },
        { version: "1.2.3-ti", date: "2026-11-01T09:30:00.000Z", notes: notes("1.2.3-ti") },
      ],
    });
  });

  it("dates each release by when its notes were written", async () => {
    let now = new Date("2026-11-01T09:30:00.000Z");
    const storage = memoryStorage({ clock: () => now });
    await release(storage, "1.2.3-ti");
    now = new Date("2026-11-04T18:05:00.000Z");
    await release(storage, "1.2.4-ti");

    const answer = (await (await askForNotes(storage, "channel=ti&from=1.2.2-ti")).json()) as {
      releases: { version: string; date: string }[];
    };

    assert.deepEqual(
      answer.releases.map(({ version, date }) => ({ version, date })),
      [
        { version: "1.2.4-ti", date: "2026-11-04T18:05:00.000Z" },
        { version: "1.2.3-ti", date: "2026-11-01T09:30:00.000Z" },
      ],
    );
  });

  it("leaves out the version the phone had and keeps the one it's on", async () => {
    const storage = memoryStorage();
    for (const version of ["1.2.3-ti", "1.2.4-ti", "1.2.5-ti", "1.2.6-ti"])
      await release(storage, version);
    const answer = await askForNotes(storage, "channel=ti&from=1.2.3-ti&to=1.2.5-ti");
    assert.deepEqual(await versions(answer), ["1.2.5-ti", "1.2.4-ti"]);
  });

  it("orders versions by number, not as text", async () => {
    const storage = memoryStorage();
    for (const version of ["1.9.0-ti", "1.10.0-ti", "1.2.0-ti"]) await release(storage, version);
    const answer = await askForNotes(storage, "channel=ti&from=1.1.0-ti&to=1.10.0-ti");
    assert.deepEqual(await versions(answer), ["1.10.0-ti", "1.9.0-ti", "1.2.0-ti"]);
  });

  it("goes up to the newest release with no `to`", async () => {
    const storage = memoryStorage();
    await release(storage, "1.2.3-ti");
    await release(storage, "1.2.4-ti");
    const answer = await askForNotes(storage, "channel=ti&from=1.2.3-ti");
    assert.deepEqual(await versions(answer), ["1.2.4-ti"]);
  });

  it("answers the channel's whole history with no `from`", async () => {
    const storage = memoryStorage();
    for (const version of ["0.47.0-ti", "0.48.0-ti", "0.49.0-ti"]) await release(storage, version);
    await release(storage, "0.48.0", "main");
    assert.deepEqual(await versions(await askForNotes(storage, "channel=ti")), [
      "0.49.0-ti",
      "0.48.0-ti",
      "0.47.0-ti",
    ]);
    assert.deepEqual(await versions(await askForNotes(storage, "channel=ti&to=0.48.0-ti")), [
      "0.48.0-ti",
      "0.47.0-ti",
    ]);
  });

  it("adds the versions that never published, each under its own version and date", async () => {
    const storage = memoryStorage({ clock: () => new Date("2026-11-21T12:00:00.000Z") });
    await release(storage, "0.72.0-ti");
    // The service builds the history from the notes files, dated by their upload.
    await askForNotes(storage, "channel=ti");
    const published = await publishEarlierNotes({
      channel: "ti",
      releases: [
        { version: "0.72.0-ti", date: "2026-11-19T00:00:00.000Z", notes: notes("again") },
        { version: "0.73.0-ti", date: "2026-11-19T21:13:50.000Z", notes: notes("0.73.0-ti") },
        {
          version: "0.73.1-ti",
          date: "2026-11-20T00:00:00.000Z",
          notes: { en: { new: [], fixes: [] }, "pt-BR": { new: [], fixes: [] } },
        },
      ],
      put: storage.put,
      read: storage.read,
    });
    await release(storage, "0.74.0-ti", "ti", new Date("2026-11-21T02:09:00.000Z"));

    assert.deepEqual(published, ["0.73.0-ti"]);
    const answer = (await (await askForNotes(storage, "channel=ti")).json()) as {
      releases: { version: string; date: string; notes: unknown }[];
    };
    assert.deepEqual(answer.releases, [
      { version: "0.74.0-ti", date: "2026-11-21T02:09:00.000Z", notes: notes("0.74.0-ti") },
      { version: "0.73.0-ti", date: "2026-11-19T21:13:50.000Z", notes: notes("0.73.0-ti") },
      { version: "0.72.0-ti", date: "2026-11-21T12:00:00.000Z", notes: notes("0.72.0-ti") },
    ]);
  });

  it("counts both channels' versions on one sequence, keeping each channel's notes apart", async () => {
    const storage = memoryStorage();
    await release(storage, "1.2.3-ti");
    await release(storage, "1.2.4", "main");
    await release(storage, "1.2.5-ti");
    const ti = await askForNotes(storage, "channel=ti&from=1.2.3&to=1.2.5-ti");
    assert.deepEqual(await versions(ti), ["1.2.5-ti"]);
    const main = await askForNotes(storage, "channel=main&from=1.2.0");
    assert.deepEqual(await versions(main), ["1.2.4"]);
  });

  /** The storage, counting what the service asks of it. */
  const counted = (storage: ReturnType<typeof memoryStorage>) => {
    const asked = { gets: 0, lists: 0 };
    const service = createUpdateService({
      ...storage,
      get: (key) => {
        asked.gets += 1;
        return storage.get(key);
      },
      list: (options) => {
        asked.lists += 1;
        return storage.list(options);
      },
    });
    const ask = async (query: string) => {
      asked.gets = 0;
      asked.lists = 0;
      return service.fetch(new Request(`${ORIGIN}/v1/notes?${query}`));
    };
    return { ask, asked };
  };

  it("answers from one stored history once it has built it, however many releases", async () => {
    const storage = memoryStorage();
    for (let patch = 0; patch < 30; patch += 1) await release(storage, `0.47.${patch}-ti`);
    const { ask, asked } = counted(storage);

    assert.equal((await versions(await ask("channel=ti"))).length, 30);
    const again = await ask("channel=ti");
    assert.equal((await versions(again)).length, 30);
    assert.deepEqual(asked, { gets: 1, lists: 0 });
    assert.deepEqual(await versions(await ask("channel=ti&from=0.47.27-ti&to=0.47.28-ti")), [
      "0.47.28-ti",
    ]);
    assert.deepEqual(asked, { gets: 1, lists: 0 });
  });

  it("keeps the stored history up to date as notes are published, dates and all", async () => {
    const storage = memoryStorage({ clock: () => new Date("2026-11-01T09:30:00.000Z") });
    await release(storage, "0.47.0-ti");
    const { ask, asked } = counted(storage);
    await ask("channel=ti");

    await release(storage, "0.48.0-ti", "ti", new Date("2026-11-04T18:05:00.000Z"));
    await release(storage, "0.47.0-ti", "ti", new Date("2026-11-05T07:00:00.000Z"));
    await release(storage, "0.48.0", "main", new Date("2026-11-05T08:00:00.000Z"));

    const answer = (await (await ask("channel=ti")).json()) as {
      releases: { version: string; date: string }[];
    };
    assert.deepEqual(
      answer.releases.map(({ version, date }) => ({ version, date })),
      [
        { version: "0.48.0-ti", date: "2026-11-04T18:05:00.000Z" },
        { version: "0.47.0-ti", date: "2026-11-05T07:00:00.000Z" },
      ],
    );
    assert.deepEqual(asked, { gets: 1, lists: 0 });
    assert.deepEqual(await versions(await ask("channel=main")), ["0.48.0"]);
  });

  it("builds the history again from the notes files when the stored one can't be read", async () => {
    const storage = memoryStorage();
    await release(storage, "0.47.0-ti");
    await release(storage, "0.48.0-ti");
    await askForNotes(storage, "channel=ti");
    await storage.put("notes/ti.json", new TextEncoder().encode("not json"), "application/json");

    assert.deepEqual(await versions(await askForNotes(storage, "channel=ti")), [
      "0.48.0-ti",
      "0.47.0-ti",
    ]);
  });

  it("answers the whole history counted from 0.0.0, as Version History asks", async () => {
    const storage = memoryStorage();
    for (const version of ["0.47.0-ti", "0.48.0-ti"]) await release(storage, version);
    assert.deepEqual(await versions(await askForNotes(storage, "channel=ti&from=0.0.0")), [
      "0.48.0-ti",
      "0.47.0-ti",
    ]);
  });

  it("answers no releases when none falls between the versions", async () => {
    const answer = await askForNotes(memoryStorage(), "channel=ti&from=1.2.3-ti");
    assert.equal(answer.status, 200);
    assert.deepEqual(await answer.json(), { releases: [] });
  });

  it("finds releases past a page of the storage's listing", async () => {
    const storage = memoryStorage({ listPageSize: 2 });
    for (const version of ["1.2.3", "1.2.4", "1.2.5", "1.2.6", "1.2.7"])
      await release(storage, version, "main");
    const answer = await askForNotes(storage, "channel=main&from=1.2.3");
    assert.deepEqual(await versions(answer), ["1.2.7", "1.2.6", "1.2.5", "1.2.4"]);
  });

  for (const query of [
    "from=1.2.3",
    "channel=none&from=1.2.3",
    "channel=ti&from=latest",
    "channel=ti&from=1.2.3&to=1.2",
  ]) {
    it(`refuses ${query}`, async () => {
      assert.equal((await askForNotes(memoryStorage(), query)).status, 400);
    });
  }
});

describe("the service", () => {
  it("answers 404 anywhere else and 405 to anything but GET", async () => {
    const service = createUpdateService(memoryStorage());
    assert.equal((await service.fetch(new Request(`${ORIGIN}/`))).status, 404);
    const post = new Request(`${ORIGIN}/v1/manifest`, { method: "POST" });
    assert.equal((await service.fetch(post)).status, 405);
  });

  // The bucket as phones see it through the Worker: everything CI published for a channel.
  const publishedBucket = async () => {
    const storage = memoryStorage();
    await publish(storage);
    const notes = {
      en: { new: ["Something"], fixes: [] },
      "pt-BR": { new: ["Algo"], fixes: [] },
    };
    await publishNotes({ channel: "ti", version: "1.2.3-ti", notes, ...storage });
    const apk = {
      version: "1.2.3-ti",
      runtimeVersion: "native-a",
      url: "https://github.com/o/r/releases/download/v1.2.3-ti/wave-1.2.3-ti.apk",
      size: 1,
      sha256: "ab".repeat(32),
    };
    await publishLatestApk({ channel: "ti", apk, signingKey: shipped.privateKey, ...storage });
    const asset = new URL((await manifestOf(await askFor(storage))).launchAsset.url).pathname;
    const contents = async () => {
      const { objects } = await storage.list({ prefix: "" });
      return new Map(
        await Promise.all(objects.map(async ({ key }) => [key, await storage.read(key)] as const)),
      );
    };
    const paths = [
      "/v1/manifest",
      "/v1/notes?channel=ti",
      "/v1/apk?channel=ti",
      asset,
      `/v1/assets/${"c".repeat(64)}`,
      "/notes/ti.json",
      "/apks/ti/latest.json",
      "/",
    ];
    return { storage, contents, paths };
  };

  it("lets no outside request upload, replace or remove a stored file", async () => {
    const { storage, contents, paths } = await publishedBucket();
    const service = createUpdateService(storage);
    const before = await contents();
    for (const method of ["HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"])
      for (const path of paths) {
        const body = method === "HEAD" || method === "OPTIONS" ? null : "replacement bytes";
        const response = await service.fetch(new Request(`${ORIGIN}${path}`, { method, body }));
        assert.equal(response.status, 405, `${method} ${path}`);
      }
    assert.deepEqual(await contents(), before);
  });

  it("writes nothing on a read but the notes history it rebuilds from the stored notes", async () => {
    const { storage, contents, paths } = await publishedBucket();
    const service = createUpdateService(storage);
    await storage.remove("notes/ti.json");
    const before = await contents();
    for (const path of paths) await service.fetch(new Request(`${ORIGIN}${path}`));
    const after = await contents();
    const changed = [...after.keys()].filter((key) => after.get(key) !== before.get(key));
    assert.deepEqual(changed, ["notes/ti.json"]);
    assert.deepEqual(
      [...before.keys()].filter((key) => !after.has(key)),
      [],
    );
  });
});

describe("publishNotes", () => {
  it("publishes nothing for a release with no notes to list", async () => {
    const storage = memoryStorage();
    await publishNotes({
      channel: "ti",
      version: "1.2.3-ti",
      notes: { en: { new: [], fixes: [] }, "pt-BR": { new: [], fixes: [] } },
      put: storage.put,
      read: storage.read,
    });
    const answer = await createUpdateService(storage).fetch(
      new Request(`${ORIGIN}/v1/notes?channel=ti&from=1.0.0`),
    );
    assert.deepEqual(await answer.json(), { releases: [] });
  });
});

describe("publishUpdate", () => {
  it("leaves the channel on its previous update when an upload fails", async () => {
    const storage = memoryStorage();
    const previous = await publish(storage);
    let uploads = 0;
    await assert.rejects(
      publish(storage, {
        dir: exported("a new bundle", "a new image"),
        put: async (key, data, contentType) => {
          uploads += 1;
          if (uploads === 3) throw new Error("network");
          await storage.put(key, data, contentType);
        },
      }),
      /network/,
    );
    assert.equal((await manifestOf(await askFor(storage))).id, previous);
  });

  it("uploads nothing when the signing key is no key", async () => {
    let uploads = 0;
    await assert.rejects(
      publish(memoryStorage(), {
        signingKey: "not a key",
        put: async () => {
          uploads += 1;
        },
      }),
    );
    assert.equal(uploads, 0);
  });

  it("refuses an export with no Android bundle", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wave-update-"));
    writeFileSync(join(dir, "metadata.json"), JSON.stringify({ fileMetadata: {} }));
    await assert.rejects(publish(memoryStorage(), { dir }), /Android/);
  });
});

describe("promoteUpdate", () => {
  it("moves a channel's phones to the earlier version's bundle, as a newer update", async () => {
    const storage = memoryStorage();
    await release(storage, "1.0.0-ti");
    const good = await manifestOf(await askFor(storage));
    const bad = await release(storage, "1.0.1-ti");

    const promoted = await promote(storage, "1.0.0-ti");

    const manifest = await manifestOf(await askFor(storage, { "expo-current-update-id": bad }));
    assert.equal(manifest.id, promoted);
    assert.notEqual(manifest.id, good.id);
    assert.ok(Date.parse(manifest.createdAt) > Date.parse(good.createdAt));
    const bundle = await createUpdateService(storage).fetch(new Request(manifest.launchAsset.url));
    assert.equal(await bundle.text(), "bundle of 1.0.0-ti");
    assert.deepEqual(manifest.launchAsset, good.launchAsset);
    assert.deepEqual(manifest.assets, good.assets);
    assert.equal(manifest.extra.expoClient.version, "1.0.0-ti");
  });

  it("leaves the desktop's channel files as they were", async () => {
    const storage = memoryStorage();
    // What the desktop's releases keep beside the phone's (desktopProtocol.ts).
    const desktop = {
      "desktop/ti/latest.json": '{"win32":"signed"}',
      "desktop/ti/history.json": '[{"version":"1.0.1-ti"}]',
      "desktop/ti/versions/1.0.1-ti.json": "{}",
      "desktop/ti/files/1.0.1-ti/wave-1.0.1-ti-linux-x64.AppImage": "AppImage",
    };
    for (const [key, value] of Object.entries(desktop))
      await storage.put(key, value, "application/json");
    await release(storage, "1.0.0-ti");
    await release(storage, "1.0.1-ti");

    await promote(storage, "1.0.0-ti");

    const { objects } = await storage.list({ prefix: "desktop/" });
    assert.deepEqual(objects.map(({ key }) => key).toSorted(), Object.keys(desktop).toSorted());
    for (const [key, value] of Object.entries(desktop))
      assert.equal(await storage.read(key), value);
  });

  it("refuses a version built for another runtime version, and says why", async () => {
    const storage = memoryStorage();
    await release(storage, "1.0.0-ti", { runtimeVersion: "native-a" });
    const current = await release(storage, "1.1.0-ti", { runtimeVersion: "native-b" });

    await assert.rejects(promote(storage, "1.0.0-ti"), /native-a.*native-b/);

    const answer = await askFor(storage, { "expo-runtime-version": "native-b" });
    assert.equal((await manifestOf(answer)).id, current);
  });

  it("refuses a version the channel doesn't keep, and names the ones it does", async () => {
    const storage = memoryStorage();
    await release(storage, "1.0.0-ti");
    await release(storage, "1.0.1-ti");
    await assert.rejects(promote(storage, "0.9.0-ti"), /0\.9\.0-ti.*1\.0\.1-ti, 1\.0\.0-ti/);
  });

  it("doesn't take a version from the other channel", async () => {
    const storage = memoryStorage();
    await release(storage, "1.0.0", { channel: "main" });
    await release(storage, "1.0.1-ti");
    await assert.rejects(promote(storage, "1.0.0"), /doesn't keep/);
  });

  it("refuses the version phones are already on", async () => {
    const storage = memoryStorage();
    await release(storage, "1.0.0-ti");
    await release(storage, "1.0.1-ti");
    await assert.rejects(promote(storage, "1.0.1-ti"), /already on 1\.0\.1-ti/);
    await promote(storage, "1.0.0-ti");
    await assert.rejects(promote(storage, "1.0.0-ti"), /already on 1\.0\.0-ti/);
  });

  it("leaves phones where they are when an upload fails", async () => {
    const storage = memoryStorage();
    await release(storage, "1.0.0-ti");
    const current = await release(storage, "1.0.1-ti");
    await assert.rejects(
      promote(storage, "1.0.0-ti", {
        put: async () => {
          throw new Error("network");
        },
      }),
      /network/,
    );
    assert.equal((await manifestOf(await askFor(storage))).id, current);
  });

  it("gives way to the next release, and can move forward again", async () => {
    const storage = memoryStorage();
    await release(storage, "1.0.0-ti");
    await release(storage, "1.0.1-ti");
    await promote(storage, "1.0.0-ti");

    const again = await promote(storage, "1.0.1-ti");
    assert.equal((await manifestOf(await askFor(storage))).id, again);

    const next = await release(storage, "1.0.2-ti");
    assert.equal((await manifestOf(await askFor(storage))).id, next);
  });
});

describe("a promoted update", () => {
  const rollback = async (storage: ReturnType<typeof memoryStorage>) => {
    await release(storage, "1.0.0-ti");
    await release(storage, "1.0.1-ti");
    return signedPart(await askFor(storage));
  };

  it("is accepted by a phone holding the matching certificate, under its new id", async () => {
    const storage = memoryStorage();
    await rollback(storage);
    const id = await promote(storage, "1.0.0-ti");
    const part = await signedPart(await askFor(storage));
    assert.equal(accepts(shipped.publicKey, part), true);
    assert.equal(accepts(another.publicKey, part), false);
    assert.equal(JSON.parse(part.body).id, id);
  });

  it("is signed anew, not with the signature it was stored with", async () => {
    const storage = memoryStorage();
    await rollback(storage);
    await promote(storage, "1.0.0-ti", { signingKey: another.privateKey });
    const part = await signedPart(await askFor(storage));
    assert.equal(accepts(another.publicKey, part), true);
    assert.equal(accepts(shipped.publicKey, part), false);
    assert.equal(JSON.parse(part.body).signed, undefined);
  });

  it("changes nothing when the signing key is no key", async () => {
    const storage = memoryStorage();
    const before = await rollback(storage);
    await assert.rejects(promote(storage, "1.0.0-ti", { signingKey: "not a key" }));
    assert.equal((await signedPart(await askFor(storage))).body, before.body);
  });
});

describe("a rollback's provenance", () => {
  type Stored = StoredUpdate;
  const twoReleases = async (storage: ReturnType<typeof memoryStorage>) => {
    const first = await release(storage, "1.0.0-ti");
    const current = await release(storage, "1.0.1-ti");
    return { first, current };
  };
  const stored = async (storage: ReturnType<typeof memoryStorage>, id: string): Promise<Stored> =>
    JSON.parse((await storage.read(updateKey("ti", "native-a", id)))!);
  const replace = (storage: ReturnType<typeof memoryStorage>, id: string, update: unknown) =>
    storage.put(updateKey("ti", "native-a", id), JSON.stringify(update), "application/json");
  const phonesOn = async (storage: ReturnType<typeof memoryStorage>): Promise<string> =>
    (await manifestOf(await askFor(storage))).id;

  it("rolls back to the release's own update with nothing but R2 and its sealed record", async () => {
    const storage = memoryStorage();
    await twoReleases(storage);
    const id = await promote(storage, "1.0.0-ti");
    assert.equal(await phonesOn(storage), id);
  });

  it("refuses a record that admitted another update, and leaves phones where they are", async () => {
    const storage = memoryStorage();
    const { current } = await twoReleases(storage);
    const record = recordOf(storage, "ti", "1.0.0-ti")!;
    const artifact = record.artifact as Record<string, unknown>;
    const other = { ...record, artifact: { ...artifact, updateSha256: "1".repeat(64) } };
    await assert.rejects(promote(storage, "1.0.0-ti", { provenance: other }), /record/);
    assert.equal(await phonesOn(storage), current);
  });

  it("refuses a record of another version, channel or native side", async () => {
    const storage = memoryStorage();
    await twoReleases(storage);
    const record = recordOf(storage, "ti", "1.0.0-ti")!;
    const artifact = record.artifact as Record<string, unknown>;
    for (const provenance of [
      recordOf(storage, "ti", "1.0.1-ti"),
      { ...record, artifact: { ...artifact, updateChannel: "main" } },
      { ...record, artifact: { ...artifact, runtimeVersion: "native-b" } },
      { ...record, artifact: { ...artifact, signedSha256: undefined } },
      { ...record, schema: "something else" },
    ])
      await assert.rejects(promote(storage, "1.0.0-ti", { provenance }), /1\.0\.0-ti/);
  });

  it("refuses an update in R2 changed after it was published", async () => {
    const storage = memoryStorage();
    const { first, current } = await twoReleases(storage);
    const original = await stored(storage, first);
    const newer = await stored(storage, current);
    for (const changed of [
      // Another release's bundle under this release's name.
      { ...original, launchAsset: newer.launchAsset },
      // A file the export didn't have.
      { ...original, assets: [...original.assets, { ...newer.launchAsset, key: "0".repeat(64) }] },
      // The right file under a hash phones would check against something else.
      { ...original, launchAsset: { ...original.launchAsset, hash: newer.launchAsset.hash } },
      // Another app config, such as another sync address.
      {
        ...original,
        extra: { expoClient: { ...original.extra.expoClient, syncUrl: "https://elsewhere.test" } },
      },
      // The list of exported files itself.
      {
        ...original,
        exported: { ...original.exported, files: { "metadata.json": "0".repeat(64) } },
      },
    ]) {
      await replace(storage, first, changed);
      await assert.rejects(promote(storage, "1.0.0-ti"), /1\.0\.0-ti/);
      assert.equal(await phonesOn(storage), current);
    }
  });

  it("never lets the transition skip the check of an update that has a record", async () => {
    const storage = memoryStorage();
    const { current } = await twoReleases(storage);
    await assert.rejects(
      promote(storage, "1.0.0-ti", { provenance: undefined, allowUnrecorded: true }),
      /1\.0\.0-ti/,
    );
    assert.equal(await phonesOn(storage), current);
  });

  describe("of a release published before records", () => {
    /** 1.0.0-ti as a publish before #1130 left it: no list of exported files. */
    const legacy = async (storage: ReturnType<typeof memoryStorage>) => {
      const { first, current } = await twoReleases(storage);
      const { exported: _, ...update } = await stored(storage, first);
      await replace(storage, first, update);
      return { first, current };
    };

    it("is refused unless the owner allows the transition, and says why", async () => {
      const storage = memoryStorage();
      const { current } = await legacy(storage);
      await assert.rejects(
        promote(storage, "1.0.0-ti", { provenance: undefined }),
        /1\.0\.0-ti.*no provenance record/,
      );
      assert.equal(await phonesOn(storage), current);
    });

    it("goes ahead when the transition is allowed, still checking the runtime version", async () => {
      const storage = memoryStorage();
      await legacy(storage);
      const id = await promote(storage, "1.0.0-ti", {
        provenance: undefined,
        allowUnrecorded: true,
      });
      assert.equal(await phonesOn(storage), id);
    });

    it("is refused when its release has a record its update can't be checked against", async () => {
      const storage = memoryStorage();
      await legacy(storage);
      await assert.rejects(promote(storage, "1.0.0-ti", { allowUnrecorded: true }), /1\.0\.0-ti/);
    });
  });
});

describe("retention", () => {
  // The hex name of a file with that content, the way its manifest's URL ends.
  const assetStatus = (storage: ReturnType<typeof memoryStorage>, content: string) =>
    createUpdateService(storage)
      .fetch(
        new Request(`${ORIGIN}/v1/assets/${createHash("sha256").update(content).digest("hex")}`),
      )
      .then(({ status }) => status);

  const releases = async (
    storage: ReturnType<typeof memoryStorage>,
    from: number,
    to: number,
    overrides: Partial<Parameters<typeof publishUpdate>[0]> = {},
  ) => {
    for (let n = from; n <= to; n += 1) await release(storage, `1.0.${n}-ti`, overrides);
  };

  it("keeps the channel's last ten updates and removes the older ones", async () => {
    const storage = memoryStorage();
    await releases(storage, 1, 11);

    assert.equal(await assetStatus(storage, "bundle of 1.0.1-ti"), 404);
    assert.equal(await assetStatus(storage, "image of 1.0.1-ti"), 404);
    await assert.rejects(promote(storage, "1.0.1-ti"), /doesn't keep/);

    assert.equal(await assetStatus(storage, "bundle of 1.0.2-ti"), 200);
    await promote(storage, "1.0.2-ti");
    assert.equal(await assetStatus(storage, "bundle of 1.0.2-ti"), 200);
    const bundleUrl = (await manifestOf(await askFor(storage))).launchAsset.url;
    const bundle = await createUpdateService(storage).fetch(new Request(bundleUrl));
    assert.equal(await bundle.text(), "bundle of 1.0.2-ti");
  });

  it("counts a promotion as an update, without losing the files it reuses", async () => {
    const storage = memoryStorage();
    await releases(storage, 1, 10);
    // Takes the 11th place, so 1.0.1's first update goes, while the promoted one still needs its files.
    await promote(storage, "1.0.1-ti");
    assert.equal(await assetStatus(storage, "bundle of 1.0.1-ti"), 200);
    assert.equal(await assetStatus(storage, "image of 1.0.1-ti"), 200);
  });

  it("keeps a file a newer update still needs", async () => {
    const storage = memoryStorage();
    const sameImage = (bundle: string) => ({ dir: exported(bundle, "the shared image") });
    await publish(storage, sameImage("first"));
    for (let n = 2; n <= 11; n += 1) await publish(storage, sameImage(`bundle ${n}`));
    assert.equal(await assetStatus(storage, "first"), 404);
    assert.equal(await assetStatus(storage, "the shared image"), 200);
  });

  it("keeps a file the other channel still needs", async () => {
    const storage = memoryStorage();
    await publish(storage, { channel: "main", dir: exported("the same bundle", "main's image") });
    await publish(storage, { channel: "ti", dir: exported("the same bundle", "ti's image") });
    await releases(storage, 1, 10);
    assert.equal(await assetStatus(storage, "ti's image"), 404);
    assert.equal(await assetStatus(storage, "the same bundle"), 200);
    assert.equal((await askFor(storage, { "expo-channel-name": "main" })).status, 200);
  });

  it("counts per channel", async () => {
    const storage = memoryStorage();
    await publish(storage, { channel: "main", dir: exported("main's bundle", "main's image") });
    await releases(storage, 1, 11);
    assert.equal(await assetStatus(storage, "main's bundle"), 200);
  });

  it("gives a runtime version with nothing kept no update", async () => {
    const storage = memoryStorage();
    await release(storage, "1.0.0-ti", { runtimeVersion: "native-a" });
    await releases(storage, 1, 9, { runtimeVersion: "native-b" });
    assert.equal((await askFor(storage, { "expo-runtime-version": "native-a" })).status, 200);

    await release(storage, "1.0.10-ti", { runtimeVersion: "native-b" });

    const errors = console.error;
    let logged = 0;
    console.error = () => (logged += 1);
    const answer = await askFor(storage, { "expo-runtime-version": "native-a" });
    console.error = errors;
    assert.equal(answer.status, 204);
    assert.equal(logged, 0);
  });

  it("doesn't fail a release when a removal fails, and retries on the next", async () => {
    const storage = memoryStorage();
    await releases(storage, 1, 10);
    const warn = console.warn;
    console.warn = () => {};
    const id = await release(storage, "1.0.11-ti", {
      remove: async () => {
        throw new Error("network");
      },
    });
    console.warn = warn;
    assert.equal((await manifestOf(await askFor(storage))).id, id);
    assert.equal(await assetStatus(storage, "bundle of 1.0.1-ti"), 200);

    await release(storage, "1.0.12-ti");
    assert.equal(await assetStatus(storage, "bundle of 1.0.1-ti"), 404);
    assert.equal(await assetStatus(storage, "bundle of 1.0.2-ti"), 404);
    assert.equal(await assetStatus(storage, "bundle of 1.0.3-ti"), 200);
  });
});

describe("the scripts", () => {
  // Runs a script with an `npx` that acts as R2 in a folder and records each call and whether it
  // could see the key.
  const bucket = () => {
    const bin = mkdtempSync(join(tmpdir(), "wave-npx-"));
    const log = join(bin, "calls.log");
    writeFileSync(
      join(bin, "npx"),
      `#!/bin/sh
echo "$5 $6 key=\${UPDATES_SIGNING_KEY:-none}" >> "${log}"
object="${bin}/r2/$6"
case "$5" in
  put) mkdir -p "$(dirname "$object")" && cp "$8" "$object" ;;
  get)
    [ -f "$object" ] || { echo "key does not exist" >&2; exit 1; }
    cp "$object" "$8"
    ;;
  delete) rm -f "$object" ;;
esac
`,
    );
    chmodSync(join(bin, "npx"), 0o755);
    const run = (script: string, args: readonly string[], env: Record<string, string>) => {
      writeFileSync(log, "");
      const { status, stdout } = spawnSync(
        process.execPath,
        [fileURLToPath(new URL(`../scripts/${script}`, import.meta.url)), ...args],
        {
          encoding: "utf8",
          env: {
            PATH: `${bin}:${process.env.PATH}`,
            CLOUDFLARE_API_TOKEN: "token",
            CLOUDFLARE_ACCOUNT_ID: "account",
            WAVE_UPDATE_CHANNEL: "ti",
            ...env,
          },
        },
      );
      return { status, output: stdout, calls: readFileSync(log, "utf8") };
    };
    const publishScript = (version: string, env: Record<string, string>) => {
      const dir = exported(`bundle of ${version}`);
      writeFileSync(join(dir, "expo-config.json"), JSON.stringify({ name: "Wave", version }));
      // The release's sealed record, as the Roll back workflow downloads it from its Release.
      const record = sealedRecord({ version, channel: "ti", runtimeVersion: "native-a", dir });
      writeFileSync(join(bin, `wave-${version}.provenance.json`), JSON.stringify(record));
      return run("publish.ts", [dir], { WAVE_RUNTIME_VERSION: "native-a", ...env });
    };
    const recordFile = (version: string) => join(bin, `wave-${version}.provenance.json`);
    const stored = (key: string) => readFileSync(join(bin, "r2/wave-updates", key), "utf8");
    /** Leaves [version]'s update as a publish before records did: no list of exported files. */
    const unrecorded = (version: string) => {
      const root = join(bin, "r2/wave-updates");
      for (const name of readdirSync(root, { recursive: true }) as string[]) {
        const file = join(root, name);
        if (!name.endsWith(".json") || !statSync(file).isFile()) continue;
        const { exported: _, ...update } = JSON.parse(readFileSync(file, "utf8"));
        if (update.extra?.expoClient?.version === version)
          writeFileSync(file, JSON.stringify(update));
      }
    };
    return { run, publishScript, stored, recordFile, unrecorded };
  };
  const key = { UPDATES_SIGNING_KEY: shipped.privateKey };

  describe("publish.ts", () => {
    it("skips with a log line and publishes nothing without the signing key", () => {
      const { output, calls, status } = bucket().publishScript("1.0.0-ti", {});
      assert.equal(status, 0);
      assert.match(output, /Skipping the over-the-air update: UPDATES_SIGNING_KEY/);
      assert.equal(calls, "");
    });

    it("publishes with the key and keeps it from what it runs", () => {
      const { output, calls } = bucket().publishScript("1.0.0-ti", key);
      assert.match(output, /Published update/);
      assert.match(calls, /latest\.json key=none/);
      assert.doesNotMatch(calls, /PRIVATE KEY/);
    });
  });

  describe("promote.ts", () => {
    const published = () => {
      const r2 = bucket();
      r2.publishScript("1.0.0-ti", key);
      r2.publishScript("1.0.1-ti", key);
      return r2;
    };
    const toFirst = { WAVE_UPDATE_VERSION: "1.0.0-ti" };
    const withRecord = (r2: ReturnType<typeof bucket>) => ({
      ...toFirst,
      WAVE_PROVENANCE_FILE: r2.recordFile("1.0.0-ti"),
    });

    it("fails, says why and promotes nothing without the signing key", () => {
      const r2 = published();
      const latest = r2.stored(latestKey("ti", "native-a"));
      const { status, output, calls } = r2.run("promote.ts", [], toFirst);
      assert.equal(status, 1);
      assert.match(output, /::error::UPDATES_SIGNING_KEY isn't set/);
      assert.equal(calls, "");
      assert.equal(r2.stored(latestKey("ti", "native-a")), latest);
    });

    it("signs the promoted update and keeps the key from what it runs", () => {
      const r2 = published();
      const { status, calls } = r2.run("promote.ts", [], { ...key, ...withRecord(r2) });
      assert.equal(status, 0);
      assert.match(calls, /latest\.json key=none/);
      assert.doesNotMatch(calls, /PRIVATE KEY/);

      const { updateId } = JSON.parse(r2.stored(latestKey("ti", "native-a")));
      const { id, extra, signed } = JSON.parse(r2.stored(updateKey("ti", "native-a", updateId)));
      assert.equal(id, updateId);
      assert.equal(extra.expoClient.version, "1.0.0-ti");
      assert.equal(JSON.parse(signed.manifest).id, updateId);
      assert.equal(
        accepts(shipped.publicKey, { header: signed.signature, body: signed.manifest }),
        true,
      );
    });

    it("refuses, promoting nothing, without the release's record or with another's", () => {
      const r2 = published();
      const latest = r2.stored(latestKey("ti", "native-a"));
      const none = r2.run("promote.ts", [], { ...key, ...toFirst });
      assert.equal(none.status, 1);
      assert.match(none.output, /::error::1\.0\.0-ti can't go back on ti/);
      const other = r2.run("promote.ts", [], {
        ...key,
        ...toFirst,
        WAVE_PROVENANCE_FILE: r2.recordFile("1.0.1-ti"),
      });
      assert.equal(other.status, 1);
      assert.doesNotMatch(none.calls + other.calls, /put/);
      assert.equal(r2.stored(latestKey("ti", "native-a")), latest);
    });

    it("takes the owner's transition only for an update published before records", () => {
      const r2 = published();
      const allowed = r2.run("promote.ts", [], {
        ...key,
        ...toFirst,
        WAVE_ALLOW_UNRECORDED: "true",
      });
      // 1.0.0-ti was published with its files listed, so it still needs its record.
      assert.equal(allowed.status, 1);
      assert.match(allowed.output, /published with a record/);
    });

    it("refuses, promoting nothing, when the record it was given can't be read", () => {
      const r2 = published();
      r2.unrecorded("1.0.0-ti");
      const latest = r2.stored(latestKey("ti", "native-a"));
      const missing = r2.run("promote.ts", [], {
        ...key,
        ...toFirst,
        WAVE_ALLOW_UNRECORDED: "true",
        WAVE_PROVENANCE_FILE: `${r2.recordFile("1.0.0-ti")}.gone`,
      });
      assert.equal(missing.status, 1);
      assert.match(missing.output, /::error::.*provenance record.*couldn't be read/);
      assert.doesNotMatch(missing.calls, /put/);
      assert.equal(r2.stored(latestKey("ti", "native-a")), latest);

      // With no record named, the transition still takes an update published before records.
      const allowed = r2.run("promote.ts", [], {
        ...key,
        ...toFirst,
        WAVE_ALLOW_UNRECORDED: "true",
      });
      assert.equal(allowed.status, 0, allowed.output);
    });

    it("gets the key from the workflow that runs it", () => {
      const workflow = new URL("../../../.github/workflows/rollback.yml", import.meta.url);
      assert.match(
        readFileSync(workflow, "utf8"),
        /UPDATES_SIGNING_KEY: \$\{\{ secrets\.UPDATES_SIGNING_KEY \}\}/,
      );
    });
  });

  describe("publish-notes.ts", () => {
    it("keeps the signing key from what it runs", () => {
      const { output, calls } = bucket().run("publish-notes.ts", [], {
        ...key,
        WAVE_RELEASE_TAG: "v1.0.0-ti",
        WAVE_RELEASE_NOTES: JSON.stringify({
          en: { new: ["A line"], fixes: [] },
          "pt-BR": { new: ["Uma linha"], fixes: [] },
        }),
      });
      assert.match(output, /Published the notes/);
      assert.match(calls, /notes\/ti\/1\.0\.0-ti\.json key=none/);
    });

    it("publishes the versions that never published before the release, once each", () => {
      const lines = (word: string) => ({
        en: { new: [word], fixes: [] },
        "pt-BR": { new: [word], fixes: [] },
      });
      const r2 = bucket();
      const env = {
        WAVE_RELEASE_TAG: "v1.0.2-ti",
        WAVE_RELEASE_NOTES: JSON.stringify(lines("Two")),
        WAVE_EARLIER_NOTES: JSON.stringify([
          { version: "1.0.1-ti", date: "2026-11-20T10:00:00.000Z", notes: lines("One") },
        ]),
      };
      const first = r2.run("publish-notes.ts", [], env);
      assert.match(first.output, /Published the notes of 1\.0\.1-ti, which never published/);
      assert.match(first.output, /Published the notes of 1\.0\.2-ti to ti/);
      assert.ok(first.calls.indexOf("1.0.1-ti.json") < first.calls.indexOf("1.0.2-ti.json"));
      assert.deepEqual(JSON.parse(r2.stored("notes/ti/1.0.1-ti.json")), lines("One"));

      const again = r2.run("publish-notes.ts", [], env);
      assert.doesNotMatch(again.output, /1\.0\.1-ti, which never published/);
      assert.doesNotMatch(again.calls, /put notes\/ti\/1\.0\.1-ti/);
    });
  });
});

describe("GET /v1/apk", () => {
  const apk = {
    version: "1.3.0-ti",
    runtimeVersion: "native-b",
    url: "https://github.com/o/r/releases/download/v1.3.0-ti/wave-1.3.0-ti.apk",
    size: 123456,
    sha256: "ab".repeat(32),
  };
  const signingKey = shipped.privateKey;
  const askForApk = (storage: ReturnType<typeof memoryStorage>, query: string) =>
    createUpdateService(storage).fetch(new Request(`${ORIGIN}/v1/apk?${query}`));
  const answerOf = async (response: Response) =>
    (await response.json()) as { metadata: string; signature: string };
  const metadataOf = async (response: Response) =>
    JSON.parse((await answerOf(response)).metadata) as unknown;

  it("answers the channel's newest APK, never cached", async () => {
    const storage = memoryStorage();
    await publishLatestApk({ channel: "ti", apk, signingKey, put: storage.put });
    const response = await askForApk(storage, "channel=ti");
    assert.equal(response.status, 200);
    assert.deepEqual(await metadataOf(response), { ...apk, channel: "ti" });
    assert.match(response.headers.get("cache-control") ?? "", /max-age=0/);
  });

  it("answers metadata the shipped certificate's key signed, the file's hash included", async () => {
    const storage = memoryStorage();
    await publishLatestApk({ channel: "ti", apk, signingKey, put: storage.put });
    const { metadata, signature } = await answerOf(await askForApk(storage, "channel=ti"));
    assert.equal((JSON.parse(metadata) as { sha256: string }).sha256, apk.sha256);
    const verifies = (publicKey: string, text: string) =>
      createVerify("RSA-SHA256").update(text, "utf8").verify(publicKey, signature, "base64");
    assert.equal(verifies(shipped.publicKey, metadata), true);
    assert.equal(verifies(another.publicKey, metadata), false);
    assert.equal(verifies(shipped.publicKey, metadata.replace("1.3.0-ti", "9.9.9-ti")), false);
  });

  it("the newest publish replaces the last", async () => {
    const storage = memoryStorage();
    await publishLatestApk({ channel: "ti", apk, signingKey, put: storage.put });
    const newer = { ...apk, version: "1.3.1-ti" };
    await publishLatestApk({ channel: "ti", apk: newer, signingKey, put: storage.put });
    assert.deepEqual(await metadataOf(await askForApk(storage, "channel=ti")), {
      ...newer,
      channel: "ti",
    });
  });

  it("keeps each channel's apart", async () => {
    const storage = memoryStorage();
    await publishLatestApk({ channel: "ti", apk, signingKey, put: storage.put });
    assert.equal((await askForApk(storage, "channel=main")).status, 404);
  });

  it("refuses an unknown channel", async () => {
    assert.equal((await askForApk(memoryStorage(), "channel=pr")).status, 400);
  });

  it("refuses to publish what phones wouldn't download or couldn't check", async () => {
    const storage = memoryStorage();
    const refused = (changes: Partial<typeof apk>, key = signingKey) =>
      assert.rejects(
        publishLatestApk({
          channel: "ti",
          apk: { ...apk, ...changes },
          signingKey: key,
          put: storage.put,
        }),
      );
    await refused({ url: "http://x/a.apk" });
    await refused({ size: 0 });
    await refused({ sha256: "abc" });
    await refused({}, "not a key");
    assert.equal((await askForApk(storage, "channel=ti")).status, 404);
  });
});

describe("publish-apk.ts", () => {
  const run = (env: Record<string, string>) => {
    const bin = mkdtempSync(join(tmpdir(), "wave-npx-apk-"));
    const log = join(bin, "calls.log");
    const uploaded = join(bin, "uploaded");
    writeFileSync(log, "");
    writeFileSync(
      join(bin, "npx"),
      `#!/bin/sh\necho "$5 $6 key=\${UPDATES_SIGNING_KEY:-none}" >> "${log}"\ncp "$8" "${uploaded}"\n`,
    );
    chmodSync(join(bin, "npx"), 0o755);
    const apkPath = join(bin, "wave.apk");
    writeFileSync(apkPath, "the APK's bytes");
    const { status, stdout } = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../scripts/publish-apk.ts", import.meta.url))],
      {
        encoding: "utf8",
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          CLOUDFLARE_API_TOKEN: "token",
          CLOUDFLARE_ACCOUNT_ID: "account",
          WAVE_UPDATE_CHANNEL: "ti",
          WAVE_RUNTIME_VERSION: "native-b",
          WAVE_RELEASE_TAG: "v1.3.0-ti",
          WAVE_APK_URL: "https://github.com/o/r/releases/download/v1.3.0-ti/wave-1.3.0-ti.apk",
          WAVE_APK_PATH: apkPath,
          ...env,
        },
      },
    );
    return { status, output: stdout, calls: readFileSync(log, "utf8"), uploaded };
  };

  it("with no key, skips with a log, publishes nothing and doesn't fail the release", () => {
    const { status, output, calls } = run({});
    assert.equal(status, 0);
    assert.match(output, /Skipping the latest APK: UPDATES_SIGNING_KEY/);
    assert.equal(calls, "");
  });

  it("with a bad key, warns, publishes nothing and doesn't fail the release", () => {
    const { status, output, calls } = run({ UPDATES_SIGNING_KEY: "not a key" });
    assert.equal(status, 0);
    assert.match(output, /::warning::/);
    assert.equal(calls, "");
  });

  it("signs the file's real SHA-256, and keeps the key from wrangler", () => {
    const { status, calls, uploaded } = run({ UPDATES_SIGNING_KEY: shipped.privateKey });
    assert.equal(status, 0);
    assert.match(calls, /apks\/ti\/latest\.json key=none/);
    const { metadata, signature } = JSON.parse(readFileSync(uploaded, "utf8")) as {
      metadata: string;
      signature: string;
    };
    const verified = createVerify("RSA-SHA256")
      .update(metadata, "utf8")
      .verify(shipped.publicKey, signature, "base64");
    assert.equal(verified, true);
    const expected = createHash("sha256").update("the APK's bytes").digest("hex");
    assert.equal((JSON.parse(metadata) as { sha256: string }).sha256, expected);
  });
});
