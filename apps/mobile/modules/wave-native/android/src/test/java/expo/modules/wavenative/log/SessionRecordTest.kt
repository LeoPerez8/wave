package expo.modules.wavenative.log

import android.app.ActivityManager
import expo.modules.wavenative.download.DownloadCounts
import expo.modules.wavenative.log.SessionRecord.Exit
import expo.modules.wavenative.log.SessionRecord.ExitReason
import java.io.File
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** How a session's end reaches the app log: an uncaught exception, and what the next launch says about it. */
class SessionRecordTest {
  private val folder: File = File(Files.createTempDirectory("wave-log").toFile(), "logs")
  private val file = AppLogFile(File(folder, "wave.log"))
  private val record = SessionRecord(folder)

  // 2026-10-16T14:03:22.415Z
  private val at = 1_792_159_402_415L

  init {
    WaveLog.writeTo(file, clock = { at })
  }

  @After
  fun stop() = WaveLog.writeTo(null)

  private fun entries(): List<String> = WaveLog.flush().let { file.read() }.split(Regex("\n(?=\\d{4}-)")).map { it.trimEnd('\n') }.filter { it.isNotEmpty() }

  /**
   * A new process: it starts with nothing queued, so what the last session queued is
   * written before the file is emptied. Otherwise the writer's thread could append it
   * after, as if this launch had written it.
   */
  private fun nextLaunch(vararg exits: Exit) {
    WaveLog.flush()
    file.dropHead(Long.MAX_VALUE)
    SessionRecord(folder).reportPrevious(exits.toList())
  }

  @Test
  fun anUncaughtExceptionIsWrittenWithItsThreadAndStack() {
    record.crashed(Thread("download-worker"), IllegalStateException("No file at /Music/a.mp3"))

    val entry = entries().single()
    assertTrue(entry, entry.startsWith("2026-10-16T14:03:22.415Z F crash: Uncaught exception in thread download-worker\n"))
    assertTrue(entry, entry.contains("\n  java.lang.IllegalStateException: No file at /Music/a.mp3\n"))
    assertTrue(entry, entry.contains("\n  \tat expo.modules.wavenative.log.SessionRecordTest."))
  }

  @Test
  fun theLaunchAfterACrashSaysThePreviousSessionEndedInACrash() {
    record.crashed(Thread("main"), RuntimeException("boom"))

    nextLaunch(Exit(at - 1_000, ExitReason.CRASH, "crash"))

    assertEquals(listOf("2026-10-16T14:03:22.415Z E app: The previous session ended in a crash"), entries())
  }

  @Test
  fun onlyTheLaunchRightAfterTheCrashSaysSo() {
    record.crashed(Thread("main"), RuntimeException("boom"))
    nextLaunch(Exit(at - 1_000, ExitReason.CRASH, "crash"))

    nextLaunch(Exit(at - 1_000, ExitReason.CRASH, "crash"), Exit(at - 500, ExitReason.USER_REQUESTED, null))

    assertEquals(emptyList<String>(), entries())
  }

  @Test
  fun aCrashOnlyAndroidSawIsReportedFromItsRecord() {
    nextLaunch(Exit(at - 60_000, ExitReason.CRASH_NATIVE, "signal 11 (SIGSEGV)"))

    assertEquals(
      listOf(
        "2026-10-16T14:03:22.415Z E app: The previous session ended in a crash (native, Android's record " +
          "of 2026-10-16T14:02:22.415Z): signal 11 (SIGSEGV)",
      ),
      entries(),
    )
  }

  @Test
  fun anAnrIsReportedWithTheMainThreadsStack() {
    val trace = """
      ----- pid 4242 at 2026-10-16 14:02:22.000 -----
      Cmd line: dev.leoperez.wave

      "Signal Catcher" daemon prio=10 tid=2 Runnable
        | group="system" sCount=0 ucsCount=0 flags=0 obj=0x12c80258 self=0x7a8b4c3000
        at dalvik.system.VMStack.getThreadStackTrace(Native method)

      "main" prio=5 tid=1 Sleeping
        | group="main" sCount=1 ucsCount=0 flags=1 obj=0x72a0d6f8 self=0x7a8b4c1000
        | sysTid=4242 nice=-10 cgrp=top-app sched=0/0 handle=0x7b9e7f04f8
        at java.lang.Thread.sleep(Native method)
        - sleeping on <0x0b3a1c2d> (a java.lang.Object)
        at expo.modules.wavenative.scan.LibraryScanner.scan(LibraryScanner.kt:88)
        at android.os.Handler.handleCallback(Handler.java:959)

      "binder:4242_1" prio=5 tid=3 Native
        at android.os.BinderProxy.transactNative(Native method)
    """.trimIndent()

    nextLaunch(Exit(at - 60_000, ExitReason.ANR, "Input dispatching timed out") { trace })

    assertEquals(
      listOf(
        "2026-10-16T14:03:22.415Z E app: The previous session stopped responding and Android closed it (ANR, " +
          "Android's record of 2026-10-16T14:02:22.415Z): Input dispatching timed out\n" +
          "  Main thread:\n" +
          "  \"main\" prio=5 tid=1 Sleeping\n" +
          "    at java.lang.Thread.sleep(Native method)\n" +
          "    - sleeping on <0x0b3a1c2d> (a java.lang.Object)\n" +
          "    at expo.modules.wavenative.scan.LibraryScanner.scan(LibraryScanner.kt:88)\n" +
          "    at android.os.Handler.handleCallback(Handler.java:959)",
      ),
      entries(),
    )
  }

  @Test
  fun aLowMemoryKillIsReportedWithWavesMemoryAndWhatItWasDoing() {
    nextLaunch(
      Exit(
        at - 60_000, ExitReason.LOW_MEMORY, "lmk", pssKb = 312 * 1024, rssKb = 401 * 1024,
        importance = ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE,
      ),
    )

    assertEquals(
      listOf(
        "2026-10-16T14:03:22.415Z E app: The previous session was killed for low memory (Android's record " +
          "of 2026-10-16T14:02:22.415Z): lmk\n" +
          "  Wave was a foreground service (playing or downloading); PSS 312 MB, RSS 401 MB",
      ),
      entries(),
    )
  }

  @Test
  fun aKillBySignalNamesTheSignal() {
    nextLaunch(Exit(at - 60_000, ExitReason.SIGNALED, null, status = 9))

    assertEquals(
      listOf(
        "2026-10-16T14:03:22.415Z E app: The previous session was killed by signal 9, SIGKILL (Android's record " +
          "of 2026-10-16T14:02:22.415Z)",
      ),
      entries(),
    )
  }

  /** The line the next launch writes for the previous session ending as [exit] says, with its record's time cut. */
  private fun reported(exit: Exit): List<String> {
    nextLaunch(exit)
    return entries().map {
      it.removePrefix("2026-10-16T14:03:22.415Z E app: ")
        .replace(Regex(" \\(Android's record of [^)]*\\)"), "")
        .replace(Regex(", Android's record of [^)]*"), "")
    }
  }

  @Test
  fun aSessionThatFrozeInTheBackgroundIsReported() {
    assertEquals(
      listOf("The previous session was killed while frozen in the background: freezer binder"),
      reported(Exit(at - 60_000, ExitReason.FREEZER, "freezer binder")),
    )
  }

  @Test
  fun aSessionWhoseDependencyDiedIsReported() {
    assertEquals(
      listOf("The previous session was closed because a process it depends on died"),
      reported(Exit(at - 60_000, ExitReason.DEPENDENCY_DIED, null)),
    )
  }

  @Test
  fun aSessionClosedForAChangedPermissionIsReported() {
    assertEquals(
      listOf("The previous session was closed because a permission changed: permissions revoked"),
      reported(Exit(at - 60_000, ExitReason.PERMISSION_CHANGE, "permissions revoked")),
    )
  }

  @Test
  fun aSessionClosedForAChangeInWavesPackageIsReported() {
    assertEquals(
      listOf("The previous session was closed because Wave's package changed state"),
      reported(Exit(at - 60_000, ExitReason.PACKAGE_STATE_CHANGE, null)),
    )
  }

  @Test
  fun aSessionThatExitedOnItsOwnIsReportedWithItsStatus() {
    assertEquals(
      listOf("The previous session exited on its own with status 10"),
      reported(Exit(at - 60_000, ExitReason.EXIT_SELF, null, status = 10)),
    )
  }

  @Test
  fun aSessionAndroidClosedForAnotherReasonIsReportedWithAndroidsWords() {
    assertEquals(
      listOf("The previous session was closed by Android: too many cached"),
      reported(Exit(at - 60_000, ExitReason.OTHER, "too many cached")),
    )
  }

  @Test
  fun aSessionThatEndedForAnUnrecordedReasonIsReported() {
    assertEquals(
      listOf("The previous session ended for a reason Android didn't record"),
      reported(Exit(at - 60_000, ExitReason.UNKNOWN, null)),
    )
  }

  @Test
  fun crashAndAnrLinesCarryWavesMemoryAndWhatItWasDoing() {
    val onScreen = ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
    assertEquals(
      listOf("The previous session ended in a crash (native): signal 11 (SIGSEGV)\n  Wave was on screen; PSS 200 MB, RSS 250 MB"),
      reported(Exit(at - 60_000, ExitReason.CRASH_NATIVE, "signal 11 (SIGSEGV)", pssKb = 200 * 1024, rssKb = 250 * 1024, importance = onScreen)),
    )
    assertEquals(
      listOf(
        "The previous session stopped responding and Android closed it (ANR): Input dispatching timed out\n" +
          "  Wave was on screen; PSS 300 MB, RSS 350 MB\n" +
          "  Main thread:\n" +
          "  \"main\" prio=5 tid=1 Native\n" +
          "    at android.os.MessageQueue.nativePollOnce(Native method)",
      ),
      reported(
        Exit(at - 30_000, ExitReason.ANR, "Input dispatching timed out", pssKb = 300 * 1024, rssKb = 350 * 1024, importance = onScreen) {
          "\"main\" prio=5 tid=1 Native\n  at android.os.MessageQueue.nativePollOnce(Native method)\n"
        },
      ),
    )
  }

  @Test
  fun theLaunchAfterACrashGivesWavesMemoryFromAndroidsRecord() {
    record.crashed(Thread("main"), RuntimeException("boom"))

    nextLaunch(
      Exit(
        at - 1_000, ExitReason.CRASH, "crash", pssKb = 180 * 1024, rssKb = 240 * 1024,
        importance = ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND,
      ),
    )

    assertEquals(
      listOf("2026-10-16T14:03:22.415Z E app: The previous session ended in a crash\n  Wave was on screen; PSS 180 MB, RSS 240 MB"),
      entries(),
    )
  }

  @Test
  fun whatWaveWasDoingIsSaidInPlainWords() {
    val words = mapOf(
      ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE to "visible behind another app",
      ActivityManager.RunningAppProcessInfo.IMPORTANCE_PERCEPTIBLE to "in the background, noticeably",
      ActivityManager.RunningAppProcessInfo.IMPORTANCE_SERVICE to "in the background (a service)",
      ActivityManager.RunningAppProcessInfo.IMPORTANCE_TOP_SLEEPING to "on screen with the screen off",
      ActivityManager.RunningAppProcessInfo.IMPORTANCE_CANT_SAVE_STATE to "in the background",
      ActivityManager.RunningAppProcessInfo.IMPORTANCE_CACHED to "cached",
    )
    for ((importance, doing) in words) {
      assertEquals(
        listOf("The previous session was killed for low memory\n  Wave was $doing; PSS 80 MB"),
        reported(Exit(at - 60_000 + importance, ExitReason.LOW_MEMORY, null, pssKb = 80 * 1024, importance = importance)),
      )
    }
  }

  @Test
  fun thePreviousSessionsLineNotesTheDownloadsTheJournalHadInProgress() {
    nextLaunch(Exit(at - 600_000, ExitReason.USER_REQUESTED, null))
    WaveLog.flush()
    file.dropHead(Long.MAX_VALUE)

    SessionRecord(folder).reportPrevious(
      listOf(Exit(at - 120_000, ExitReason.ANR, "Input dispatching timed out"), Exit(at - 60_000, ExitReason.LOW_MEMORY, null)),
    ) { DownloadCounts(running = 5, left = 659) }

    val written = entries()
    assertEquals(2, written.size)
    assertFalse(written[0], written[0].contains("Downloads"))
    assertEquals(
      "2026-10-16T14:03:22.415Z E app: The previous session was killed for low memory (Android's record of " +
        "2026-10-16T14:02:22.415Z)\n" +
        "  Downloads were in progress: 5 downloading, 659 waiting",
      written[1],
    )
  }

  @Test
  fun noDownloadsInProgressAddsNothing() {
    nextLaunch(Exit(at - 600_000, ExitReason.USER_REQUESTED, null))
    WaveLog.flush()
    file.dropHead(Long.MAX_VALUE)

    SessionRecord(folder).reportPrevious(listOf(Exit(at - 60_000, ExitReason.LOW_MEMORY, null))) { DownloadCounts(running = 0, left = 0) }

    assertEquals(
      listOf("2026-10-16T14:03:22.415Z E app: The previous session was killed for low memory (Android's record of 2026-10-16T14:02:22.415Z)"),
      entries(),
    )
  }

  @Test
  fun theLaunchAfterACrashNotesTheDownloadsInProgress() {
    record.crashed(Thread("main"), RuntimeException("boom"))
    WaveLog.flush()
    file.dropHead(Long.MAX_VALUE)

    SessionRecord(folder).reportPrevious(listOf(Exit(at - 1_000, ExitReason.CRASH, "crash"))) { DownloadCounts(running = 2, left = 0) }

    assertEquals(
      listOf("2026-10-16T14:03:22.415Z E app: The previous session ended in a crash\n  Downloads were in progress: 2 downloading, 0 waiting"),
      entries(),
    )
  }

  @Test
  fun anOrdinaryEndNeverReadsTheJournal() {
    nextLaunch(Exit(at - 600_000, ExitReason.USER_REQUESTED, null))

    SessionRecord(folder).reportPrevious(listOf(Exit(at - 60_000, ExitReason.USER_REQUESTED, null))) { error("The journal isn't read") }

    assertEquals(emptyList<String>(), entries())
  }

  @Test
  fun quittingSwipingAwayAndAPackageUpdateSayNothing() {
    nextLaunch(Exit(at - 600_000, ExitReason.USER_REQUESTED, null))

    nextLaunch(
      Exit(at - 60_000, ExitReason.USER_REQUESTED, "remove task"),
      Exit(at - 120_000, ExitReason.OTHER, "remove task"),
      Exit(at - 180_000, ExitReason.USER_STOPPED, null),
      Exit(at - 240_000, ExitReason.PACKAGE_UPDATED, "package updated"),
      Exit(at - 300_000, ExitReason.USER_REQUESTED, "stop dev.leoperez.wave"),
    )

    assertEquals(emptyList<String>(), entries())
  }

  @Test
  fun theFirstLaunchReportsOnlyThePreviousSessionNotAllOfAndroidsHistory() {
    nextLaunch(
      Exit(at - 60_000, ExitReason.ANR, "Input dispatching timed out"),
      Exit(at - 600_000, ExitReason.CRASH, "crash"),
    )

    val written = entries()
    assertEquals(1, written.size)
    assertTrue(written[0], written[0].contains("stopped responding"))
  }

  @Test
  fun sessionsSinceTheLastLaunchAreEachReportedOnce() {
    nextLaunch(Exit(at - 600_000, ExitReason.USER_REQUESTED, null))

    nextLaunch(
      Exit(at - 60_000, ExitReason.CRASH_NATIVE, "signal 6 (SIGABRT)"),
      Exit(at - 120_000, ExitReason.ANR, "Broadcast of Intent { act=android.intent.action.MEDIA_BUTTON }"),
      Exit(at - 600_000, ExitReason.USER_REQUESTED, null),
    )

    val written = entries()
    assertEquals(2, written.size)
    assertTrue(written[0], written[0].contains("An earlier session stopped responding and Android closed it (ANR, Android's record of 2026-10-16T14:01:22.415Z)"))
    assertTrue(written[1], written[1].contains("The previous session ended in a crash (native"))
    assertFalse(written[0], written[0].contains("Main thread"))

    nextLaunch(Exit(at - 60_000, ExitReason.CRASH_NATIVE, "signal 6 (SIGABRT)"))
    assertEquals(emptyList<String>(), entries())
  }
}
