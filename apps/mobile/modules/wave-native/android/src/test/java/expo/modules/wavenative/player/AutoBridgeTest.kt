package expo.modules.wavenative.player

import com.google.common.util.concurrent.ListenableFuture
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AutoBridgeTest {
  /** The main-thread timers as the bridge sees them, on a manual clock. */
  private class FakeHost : AutoBridgeHost {
    var now = 0L
    private val pending = mutableListOf<Pair<Long, () -> Unit>>()

    override fun schedule(delayMs: Long, action: () -> Unit): () -> Unit {
      val entry = (now + delayMs) to action
      pending += entry
      return { pending.remove(entry) }
    }

    fun advanceBy(ms: Long) {
      now += ms
      val due = pending.filter { it.first <= now }
      pending.removeAll(due)
      due.forEach { it.second() }
    }
  }

  /** JS as the bridge sees it: the requests it was sent, in order. */
  private class FakeJs : AutoEmitter {
    val requests = mutableListOf<Triple<Int, String, String>>()

    override fun emit(id: Int, type: String, payload: String) {
      requests += Triple(id, type, payload)
    }
  }

  private val host = FakeHost()
  private val bridge = AutoBridge(host)
  private val js = FakeJs()

  private fun <T> ListenableFuture<T>.value(): T {
    assertTrue("the request is still pending", isDone)
    return get()
  }

  @Test
  fun `a request reaches JS and completes with its answer`() {
    bridge.attach(js)

    val reply = bridge.request("root", "{}", timeoutMs = 5_000)

    assertEquals(listOf(Triple(js.requests[0].first, "root", "{}")), js.requests)
    assertFalse(reply.isDone)
    bridge.respond(js.requests[0].first, """{"id":"root"}""")
    assertEquals(AutoReply.Ok("""{"id":"root"}"""), reply.value())
  }

  @Test
  fun `JS can fail a request with a message for Auto`() {
    bridge.attach(js)
    val reply = bridge.request("children", """{"parentId":"x"}""", timeoutMs = 5_000)

    bridge.fail(js.requests[0].first, "No such album")

    assertEquals(AutoReply.Failed("No such album"), reply.value())
  }

  @Test
  fun `concurrent requests are told apart by id`() {
    bridge.attach(js)
    val root = bridge.request("root", "{}", timeoutMs = 5_000)
    val children = bridge.request("children", "{}", timeoutMs = 5_000)

    bridge.respond(js.requests[1].first, "[]")
    bridge.respond(js.requests[0].first, "{}")

    assertEquals(AutoReply.Ok("{}"), root.value())
    assertEquals(AutoReply.Ok("[]"), children.value())
  }

  @Test
  fun `a request JS doesn't answer in time fails with a loading message`() {
    bridge.attach(js)
    val reply = bridge.request("root", "{}", timeoutMs = 5_000)

    host.advanceBy(4_999)
    assertFalse(reply.isDone)
    host.advanceBy(1)

    assertEquals(AutoReply.Failed(AutoBridge.STILL_LOADING), reply.value())
  }

  @Test
  fun `a late or unknown answer is ignored`() {
    bridge.attach(js)
    val reply = bridge.request("root", "{}", timeoutMs = 5_000)
    host.advanceBy(5_000)

    assertFalse(bridge.respond(js.requests[0].first, "{}"))
    assertFalse(bridge.respond(999, "{}"))
    assertEquals(AutoReply.Failed(AutoBridge.STILL_LOADING), reply.value())
  }

  @Test
  fun `an answer cancels the timeout`() {
    bridge.attach(js)
    val reply = bridge.request("root", "{}", timeoutMs = 5_000)
    bridge.respond(js.requests[0].first, "{}")

    host.advanceBy(10_000)

    assertEquals(AutoReply.Ok("{}"), reply.value())
  }

  @Test
  fun `requests made while JS is starting are sent once it attaches`() {
    val reply = bridge.request("root", "{}", timeoutMs = 8_000)
    assertFalse(bridge.attached)

    host.advanceBy(3_000)
    bridge.attach(js)

    assertEquals(listOf("root"), js.requests.map { it.second })
    bridge.respond(js.requests[0].first, "{}")
    assertEquals(AutoReply.Ok("{}"), reply.value())
  }

  @Test
  fun `the timeout covers the wait for JS to start`() {
    val reply = bridge.request("children", "{}", timeoutMs = 8_000)

    host.advanceBy(8_000)

    assertEquals(AutoReply.Failed(AutoBridge.STILL_LOADING), reply.value())
  }

  @Test
  fun `a request that timed out while JS was starting is still sent, and its answer reported`() {
    var late = 0
    val reply = bridge.request("children", "{}", timeoutMs = 8_000, onLateAnswer = { late++ })
    host.advanceBy(8_000)
    assertEquals(AutoReply.Failed(AutoBridge.STILL_LOADING), reply.value())

    bridge.attach(js)
    assertEquals(0, late)
    bridge.respond(js.requests.single().first, "[]")

    assertEquals(1, late)
  }

  @Test
  fun `a request sent while JS was starting reports its late answer`() {
    var late = 0
    bridge.request("children", "{}", timeoutMs = 8_000, onLateAnswer = { late++ })
    bridge.attach(js)
    host.advanceBy(8_000)

    bridge.respond(js.requests.single().first, "[]")

    assertEquals(1, late)
  }

  @Test
  fun `a late answer to a request made with JS running isn't reported`() {
    var late = 0
    bridge.attach(js)
    bridge.request("children", "{}", timeoutMs = 5_000, onLateAnswer = { late++ })
    host.advanceBy(5_000)

    assertFalse(bridge.respond(js.requests.single().first, "[]"))

    assertEquals(0, late)
  }

  @Test
  fun `a timed-out request that JS fails isn't reported`() {
    var late = 0
    bridge.request("children", "{}", timeoutMs = 8_000, onLateAnswer = { late++ })
    host.advanceBy(8_000)
    bridge.attach(js)

    bridge.fail(js.requests.single().first, "No such album")

    assertEquals(0, late)
  }

  @Test
  fun `a timed-out request without onLateAnswer is never sent`() {
    bridge.request("add", "{}", timeoutMs = 8_000)
    host.advanceBy(8_000)

    bridge.attach(js)

    assertTrue("Auto was told it failed, so JS mustn't act on it", js.requests.isEmpty())
  }

  @Test
  fun `when JS goes away its unanswered requests fail and new ones wait again`() {
    bridge.attach(js)
    val sent = bridge.request("root", "{}", timeoutMs = 5_000)

    bridge.detach()
    val waiting = bridge.request("children", "{}", timeoutMs = 5_000)

    assertEquals(AutoReply.Failed(AutoBridge.STILL_LOADING), sent.value())
    assertFalse(waiting.isDone)
    val restarted = FakeJs()
    bridge.attach(restarted)
    assertEquals(listOf("children"), restarted.requests.map { it.second })
  }
}
