package expo.modules.wavenative.download

import org.junit.Assert.*
import org.junit.Test

/**
 * The Wi-Fi job handing the songs that waited for Wi-Fi to the download service (#1502): the job
 * is cancelled only once Android accepted the service, and once Android stopped it the job starts
 * no work.
 */
class WifiWaitHandoffTest {
  @Test fun theWaitIsCancelledOnlyOnceAndroidAcceptedTheService() {
    val steps = mutableListOf<String>()
    val refused = WifiWaitHandoff.startService(start = { steps += "start" }, cancelWait = { steps += "cancel" })
    assertNull(refused)
    assertEquals(listOf("start", "cancel"), steps)
  }

  @Test fun refusedTheJobKeepsRunningForTheDownloads() {
    var cancelled = false
    val refusal = IllegalStateException("Not allowed to start service from the background")
    val refused = WifiWaitHandoff.startService(start = { throw refusal }, cancelWait = { cancelled = true })
    assertSame(refusal, refused)
    assertFalse("the running job isn't cancelled: it runs the downloads", cancelled)
  }

  @Test fun theJobRunsTheWorkUntilAndroidStopsIt() {
    val run = WifiWaitHandoff.JobRun()
    var started = 0
    assertTrue(run.startWork { started++ })
    assertEquals(1, started)
    run.stopped()
    assertFalse("a stop before the work starts leaves nothing started after it", run.startWork { started++ })
    assertEquals(1, started)
  }
}
