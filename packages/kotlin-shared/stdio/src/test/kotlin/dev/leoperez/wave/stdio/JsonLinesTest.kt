package dev.leoperez.wave.stdio

import expo.modules.wavenative.yt.YtException
import expo.modules.wavenative.yt.YtFailure
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.fail
import org.junit.Test

class JsonLinesTest {
  @Test
  fun answersARequestWithItsResultUnderItsId() = withHost({ method, params ->
    buildJsonObject { put("echo", "$method ${params["word"]!!.jsonPrimitive.content}") }
  }) { host ->
    host.write("""{"id":7,"method":"say","params":{"word":"hi"}}""")
    val answer = host.next()
    assertEquals(JsonPrimitive(7), answer["id"])
    assertEquals("say hi", answer["result"]!!.jsonObject["echo"]!!.jsonPrimitive.content)
  }

  @Test
  fun aFailureCarriesThePhonesErrorCode() = withHost({ _, _ -> throw YtException(YtFailure.OFFLINE) }) { host ->
    host.write("""{"id":1,"method":"search","params":{"query":"x"}}""")
    val answer = host.next()
    assertEquals(JsonPrimitive(1), answer["id"])
    assertEquals("ERR_YT_OFFLINE", answer["error"]!!.jsonObject["code"]!!.jsonPrimitive.content)
    assertFalse(answer.containsKey("result"))
  }

  @Test
  fun aRequestWithoutParamsGetsEmptyOnes() = withHost({ _, params -> JsonPrimitive(params.size) }) { host ->
    host.write("""{"id":2,"method":"ping"}""")
    assertEquals(JsonPrimitive(0), host.next()["result"])
  }

  @Test
  fun asksTheHostAndGetsItsAnswer() = withHost({ _, _ -> JsonPrimitive(true) }) { host ->
    val asked = async(Dispatchers.Default) { host.lines.ask("poToken", buildJsonObject { put("videoId", "v1") }) }
    val request = host.next()
    val id = request["id"]!!.jsonPrimitive.content
    assertEquals("poToken", request["method"]!!.jsonPrimitive.content)
    assertEquals("v1", request["params"]!!.jsonObject["videoId"]!!.jsonPrimitive.content)
    host.write("""{"id":"$id","result":{"token":"t"}}""")
    assertEquals("t", asked.await().jsonObject["token"]!!.jsonPrimitive.content)
  }

  @Test
  fun aHostErrorFailsTheQuestionWithItsCode() = withHost({ _, _ -> JsonPrimitive(true) }) { host ->
    val asked = async(Dispatchers.Default) { runCatching { host.lines.ask("poToken", buildJsonObject {}) } }
    val id = host.next()["id"]!!.jsonPrimitive.content
    host.write("""{"id":"$id","error":{"code":"ERR_NO_TOKEN","message":"none"}}""")
    val failure = asked.await().exceptionOrNull() as? HostError ?: fail("No host error") as Nothing
    assertEquals("ERR_NO_TOKEN", failure.code)
  }

  @Test
  fun anUnansweredQuestionTimesOut() = withHost({ _, _ -> JsonPrimitive(true) }) { host ->
    val failure = runCatching { host.lines.ask("poToken", buildJsonObject {}, timeoutMs = 50) }.exceptionOrNull()
    assertEquals("ERR_HOST_TIMEOUT", (failure as HostError).code)
  }

  @Test
  fun anUnreadableLineIsAnsweredWithACodeAndTheJvmGoesOn() = withHost({ _, _ -> JsonPrimitive("fine") }) { host ->
    host.write("not json")
    assertEquals("ERR_BAD_REQUEST", host.next()["error"]!!.jsonObject["code"]!!.jsonPrimitive.content)
    host.write("""{"id":3,"method":"ping"}""")
    assertEquals(JsonPrimitive("fine"), host.next()["result"])
  }
}
