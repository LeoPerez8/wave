import { TextButton } from "@/components/TextButton";
import { useLocalisation } from "@/localisation/localisation";

import { tapInstallNow, useUpdateButtonLook } from "./appUpdates";

/**
 * On the right edge of Settings' Version History row while a downloaded update is ready: reloads
 * Wave on a bundle, or installs an APK as the pill does, even one swiped off the pill. Nothing
 * shows otherwise. Core's update policy says when it shows and what a tap does.
 */
export function InstallNowButton() {
  const { strings } = useLocalisation();
  const look = useUpdateButtonLook();
  if (look !== "installNow" && look !== "installing") return null;
  // Held disabled while Android has the APK: a tap couldn't add to that install.
  return (
    <TextButton
      label={strings.appUpdates.installNow}
      accessibilityLabel={strings.appUpdates.installNow}
      disabled={look === "installing"}
      onPress={tapInstallNow}
    />
  );
}
