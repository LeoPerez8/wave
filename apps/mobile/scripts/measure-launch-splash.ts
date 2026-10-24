// Run with Node from apps/mobile. Exercises only withLaunchSplash through
// Expo's real resource mods, including XML parsing, formatting and file writes.
// The temporary project excludes other prebuild plugins and needs no SDK.
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileModsAsync } from "expo/config-plugins";

const started = performance.now();
const { withLaunchSplash } = await import("../plugins/withLaunchSplash.ts");
const importMs = performance.now() - started;
const projectRoot = await mkdtemp(join(tmpdir(), "wave-launch-splash-"));
const res = join(projectRoot, "android/app/src/main/res");
const files = ["values/styles.xml", "values/colors.xml", "values-night/colors.xml"] as const;
const seedStyles = `<resources>
  <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar"/>
  <style name="Theme.App.SplashScreen" parent="Theme.SplashScreen">
    <item name="windowSplashScreenBackground">@color/splashscreen_background</item>
    <item name="windowSplashScreenAnimatedIcon">@drawable/splashscreen_logo</item>
    <item name="postSplashScreenTheme">@style/AppTheme</item>
  </style>
</resources>`;
const seedColors = '<resources><color name="splashscreen_background">#e0ecef</color></resources>';
const timings: number[] = [];

try {
  for (const folder of ["values", "values-night"])
    await mkdir(join(res, folder), { recursive: true });
  for (let run = 0; run < 8; run++) {
    await writeFile(join(res, files[0]), seedStyles);
    for (const file of files.slice(1)) await writeFile(join(res, file), seedColors);
    const begin = performance.now();
    await compileModsAsync(
      withLaunchSplash({ name: "Wave", slug: "wave", android: { package: "dev.leoperez.wave" } }),
      { projectRoot, platforms: ["android"] },
    );
    timings.push(performance.now() - begin);
  }
  const sizes: Record<string, number> = {};
  for (const file of files) sizes[file] = (await stat(join(res, file))).size;
  const styles = await readFile(join(res, files[0]), "utf8");
  const colors = await readFile(join(res, files[1]), "utf8");
  console.log(
    JSON.stringify(
      {
        importMs,
        timingsMs: timings,
        medianWarmMs: timings.slice(1).toSorted((a, b) => a - b)[3],
        sizes,
        styles: (styles.match(/<style /g) ?? []).length,
        colors: (colors.match(/<color /g) ?? []).length,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(projectRoot, { recursive: true, force: true });
}
