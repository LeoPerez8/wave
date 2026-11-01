import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promoteUpdate } from "./promote.ts";
import { publishNotes, publishUpdate } from "./publish.ts";
import { createUpdateService } from "./service.ts";
import { memoryStorage } from "./testing.ts";

const ORIGIN = "https://updates.test";

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

// `expo export`'s output for one bundle and one image.
const exported = (bundle: string, image = "image"): string => {
  const dir = mkdtempSync(join(tmpdir(), "wave-update-"));
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
    put: storage.put,
    read: storage.read,
    remove: storage.remove,
    now: () => (clock += 1000),
    newId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    ...overrides,
  });

// A release of that version: CI's export carries it in the app config.
const release = (
  storage: ReturnType<typeof memoryStorage>,
  version: string,
  overrides: Partial<Parameters<typeof publishUpdate>[0]> = {},
) =>
  publish(storage, {
    dir: exported(`bundle of ${version}`, `image of ${version}`),
    appConfig: { name: "Wave", version },
    ...overrides,
  });

const promote = (
  storage: ReturnType<typeof memoryStorage>,
  version: string,
  overrides: Partial<Parameters<typeof promoteUpdate>[0]> = {},
) =>
  promoteUpdate({
    channel: "ti",
    version,
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
  ) => publishNotes({ channel, version, notes: notes(version), put: storage.put });

  const askForNotes = (storage: ReturnType<typeof memoryStorage>, query: string) =>
    createUpdateService(storage).fetch(new Request(`${ORIGIN}/v1/notes?${query}`));

  const versions = async (response: Response) =>
    ((await response.json()) as { releases: { version: string }[] }).releases.map(
      (it) => it.version,
    );

  it("answers each release's notes per language, newest first", async () => {
    const storage = memoryStorage();
    await release(storage, "1.2.3-ti");
    await release(storage, "1.2.4-ti");

    const response = await askForNotes(storage, "channel=ti&from=1.2.2-ti&to=1.2.4-ti");

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(await response.json(), {
      releases: [
        { version: "1.2.4-ti", notes: notes("1.2.4-ti") },
        { version: "1.2.3-ti", notes: notes("1.2.3-ti") },
      ],
    });
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
    "channel=ti",
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
});

describe("publishNotes", () => {
  it("publishes nothing for a release with no notes to list", async () => {
    const storage = memoryStorage();
    await publishNotes({
      channel: "ti",
      version: "1.2.3-ti",
      notes: { en: { new: [], fixes: [] }, "pt-BR": { new: [], fixes: [] } },
      put: storage.put,
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
