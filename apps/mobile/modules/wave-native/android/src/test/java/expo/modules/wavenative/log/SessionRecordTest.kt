package expo.modules.wavenative.log

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

  private fun entries(): List<String> = file.read().split(Regex("\n(?=\\d{4}-)")).map { it.trimEnd('\n') }.filter { it.isNotEmpty() }

  private fun nextLaunch(vararg exits: Exit) {
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
  fun anOrdinaryEndSaysNothing() {
    nextLaunch(Exit(at - 60_000, ExitReason.USER_REQUESTED, null), Exit(at - 120_000, ExitReason.OTHER, "swiped away"))

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
