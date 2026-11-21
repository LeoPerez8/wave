import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Exercise the actual setting and persistence. Only the SQLite key-value store,
// React Native and the native module are replaced at their platform boundaries.
const ROW_KEY = "settings.nowPlayingRow";
const KEY = "settings.nowPlayingSlots";

let fixtureId = 0;
/** Loads Now Playing's buttons on a phone whose key-value store holds `stored`. */
const loadPhone = async (stored: Record<string, string> = {}) => {
  const id = ++fixtureId;
  const boundary = `data:text/javascript,${encodeURIComponent(`
    export const fixture = ${id};
    const kept = new Map(Object.entries(${JSON.stringify(stored)}));
    export const Storage = {
      getItemSync: key => kept.get(key) ?? null,
      setItemSync: (key, value) => kept.set(key, value),
      removeItemSync: key => kept.delete(key),
    };
    export const phoneLanguages = () => [];
    export const subscribePhoneLanguages = () => () => {};
    export const AppState = { addEventListener: () => ({ remove: () => {} }) };
  `)}`;
  const src = new URL("../", import.meta.url);
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (["react-native", "expo-sqlite/kv-store", "@/native/waveNative"].includes(specifier))
        return { url: boundary, shortCircuit: true };
      if (specifier.startsWith("@/")) specifier = new URL(specifier.slice(2), src).href;
      if (specifier.startsWith(".") || specifier.startsWith("file:")) {
        const url = new URL(specifier, context.parentURL);
        if (url.href.startsWith(src.href)) {
          if (!url.pathname.endsWith(".ts") && existsSync(new URL(`${url.pathname}.ts`, url)))
            url.pathname += ".ts";
          url.search = `fixture=${id}`;
          return nextResolve(url.href, context);
        }
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    const buttons = (await import(
      `./nowPlayingButtons.ts?fixture=${id}`
    )) as typeof import("./nowPlayingButtons.ts");
    const settings = (await import(
      `../lib/persistedSetting.ts?fixture=${id}`
    )) as typeof import("../lib/persistedSetting.ts");
    const { Storage } = (await import(boundary)) as {
      Storage: { getItemSync: (key: string) => string | null };
    };
    const changed: string[] = [];
    settings.onSyncedSettingChange((key) => changed.push(key));
    return { buttons, settings, Storage, changed };
  } finally {
    hooks.deregister();
  }
};

const ROW = JSON.stringify(["shuffle", "repeat", "share", null]);
const CONVERTED = ["shuffle", "repeat", "share", null, "queue", null, null];
const DEFAULT = ["lyrics", "addToPlaylist", "download", "shuffle", "repeat", null, null];

test("a phone that never edited the row shows the default, with nothing stored", async () => {
  const { buttons, settings, Storage } = await loadPhone();
  assert.deepEqual(buttons.savedNowPlayingButtons(), DEFAULT);
  assert.equal(settings.syncedSettingValue(KEY), null);
  assert.equal(Storage.getItemSync(KEY), null);
});

test("a row edited before the update shows as seven slots with Queue fifth, and stays as it was under its key", async () => {
  const { buttons, Storage } = await loadPhone({ [ROW_KEY]: ROW });
  assert.deepEqual(buttons.savedNowPlayingButtons(), CONVERTED);
  assert.equal(Storage.getItemSync(ROW_KEY), ROW);
});

test("an edit is stored under the new key, kept across a restart, and synced; the row's key is not written", async () => {
  const phone = await loadPhone({ [ROW_KEY]: ROW });
  phone.buttons.editSavedNowPlayingButtons({ slot: 6, action: "sleepTimer" });
  const edited = JSON.stringify(["shuffle", "repeat", "share", null, "queue", null, "sleepTimer"]);
  assert.equal(phone.Storage.getItemSync(KEY), edited);
  assert.equal(phone.Storage.getItemSync(ROW_KEY), ROW);
  assert.deepEqual(phone.changed, [KEY]);

  const restarted = await loadPhone({ [ROW_KEY]: ROW, [KEY]: edited });
  assert.equal(restarted.settings.syncedSettingValue(KEY), edited);

  const other = await loadPhone();
  assert.equal(other.settings.applySyncedSetting(KEY, edited), true);
  assert.equal(other.Storage.getItemSync(KEY), edited);
  assert.equal(other.settings.syncedSettingValue(KEY), edited);
});

test("a row pulled under its old key, from a phone still on an older Wave, is left alone", async () => {
  const { settings, Storage } = await loadPhone();
  assert.equal(settings.applySyncedSetting(ROW_KEY, ROW), false);
  assert.equal(Storage.getItemSync(ROW_KEY), null);
  assert.equal(Storage.getItemSync(KEY), null);
});

test("Reset to Default clears the new key, so the slots read as the default again", async () => {
  const phone = await loadPhone({
    [KEY]: JSON.stringify(["shuffle", "repeat", "share", null, null, "queue", null]),
  });
  phone.buttons.editSavedNowPlayingButtons("reset");
  assert.equal(phone.Storage.getItemSync(KEY), null);
  assert.equal(phone.settings.syncedSettingValue(KEY), null);
  assert.deepEqual(phone.changed, [KEY]);
});

test("Reset to Default over a row edited before the update holds across a restart", async () => {
  const phone = await loadPhone({ [ROW_KEY]: ROW });
  phone.buttons.editSavedNowPlayingButtons("reset");
  assert.deepEqual(phone.buttons.savedNowPlayingButtons(), DEFAULT);
  const stored = phone.Storage.getItemSync(KEY);
  assert.equal(stored, JSON.stringify(DEFAULT));
  assert.equal(phone.Storage.getItemSync(ROW_KEY), ROW);

  const restarted = await loadPhone({ [ROW_KEY]: ROW, [KEY]: JSON.stringify(DEFAULT) });
  assert.deepEqual(restarted.buttons.savedNowPlayingButtons(), DEFAULT);
});

test("a choice another slot holds is captioned with that slot's place; the slot's own and free ones are not", async () => {
  const { buttons } = await loadPhone();
  const slots = ["lyrics", null, null, null, null, "shuffle", "repeat"] as const;
  assert.equal(buttons.nowPlayingSlotCaption(slots, 6, "lyrics"), "In the footer");
  assert.equal(buttons.nowPlayingSlotCaption(slots, 0, "shuffle"), "Beside Previous");
  assert.equal(buttons.nowPlayingSlotCaption(slots, 0, "repeat"), "Beside Next");
  assert.equal(buttons.nowPlayingSlotCaption(slots, 0, "lyrics"), undefined);
  assert.equal(buttons.nowPlayingSlotCaption(slots, 0, "queue"), undefined);
  assert.equal(buttons.nowPlayingSlotCaption(slots, 0, null), undefined);
});

test("slots holding Magic Queue, Go to Artist and Go to Album sync and read back, named as the song menu names them", async () => {
  const phone = await loadPhone();
  phone.buttons.editSavedNowPlayingButtons({ slot: 5, action: "magicQueue" });
  phone.buttons.editSavedNowPlayingButtons({ slot: 6, action: "goToArtist" });
  phone.buttons.editSavedNowPlayingButtons({ slot: 4, action: "goToAlbum" });
  const stored = JSON.stringify([
    "lyrics",
    "addToPlaylist",
    "download",
    "shuffle",
    "goToAlbum",
    "magicQueue",
    "goToArtist",
  ]);
  assert.equal(phone.Storage.getItemSync(KEY), stored);
  assert.deepEqual(phone.changed, [KEY, KEY, KEY]);
  const restarted = await loadPhone({ [KEY]: stored });
  assert.deepEqual(restarted.buttons.savedNowPlayingButtons(), JSON.parse(stored));
  assert.deepEqual(
    (["magicQueue", "goToArtist", "goToAlbum"] as const).map(restarted.buttons.nowPlayingSlotLabel),
    ["Magic Queue", "Go to Artist", "Go to Album"],
  );
});

test("a slot pulled from a newer Wave, holding an action this one doesn't know, shows empty and the rest as synced", async () => {
  const other = await loadPhone();
  const newer = JSON.stringify(["lyrics", "karaoke", null, null, null, "magicQueue", null]);
  assert.equal(other.settings.applySyncedSetting(KEY, newer), true);
  assert.deepEqual(other.buttons.savedNowPlayingButtons(), [
    "lyrics",
    null,
    null,
    null,
    null,
    "magicQueue",
    null,
  ]);
});
