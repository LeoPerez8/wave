import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Exercise the actual setting and persistence. Only the SQLite key-value store,
// React Native and the native module are replaced at their platform boundaries.
const OLD_KEY = "settings.nowPlayingButtons";
const KEY = "settings.nowPlayingRow";

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

test("a row edited before the update is left under the old key, and the phone shows the default row", async () => {
  const { settings, Storage } = await loadPhone({
    [OLD_KEY]: JSON.stringify(["shuffle", "repeat", "share", null]),
  });
  // Nothing under the new key is the default row.
  assert.equal(settings.syncedSettingValue(KEY), null);
  assert.equal(Storage.getItemSync(KEY), null);
});

test("an edit is stored under the new key, kept across a restart, and synced", async () => {
  const phone = await loadPhone();
  phone.buttons.editSavedNowPlayingButtons({ slot: 1, action: "sleepTimer" });
  const edited = JSON.stringify(["lyrics", "sleepTimer", "download", "songMenu"]);
  assert.equal(phone.Storage.getItemSync(KEY), edited);
  assert.equal(phone.Storage.getItemSync(OLD_KEY), null);
  assert.deepEqual(phone.changed, [KEY]);

  const restarted = await loadPhone({ [KEY]: edited });
  assert.equal(restarted.settings.syncedSettingValue(KEY), edited);

  const other = await loadPhone();
  assert.equal(other.settings.applySyncedSetting(KEY, edited), true);
  assert.equal(other.Storage.getItemSync(KEY), edited);
  assert.equal(other.settings.syncedSettingValue(KEY), edited);
});

test("a row pulled under the old key, from a phone still on an older Wave, is left alone", async () => {
  const { settings, Storage } = await loadPhone();
  assert.equal(
    settings.applySyncedSetting(OLD_KEY, JSON.stringify(["shuffle", "repeat", "share", null])),
    false,
  );
  assert.equal(settings.syncedSettingValue(KEY), null);
  assert.equal(Storage.getItemSync(KEY), null);
});

test("Reset to Default clears the new key, so the row reads as the default again", async () => {
  const phone = await loadPhone({
    [KEY]: JSON.stringify(["shuffle", "repeat", "share", null]),
  });
  phone.buttons.editSavedNowPlayingButtons("reset");
  assert.equal(phone.Storage.getItemSync(KEY), null);
  assert.equal(phone.settings.syncedSettingValue(KEY), null);
  assert.deepEqual(phone.changed, [KEY]);
});
