// A simulated phone running a simulated Wave, for `perf.ts run --dry-run` and the runner's
// tests. It answers every command the runner sends the way Android 14 prints it, keeps a
// virtual clock (sleeping costs no real time), and runs Core's perf recorder as the app
// does, so a dry run goes through target finding, logcat flushes, gfxinfo parsing and the
// metrics. It throws on any command it doesn't know, which catches a runner change that
// would send the phone something new. Its numbers are made up: never record them as results.
import { writeFileSync } from "node:fs";

import { createPerfRecorder, type PerfRecorder } from "../../packages/core/src/index.ts";
import type { Device } from "./runner.ts";

interface Frame {
  readonly start: number;
  readonly ms: number;
}

interface Node {
  readonly desc?: string;
  readonly text?: string;
  readonly bounds: readonly [number, number, number, number];
}

const INTERVAL = 1000 / 120;
const ns = (ms: number): number => Math.round(ms * 1_000_000);
const TAB_ROUTES: Readonly<Record<string, string>> = {
  Home: "/",
  Library: "/library",
  Playlists: "/playlists",
  Search: "/search",
};

export interface FakeDeviceOptions {
  /** Whether the simulated app is a perf build. */
  readonly perfBuild?: boolean;
  /** The tabs on the simulated tab bar, by label. */
  readonly tabs?: readonly string[];
  /** The phone's API level. */
  readonly sdk?: number;
  /** Rules already in the app's saved ART profile. */
  readonly savedProfile?: readonly string[];
  /** What profileinstaller answers an install with (ProfileInstaller's result codes). */
  readonly installResult?: number;
}

// The simulated app's code, as ART profile rules: what a launch runs, what its screens run.
const LAUNCH_RULES = [
  "HSPLdev/leoperez/wave/MainActivity;->onCreate(Landroid/os/Bundle;)V",
  "Ldev/leoperez/wave/MainActivity;",
  "HSPLcom/facebook/react/ReactInstanceManager;->createReactContext()V",
  "Lcom/facebook/react/ReactInstanceManager;",
];
const SCROLL_RULES = [
  "PLcom/facebook/react/views/scroll/ReactScrollView;->onTouchEvent(Landroid/view/MotionEvent;)Z",
  "Lcom/facebook/react/views/scroll/ReactScrollView;",
];
const NOW_PLAYING_RULES = [
  "HPLandroidx/media3/session/MediaController;->getCurrentPosition()J",
  "Landroidx/media3/session/MediaController;",
];
/** The AndroidX library profile the simulated APK ships in assets/dexopt. */
const APK_BASELINE = [
  "HSPLandroidx/appcompat/app/AppCompatDelegate;-><clinit>()V",
  "Landroidx/appcompat/app/AppCompatDelegate;",
];
const PROFILE_RESULT = (code: number): string =>
  `Broadcasting: Intent { flg=0x400000 cmp=dev.leoperez.wave/androidx.profileinstaller.ProfileInstallReceiver }\nBroadcast completed: result=${code}\n`;

export class FakeDevice implements Device {
  readonly serial = "DRYRUN0001";
  readonly commands: string[] = [];
  private clock = 81_000_000;
  private readonly perfBuild: boolean;
  private readonly tabs: readonly string[];
  private running = false;
  private recorder: PerfRecorder | null = null;
  private routes: string[] = ["/"];
  private nowPlaying = false;
  private queue = false;
  private keyboard = false;
  private importCard = false;
  private importing = false;
  private frames: Frame[] = [];
  private framesSinceReset = 0;
  private logcat: string[] = [];
  private nextTick = 0;
  private readonly sdk: number;
  private readonly installResult: number;
  /** ART's profile: what ran since the last save, and what is saved on disk. */
  private pendingRules = new Set<string>();
  private savedRules: Set<string>;
  private skipFile = false;
  private compilation = { status: "speed-profile", reason: "install-dm" };

  constructor(options: FakeDeviceOptions = {}) {
    this.perfBuild = options.perfBuild ?? true;
    this.tabs = options.tabs ?? ["Home", "Library", "Playlists", "Search"];
    this.sdk = options.sdk ?? 36;
    this.installResult = options.installResult ?? 1;
    this.savedRules = new Set(options.savedProfile ?? []);
  }

  async sleep(ms: number): Promise<void> {
    this.advance(ms);
  }

  async pull(_remote: string, local: string): Promise<void> {
    writeFileSync(local, "dry-run trace placeholder\n");
  }

  async shell(command: string, _input?: string): Promise<string> {
    this.commands.push(command);
    this.advance(30);
    for (const [pattern, answer] of this.answers) {
      const match = pattern.exec(command);
      if (match !== null) return answer(match);
    }
    throw new Error(`Dry run: the simulated phone doesn't know "${command}".`);
  }

  // ---------------------------------------------------------------------------
  // Time

  private advance(ms: number): void {
    const until = this.clock + ms;
    while (this.nextTick <= until) {
      this.clock = Math.max(this.clock, this.nextTick);
      this.tick();
      this.nextTick = this.clock + 500;
    }
    this.clock = until;
  }

  /** What the app does on its own: the perf build's flush check. */
  private tick(): void {
    if (this.recorder?.dueForFlush() !== true) return;
    const meta = {
      perfBuild: true,
      commit: "0000000",
      "startup.startTime": 81_000_100,
      "startup.endTime": 81_000_900,
      "library.tracks": 12_345,
      "library.playlists": 40,
      "library.playlistItems": 6_000,
      "library.largestPlaylist": 2_500,
      "library.playEvents": 54_321,
      ...(this.importing
        ? { "import.running": true, "import.done": 120, "import.total": 2_000 }
        : {}),
    };
    this.logcat.push(...this.recorder.drain(meta));
  }

  // ---------------------------------------------------------------------------
  // The simulated app

  private get route(): string {
    return this.routes[this.routes.length - 1] ?? "/";
  }

  private launch(): string {
    this.running = true;
    this.ran(LAUNCH_RULES);
    // profileinstaller writes the APK's profile once the app has started, unless told to skip.
    if (!this.skipFile && this.installResult === 1)
      for (const rule of APK_BASELINE) this.savedRules.add(rule);
    this.routes = ["/"];
    this.nowPlaying = this.queue = this.keyboard = this.importCard = false;
    this.frames = [];
    this.framesSinceReset = 0;
    this.recorder = this.perfBuild ? createPerfRecorder({ now: () => this.clock }) : null;
    this.render(this.clock + 200, 40);
    this.advance(750);
    return "Starting: Intent { act=android.intent.action.MAIN }\nStatus: ok\nLaunchState: COLD\nActivity: dev.leoperez.wave/.MainActivity\nTotalTime: 742\nWaitTime: 760\nComplete\n";
  }

  /** [count] frames from [start], one of them long, as a transition draws. */
  private render(start: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.frames.push({ start: start + i * INTERVAL, ms: i === 3 ? 21 : 6 });
    }
    this.framesSinceReset += count;
  }

  /** A mark at the simulated clock's time, as the app's `perfMark`. */
  private respond(name: string, detail?: string): void {
    this.recorder?.mark(name, detail);
  }

  private navigate(to: string | null): void {
    this.render(this.clock + 8, 36);
    this.recorder?.render("TabBar");
    this.recorder?.render("MiniPlayer");
    if (to === null) this.routes.pop();
    else this.routes.push(to);
    this.advance(120);
    this.respond("route", this.route);
  }

  private tap(x: number, y: number): void {
    const node = this.nodes().find(
      ({ bounds: [left, top, right, bottom] }) =>
        x >= left && x <= right && y >= top && y <= bottom,
    );
    this.recorder?.touch(this.clock - 4);
    this.advance(12);
    if (node === undefined) return;
    const label = node.desc ?? node.text ?? "";
    const tabRoute = TAB_ROUTES[label];
    if (tabRoute !== undefined && node.desc !== undefined) {
      this.routes = [tabRoute];
      this.render(this.clock, 30);
      this.advance(100);
      this.respond("route", tabRoute);
      if (label === "Search") {
        this.advance(180);
        this.keyboard = true;
        this.respond("keyboard.show");
      }
    } else if (label === "Settings") this.navigate("/settings");
    else if (label === "Developer") this.navigate("/settings/developer");
    else if (label === "Albums") this.navigate("/library/albums");
    else if (label === "Songs") this.navigate("/library/songs");
    else if (label === "Back") this.navigate(null);
    else if (label.startsWith("Now playing:")) {
      this.ran(NOW_PLAYING_RULES);
      this.nowPlaying = true;
      this.render(this.clock, 40);
      this.advance(16);
      this.respond("nowPlaying.shown");
    } else if (label === "Close Now Playing") {
      this.nowPlaying = this.queue = false;
      this.render(this.clock, 40);
      this.advance(16);
      this.respond("nowPlaying.hidden");
    } else if (label === "Queue") {
      this.queue = !this.queue;
      this.render(this.clock, 24);
      this.recorder?.render("UpNextList");
      this.advance(90);
      if (this.queue) this.respond("visible", "queue");
    } else if (label === "Import") {
      this.importCard = false;
      this.importing = true;
      this.render(this.clock, 20);
      this.advance(40);
      this.respond("import.running", "2000");
    }
  }

  private ran(rules: readonly string[]): void {
    for (const rule of rules) this.pendingRules.add(rule);
  }

  /** What profileinstaller's receiver does with a broadcast; answers its result code. */
  private profileInstaller(action: string, extra: string | undefined): string {
    switch (action) {
      case "SAVE_PROFILE":
        if (!this.running) return PROFILE_RESULT(13);
        for (const rule of this.pendingRules) this.savedRules.add(rule);
        this.pendingRules.clear();
        return PROFILE_RESULT(12);
      case "SKIP_FILE":
        this.skipFile = extra === "WRITE_SKIP_FILE";
        return PROFILE_RESULT(this.skipFile ? 10 : 11);
      case "INSTALL_PROFILE":
        if (this.installResult === 1) for (const rule of APK_BASELINE) this.savedRules.add(rule);
        return PROFILE_RESULT(this.installResult);
      default:
        throw new Error(`Dry run: profileinstaller has no action ${action}.`);
    }
  }

  private back(): void {
    if (this.keyboard) this.keyboard = false;
    else if (this.nowPlaying) this.nowPlaying = this.queue = false;
    else if (this.routes.length > 1) this.routes.pop();
    this.render(this.clock + 8, 20);
  }

  private nodes(): Node[] {
    if (!this.running) return [];
    if (this.importCard) return [{ text: "Import", bounds: [900, 2400, 1300, 2520] }];
    if (this.nowPlaying)
      return [
        { desc: "Close Now Playing", bounds: [640, 120, 800, 260] },
        { desc: "Queue", bounds: [1100, 2800, 1240, 2940] },
      ];
    const route = this.route;
    if (route.startsWith("/settings") || route.startsWith("/library/"))
      return [
        { desc: "Back", bounds: [40, 140, 180, 280] },
        ...(route === "/settings"
          ? [{ text: "Developer", bounds: [80, 1500, 600, 1600] } as Node]
          : []),
      ];
    const tabs = this.tabs.map((label, i): Node => ({
      desc: label,
      bounds: [80 + i * 300, 2900, 340 + i * 300, 3040],
    }));
    const mini: Node = { desc: "Now playing: Airbag, Radiohead", bounds: [40, 2700, 1400, 2860] };
    if (route === "/library")
      return [
        { text: "Albums", bounds: [80, 700, 600, 800] },
        { text: "Songs", bounds: [80, 900, 600, 1000] },
        mini,
        ...tabs,
      ];
    return [{ desc: "Settings", bounds: [1260, 180, 1400, 320] }, mini, ...tabs];
  }

  private uiDump(): string {
    const nodes = this.nodes()
      .map(
        (node, i) =>
          `<node index="${i}" text="${node.text ?? ""}" class="android.view.ViewGroup" package="dev.leoperez.wave" content-desc="${
            node.desc ?? ""
          }" bounds="[${node.bounds[0]},${node.bounds[1]}][${node.bounds[2]},${node.bounds[3]}]" />`,
      )
      .join("");
    return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" class="android.widget.FrameLayout" content-desc="" bounds="[0,0][1440,3120]">${nodes}</node></hierarchy>`;
  }

  private gfxinfo(): string {
    if (!this.running) return "No process found for: dev.leoperez.wave\n";
    const kept = this.frames.slice(-120);
    const sorted = this.frames.map((frame) => frame.ms).toSorted((a, b) => a - b);
    const at = (q: number) =>
      Math.round(sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0);
    const late = this.frames.filter((frame) => frame.ms > 2 * INTERVAL).length;
    const histogram = new Map<number, number>();
    for (const ms of sorted)
      histogram.set(Math.round(ms), (histogram.get(Math.round(ms)) ?? 0) + 1);
    const rows = kept.map(
      (frame) =>
        `0,1,${ns(frame.start)},${ns(frame.start)},0,${ns(frame.start + 0.5)},0,0,0,${ns(
          frame.start + 2 * INTERVAL,
        )},${ns(INTERVAL)},${ns(frame.start)},0,0,0,0,${ns(frame.start + frame.ms)},0,0,0,0,0,0,`,
    );
    return [
      "** Graphics info for pid 4242 [dev.leoperez.wave] **",
      `Total frames rendered: ${this.framesSinceReset}`,
      `Janky frames: ${late} (0.00%)`,
      `50th percentile: ${at(0.5)}ms`,
      `90th percentile: ${at(0.9)}ms`,
      `95th percentile: ${at(0.95)}ms`,
      `99th percentile: ${at(0.99)}ms`,
      "Number Missed Vsync: 0",
      "Number High input latency: 0",
      `Number Slow UI thread: ${late}`,
      "Number Slow bitmap uploads: 0",
      "Number Slow issue draw commands: 0",
      `Number Frame deadline missed: ${late}`,
      `HISTOGRAM: ${[...histogram].map(([ms, count]) => `${ms}ms=${count}`).join(" ")}`,
      "",
      "\tdev.leoperez.wave/dev.leoperez.wave.MainActivity/android.view.ViewRootImpl@1 (visibility=0)",
      "---PROFILEDATA---",
      "Flags,FrameTimelineVsyncId,IntendedVsync,Vsync,InputEventId,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,FrameDeadline,FrameInterval,FrameStartTime,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,GpuCompleted,SwapBuffersCompleted,DisplayPresentTime,CommandSubmissionDuration,",
      ...rows,
      "---PROFILEDATA---",
      "",
    ].join("\n");
  }

  private readonly answers: readonly [RegExp, (match: RegExpExecArray) => string][] = [
    [/^input keyevent KEYCODE_WAKEUP$/, () => ""],
    [
      /^cmd package compile -m (\S+) -f \S+$/,
      (match) => {
        this.compilation = { status: match[1] ?? "?", reason: "cmdline" };
        return "Success\n";
      },
    ],
    [
      /^cmd package compile --reset \S+$/,
      () => {
        this.savedRules.clear();
        this.pendingRules.clear();
        this.compilation = { status: "verify", reason: "install" };
        return "Success\n";
      },
    ],
    [
      /^am broadcast -a androidx\.profileinstaller\.action\.(\w+)(?: -e EXTRA_SKIP_FILE_OPERATION (\w+))? --include-stopped-packages \S+\/androidx\.profileinstaller\.ProfileInstallReceiver$/,
      (match) => this.profileInstaller(match[1] ?? "", match[2]),
    ],
    [/^pm dump-profiles --dump-classes-and-methods \S+$/, () => ""],
    [
      /^cat \/data\/misc\/profman\/\S+-primary\.prof\.txt$/,
      () => [...this.savedRules].map((rule) => `${rule}\n`).join(""),
    ],
    [/^wm size$/, () => "Physical size: 1440x3120\n"],
    [/^input swipe \d+ \d+ \d+ \d+ \d+$/, () => (this.ran(SCROLL_RULES), "")],
    [
      /^getprop$/,
      () =>
        `[ro.product.manufacturer]: [samsung]\n[ro.product.model]: [SM-DRYRUN]\n[ro.build.version.release]: [16]\n[ro.build.version.sdk]: [${this.sdk}]\n[ro.build.fingerprint]: [samsung/dryrun/dryrun:16/DRY/1:user/release-keys]\n`,
    ],
    [
      /^dumpsys package \S+$/,
      () =>
        `  Package [dev.leoperez.wave] (1):\n    versionCode=503 minSdk=31 targetSdk=36\n    versionName=0.5.3-ti\n    lastUpdateTime=2026-10-16 09:00:00\nDexopt state:\n  [dev.leoperez.wave]\n    path: /data/app/base.apk\n      arm64: [status=${this.compilation.status}] [reason=${this.compilation.reason}]\n`,
    ],
    [
      /^dumpsys display$/,
      () =>
        "  mActiveSfDisplayMode=DisplayMode{id=1, width=1440, height=3120, refreshRate=120.0}\n",
    ],
    [
      /^settings get (system|secure|global) (\S+)$/,
      (match) => (match[2]?.includes("scale") ? "1.0\n" : "120.0\n"),
    ],
    [/^dumpsys thermalservice$/, () => "Thermal Status: 0\n"],
    [
      /^am force-stop \S+$/,
      () => {
        // A killed app loses what ART hadn't saved yet.
        this.pendingRules.clear();
        this.running = false;
        this.recorder = null;
        return "";
      },
    ],
    [/^am start -W -S -a android\.intent\.action\.MAIN/, () => this.launch()],
    [
      /^am start -W -a android\.intent\.action\.MAIN/,
      () => {
        if (!this.running) return this.launch();
        this.render(this.clock + 20, 20);
        this.advance(180);
        return "Starting: Intent { act=android.intent.action.MAIN }\nStatus: ok\nLaunchState: HOT\nActivity: dev.leoperez.wave/.MainActivity\nTotalTime: 164\nWaitTime: 170\nComplete\n";
      },
    ],
    [/^input keyevent 3$/, () => ""],
    [
      /^am start -a android\.intent\.action\.SEND .* \S+$/,
      () => {
        this.importCard = true;
        this.render(this.clock + 30, 30);
        return "Starting: Intent { act=android.intent.action.SEND }\n";
      },
    ],
    [
      /^dumpsys activity activities \| grep/,
      () =>
        this.running
          ? "  topResumedActivity=ActivityRecord{1 u0 dev.leoperez.wave/.MainActivity t9}\n"
          : "",
    ],
    [/^logcat -c$/, () => ((this.logcat = []), "")],
    [/^logcat -d -v raw -s ReactNativeJS:V$/, () => this.logcat.join("\n")],
    [/^uiautomator dump \S+ >\/dev\/null 2>&1; cat \S+$/, () => this.uiDump()],
    [/^dumpsys gfxinfo \S+ reset$/, () => ((this.frames = []), (this.framesSinceReset = 0), "")],
    [/^dumpsys gfxinfo \S+ framestats$/, () => this.gfxinfo()],
    [
      /^input tap \d+ \d+(; input tap \d+ \d+)*$/,
      (match) => {
        for (const tap of match[0].split("; ")) {
          const [, x, y] = tap.split(" ").slice(1);
          this.tap(Number(x), Number(y));
          this.advance(60);
        }
        return "";
      },
    ],
    [/^input keyevent 4$/, () => (this.back(), "")],
    [
      /^dumpsys meminfo \S+$/,
      () =>
        this.running
          ? " App Summary\n           Java Heap:    20480                          40960\n         Native Heap:    61100                          62000\n            Graphics:    50000                          50000\n           TOTAL PSS:   245678            TOTAL RSS:   312345       TOTAL SWAP PSS:     1234\n"
          : "No process found for: dev.leoperez.wave\n",
    ],
    [/^perfetto --txt -c - -o \S+ --background$/, () => "4321\n"],
    [/^kill -TERM \d+; while kill -0/, () => ""],
    [/^rm -f \S+$/, () => ""],
  ];
}
