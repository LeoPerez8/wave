import { describeFolder } from "@wave/core";
import { Alert } from "react-native";

import { scanState } from "./LibraryScan";
import { chooseMusicFolder } from "./runtime";

/**
 * Opens the system folder picker and adds the folder, explaining picks that
 * add nothing. Folders can't change while a scan runs.
 */
export const promptForMusicFolder = async (): Promise<void> => {
  if (scanState.get().status === "scanning") {
    Alert.alert("Wave is scanning", "You can add a folder once the scan finishes.");
    return;
  }
  try {
    const choice = await chooseMusicFolder();
    if (choice.kind === "covered") {
      Alert.alert(
        "Already in your library",
        `Wave already shows the songs in ${describeFolder(choice.by).name}, which includes this folder.`,
      );
    } else if (choice.kind === "unsupported") {
      Alert.alert(
        "Wave can't read this folder",
        "Pick it from your phone's storage or SD card in the picker, rather than from a shortcut like Downloads or a cloud drive.",
      );
    }
  } catch (error) {
    Alert.alert("Couldn't add the folder", error instanceof Error ? error.message : String(error));
  }
};
