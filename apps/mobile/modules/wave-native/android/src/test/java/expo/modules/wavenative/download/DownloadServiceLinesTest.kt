package expo.modules.wavenative.download

import expo.modules.wavenative.log.MemoryUse
import org.junit.Assert.assertEquals
import org.junit.Test

/** The app log's lines for the download service starting, stopping and being refused (#385), with Wave's memory (#450). */
class DownloadServiceLinesTest {
  private val mb = 1L shl 20
  private val memory = MemoryUse(javaUsed = 45 * mb, javaLimit = 256 * mb, nativeHeap = 80 * mb, pss = 210 * mb)

  @Test fun startingSaysWhetherAndroidRestartedItAndWhatItHasToDo() {
    assertEquals(
      "The download service started: 2 downloading, 40 waiting; Java heap 45/256 MB, native heap 80 MB, PSS 210 MB",
      DownloadServiceLines.started(restarted = false, DownloadCounts(running = 2, left = 40), memory),
    )
    assertEquals(
      "Android restarted the download service after Wave was closed: 5 downloading, 0 waiting; Java heap 45/256 MB, native heap 80 MB, PSS 210 MB",
      DownloadServiceLines.started(restarted = true, DownloadCounts(running = 5, left = 0), memory),
    )
  }

  @Test fun stoppingSaysWhyAfterHowLongAndWhatWasLeft() {
    assertEquals(
      "The download service stopped after 42 min 5 s: its queue is empty; Java heap 45/256 MB, native heap 80 MB, PSS 210 MB",
      DownloadServiceLines.stopped(DownloadServiceStop.QUEUE_EMPTY, 42 * 60_000L + 5_000L, DownloadCounts(0, 0), memory),
    )
    assertEquals(
      "The download service stopped after 6 h: Android's time limit, with 3 downloading and 12 waiting; Java heap 45/256 MB, native heap 80 MB, PSS 210 MB",
      DownloadServiceLines.stopped(DownloadServiceStop.TIME_LIMIT, 6 * 60 * 60_000L, DownloadCounts(3, 12), memory),
    )
    assertEquals(
      "The download service stopped after 30 s: Android stopped it, with 1 downloading and 0 waiting; Java heap 45/256 MB, native heap 80 MB, PSS 210 MB",
      DownloadServiceLines.stopped(DownloadServiceStop.ANDROID, 30_000L, DownloadCounts(1, 0), memory),
    )
  }

  @Test fun whileItRunsAMemoryLineSaysWhatItHasToDoAndTheHermesHeapWhenJsReportedIt() {
    assertEquals(
      "Memory while downloading (5 downloading, 650 waiting): Java heap 45/256 MB, native heap 80 MB, PSS 210 MB, Hermes heap 31 MB",
      DownloadServiceLines.memory(DownloadCounts(running = 5, left = 650), memory, hermesHeap = 31 * mb),
    )
    assertEquals(
      "Memory while downloading (0 downloading, 3 waiting): Java heap 45/256 MB, native heap 80 MB, PSS 210 MB",
      DownloadServiceLines.memory(DownloadCounts(running = 0, left = 3), memory, hermesHeap = null),
    )
    // Songs downloaded and waiting their turn to be saved aren't downloading (#466).
    assertEquals(
      "Memory while downloading (5 downloading, 600 saving, 428 waiting): Java heap 45/256 MB, native heap 80 MB, PSS 210 MB",
      DownloadServiceLines.memory(DownloadCounts(running = 5, left = 428, saving = 600), memory, hermesHeap = null),
    )
    assertEquals(
      "The download service stopped after 30 s: Android stopped it, with 0 downloading, 2 saving and 0 waiting; Java heap 45/256 MB, native heap 80 MB, PSS 210 MB",
      DownloadServiceLines.stopped(DownloadServiceStop.ANDROID, 30_000L, DownloadCounts(running = 0, left = 0, saving = 2), memory),
    )
  }

  @Test fun aRefusedStartOrRestartSaysWhatAndroidAnsweredAndWhatHappensToTheDownloads() {
    assertEquals(
      "Android refused to restart the download service after Wave was closed (android.app.ForegroundServiceStartNotAllowedException: not allowed); the downloads wait for Wave's next launch",
      DownloadServiceLines.refused(restart = true, "android.app.ForegroundServiceStartNotAllowedException: not allowed"),
    )
    assertEquals(
      "Android refused to start the download service (java.lang.SecurityException: denied); the downloads wait for Wave's next launch, started ones back in line",
      DownloadServiceLines.refused(restart = false, "java.lang.SecurityException: denied"),
    )
  }

  @Test fun aReplacementRunsStopSaysWhatItDidAndWhy() {
    assertEquals(
      "A quality replacement run ended: 170 replaced, 12 kept with no better copy, 3 failed, 0 waiting",
      DownloadServiceLines.replacementRun(DurableDownloads.ReplacementRun(replaced = 170, kept = 12, failed = 3, waiting = 0, cancelled = 0), stopped = null),
    )
    assertEquals(
      "A quality replacement run stopped (Android's time limit): 170 replaced, 12 kept with no better copy, 3 failed, 540 waiting, 2 cancelled",
      DownloadServiceLines.replacementRun(DurableDownloads.ReplacementRun(replaced = 170, kept = 12, failed = 3, waiting = 540, cancelled = 2), DownloadServiceStop.TIME_LIMIT),
    )
  }
}
