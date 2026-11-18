package expo.modules.wavenative.yt

import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test

class YtLikesTest {
  @Test
  fun sendsOnlyALikeForTheVideo() = runBlocking {
    val requests = mutableListOf<Pair<String, String>>()
    val likes = YtLikes { endpoint, body -> requests += endpoint to body.toString() }
    likes.like("video-123")
    assertEquals(listOf("like/like" to """{"target":{"videoId":"video-123"}}"""), requests)
  }

  @Test
  fun aRefusedWriteFailsTheCaller() = runBlocking {
    val likes = YtLikes { _, _ -> throw IOException("refused") }
    try {
      likes.like("video-123")
      fail("The export must stop on a failed write")
    } catch (error: IOException) {
      assertEquals("refused", error.message)
    }
  }
}
