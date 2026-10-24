/** App storage and network adapter for the radio reader shared by Discover's mix rows. */
import Storage from "expo-sqlite/kv-store";
import { createRadioPageCatalog } from "@/ytmusic/radioPageCatalog";
import { noteRadioNow } from "@/ytmusic/candidateCatalog";
import { createCachedArtistRadioReader } from "./cachedArtistRadio";
import { artistRadio } from "./ytArtistPage";

export const mixRadioPages = createRadioPageCatalog({
  read: () => Storage.getItemSync("candidateCatalog.radioPages"),
  write: (value) => Storage.setItemSync("candidateCatalog.radioPages", value),
});

export const readMixArtistRadio = createCachedArtistRadioReader({
  cache: mixRadioPages,
  live: artistRadio,
  note: (name, page) => noteRadioNow(name, page.songs),
});
