package expo.modules.wavenative.yt

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Likes only: exporting never removes a like from the account. */
class YtLikes(private val send: suspend (String, JsonObject) -> Unit) {
  suspend fun like(videoId: String) {
    require(videoId.isNotBlank()) { "A like needs a video id" }
    send("like/like", buildJsonObject {
      put("target", buildJsonObject { put("videoId", videoId) })
    })
  }
}
