# Checking tickets on the PC's emulator

When no phone is connected, run a ticket's phone checks on the local emulator, and label every
result as an emulator result, naming the AVD and the build's commit. A criterion that names the
owner's S24+ or a car still needs that hardware, so its numbers stay unverified.

## Build and install

CI's APKs ship only `arm64-v8a` and crash in `MainApplication.onCreate` on the x86_64 AVDs. Build
your checkout instead, in the background, since a build takes 8 to 20 minutes:

```sh
scripts/emulator-apk.sh <adb-serial>
```

The package is `dev.leoperez.wave`. Only one Gradle build at a time: this machine stalls under
several, and a parallel `testDebugUnitTest` once hung for 50 minutes.

## Device

Use `wave-run-903` on host `local`, through the T3 device tools: `device_list`, `device_open`, then
the `agent-device` command it returns. Use `adb` only for installs, logs and pushing files.

## Limits

- `wave-run-903` needs about 7.4 GB free on `/` to create its data partition.
  `scripts/clean-worktrees.sh` frees space.
- The `alarm-api*` and `autosync-*` AVDs belong to other projects, so leave them alone.
- T3 starts emulators with `-no-audio`, so a real song match is unlikely. Mark that criterion
  unverified.
- Local builds have updates off, so a real update check needs an arm64 device and a CI APK.
