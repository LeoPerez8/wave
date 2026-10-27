import { router } from "@/lib/timingRouter";
import { useState } from "react";
import { Text, View } from "react-native";

import { EntryRow } from "@/catalog/EntryRow";
import { Hairline } from "@/catalog/Hairline";
import { TextButton } from "@/components/TextButton";
import { useScanRoots, useScanStatus } from "@/library/hooks";
import { importBlackPlayerStats } from "@/library/importBlackPlayerStats";
import { startRescan } from "@/library/runtime";

/** Import BlackPlayer Stats, with what it does. */
function BlackPlayerImport() {
  const [importing, setImporting] = useState(false);
  const start = () => {
    setImporting(true);
    void importBlackPlayerStats().finally(() => setImporting(false));
  };
  return (
    <>
      <View className="mt-4 items-start">
        <TextButton
          label={importing ? "Importing…" : "Import BlackPlayer Stats"}
          disabled={importing}
          onPress={start}
        />
      </View>
      <Text className="font-sans text-footnote text-secondary">
        Adds the plays in BlackPlayer's track stats files to your listening history. Pick every
        snapshot you have: comparing them dates the plays. Importing again only adds new plays.
      </Text>
    </>
  );
}

/** Settings › Library: the music folders, Rescan library and Import BlackPlayer Stats. */
export function LibrarySettingsSection() {
  const roots = useScanRoots();
  const scanning = useScanStatus() === "scanning";
  return (
    <View>
      <Hairline />
      <EntryRow
        label="Music folders"
        count={roots.length === 0 ? undefined : roots.length}
        onPress={() => router.push("/music-folders")}
      />
      <Text className="mt-2 font-sans text-footnote text-secondary">
        The folders on your phone that Wave shows songs from, and the folders inside them it
        ignores.
      </Text>
      <View className="mt-4 items-start">
        <TextButton
          label={scanning ? "Scanning…" : "Rescan library"}
          disabled={scanning}
          onPress={() => void startRescan()}
        />
      </View>
      <Text className="font-sans text-footnote text-secondary">
        Wave picks up new, changed and removed files each time you open it, and when you pull down
        in the Library.
      </Text>
      <BlackPlayerImport />
    </View>
  );
}
