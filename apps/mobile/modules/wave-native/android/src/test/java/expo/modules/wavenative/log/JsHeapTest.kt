package expo.modules.wavenative.log

import kotlin.concurrent.thread
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Native code asking JS for the Hermes heap, for the download service's memory line (#450). */
class JsHeapTest {
  private val heap = JsHeap(timeoutMs = 100L)

  @Test fun withNoJsRunningThereIsNoHermesHeapAndNoWait() {
    val started = System.nanoTime()
    assertNull(heap.read())
    assertTrue(System.nanoTime() - started < 50_000_000L)
  }

  @Test fun readsWhatJsAnswers() {
    heap.listen { thread { heap.reported(31L shl 20) } }
    assertEquals(31L shl 20, heap.read())
  }

  @Test fun givesUpWhenJsDoesntAnswerInTime() {
    heap.listen { }
    val started = System.nanoTime()
    assertNull(heap.read())
    assertTrue(System.nanoTime() - started >= 90_000_000L)
  }

  @Test fun aLateAnswerIsntTakenForTheNextAsk() {
    var answer = false
    heap.listen { if (answer) heap.reported(2L) }
    assertNull(heap.read())
    heap.reported(1L)
    assertNull(heap.read())
    answer = true
    assertEquals(2L, heap.read())
  }

  @Test fun aRuntimeThatWentNoLongerAnswers() {
    val stop = heap.listen { heap.reported(1L) }
    stop()
    assertNull(heap.read())
  }
}
