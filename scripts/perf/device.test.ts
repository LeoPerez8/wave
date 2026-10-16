import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findNode,
  parseAmStart,
  parseCompilation,
  parseGetprop,
  parseGfxinfo,
  parseMeminfo,
  parsePackage,
  parseRefreshRate,
  parseThermalStatus,
  parseWmSize,
} from "./device.ts";

// Shapes as Android 14 prints them; trimmed to what the runner reads plus some noise.
const GFXINFO = `Applications Graphics Acceleration Info:
Uptime: 81234567 Realtime: 91234567

** Graphics info for pid 4242 [dev.leoperez.wave] **

Stats since: 81000000000000ns
Total frames rendered: 240
Janky frames: 12 (5.00%)
Janky frames (legacy): 30 (12.50%)
50th percentile: 6ms
90th percentile: 9ms
95th percentile: 12ms
99th percentile: 25ms
Number Missed Vsync: 3
Number High input latency: 1
Number Slow UI thread: 5
Number Slow bitmap uploads: 0
Number Slow issue draw commands: 2
Number Frame deadline missed: 12
Number Frame deadline missed (legacy): 10
HISTOGRAM: 5ms=100 6ms=60 7ms=30 8ms=20 9ms=10 10ms=8 12ms=4 25ms=6 150ms=2
50th gpu percentile: 3ms
90th gpu percentile: 5ms
GPU HISTOGRAM: 1ms=10 2ms=20
Font Cache (CPU):
  Size: 1.00 MB

Pipeline=Skia (Vulkan)
Profile data in ms:

\tdev.leoperez.wave/dev.leoperez.wave.MainActivity/android.view.ViewRootImpl@5f1a2b3 (visibility=0)
---PROFILEDATA---
Flags,FrameTimelineVsyncId,IntendedVsync,Vsync,InputEventId,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,FrameDeadline,FrameInterval,FrameStartTime,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,GpuCompleted,SwapBuffersCompleted,DisplayPresentTime,CommandSubmissionDuration,
0,9001,81000100000000,81000100000000,77,81000100500000,81000101000000,81000101500000,81000102000000,81000116666666,8333333,81000100000000,81000103000000,81000103100000,81000103500000,81000105000000,81000106000000,100000,50000,81000106000000,81000105500000,0,20000,
1,9002,81000108333333,81000108333333,0,81000108500000,81000109000000,81000109500000,81000110000000,81000125000000,8333333,81000108333333,81000111000000,81000111100000,81000111500000,81000128000000,81000130000000,100000,50000,81000130000000,81000129000000,0,20000,
---PROFILEDATA---

\tdev.leoperez.wave/PopupWindow:1a2b (visibility=0)
---PROFILEDATA---
Flags,FrameTimelineVsyncId,IntendedVsync,Vsync,InputEventId,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,FrameDeadline,FrameInterval,FrameStartTime,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,GpuCompleted,SwapBuffersCompleted,DisplayPresentTime,CommandSubmissionDuration,
0,9003,81000116666666,81000116666666,0,81000116700000,81000116800000,81000116900000,81000117000000,81000133333333,8333333,81000116666666,81000118000000,81000118100000,81000118500000,81000119000000,81000120000000,100000,50000,81000120000000,81000119500000,0,20000,
---PROFILEDATA---

View hierarchy:
`;

describe("parseGfxinfo", () => {
  it("reads the totals gfxinfo keeps since its last reset", () => {
    const { summary } = parseGfxinfo(GFXINFO);
    assert.deepEqual(
      {
        totalFrames: summary.totalFrames,
        jankyFrames: summary.jankyFrames,
        p50Ms: summary.p50Ms,
        p90Ms: summary.p90Ms,
        p95Ms: summary.p95Ms,
        p99Ms: summary.p99Ms,
        missedVsync: summary.missedVsync,
        highInputLatency: summary.highInputLatency,
        slowUiThread: summary.slowUiThread,
        slowBitmapUploads: summary.slowBitmapUploads,
        slowIssueDrawCommands: summary.slowIssueDrawCommands,
        frameDeadlineMissed: summary.frameDeadlineMissed,
      },
      {
        totalFrames: 240,
        jankyFrames: 12,
        p50Ms: 6,
        p90Ms: 9,
        p95Ms: 12,
        p99Ms: 25,
        missedVsync: 3,
        highInputLatency: 1,
        slowUiThread: 5,
        slowBitmapUploads: 0,
        slowIssueDrawCommands: 2,
        frameDeadlineMissed: 12,
      },
    );
  });

  it("reads the CPU frame-time histogram, not the GPU one", () => {
    assert.deepEqual(parseGfxinfo(GFXINFO).summary.histogram, [
      [5, 100],
      [6, 60],
      [7, 30],
      [8, 20],
      [9, 10],
      [10, 8],
      [12, 4],
      [25, 6],
      [150, 2],
    ]);
  });

  it("reads every window's retained frames, in ms on the monotonic clock", () => {
    const { frames } = parseGfxinfo(GFXINFO);
    assert.equal(frames.length, 3);
    assert.deepEqual(frames[0], {
      window: "dev.leoperez.wave/dev.leoperez.wave.MainActivity/android.view.ViewRootImpl@5f1a2b3",
      flags: 0,
      inputEventId: 77,
      intendedVsyncMs: 81_000_100,
      completedMs: 81_000_106,
      deadlineMs: 81_000_116.666666,
      intervalMs: 8.333333,
      phases: { traversalMs: 0.5, drawMs: 1, syncMs: 0.4, issueMs: 1.5, gpuMs: 1 },
    });
    assert.equal(frames[2]?.window, "dev.leoperez.wave/PopupWindow:1a2b");
  });

  it("splits each frame into the UI thread's, the RenderThread's and the GPU's parts", () => {
    // The second frame: the RenderThread spent 16.5 ms issuing draw commands (blur, layers).
    const { frames } = parseGfxinfo(GFXINFO);
    assert.deepEqual(frames[1]?.phases, {
      traversalMs: 0.5,
      drawMs: 1,
      syncMs: 0.4,
      issueMs: 16.5,
      gpuMs: 2,
    });
  });

  it("leaves out a part whose timestamps Android didn't fill in", () => {
    const header =
      "Flags,IntendedVsync,PerformTraversalsStart,DrawStart,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,GpuCompleted,";
    const row = "0,1000000000,1001000000,1002000000,1003000000,0,0,1006000000,1007000000,0,";
    const { frames } = parseGfxinfo(`	main (visibility=0)
---PROFILEDATA---
${header}
${row}
---PROFILEDATA---
`);
    assert.deepEqual(frames[0]?.phases, {
      traversalMs: 1,
      drawMs: 1,
      syncMs: null,
      issueMs: null,
      gpuMs: null,
    });
  });

  it("finds nothing in an app that hasn't drawn", () => {
    const parsed = parseGfxinfo("No process found for: dev.leoperez.wave\n");
    assert.equal(parsed.summary.totalFrames, null);
    assert.deepEqual(parsed.frames, []);
  });
});

describe("parseMeminfo", () => {
  it("reads the totals and the app summary in KB", () => {
    const text = `Applications Memory Usage (in Kilobytes):
Uptime: 81234567 Realtime: 91234567

** MEMINFO in pid 4242 [dev.leoperez.wave] **
                   Pss  Private  Private  SwapPss      Rss     Heap     Heap     Heap
                 Total    Dirty    Clean    Dirty    Total     Size    Alloc     Free
                ------   ------   ------   ------   ------   ------   ------   ------
  Native Heap    61234    61100        0       12    62000    90000    70000    20000
  TOTAL   245678   200000    30000     1234   312345   120000    90000    30000

 App Summary
                       Pss(KB)                        Rss(KB)
                        ------                         ------
           Java Heap:    20480                          40960
         Native Heap:    61100                          62000
                Code:    40000                          90000
               Stack:     1200                           1300
            Graphics:    50000                          50000
       Private Other:    12000
              System:    61000
             Unknown:                                    5000

           TOTAL PSS:   245678            TOTAL RSS:   312345       TOTAL SWAP PSS:     1234
`;
    assert.deepEqual(parseMeminfo(text), {
      totalPssKb: 245_678,
      totalRssKb: 312_345,
      swapPssKb: 1_234,
      javaHeapKb: 20_480,
      nativeHeapKb: 61_100,
      codeKb: 40_000,
      stackKb: 1_200,
      graphicsKb: 50_000,
      privateOtherKb: 12_000,
      systemKb: 61_000,
    });
  });

  it("is empty when the app isn't running", () => {
    assert.deepEqual(parseMeminfo("No process found for: dev.leoperez.wave"), {});
  });
});

describe("parseAmStart", () => {
  it("reads a measured launch", () => {
    const text = `Starting: Intent { act=android.intent.action.MAIN cat=[android.intent.category.LAUNCHER] pkg=dev.leoperez.wave }
Status: ok
LaunchState: COLD
Activity: dev.leoperez.wave/.MainActivity
TotalTime: 812
WaitTime: 830
Complete
`;
    assert.deepEqual(parseAmStart(text), {
      status: "ok",
      launchState: "COLD",
      totalTimeMs: 812,
      waitTimeMs: 830,
    });
  });

  it("leaves out what a failed launch didn't say", () => {
    assert.deepEqual(parseAmStart("Error: Activity not started, unable to resolve Intent"), {
      status: null,
      launchState: null,
      totalTimeMs: null,
      waitTimeMs: null,
    });
  });
});

describe("parsePackage and parseCompilation", () => {
  const text = `Packages:
  Package [dev.leoperez.wave] (a1b2c3):
    versionCode=503 minSdk=31 targetSdk=36
    versionName=0.5.3-ti
    lastUpdateTime=2026-10-15 21:04:11
    firstInstallTime=2026-09-01 10:00:00

Dexopt state:
  [dev.leoperez.wave]
    path: /data/app/~~x==/dev.leoperez.wave-y==/base.apk
      arm64: [status=speed-profile] [reason=bg-dexopt] [primary-abi]
        [location is /data/app/~~x==/dev.leoperez.wave-y==/oat/arm64/base.odex]
`;

  it("reads the installed version", () => {
    assert.deepEqual(parsePackage(text), {
      versionName: "0.5.3-ti",
      versionCode: 503,
      lastUpdateTime: "2026-10-15 21:04:11",
    });
  });

  it("reads how ART compiled the APK", () => {
    assert.deepEqual(parseCompilation(text), { status: "speed-profile", reason: "bg-dexopt" });
  });

  it("knows when the package isn't installed", () => {
    assert.equal(parsePackage("Unable to find package: dev.leoperez.wave"), null);
    assert.equal(parseCompilation("Unable to find package: dev.leoperez.wave"), null);
  });
});

describe("parseRefreshRate", () => {
  it("reads the active display mode's rate", () => {
    const text = `DISPLAY MANAGER (dumpsys display)
  mActiveSfDisplayMode=DisplayMode{id=1, width=1440, height=3120, xDpi=505.0, yDpi=505.0, refreshRate=120.0, appVsyncOffsetNanos=0}
  mRenderFrameRate=60.0
`;
    assert.equal(parseRefreshRate(text), 120);
  });

  it("falls back to the logical display's rate", () => {
    assert.equal(parseRefreshRate("    mRefreshRate=60.000004\n"), 60);
    assert.equal(parseRefreshRate("nothing here"), null);
  });
});

describe("parseWmSize", () => {
  it("reads the screen's size in pixels", () => {
    assert.deepEqual(parseWmSize("Physical size: 1440x3120\n"), { width: 1440, height: 3120 });
  });

  it("prefers the size set over the physical one, as the screen draws at it", () => {
    assert.deepEqual(parseWmSize("Physical size: 1440x3120\nOverride size: 1080x2340\n"), {
      width: 1080,
      height: 2340,
    });
  });

  it("is null when wm says nothing it can read", () => {
    assert.equal(parseWmSize(""), null);
  });
});

describe("parseGetprop and parseThermalStatus", () => {
  it("reads properties", () => {
    const props = parseGetprop(
      "[ro.product.model]: [SM-S926B]\n[ro.build.version.release]: [16]\n[empty]: []\n",
    );
    assert.equal(props["ro.product.model"], "SM-S926B");
    assert.equal(props["ro.build.version.release"], "16");
    assert.equal(props["empty"], "");
  });

  it("reads the thermal status", () => {
    assert.equal(parseThermalStatus("IsStatusOverride: false\nThermal Status: 2\n"), 2);
    assert.equal(parseThermalStatus(""), null);
  });
});

describe("findNode", () => {
  const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="dev.leoperez.wave" content-desc="" bounds="[0,0][1440,3120]"><node index="0" text="" class="android.view.ViewGroup" content-desc="Settings" clickable="true" bounds="[1260,180][1400,320]" /><node index="1" text="Songs" class="android.widget.TextView" content-desc="" bounds="[100,900][400,980]" /><node index="2" text="" class="android.view.ViewGroup" content-desc="Now playing: Airbag, Radiohead" bounds="[40,2700][1400,2860]" /><node index="3" text="Rock &amp; Roll" class="android.widget.TextView" content-desc="" bounds="[100,1000][400,1080]" /></node></hierarchy>`;

  it("finds a node by its accessibility label and gives its centre", () => {
    assert.deepEqual(findNode(xml, { desc: "Settings" }), { x: 1330, y: 250 });
  });

  it("finds a node by text, or by the start of its label", () => {
    assert.deepEqual(findNode(xml, { text: "Songs" }), { x: 250, y: 940 });
    assert.deepEqual(findNode(xml, { descPrefix: "Now playing:" }), { x: 720, y: 2780 });
  });

  it("matches text with XML entities decoded", () => {
    assert.deepEqual(findNode(xml, { text: "Rock & Roll" }), { x: 250, y: 1040 });
  });

  it("finds nothing when nothing matches", () => {
    assert.equal(findNode(xml, { desc: "Queue" }), null);
  });
});
