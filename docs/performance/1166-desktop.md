# Desktop performance in CI

Issue #1166. The Windows and Linux desktop jobs run `pnpm --filter @wave/desktop test:perf`
after building the audio addon and JVM. Linux uses Xvfb. The check runs alone, with one worker
and no retries. Every push to `main` and every release tag runs both jobs, so each release's
run holds the report. The phone's release doesn't wait for them: a slow runner fails the desktop
job, not the publication.

## Measurements and limits

- **Window ready:** elapsed monotonic time from immediately before Playwright launches Electron
  until the initial window has populated its 50,000-song table and completed two animation
  frames. The window must be visible. This includes process launch, database opening, service
  creation, renderer loading, hydration, IPC reads and test-driver overhead. Exactly 2,000 ms
  fails. Fixture seeding and compilation are outside the timer. This is a new process and data
  directory, without clearing the operating system's disk cache. The report's `startup` says
  when the window opened and when its page started and finished loading; only the total is held
  to the limit.
- **Scrolling:** first measure 60 idle animation-frame intervals to determine the display's
  median interval. Then scroll 80 pixels per frame for 120 frames each near rows 0, 24,500 and
  49,500. Each segment must have p95 at most 1.5 display intervals, at most 5% missed display
  opportunities, and at most 5% frames with incomplete visible rows. A missed opportunity is
  `max(0, round(interval / displayInterval) - 1)`. Runs below 40 Hz are invalid. Check rendered
  rows stay below 50 and scrolling actually advances. Raw intervals, incomplete-frame counts and
  the rows each incomplete frame did draw stay in the report; a responsive empty viewport cannot
  pass.
- **Memory at rest:** after a real tag read and audio status call, scan completion and five
  idle seconds, enumerate the OS process table once and sum resident working sets for main and
  every descendant. This includes Chromium helpers, the audio utility process and the JVM.
  Electron's process list supplies any available roles; it alone would miss Java. The audio
  status call must still succeed after the idle period. Windows uses
  `Win32_Process.WorkingSetSize`, Linux uses `ps` RSS in KiB.
  Shared pages can count more than once. There is no memory budget in v1.

The profile is signed out, YT Music off, no artwork and no audio playing. It measures the real
application and both backends, with a SQLite-seeded library rather than 50,000 physical files.
It does not cover scanning, artwork-heavy libraries, network activity or installed-app startup.
No services, bridge calls or shared Android logic are added.

Two changes to the app came out of the first runs:

- The window is created and loads its page while the services start, and is shown once both are
  done. Before, the page only began to load after the database, the audio process and the JVM
  were up, about half a second later on the development machine.
- The table reads the page of rows on either side of the ones in view. Before, a scroll that
  crossed into a new page drew empty rows until its read came back, which took longer the deeper
  the page was (about 40 ms at row 49,500).

## Evidence

`apps/desktop/perf-results/desktop-performance-<platform>.json` records the commit, CI ref,
profile, limits, startup time, raw frames, segment results and memory per process in bytes.
The test writes and attaches the report even on failure; `status` is `passed` only after all
checks succeed. A backend failure leaves an incomplete report and fails the job.

CI uploads `desktop-performance-desktop-windows` and `desktop-performance-desktop-linux` on
success or failure for 90 days, including on every release-tag run. Missing artifacts fail
the job. These are workflow artifacts attached to the run, not release assets.

For a local run, build `build:native` and `build:jvm` first, then run `test:perf`. Windows needs
PowerShell's CIM cmdlets; Linux needs `ps` and an active display or `xvfb-run -a`. Keep other
builds and Electron runs idle during measurement. `test:e2e` excludes this separate performance
check. Node tests in `src/performance.test.ts` exercise the strict startup boundary, dropped
frames, stalls, incomplete viewports and process-tree inclusion; `performanceWorkflow.test.ts`
checks the CI wiring.
