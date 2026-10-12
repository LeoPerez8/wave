# Spike: headless JS in the media library service (#31)

Status: **built, waiting for the owner's run on the DHU and the S24+.** The go / fallback
decision below stays open until the table has numbers.

Wave's library, queue engine and play recording all live in JS. Android Auto binds Wave's
media service with no Activity, possibly with Wave's process dead. The spec (#30, Further
Notes) calls this the main technical risk of v2. The spike has to prove that:

- the React Native runtime starts headless from the service bind;
- it answers browse requests within Auto's patience;
- the Activity opening afterwards shares that runtime;
- the runtime survives the Activity closing while Auto keeps playing.

## How it works

This is the real foundation the Auto tickets (#32–#39) extend, with JS answering a
placeholder browse tree.

1. **Media library service.** `PlaybackService` is now a Media3 `MediaLibraryService` with
   a `MediaLibrarySession`. The manifest declares the `MediaLibraryService` and
   `MediaBrowserService` actions, and `res/xml/automotive_app_desc.xml` declares Wave as an
   Auto media app. All of these live in the `wave-native` module. The rest is unchanged:
   the notification, lock screen, headset buttons, audio focus, becoming-noisy handling,
   the sleep timer and the audio processor hook. Wave's own controller (the JS module)
   keeps its v1 commands.
2. **Headless start** (`JsRuntime`). Auto connecting (`onConnect` for the Auto companion or
   automotive controller), or any browse request, calls `JsRuntime.ensureStarted`. It
   takes the app's `ReactHost`, the same lazy singleton the Activity uses, and starts it if
   no React context exists yet. The JS bundle then loads without UI. Once the context is up,
   it starts the `WaveService` headless task (`isAllowedInForeground`, no timeout). The
   task stays pending on purpose: while a headless task runs, React Native keeps JS timers
   going without a resumed Activity, and the queue's settle step and play history need
   them. The task ends when the last browsing controller disconnects or the service is
   destroyed. The runtime itself is never torn down.
3. **One set of services.** `apps/mobile/index.ts` is the new entry. It loads Expo Router's
   entry and registers `WaveService`, which calls `startServices("headless")`. The root
   layout calls `startServices("app")`. `startServices` (`src/services.ts`) is idempotent:
   the first call builds `appRuntime` (library store, queue and player sync, playback
   persistence, play history) and starts the Auto responder. Later calls only count
   themselves. The library scan stays with the UI.
4. **Request/response bridge** (`AutoBridge`, JVM-tested). A browse callback calls
   `AutoLibrary.root` or `AutoLibrary.children`, which hand `{type, payload}` to the bridge
   and return Media3 a future. The bridge emits `onAutoRequest` with an id. JS answers with
   `respondAuto(id, json)` or `failAuto(id, message)`. Requests made before JS has attached
   (cold start) queue up and are sent by `attachAuto()`. A request without an answer in
   time (8 s while JS is starting, 5 s when it runs) fails with "Wave is still loading
   your library. Try again in a moment.", which Auto shows as an error.
5. **Placeholder tree** (removed by #32). The spike answered a one-tab "Wave" tree with a
   status line. #32 replaced it with the real browse tree (Core's Auto browse model and the
   `Auto` service in `src/auto/Auto.ts`), so the checks below read the log instead.

## How to verify on the DHU

Use the CI-built **release** APK. A debug build loads JS from Metro, which a headless
start can't reach.

One-time setup:

1. On the phone: Settings → Apps → Android Auto → Additional settings → About. Tap
   "Version and permission info" 10 times to enable developer mode. In the overflow menu,
   choose **Developer settings** and turn on **Unknown sources** (Auto hides sideloaded
   apps otherwise; the real car needs it too). In the overflow menu, choose **Start head
   unit server**.
2. On the computer: install "Android Auto Desktop Head Unit Emulator" from the SDK Manager.
   Then run `adb forward tcp:5277 tcp:5277` and
   `$ANDROID_HOME/extras/google/auto/desktop-head-unit`.

Keep a log open: `adb logcat -s WaveAuto ReactNativeJS`. Every `WaveAuto` line carries
`SystemClock.elapsedRealtime()` in ms. `Bound … process started at …` gives the process
start time. `root answered at … ms, … ms after asking (JS was starting)` gives the answer.

Checks (the ticket's acceptance criteria):

1. **Listed:** Wave appears in the DHU's media app list.
2. **Cold start:** stop the DHU. Run `adb shell am force-stop dev.leoperez.wave` and confirm
   with `adb shell pidof dev.leoperez.wave` that nothing prints. Start the DHU and open Wave.
   The Albums tab lists the library. The log shows `Starting JS runtime headless`, then
   `[wave] services started by the headless`.
3. **Shared runtime:** with the DHU still connected, open Wave on the phone. The log shows
   `[wave] services already started by the headless; the app reuses them`, and never a
   second `services started` line. The app shows the same queue the service plays.
4. **Activity closing:** play something from the phone, then swipe Wave away from Recents.
   Playback continues. The DHU still browses (no new `services started` line), and `pidof`
   shows the same pid.
5. **Warm start:** with Wave already open, connect the DHU. The `root answered` line says
   `(JS running)`.

## Measurements (S24+, release APK)

Fill in from the `WaveAuto` lines. Bind → answer = `root answered at` minus the first
`Bound` line. Do at least three cold runs.

| Run    | Process start → bind (ms) | Bind → root answer (ms) | Root asked → answered (ms) | Bind → first children (ms) | Notes |
| ------ | ------------------------- | ----------------------- | -------------------------- | -------------------------- | ----- |
| Cold 1 |                           |                         |                            |                            |       |
| Cold 2 |                           |                         |                            |                            |       |
| Cold 3 |                           |                         |                            |                            |       |
| Warm 1 |                           |                         |                            |                            |       |
| Warm 2 |                           |                         |                            |                            |       |

Did Auto ever show "still loading" or an empty / error screen on a cold start? ___

## Decision

**Pending the owner's DHU run.** Going in, the expectation is **go (headless JS)**. JS's
own work for an answer is small (one event and one JSON string), so a cold start costs
roughly the Hermes bundle load plus the app services' first build.

- **Go** if the cold bind → root answer stays well inside the 8 s timeout and Auto shows the
  tree without an error. Then tune `AutoLibrary.COLD_TIMEOUT_MS` / `WARM_TIMEOUT_MS` to
  the numbers above.
- **Cheaper mitigations before any fallback.** The spec allows both. (a) Answer
  `onGetLibraryRoot` natively, since the root's four tabs are static, and only forward
  `onGetChildren`, so Auto's first call never waits on JS. (b) Let a cold `onGetChildren`
  fail with the "still loading" message, then call `notifyChildrenChanged` once JS attaches.
- **Fallback** (spec, Further Notes): a native read-only view of the SQLite database for
  browsing, with plays buffered natively and imported by JS later. This is the owner's
  call. Don't switch to it silently.
