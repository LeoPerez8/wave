package expo.modules.wavenative.download

import org.junit.Assert.assertEquals
import org.junit.Test

/** The app log's lines for the download service starting, stopping and being refused (#385). */
class DownloadServiceLinesTest {
  @Test fun startingSaysWhetherAndroidRestartedItAndWhatItHasToDo() {
    assertEquals("The download service started: 2 downloading, 40 waiting", DownloadServiceLines.started(restarted = false, DownloadCounts(running = 2, left = 40)))
    assertEquals(
      "Android restarted the download service after Wave was closed: 5 downloading, 0 waiting",
      DownloadServiceLines.started(restarted = true, DownloadCounts(running = 5, left = 0)),
    )
  }

  @Test fun stoppingSaysWhyAfterHowLongAndWhatWasLeft() {
    assertEquals(
      "The download service stopped after 42 min 5 s: its queue is empty",
      DownloadServiceLines.stopped(DownloadServiceStop.QUEUE_EMPTY, 42 * 60_000L + 5_000L, DownloadCounts(0, 0)),
    )
    assertEquals(
      "The download service stopped after 6 h: Android's time limit, with 3 downloading and 12 waiting",
      DownloadServiceLines.stopped(DownloadServiceStop.TIME_LIMIT, 6 * 60 * 60_000L, DownloadCounts(3, 12)),
    )
    assertEquals(
      "The download service stopped after 30 s: Android stopped it, with 1 downloading and 0 waiting",
      DownloadServiceLines.stopped(DownloadServiceStop.ANDROID, 30_000L, DownloadCounts(1, 0)),
    )
  }

  @Test fun aRefusedStartOrRestartSaysWhatAndroidAnsweredAndWhatHappensToTheDownloads() {
    assertEquals(
      "Android refused to restart the download service after Wave was closed (android.app.ForegroundServiceStartNotAllowedException: not allowed); the downloads wait for Wave's next launch",
      DownloadServiceLines.refused(restart = true, "android.app.ForegroundServiceStartNotAllowedException: not allowed"),
    )
    assertEquals(
      "Android refused to start the download service (java.lang.SecurityException: denied); started downloads fail with Retry, waiting ones wait for Wave's next launch",
      DownloadServiceLines.refused(restart = false, "java.lang.SecurityException: denied"),
    )
  }
}
