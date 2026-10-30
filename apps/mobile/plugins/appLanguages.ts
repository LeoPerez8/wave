import type { AndroidConfig } from "expo/config-plugins";

type Manifest = AndroidConfig.Manifest.AndroidManifest;

/** Android owns the language picker; MainActivity keeps playback's UI alive on a change. */
export const addAppLanguages = (manifest: Manifest): Manifest => {
  const application = manifest.manifest.application?.[0];
  if (!application) throw new Error("AndroidManifest.xml has no <application>");
  const main = application.activity?.find(
    (activity) => activity.$["android:name"] === ".MainActivity",
  );
  if (!main) throw new Error("AndroidManifest.xml has no .MainActivity");
  application.$["android:localeConfig"] = "@xml/locales_config";
  const changes = (main.$["android:configChanges"] ?? "").split("|").filter(Boolean);
  main.$["android:configChanges"] = [...new Set([...changes, "locale", "layoutDirection"])].join(
    "|",
  );
  return manifest;
};

/** The complete list Android 13+ shows for Wave, independent of preview's launch gate. */
export const appLanguageFiles = (): Record<string, string> => ({
  "xml/locales_config.xml": `<?xml version="1.0" encoding="utf-8"?>
<locale-config xmlns:android="http://schemas.android.com/apk/res/android">
  <locale android:name="en" />
  <locale android:name="pt-BR" />
</locale-config>
`,
});
